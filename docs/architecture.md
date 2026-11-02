---
id: ARCH
status: approved         # draft | approved — only the user approves
prd_version: 0.7
owner: architect
---

# Architecture

> v0.6 (bozza): aggiunge il backoffice di amministrazione (FR-92..FR-121, NFR-27..NFR-33): catalogo
> su D1 con cache KV e seed da `locations.json` (ADR-0006), secondo Worker `maestrale-admin` con
> Cloudflare Access e SSR (ADR-0007), registri su D1 (ADR-0008), "Esegui ora" asincrono con
> dispatcher a cron (ADR-0009), snapshot dell'app generato dal database (ADR-0010) e località
> iniziale dell'app per slug con migrazione una tantum (ADR-0011). ADR-0004 è
> superato. Il disegno approvato per il PRD v0.5 (storico, ADR-0002) resta invariato.
>
> v0.5 (approvata): aggiunge lo storico giornaliero del giorno 0 su D1, `GET /history` e la schermata
> storico nell'app (FR-69..FR-91, NFR-23..NFR-26, ADR-0002).

## 1. Context
Maestrale mostra previsioni marine e meteo giornaliere (7 giorni) per le località costiere della
Sardegna di un catalogo chiuso: oggi 13 sul piano Workers **Paid** (NFR-15, NFR-19), e lo **storico**
dei valori previsti per il giorno stesso (giorno 0), per località e per giorno (C-8). Attori: l'**app
Flutter** (unico client pubblico, un solo utente in sviluppo), il **proprietario** (operatore) e gli
**amministratori** (1–3 persone, browser desktop, FR-118), che gestiscono il catalogo e consultano le
esecuzioni dal backoffice (FR-92). Sistemi esterni: **Open-Meteo** (nessuna API key, chiamate
multi-coordinata), **Cloudflare** (Workers, Workers KV, D1, Cron Triggers) e **Cloudflare Access**
(autenticazione degli amministratori, OQ-39). Confine del sistema: il Worker pubblico `maestrale`
(`worker/`), il Worker `maestrale-admin` (`worker/src/admin/`), la KV `FORECASTS`, il database D1
`maestrale-history` (binding `HISTORY`) per lo storico e il database D1 `maestrale-core` (binding
`CORE`) per catalogo e registri. `locations.json` alla radice è solo il seed della migrazione
iniziale (FR-104); l'app raggiunge l'API via HTTPS con `API_BASE_URL` (FR-48) e il backoffice vive su
un'origine propria (FR-118).

## 2. Stack
| Layer | Choice | Why |
|---|---|---|
| Runtime | Cloudflare Workers (TypeScript), piano **Paid** (NFR-15) | NFR-12, NFR-15 |
| Router | Hono (Worker pubblico e backoffice) | leggero, tipizzato, funziona su Workers |
| Cache previsioni | Workers KV `FORECASTS`: `forecast:<slug>` + `meta` (`latest` congelato per la migrazione) | FR-55..FR-57, ADR-0003 |
| Catalogo | D1 `maestrale-core` (binding `CORE`, primario `weur`) + cache KV `catalog:current`; `locations.json` solo seed (FR-104) | FR-61, FR-101, NFR-33, ADR-0006 |
| Storico | Cloudflare D1 `maestrale-history` (binding `HISTORY`, primario `weur`), tabella `daily_history`, migrazioni in `worker/migrations/` | C-8, NFR-12, FR-69..FR-76, ADR-0002 |
| Backoffice | Worker `maestrale-admin` (Hono JSX, SSR) sull'origine `admin.<dominio>` | FR-92, FR-118, NFR-31, ADR-0007 |
| Autenticazione admin | Cloudflare Access sull'hostname admin + verifica del JWT nel Worker (`jose`) | FR-93, FR-94, NFR-27, ADR-0007 |
| Registri | D1 `maestrale-core`: `job_runs`, `job_run_failures`, `admin_actions`; elenco paginato e filtri in SQL | FR-105..FR-113, ADR-0008 |
| Scheduler | Cron `30 0,6,12,18 * * *` (job) e `* * * * *` (dispatcher, riparazione cache e retention) | FR-49, FR-114..FR-116, ADR-0009 |
| Test backend | Vitest + `@cloudflare/vitest-pool-workers` (KV e D1 di Miniflare: `HISTORY` e `CORE`) | NFR-13 |
| Client | Flutter, `--dart-define=API_BASE_URL`; `http`, `shared_preferences`, `flutter_map` + `flutter_map_marker_cluster`, `fl_chart` ^1.2.0 (MIT) | FR-48, FR-65, FR-68, FR-87, ADR-0005, ADR-0002 |

## 3. Components
| Component | Responsibility | Talks to |
|---|---|---|
| `worker/src/catalog.ts` | Unico accesso al catalogo: memo per isolate (TTL 30 s) → KV `catalog:current` → D1, `resolve(localita)` (FR-22), corpo ed ETag di `/locations`; cache assente e D1 illeggibile → `unavailable` (FR-120) | KV `FORECASTS`, D1 `CORE` |
| `worker/src/catalog_store.ts` (nuovo) | Lettura del catalogo attivo, insert/update con controllo di versione (FR-103), disattivazione/riattivazione, `catalog_meta` e ricostruzione della chiave KV (ADR-0006) | D1 `CORE`, KV |
| `worker/src/catalog_validation.ts` (nuovo) | Validazione pura di FR-98: slug normalizzato e unico su tutte le voci (attive e disattivate), nomi senza collisioni, coordinate nei limiti, avviso oltre 500 località | — |
| `worker/src/store.ts` | Accesso tipizzato alla KV: `forecast:<slug>`, `meta`, lettura bulk, `latest` (sola lettura, modalità legacy). Esiti come valori (`ok`/`missing`/`unreadable`) | KV |
| `worker/src/history.ts` (nuovo) | Funzioni pure dello storico: data Europe/Rome da un istante, estrazione della riga del giorno 0 da una `Forecast` (FR-69, FR-70), validazione dei parametri di `/history` (FR-77), scelta del `Cache-Control` (FR-79), `CASE` del rango Douglas generato dalla scala FR-10 | `aggregate.ts` (etichette FR-10) |
| `worker/src/history_store.ts` (nuovo) | Accesso tipizzato a D1: `writeHistory(db, rows, batchRows)` (upsert a blocchi in un `batch()`), `readDays`, `readMonths` (query di ADR-0002 §3); esiti come valori (`ok`/`unreadable`), mai eccezioni verso le route | D1 `HISTORY` |
| `worker/src/runs_store.ts` (nuovo) | Accesso tipizzato a D1 `CORE`: avvio/chiusura del registro di esecuzione e fallimenti, claim e lease di `run_requests`/`job_lock`, elenco/dettaglio, retention e watchdog; esiti come valori | D1 `CORE` |
| `worker/src/dispatch.ts` (nuovo) | Cron `* * * * *`: riparazione di `catalog:current`, watchdog FR-107, retention FR-112, claim ed esecuzione di "Esegui ora" (FR-114..FR-116, ADR-0009) | D1 `CORE`, KV, job |
| `worker/src/admin/` (nuovo) | Worker `maestrale-admin`: Hono JSX SSR (catalogo, esecuzioni, registro), verifica Access, form e POST con controllo dell'origine, "Esegui ora" | D1 `CORE`, KV, Access |
| Route `routes/forecast.ts` | `GET /forecast`: risolve lo slug dal catalogo, legge record + `meta` in 1 operazione, ripiego `latest`, 404 troncato (FR-58); catalogo non disponibile → 503 (FR-120) | catalog, store |
| Route `routes/health.ts` | `GET /health` dal solo `meta` (FR-56); modalità legacy se `meta` manca. **Invariata** (FR-81) | store |
| Route `routes/locations.ts` | `GET`/`HEAD /locations` con `ETag`, `Cache-Control`, 304 (FR-62, FR-63); corpo dalla cache del catalogo, 503 se non disponibile (FR-120) | catalog |
| Route `routes/history.ts` (nuova) | `GET`/`HEAD /history`: validazione 422, 404 dal catalogo, 1 query D1, involucro JSON, `Cache-Control` breve/lungo, 503 se D1 non leggibile o catalogo non disponibile (FR-74..FR-80, FR-120) | catalog, history, history_store |
| `worker/src/index.ts` | Composizione Hono del Worker pubblico; CORS invariato; handler `scheduled` che distingue i due cron: `30 0,6,12,18 * * *` → `runUpdate`, `* * * * *` → `dispatch.ts` | route, job, dispatch |
| Job `update.ts` + `blocks.ts` + `forecast.ts` + `aggregate.ts` + `open_meteo.ts` | Legge la versione del catalogo all'inizio (FR-102) e registra l'esecuzione (FR-105); fase blocchi multi-coordinata (FR-53), interruttore e fase fallback (FR-54), budget di durata e subrequest (FR-54, NFR-15, con le istruzioni D1 riservate), secchiello pesato (NFR-20), scrittura per località poi `meta`, seed di migrazione (FR-59), **poi** storico (FR-70..FR-72) tramite `deps.history`, `paid_alerts` nel log | Open-Meteo, KV, `HistoryWriter`, `RunsWriter` |
| `open_meteo.ts` | `fetchJson` (FR-17), `buildUrl` con liste di coordinate, `mapWithConcurrency`, limitatore pesato, contatore di subrequest | Open-Meteo |
| `worker/migrations/0001_daily_history.sql` (nuovo) | Schema di `daily_history` (ADR-0002 §1) | D1 `HISTORY` |
| `worker/migrations-core/0001_backoffice.sql` (nuovo) | Schema di `catalog_meta`, `locations`, `job_runs`, `job_run_failures`, `admin_actions`, `run_requests`, `job_lock` (ADR-0006, ADR-0008, ADR-0009) | D1 `CORE` |
| `worker/migrations-core/0002_seed_locations.sql` (generata) | Seed delle 13 località di `locations.json` (FR-104) | D1 `CORE` |
| `worker/wrangler.jsonc` | Due `d1_databases`: `HISTORY` (`maestrale-history`, `migrations_dir: "migrations"`) e `CORE` (`maestrale-core`, `migrations_dir: "migrations-core"`); cron aggiunto `* * * * *`; le `vars` restano facoltative (default nel codice) | — |
| `worker/wrangler.admin.jsonc` (nuovo) | Worker `maestrale-admin`: `main: src/admin/index.ts`, custom domain `admin.<dominio>`, binding `CORE` e `FORECASTS`, `vars` `ADMIN_ORIGIN`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`; nessun binding `HISTORY` né Open-Meteo | — |
| `README.md` | Sezioni `/history` (FR-82) e backoffice: aree, accesso, pagina del catalogo e delle esecuzioni, rinvio al runbook per Access e backup | — |
| App `LocationRepository` + `LocationCatalogApi` + `LocationCacheStore` + snapshot | Catalogo subito da copia locale o snapshot, poi sostituito da quello di rete (FR-65, FR-66) | Worker `/locations`, `shared_preferences`, asset |
| App `services/home_location.dart` (nuovo) | `resolveSavedHomeLocation(saved, catalog)`: migrazione una tantum nome → slug; se non risolve la preferenza resta invariata e si ritenta (FR-41, FR-42, FR-117, ADR-0011) | `shared_preferences` |
| App `services/api_errors.dart` (nuovo) | Estrazione del messaggio d'errore con le regole di FR-33 (`detail` testuale o `detail.message`, altrimenti messaggio generico con il codice), condivisa da `ForecastApi` (comportamento invariato) e `HistoryApi` | — |
| App `services/history_api.dart` (nuovo) | `HistoryApi({baseUrl, http.Client? client})`: `fetchDays(slug, from, to)` e `fetchMonths(slug, from, to)` → `GET /history?localita=<slug>&from&to&granularity`, timeout 15 s; risposta → `HistoryResult`; struttura non valida → "Risposta del server non valida" (FR-91) | Worker `/history` |
| App `models/history.dart` (nuovo) | `HistoryGranularity { day, month }`, `HistoryDay` (data + 7 valori nullable), `HistoryMonth` (mese, `days` + 7 valori nullable), `HistoryResult` (slug, nome, granularità, `from`, `to`, elementi) | — |
| App `services/rome_date.dart` (nuovo) | `romeToday(DateTime utcNow)` (regola UE dell'ora legale) e calcolo dei preset 7 giorni / 30 giorni / 12 mesi (FR-84) e del primo giorno ammesso dal selettore (FR-85) | — |
| App `screens/history_screen.dart` + `widgets/history_chart.dart`, `widgets/sea_state_strip.dart`, `widgets/history_table.dart` (nuovi) | Preset, intervallo personalizzato, granularità, stati di caricamento/vuoto/errore con "Riprova", nota FR-90 sempre visibile con dati, grafico (`fl_chart`), fascia stato del mare, tabella a righe a due livelli (FR-84..FR-90) | `HistoryApi` |
| App schermate (`forecast_screen.dart`, `coastal_map_screen.dart`) | Ricerca, mappa con cluster, previsioni; catalogo solo dal repository (FR-67, FR-68); `ForecastScreen` riceve anche `HistoryApi` e mostra il comando "Storico" solo con una previsione caricata (FR-83) | repository, `ForecastApi`, `HistoryScreen` |
| `scripts/sync_app_catalog.mjs` | Genera lo snapshot `app/assets/locations.json` dal risultato di `d1 execute --json` (`--from`), con le sole località attive ordinate per nome (FR-65, ADR-0010) | file |
| `scripts/seed_catalog.mjs` (nuovo) | Genera `worker/migrations-core/0002_seed_locations.sql` da `locations.json` (una tantum, FR-104) | file |
| `scripts/compare_backends.mjs` | Parità e smoke test | HTTP |

### Flusso del job (ADR-0003 §4, ADR-0002 §2)
1. Legge il catalogo dalla cache/D1 e lo valida (FR-2, FR-101, FR-102), registrando versione e numero
   di località; se non è valido non tocca il cache e chiude il registro con esito "rifiutata"
   (FR-106). Legge `meta`; se manca (prima esecuzione dopo la migrazione) legge anche `latest`.
   Calcola la data Europe/Rome dell'avvio (giorno 0).
2. Blocchi di `OPEN_METEO_BLOCK_SIZE` località (default 50, 1..100); per blocco 1 richiesta Marine +
   1 Forecast, al più `UPDATE_CONCURRENCY` (default 4) in volo, consumo ≤
   `OPEN_METEO_MAX_WEIGHT_PER_MIN` (default 300) chiamate pesate/min.
3. **Fase blocchi**: tutte le richieste di blocco fino all'esaurimento dei tentativi; ogni elemento
   della lista → `buildForecastFromPayloads` (stessa funzione della richiesta singola: FR-53 =
   FR-51). Località di blocchi falliti o con elemento non valido → candidate al fallback, solo per
   il provider mancante.
4. **Interruttore** (FR-54): dopo la fase blocchi e prima di ogni richiesta singola, se
   `richieste di blocco fallite / totali` (Marine e Forecast contate separatamente) è
   **> `FALLBACK_BREAKER_THRESHOLD`** (default 0.5; esattamente 0.5 → fallback eseguito), nessuna
   richiesta singola: le candidate conservano il dato precedente e ricevono in `errors` "Aggiornamento
   non tentato: interruttore del fallback attivo (guasto diffuso del provider)". Un blocco con solo
   alcuni elementi non validi non conta come fallito.
5. **Fase fallback** (se l'interruttore non è scattato): richieste singole per le candidate.
6. **Budget**: scadenza `UPDATE_BUDGET_SECONDS` (default 720) e tetto `UPDATE_MAX_SUBREQUESTS`
   (default 45, con riservate le operazioni KV **e le ⌈N/`HISTORY_WRITE_BATCH_ROWS`⌉ istruzioni D1**);
   le località non tentate vanno in `errors` con "Aggiornamento non tentato: budget di durata
   esaurito" / "... budget di subrequest esaurito".
7. Nessuna località aggiornata → nessuna scrittura (né KV né D1). Altrimenti: `put forecast:<slug>`
   per le aggiornate; in migrazione seed da `latest` delle non aggiornate; `delete` delle località
   uscite dal catalogo; infine `put meta`. `latest` non viene mai scritto (FR-59).
8. **Storico** (FR-70..FR-72): per ogni località aggiornata, la riga del giorno 0 presa dalla stessa
   previsione appena scritta (se il giorno 0 manca: nessuna riga, slug in `history_missing_day0`);
   righe in blocchi da `HISTORY_WRITE_BATCH_ROWS` (default 100), un'istruzione
   `INSERT … SELECT … FROM json_each(?1) WHERE true ON CONFLICT DO UPDATE` per blocco, tutte in un solo
   `HISTORY.batch()`, **un tentativo**. Qualunque errore è catturato e registrato (righe non scritte
   = tutte); KV, `meta`, `errors` e `/health` non cambiano.
9. Chiude il registro dell'esecuzione (FR-105): esito, durata, aggiornate, fallite con messaggio,
   non tentate, interruttore, metriche e storico. Un errore del registro è solo nel log e non cambia
   `/health` (FR-111).
10. Log `forecast_update` con le metriche di NFR-21, `fallback_breaker` (esito FR-52), le metriche
    dello storico (§6) e `paid_alerts` (NFR-15).

### Flusso del backoffice (ADR-0007, ADR-0009)
1. La richiesta passa da Cloudflare Access (login, sessione 8 h); il Worker admin verifica il JWT e
   l'email, altrimenti 401/403 (FR-93).
2. `GET /catalogo`, `/esecuzioni`, `/registro`: letture da D1 `CORE` (catalogo e registri), render
   SSR; `GET /esecuzioni/:id` unisce i fallimenti con il nome corrente.
3. `POST /catalogo/*`: validazione (FR-98), `batch()` D1 con il controllo di versione (FR-103) e la
   voce in `admin_actions` (FR-113), poi ricostruzione della chiave KV `catalog:current`
   (FR-101). Conflitto → 409 e nessuna scrittura.
4. `POST /esegui`: accettazione o rifiuto (FR-115) con voce in `admin_actions`; nessun lavoro nel
   Worker admin. Il dispatcher a cron ogni minuto esegue la richiesta (ADR-0009).

## 4. Data model
**Catalogo** (D1 `maestrale-core`, binding `CORE`, ADR-0006): `locations(slug PK, name, latitude,
longitude, active, version, created_at, updated_at)` con `active = 1` per le località servite, e
`catalog_meta(id = 1, version, updated_at)`. `locations.version` serve a FR-103;
`catalog_meta.version` è il contatore globale. Le letture usano solo le località attive, ordinate per
`name`. Vincoli verificati in `catalog_validation.ts`: slug = `slugify(slug)` e univoco su tutte le
voci (anche disattivate), nomi normalizzati senza collisioni con slug o nomi altrui, coordinate nei
limiti di FR-98. Il seed (`0002_seed_locations.sql`) contiene le 13 voci di `locations.json`, tutte
attive (FR-104).

**KV `catalog:current`** (ADR-0006): `{ schema_version: 1, catalog_version, etag, locations: [...] }`
con le sole attive ordinate per `name`; `etag` = SHA-256 del corpo canonico di `/locations`, calcolato
alla scrittura. È la sorgente calda di `/locations`, `/forecast` e `/history`; la memo per isolate
dura 30 s (NFR-33). Se la chiave manca si legge D1 e si ricostruisce; se manca anche D1 → 503
(FR-120). Il cron del dispatcher ripara la chiave se `catalog_version` diverge (ADR-0009).

**Registri** (D1 `maestrale-core`, ADR-0008/ADR-0009): `job_runs` (una riga per esecuzione, stato
`running`/`done`, esito FR-106, metriche JSON), `job_run_failures` (una riga per località fallita o
non tentata, `PRIMARY KEY (run_id, slug)`), `admin_actions` (registro operazioni, `before_json`/
`after_json`), `run_requests` (richieste "Esegui ora" in attesa) e `job_lock` (lease dell'esecuzione
in corso). Nessuna di queste tabelle è raggiungibile dall'API pubblica.

**KV `FORECASTS`** (ADR-0003), invariata:
| Chiave | Valore | Note |
|---|---|---|
| `forecast:<slug>` | JSON della previsione di una località, struttura congelata in `tests/fixtures/forecast.schema.json` (`location`, `cells`, `timezone`, `generated_at`, `sources`, `daily`) | 1 `put` atomica per esecuzione e località (FR-19); non riscritta se la località fallisce (FR-18) |
| `meta` | `{ schema_version: 1, generated_at, updated_locations: [slug], errors: {slug: msg}, locations: n, slugs: [slug] }` | ultima scrittura KV dell'esecuzione; `locations = slugs.length`; nessun campo dello storico |
| `catalog:current` | `{ schema_version: 1, catalog_version, etag, locations: [...] }` (solo attive, ordinate per `name`) | cache del catalogo, riscritta dal backoffice e riparata dal dispatcher (ADR-0006) |
| `latest` | documento v0.1 `{ schema_version, generated_at, updated_locations, errors, locations: {slug: previsione} }` | congelato: scritto solo dalla versione precedente del Worker; cancellato dall'operatore dopo 14 giorni senza rollback e con `/health` `ok` (FR-60) |

**D1 `maestrale-history`, tabella `daily_history`** (ADR-0002 §1, `worker/migrations/0001_daily_history.sql`):
| Colonna | Tipo | Note |
|---|---|---|
| `location_slug` | `TEXT NOT NULL` | slug del catalogo; **PK** con `date` |
| `date` | `TEXT NOT NULL` | `YYYY-MM-DD`, fuso Europe/Rome (giorno 0 dell'esecuzione); **PK** con `location_slug` |
| `air_temperature_mean_c`, `air_temperature_min_c`, `air_temperature_max_c` | `REAL` (nullable) | da `daily[d0].weather` (FR-8), copiati senza ricalcolo |
| `water_temperature_mean_c` | `REAL` (nullable) | da `daily[d0].sea` (FR-7) |
| `state` | `TEXT` (nullable) | etichetta Douglas di FR-10 |
| `wave_height_mean_m`, `wave_height_max_m` | `REAL` (nullable) | da `daily[d0].sea` (FR-7) |

`PRIMARY KEY (location_slug, date)`, `WITHOUT ROWID`: al più un record per coppia (FR-69), upsert
`ON CONFLICT` (FR-70), letture per intervallo come scansione contigua della PK, nessun indice
secondario. Nessuna cancellazione automatica (OQ-36). Capacità: ~150-190 byte/riga → 500 località ×
10 anni (≈ 1,83 M righe) ≈ 280-350 MB; 13 località ≈ 8 MB in 10 anni (NFR-24).

**App** (`shared_preferences`): `maestrale_home_location` (slug, FR-41/FR-117), `maestrale_catalog_json`
(corpo di `/locations`), `maestrale_catalog_etag`. Asset `assets/locations.json` (snapshot generato
dal database, ADR-0010). Lo storico non è salvato sul dispositivo (non-goal v0.5).

## 5. Interfaces / APIs
- `GET /health`: sempre 200, `status` `ok`|`degraded`; da `meta`: `generated_at`, `age_hours`,
  `stale`, `locations`, `update_errors`; `meta` (e `latest`) assente o illeggibile: `error` e
  `cache_path` (`kv:FORECASTS`, eccezione OQ-19). Contratto invariato (FR-26, FR-50, FR-56, FR-81):
  gli errori dello storico **non** lo influenzano. 1 lettura KV (2 in modalità legacy).
- `GET /forecast?localita=<nome o slug>`: 200 con l'oggetto località (contratto invariato); 404 con
  `detail.message` invariato e `detail.available` = primi **50** nomi ordinati, stesso formato
  (FR-58: identico a FR-23 con ≤ 50 località); 422 se `localita` manca o è vuoto; 503 se il cache
  manca o è illeggibile o se il catalogo non è disponibile (FR-120). 1 operazione KV nel caso 200, ≤ 2 negli altri.
- `GET /locations` (FR-62/FR-63, ADR-0006): 200
  `{ "schema_version": 1, "version": "<hash>", "count": n, "locations": [{slug, name, latitude, longitude}] }`
  ordinato per `name`; header `ETag: "<hash>"` (SHA-256 del corpo, 16 esadecimali, calcolato alla
  scrittura della cache), `Cache-Control: public, max-age=<LOCATIONS_MAX_AGE_SECONDS>` (default 86400),
  `Access-Control-Expose-Headers: ETag`; `If-None-Match` corrispondente → 304 senza corpo. `HEAD`
  come `GET` senza corpo. 1 lettura KV (0 se la memo per isolate è valida), nessuna chiamata ai
  provider; catalogo non disponibile → **503** "Catalogo temporaneamente non disponibile" (FR-120).
- `GET /history?localita=<nome o slug>&from=YYYY-MM-DD&to=YYYY-MM-DD[&granularity=day|month]`
  (nuovo, FR-74..FR-80, ADR-0002 §3):
  - **200** `{ "schema_version": 1, "location": {slug, name}, "granularity", "from", "to",
    "timezone": "Europe/Rome", "items": [...] }`; con `day` ogni elemento è
    `{ date, air_temperature_mean_c, air_temperature_min_c, air_temperature_max_c,
    water_temperature_mean_c, state, wave_height_mean_m, wave_height_max_m }` in ordine di data; con
    `month` `{ month: "YYYY-MM", days, …stessi 7 campi }` in ordine di mese: media aria media (1 dec.),
    minimo delle minime, massimo delle massime, media mare (1 dec.), media onda media (2 dec.),
    massimo onda massima, `state` = moda con pareggio → rango Douglas più alto, `null` ignorati,
    tutti `null` → `null`; aggregazione in **una query SQL** (`GROUP BY substr(date,1,7)` +
    `ROW_NUMBER()`). Giorni/mesi senza record omessi; nessun record → `items: []`.
  - **422** (`detail` in italiano): `localita` assente o vuoto; `granularity` presente e diverso da
    `day`/`month`; `from`/`to` assenti o non date di calendario `YYYY-MM-DD`; `from` > `to`; `day` con
    più di 366 giorni (estremi inclusi); `month` con più di 120 mesi toccati. `to` nel futuro è ammesso.
  - **404**: località non nel catalogo; `detail.message` "Localita '<valore>' non trovata",
    `detail.available` = primi 50 nomi ordinati del catalogo (formato FR-58), nessuna lettura KV.
  - **503**: binding `HISTORY` assente, tabella assente o query fallita, o catalogo non disponibile
    (FR-120); `detail` "Storico
    temporaneamente non disponibile" (errore originale solo nel log).
  - Header della 200: `Cache-Control: public, max-age=<HISTORY_MAX_AGE_SHORT_SECONDS>` (default 900)
    se `to` ≥ oggi Europe/Rome, altrimenti `max-age=<HISTORY_MAX_AGE_LONG_SECONDS>` (default 86400).
    Nessun header di cache sugli errori.
  - `HEAD` come `GET` senza corpo; 1 query D1, 0 operazioni KV, nessuna chiamata ai provider.
- `GET /` sonda di liveness (invariata).
- Sola lettura, nessuna autenticazione, CORS da `CORS_ORIGINS` (default `*`), `allowMethods`
  `["GET"]` invariato (FR-64, FR-80). Nessun `/docs` (FR-29 escluso); la documentazione di `/history`
  per i client è nel README (FR-82).
- Contratto del payload previsione: `tests/fixtures/forecast.schema.json` (congelato).

**Configurazione** (variabili d'ambiente in `wrangler.jsonc`, nessuna modifica di codice, FR-28/FR-53/FR-63/FR-79):
| Variabile | Default | Uso |
|---|---|---|
| `CORS_ORIGINS` | `*` | FR-28 |
| `FORECAST_MAX_AGE_HOURS` | `12` | soglia `stale` |
| `LOCATIONS_MAX_AGE_SECONDS` | `86400` | `Cache-Control` di `/locations` |
| `OPEN_METEO_BLOCK_SIZE` | `50` (1..100) | FR-53 |
| `UPDATE_CONCURRENCY` | `4` (1..6) | NFR-17 |
| `OPEN_METEO_MAX_WEIGHT_PER_MIN` | `300` | NFR-20 (< 600) |
| `UPDATE_BUDGET_SECONDS` | `720` | FR-54, NFR-15 |
| `UPDATE_MAX_SUBREQUESTS` | `9000` (Paid) | NFR-15: tetto di subrequest per esecuzione, KV e D1 incluse |
| `FALLBACK_BREAKER_THRESHOLD` | `0.5` (scatta se strettamente maggiore) | FR-54, OQ-28 |
| `PAID_ALERT_SUBREQUESTS` | `40` | NFR-15 (b), segnalazione nel log |
| `PAID_ALERT_KV_WRITES_PER_DAY` | `700` | NFR-15 (c), OQ-29, segnalazione nel log |
| `LEGACY_LATEST_FALLBACK` | `true` | FR-59; disattivato nel rilascio che precede la cancellazione di `latest` (FR-60) |
| `HISTORY_WRITE_BATCH_ROWS` | `100` (1..400) | righe per istruzione di upsert (ADR-0002 §2, OQ-35) |
| `HISTORY_MAX_AGE_SHORT_SECONDS` | `900` | FR-79, OQ-32: `to` ≥ oggi |
| `HISTORY_MAX_AGE_LONG_SECONDS` | `86400` | FR-79, OQ-32: intervallo tutto nel passato |
| `PAID_ALERT_D1_SIZE_MB` | `350` | proposta OQ-35: `paid_alerts: d1_size` se `size_after` > soglia |
| `ADMIN_ORIGIN` | `https://admin.<dominio>` | origine del backoffice; controllo `Origin`/`Referer` (NFR-27) |
| `ACCESS_TEAM_DOMAIN` | — | team Cloudflare Access per le JWKS (ADR-0007) |
| `ACCESS_AUD` | — | audience del JWT di Access (ADR-0007) |
| `MIN_ON_DEMAND_INTERVAL_SECONDS` | `900` (minimo 900) | FR-115, ADR-0009 |
| `RUN_DISPATCH_ENABLED` | `true` | ADR-0009: disattiva il dispatcher nei test di parità |
| `JOB_MAX_DURATION_SECONDS` | `900` | FR-107, NFR-15: watchdog delle esecuzioni non completate |
| `RUN_RETENTION_DAYS` | `90` | FR-112, NFR-30 |
| `ACTIONS_RETENTION_DAYS` | `730` | FR-113, NFR-29 (24 mesi) |
| `CATALOG_CACHE_TTL_SECONDS` | `30` | NFR-33: memo per isolate del catalogo |
| `CATALOG_MAX_LOCATIONS` | `500` | FR-98: avviso, non blocco |
| `CATALOG_AREA_MIN_LAT`, `CATALOG_AREA_MIN_LON` | `38.5`, `7.5` | FR-98 |
| `CATALOG_AREA_MAX_LAT`, `CATALOG_AREA_MAX_LON` | `41.5`, `10.2` | FR-98 |
| `ADMIN_PAGE_SIZE` | `20` | FR-108 |

### App: schermata storico (FR-83..FR-91, ADR-0002 §4)
- **Accesso**: comando "Storico" nella schermata previsioni, presente solo con `_forecast` caricata;
  apre `HistoryScreen(slug: forecast.location.slug, name: …)` con `Navigator.push` (FR-83).
- **Controlli**: preset "7 giorni", "30 giorni", "12 mesi" (date da `romeToday`, FR-84; preset
  iniziale secondo la decisione dell'owner su OQ-34, proposta "7 giorni") e "Personalizzato"
  (`showDateRangePicker` con `lastDate` = oggi Roma e `firstDate` = 1° giorno del mese di 119 mesi
  prima: ogni selezione confermabile rispetta FR-85). Selettore giorno/mese (`SegmentedButton`),
  "giorno" disabilitato oltre 366 giorni (FR-86). Ogni cambio → nuova richiesta; un contatore di
  richiesta scarta le risposte superate.
- **Stati** (FR-89): indicatore di avanzamento; `items` vuoto → "Nessun dato storico per il periodo
  selezionato"; errore (HTTP ≠ 200, timeout 15 s, rete, risposta non valida) → messaggio con le regole
  di FR-33 (`api_errors.dart`) e "Riprova" che ripete l'ultima richiesta.
- **Contenuto con dati**: nota fissa "Valori previsti per il giorno stesso, non misure osservate"
  (FR-90) sopra il grafico; grafico `fl_chart` (aria media, banda min/max con `BetweenBarsData`, mare
  medio; giorni mancanti e `null` → `FlSpot.nullSpot`; assi con limiti espliciti); fascia colorata
  dello stato del mare allineata all'asse x con legenda; tabella con righe a due livelli ad altezza
  fissa (`SliverFixedExtentList`), `null` → "n.d.", per i mesi anche `days` (FR-87, FR-88).

### Backoffice (Worker `maestrale-admin`, FR-92..FR-121, ADR-0007)
- **Origine**: `https://admin.<dominio>` (`ADMIN_ORIGIN`), distinta dall'API pubblica; nessun CORS,
  nessun endpoint admin sull'origine pubblica.
- **Identità** (FR-93): JWT di Cloudflare Access (`Cf-Access-Jwt-Assertion`) verificato (RS256, JWKS
  memoizzate 1 h, `aud`/`exp`/`iss`); email da `Cf-Access-Authenticated-User-Email`; assente o non
  valido → 401, identità non autorizzata → 403, nessun dato nel corpo. In test l'identità è iniettata
  da un `AccessVerifier` finto (NFR-13).
- **Pagine** (SSR, italiano, date in Europe/Rome):
  - `GET /` → 302 `/catalogo`;
  - `GET /catalogo?q=&stato=` — elenco con stato, totale e totale attive (FR-96), ordinato per `name`,
    senza paginazione;
  - `GET /catalogo/nuovo`, `GET|POST /catalogo/:slug` — form con errori per campo (FR-97..FR-99);
    `slug` in sola lettura in modifica;
  - `POST /catalogo/:slug/disattiva|riattiva` — conferma con slug e nome (FR-100, FR-119);
  - `GET /esecuzioni?esito=&da=&a=&page=` — elenco paginato a `ADMIN_PAGE_SIZE` (20) (FR-108);
  - `GET /esecuzioni/:id` — dettaglio, fallimenti ordinati per slug con nome corrente (FR-109);
  - `GET /registro?slug=&admin=` — registro operazioni (FR-113);
  - `GET|POST /esegui` — conferma e avvio (FR-114..FR-116).
- **Scritture**: solo `POST`; controllo `Origin`/`Referer` = `ADMIN_ORIGIN` (NFR-27); `303` + messaggio
  flash; validazione fallita → riformulazione con errori per campo; conflitto di versione → `409`
  (FR-103); `Cache-Control: no-store`, CSP `default-src 'self'; frame-ancestors 'none'`,
  `X-Content-Type-Options: nosniff`.
- **"Esegui ora"**: `POST /esegui` inserisce una richiesta in `run_requests` o la rifiuta con motivo
  (FR-115), risponde subito e il dispatcher la esegue entro ~60 s (ADR-0009).

## 6. Cross-cutting concerns
- **Errori**: lettura KV e parse come valori tipizzati (`store.ts`), mai eccezioni verso le route;
  `/health` non fallisce mai (FR-26). Il job lancia solo per catalogo invalido (FR-2) o scrittura KV
  fallita; errori per località in `errors` (FR-18, FR-54). Una `put` fallita a metà esecuzione lascia
  record nuovi e `meta` vecchio: stato coerente per località, accettato come R-9. **Storico**: ogni
  errore D1 nel job è catturato dopo la pubblicazione del cache (FR-72); in `/history` D1 restituisce
  esiti tipizzati (`history_store.ts`) e un errore diventa 503; nessuna eccezione non gestita.
- **Sicurezza**: l'API pubblica resta in sola lettura (NFR-11, FR-73); le uniche scritture sono del
  job e del backoffice autenticato (FR-93). Tutte le query usano parametri legati (`bind`), date
  validate prima del bind, slug sempre dal catalogo; i messaggi di 503 non espongono SQL. Il Worker
  admin è su un'origine propria davanti a Cloudflare Access, con verifica del JWT (ADR-0007) e
  controllo dell'origine sulle scritture (NFR-27); nessun segreto nel repository (NFR-8, gli id dei
  database non sono segreti); la posizione non lascia il dispositivo (NFR-9).
- **Osservabilità**: log JSON `forecast_update` (NFR-18, NFR-21, FR-52) con durata, blocchi,
  richieste e fallimenti di blocco, `fallback_breaker`, fallback, subrequest (KV e D1 incluse),
  scritture/cancellazioni KV, peso consumato, budget esaurito (`duration`/`subrequests`),
  `paid_alerts`, e per lo storico: `history_date`, `history_rows` (righe scritte), `history_queries`,
  `history_failed` (righe non scritte), `history_error`, `history_missing_day0`, `d1_rows_written`,
  `d1_size_bytes` (da `meta` del risultato D1); un `console.error` per località fallita e per errore
  dello storico; `console.error` sui 503 di `/history`. Workers Logs abilitati
  (`observability.enabled`). Il backoffice logga `admin_action` (azione, slug, esito, email) e
  `run_dispatch` (richiesta, esito del claim, durata); gli errori del registro delle esecuzioni sono
  solo nel log (FR-111). CPU e invocazioni fallite si leggono da Workers Logs/dashboard (NFR-15).
- **Test** (NFR-13): fetch/sleep/now iniettati; parità FR-51 sulla funzione pura condivisa fra
  risposta singola e lista; test esistenti su `latest` coperti dalla modalità legacy (FR-64) e
  invariati (FR-81); test del catalogo reale; **D1 di Miniflare** dal binding di `wrangler.jsonc` con
  le migrazioni di `worker/migrations/` applicate in un file di setup di Vitest (`applyD1Migrations`),
  per upsert, giro di andata e ritorno dei valori (identità FR-69, `null` inclusi), divisione in
  blocchi (100/101 righe), query `day`/`month` (moda, pareggio, tutti `null`, mesi parziali); job con
  `HistoryWriter` finto (errore → cache identico, FR-72; località fallita → nessuna riga, FR-71);
  route con D1 finto che fallisce (503) e casi limite di 422 e `Cache-Control` (`to` = oggi). Test
  Flutter con repository, client e store finti; `HistoryApi` con `http.Client` finto (FR-91);
  `romeToday` sui cambi d'ora; widget test della schermata storico con 366 elementi. **Backoffice**:
  `AccessVerifier` finto (ok, 401, 403), D1 `CORE` di Miniflare con le migrazioni, test del catalogo
  (validazione, conflitto FR-103, disattivazione/riattivazione, cache KV e riparazione), dei registri
  (elenco, filtri, paginazione, dettaglio, watchdog, retention), di "Esegui ora"
  (accettazione/rifiuto, claim, lease, singola località senza `meta`), delle pagine SSR e dei codici
  401/403/409; un test verifica che il bundle pubblico non contenga più `locations.json`.
- **Rilascio** (ADR-0002 §1, ADR-0006, ADR-0007, ADR-0009): `wrangler d1 create maestrale-core
  --location=weur`, id nei due `wrangler` config, `wrangler d1 migrations apply maestrale-core
  --remote` (schema + seed delle 13 località), deploy del Worker pubblico (ora legge il catalogo da
  `CORE`), deploy di `maestrale-admin`, applicazione Cloudflare Access sull'hostname admin con la
  policy delle 1–3 email. Il seed è **una tantum**: dopo l'attivazione `locations.json` non è più
  letto. Storico: `wrangler d1 create maestrale-history --location=weur`, migrazioni, deploy; la data
  del primo deploy con lo storico è la data di attivazione da dichiarare nel README (FR-82). Un deploy
  prima delle migrazioni non rompe il cache (errore nel log, `/history` e `/locations` 503).
  Cancellazione di `latest` secondo FR-60. Backup di `CORE` (Time Travel o export pianificato) e
  procedura di ripristino nel runbook (FR-121).

## 7. Non-functional requirements mapping
| NFR | How it is met |
|---|---|
| NFR-1 | `stale` da `meta.generated_at` e `FORECAST_MAX_AGE_HOURS` |
| NFR-2 | Cron ogni 6 h (FR-49) |
| NFR-3 | Una `put` per località; località fallita non riscritta; nessuna scrittura se nulla è aggiornato; errore D1 isolato dopo la pubblicazione del cache |
| NFR-4 | `/forecast` 1 operazione KV (bulk), `/health` 1, `/locations` 0; nessuna chiamata provider |
| NFR-5 | 2 richieste per blocco + fallback; budget 12 min, ~3,3 min nominali con 500 località; storico in una transazione da ≤ 5 istruzioni |
| NFR-6 | 30 s × 3 tentativi verso i provider; 15 s app → `/locations`, `/forecast` e `/history` |
| NFR-7 | `sources.*` invariati nel record per località |
| NFR-8 | Nessuna API key; nessun segreto per D1 (binding) |
| NFR-9 | Località più vicina calcolata sul dispositivo; `/history` riceve solo slug e date |
| NFR-10 | Messaggi in italiano (incluso budget esaurito e 422/503 di `/history`); date dello storico e preset dell'app in Europe/Rome (`Intl` nel Worker, `romeToday` nell'app) |
| NFR-11 | API pubblica solo `GET`/`HEAD` (anche `/history`); scritture solo dal job e dal backoffice autenticato (FR-93); nessun endpoint pubblico di scrittura |
| NFR-12 | Workers + KV per cache previsioni e catalogo; D1 per lo storico (`HISTORY`) e per catalogo e registri (`CORE`) |
| NFR-13 | Dipendenze iniettabili backend e app (`HistoryWriter`, `RunsWriter`, `AccessVerifier`, `http.Client` di `HistoryApi`); Miniflare per KV e per entrambi i D1, con le rispettive migrazioni applicate nei test |
| NFR-14 | Ogni chiave scritta una volta per esecuzione (≤ 1/s); `put` atomica per località |
| NFR-15 | Piano **Paid** (dal 2026-11-01): con 13 località ~18 subrequest nominali (17 + 1 istruzione D1), 56 scritture KV/giorno, 52 righe D1/giorno; con 500 località ~528 subrequest nominali (5 istruzioni D1), ~3.600 nel caso peggiore (< 10.000), ≤ ~505 operazioni KV (< 1.000), 5 query D1 (< 1.000); CPU ≪ 15 min; D1: 100 parametri/query e 100 KB per istruzione rispettati; il cron dispatcher aggiunge ~1.440 invocazioni/giorno trascurabili. `paid_alerts` restano come segnalazione nei log, senza soglie Free bloccanti |
| NFR-16 | Consistenza eventuale KV accettata; ripiego `latest` durante la migrazione; D1 a consistenza forte sul primario (nessuna replica) |
| NFR-17 | ≤ 4 richieste in volo (blocchi e fallback) |
| NFR-18 | Log `forecast_update` + errori per località + metriche ed errori dello storico |
| NFR-19 | Catalogo in D1 dietro cache KV (1 lettura, 2 per `/forecast`), memo 30 s; `/locations` ≈ 40 KB con 500 voci; 500 località sul piano Paid (già attivo); oltre 500 solo avviso (FR-98) |
| NFR-20 | Peso 1 per località per API → 1.000/esecuzione, 4.000/giorno; secchiello a 300/min (< 600); interruttore del fallback nel guasto diffuso; lo storico non chiama i provider |
| NFR-21 | Metriche nel log, incluse istruzioni e righe D1 scritte; fan-out non introdotto |
| NFR-22 | Catalogo da copia locale/snapshot pubblicato subito, rete in parallelo (FR-65); nomi normalizzati precalcolati; marker cluster |
| NFR-23 | `/history` = 1 query D1 su `location_slug = ?` e `date BETWEEN` sulla PK `WITHOUT ROWID` (scansione contigua, ≤ 366 righe per `day`, ≤ ~3.660 per `month`), aggregazione in SQL; costo indipendente dal catalogo; 0 letture KV; primario D1 in `weur`; `Cache-Control` lungo per il passato |
| NFR-24 | ~150-190 byte/riga → 500 × 10 anni ≈ 280-350 MB (< 10 GB Paid); 13 località ≈ 8 MB; `d1_size_bytes` nel log per la misura; nessuna cancellazione (OQ-36 risolta in v0.7: conservazione indefinita) |
| NFR-25 | Una transazione da ⌈N/100⌉ istruzioni (1 con 13, 5 con 500), ordine delle centinaia di ms (< 5 s); istruzioni nel budget di subrequest; `history_queries`/`d1_rows_written` nel log |
| NFR-26 | `fl_chart` con limiti degli assi espliciti e ≤ 366 punti per serie; fascia stato del mare in un solo `CustomPainter`; tabella pigra ad altezza fissa (`SliverFixedExtentList`); nessun calcolo pesante nel `build` (serie precalcolate alla ricezione) |
| NFR-27 | JWT di Access verificato su ogni richiesta admin; 401/403 senza dati; `Origin`/`Referer` = `ADMIN_ORIGIN` sulle scritture; cookie di sessione SameSite; nessun segreto nel repository; revoca documentata nel runbook (15 min) |
| NFR-28 | Worker e origine separati (`maestrale-admin`); nessun CORS admin; l'API pubblica non espone route admin; i registri stanno su `CORE`, distinto da `HISTORY`; la KV è condivisa solo per `catalog:current` |
| NFR-29 | `admin_actions` scritto nella stessa `batch()` della modifica; nessun endpoint di modifica o cancellazione; retention 730 giorni (24 mesi) |
| NFR-30 | `RUN_RETENTION_DAYS = 90`; i fallimenti sono righe (500 righe/run ≈ 100 KB totali, non un singolo valore); il watchdog chiude le esecuzioni `running` scadute |
| NFR-31 | SSR senza bundle client; elenco con 500 righe ≈ 40 KB; paginazione a 20; indici su `job_runs.started_at` e `admin_actions.slug`; p95 < 1 s da misurare |
| NFR-32 | Registro: 1 `INSERT` all'avvio e 1 `batch()` alla fine; lettura catalogo dalla cache (1 KV, 1 D1 al miss); < 2 s nominale da misurare |
| NFR-33 | KV `catalog:current` + memo 30 s; riparazione dal dispatcher entro ~60 s; cache assente e D1 giù → 503 (FR-120); modifica visibile entro il target di 60 s |

## 8. Decisions
| ADR | Title | Status |
|---|---|---|
| [ADR-0001](adr/0001-cloudflare-workers-kv.md) | Backend su Cloudflare Workers con cache su Workers KV | proposed |
| [ADR-0002](adr/0002-storico-giornaliero-d1.md) | Storico giornaliero del giorno 0 su D1, `GET /history` e schermata storico | proposed |
| [ADR-0003](adr/0003-cache-per-localita-e-blocchi-open-meteo.md) | Cache per località su KV, chiamate Open-Meteo a blocchi, migrazione da `latest` | accepted |
| [ADR-0004](adr/0004-catalogo-localita-file-versionato.md) | Catalogo come file versionato e `GET /locations` | superseded by ADR-0006 |
| [ADR-0005](adr/0005-location-repository-app.md) | LocationRepository nell'app, snapshot, clustering | accepted |
| [ADR-0006](adr/0006-catalogo-d1-con-cache-kv.md) | Catalogo su D1 con cache KV, seed una tantum | proposed |
| [ADR-0007](adr/0007-backoffice-worker-separato-access.md) | Backoffice come Worker separato, SSR e Cloudflare Access | proposed |
| [ADR-0008](adr/0008-registri-esecuzioni-operazioni-d1.md) | Registri delle esecuzioni e delle operazioni su D1 | proposed |
| [ADR-0009](adr/0009-esegui-ora-dispatcher-cron.md) | "Esegui ora" asincrono con dispatcher a cron ogni minuto | proposed |
| [ADR-0010](adr/0010-snapshot-app-dal-database.md) | Snapshot del catalogo nell'app generato dal database | proposed |
| [ADR-0011](adr/0011-localita-iniziale-slug.md) | Località iniziale dell'app per slug con migrazione una tantum | proposed |

Il numero 0002, lasciato libero in v0.4, è ora usato dallo storico su D1. ADR-0004 è superato da
ADR-0006 ma resta la storia della scelta v0.4.

## 9. Risks and open points
- **Risposte proposte dall'architect, da approvare dall'owner** (dettaglio e motivazioni in
  ADR-0002 §5):
  - **OQ-30**: `from`/`to` obbligatori (422); `to` nel futuro ammesso; con `month` date
    `YYYY-MM-DD` e mesi parziali rivelati da `days`.
  - **OQ-31**: errore di scrittura dello storico solo nel log, `/health` invariato; D1 non leggibile →
    `/history` 503 "Storico temporaneamente non disponibile".
  - **OQ-32**: medie mensili a 1 decimale (temperature) e 2 (onde), min/max non riarrotondati;
    `Cache-Control` 900 s / 86.400 s, configurabili.
  - **OQ-33**: `fl_chart` ^1.2.0; stato del mare come fascia colorata con legenda; tabella a righe a
    due livelli senza scorrimento orizzontale.
  - **OQ-35**: upsert a blocchi da 100 righe con un parametro JSON in un solo `batch()` (1 query con
    13 località, 5 con 500); 280-350 MB per 500 × 10 anni; segnalazione `d1_size` a 350 MB nei log
    (la regola go/no-go Free è superata).
- **Domande aperte non dell'architect che toccano il disegno**: **OQ-34** (preset iniziale, granularità
  di "12 mesi", "Storico" con previsione in errore: oggi il comando richiede una previsione caricata,
  come FR-83); **OQ-37** (fedeltà di C-8 a D-1..D-6). **OQ-36** è risolta in v0.7: conservazione
  indefinita; una località disattivata conserva le righe e nessuna migrazione dello slug è prevista.
- **Interpretazione di FR-78**: `detail.available` del 404 di `/history` usa i nomi del **catalogo**
  (dalla cache KV), mentre `/forecast` usa i nomi delle località con un record (`meta.slugs`). A
  regime coincidono; da confermare se l'owner vuole l'identità esatta.
- **Subrequest e D1**: la documentazione non chiarisce se un `batch()` conti come una o più
  subrequest; si contano le istruzioni (prudenziale).
- **Funzionalità SQLite da verificare nella D1 di Miniflare e in produzione**: `WITHOUT ROWID`,
  `json_each`/`json_extract`, funzioni finestra, `meta.size_after`; e l'API per applicare le
  migrazioni con `@cloudflare/vitest-pool-workers` 0.23 (migrazione al nuovo plugin ancora in
  TODO E01-S08).
- **`fl_chart`**: resa di `BetweenBarsData` quando le serie contengono `nullSpot` da verificare con un
  test widget o una prova visiva prima della storia del grafico.
- **`romeToday` nell'app** implementa la regola UE dell'ora legale; se la regola cambiasse servirebbe
  un aggiornamento (alternativa: pacchetto `timezone`).
- **R-11/R-12**: il giorno corrente si stabilizza dopo l'ultima esecuzione del giorno; un errore D1
  sull'ultima esecuzione lascia il valore di un'esecuzione precedente o nessun record (accettato,
  C-8).
- **Parametri aperti, configurabili con default** (decisione dell'owner attesa, nessuna modifica di
  codice al cambio): **OQ-28** soglia dell'interruttore, `FALLBACK_BREAKER_THRESHOLD = 0.5`
  (strettamente maggiore); **OQ-29** superata (servizio su Paid): l'alert `PAID_ALERT_KV_WRITES_PER_DAY
  = 700` resta solo come segnalazione nei log.
- **Budget di subrequest** (`UPDATE_MAX_SUBREQUESTS`): tetto per esecuzione (9.000 sul piano Paid,
  KV e D1 incluse); le località non tentate ricevono un messaggio esplicito come per il budget di
  durata di FR-54.
- **Località senza record valido escluse dal fallback dall'interruttore**: quelle di un blocco
  riuscito ma con elemento non valido ricevono lo stesso messaggio dell'interruttore, perché FR-54
  vieta qualunque richiesta singola nell'esecuzione.
- **CPU**: il tetto del piano Paid (30 s per cron con intervallo < 1 h) va verificato con la misura
  di NFR-21 (E01-S07 AC-9 ancora da misurare), ma non è un rischio a 500 località.
- **R-8 quota residua**: con fino al 50% dei blocchi falliti il fallback consuma fino a ~3.600
  chiamate pesate per esecuzione (cadenzamento × budget); collegato a OQ-9.
- **Limiti Open-Meteo non documentati**: lunghezza massima dell'URL e garanzia d'ordine della lista
  multi-coordinata; blocchi limitati a 100 e test di contratto manuale prima del rilascio.
- **R-9**: `/health` e `/forecast` possono riflettere esecuzioni diverse per poco tempo; accettato.
- **Tetto KV di 1.000 operazioni per invocazione**: catalogo ≤ ~990 località senza fan-out.
- **Lettura bulk KV** nel pool di test in uso da verificare; in mancanza 2 `get` paralleli (≤ 2
  operazioni, NFR-19 rispettato).
- **Modalità legacy** temporanea: va rimossa con i test che popolano `latest` nel rilascio che
  precede la cancellazione di `latest` (FR-60); data di partenza del conteggio di 14 giorni e
  rollback annotati nel runbook.
- **Rollback seguito da nuovo rilascio**: `/forecast` serve record per località più vecchi di
  `latest` fino al cron successivo (≤ 6 h). Un rollback a una versione senza storico non tocca D1;
  i giorni del rollback mancano nello storico (nessun backfill).
- **Località nuova fra deploy e cron**: in `/locations` ma 404 su `/forecast` per al più 6 h; su
  `/history` 200 con `items` vuoto.
- **Consistenza eventuale della KV (NFR-16)**: accettata. **Cron solo UTC**: invariato.
- **Fixture congelate**: nessuna validazione automatica contro lo schema; rigenerazione dal tag
  `python-baseline`.
- **Backoffice — rischi e punti aperti**:
  - **Time Travel D1**: copre una finestra limitata (30 giorni sul piano Paid); NFR-29 richiede 24
    mesi di registro operazioni, quindi servono **export periodici** (almeno mensili) conservati fuori
    dal database (R2 o repository) e la procedura di ripristino nel runbook (FR-121). Da confermare
    nell'implementazione.
  - **Ritardo di "Esegui ora"**: l'esecuzione parte entro ~60 s; l'interfaccia deve mostrare la
    richiesta come "in attesa" e la pagina esecuzioni deve includere le richieste `pending`, altrimenti
    l'amministratore non vede nulla per un minuto.
  - **Dispatcher unico**: se il cron `* * * * *` è disattivato o fallisce ripetutamente, le richieste
    restano `pending`, la cache del catalogo non viene riparata e il watchdog non chiude le esecuzioni
    interrotte. Va monitorato (Workers Logs) e il runbook deve dire come intervenire.
  - **Due Worker sulla stessa KV/D1**: il Worker admin scrive `catalog:current` e `run_requests`; un
    errore di deploy del solo admin non rompe l'API pubblica, ma un cambio di schema non applicato a
    entrambi sì. Migrazioni prima dei deploy, sempre.
  - **`jose` e JWKS**: la verifica del JWT aggiunge una dipendenza e una fetch alle JWKS (memoizzata
    1 h); un'eventuale rotazione delle chiavi di Access non richiede deploy, ma va tollerata (retry).
  - **`locations.json` congelato**: dopo il seed il file non è più una fonte; va dichiarato nel
    README e nel runbook per evitare che qualcuno lo modifichi aspettandosi un effetto (FR-104).
  - **OQ-4, OQ-16, OQ-35, OQ-37** restano aperte e non bloccano il backoffice; OQ-16 (priorità) e
    OQ-4 (allerte) vanno chiuse prima del rilascio pubblico.
