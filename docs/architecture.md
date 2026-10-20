---
id: ARCH
status: approved         # draft | approved — only the user approves
prd_version: 0.5
owner: architect
---

# Architecture

> v0.5 (bozza): aggiunge lo storico giornaliero del giorno 0 su D1, `GET /history` e la schermata
> storico nell'app (FR-69..FR-91, NFR-23..NFR-26, ADR-0002). Il resto del disegno approvato per il
> PRD v0.4 è invariato.

## 1. Context
Maestrale mostra previsioni marine e meteo giornaliere (7 giorni) per le località costiere della
Sardegna di un catalogo chiuso: oggi 13 sul piano Workers Free, fino a ~500 sul piano Paid (C-4,
C-5, NFR-15, NFR-19), e lo **storico** dei valori previsti per il giorno stesso (giorno 0), per
località e per giorno (C-8). Attori: l'**app Flutter**
(unico client, un solo utente in sviluppo) e il **proprietario** (operatore, gestisce anche il
catalogo). Sistemi esterni: **Open-Meteo** (Marine e Weather Forecast, nessuna API key, chiamate
multi-coordinata) e **Cloudflare** (Workers, Workers KV, D1, Cron Triggers). Confine del sistema: il
Worker `maestrale` (`worker/`), la KV `FORECASTS`, il database D1 `maestrale-history` (binding
`HISTORY`) e il file di catalogo `locations.json`; l'app lo raggiunge via HTTPS con `API_BASE_URL`
(FR-48).

## 2. Stack
| Layer | Choice | Why |
|---|---|---|
| Runtime | Cloudflare Workers (TypeScript), piano **Free ora, Paid alla soglia** (C-5) | NFR-12, NFR-15; stesso codice sui due piani, ADR-0003 §5 |
| Router | Hono | leggero, tipizzato, funziona su Workers |
| Cache | Workers KV `FORECASTS`: `forecast:<slug>` + `meta` (`latest` congelato per la migrazione) | FR-55..FR-57, ADR-0003 |
| Storico | Cloudflare D1 `maestrale-history` (binding `HISTORY`, primario `weur`), tabella `daily_history`, migrazioni in `worker/migrations/` | C-8, NFR-12, FR-69..FR-76, ADR-0002 |
| Catalogo | `locations.json` versionato alla radice, incluso nel bundle | FR-61, C-6, ADR-0004 |
| Scheduler | Cron Trigger `30 0,6,12,18 * * *` (UTC) | FR-49 |
| Test backend | Vitest + `@cloudflare/vitest-pool-workers` (KV e D1 di Miniflare) | NFR-13 |
| Client | Flutter, `--dart-define=API_BASE_URL`; `http`, `shared_preferences`, `flutter_map` + `flutter_map_marker_cluster`, `fl_chart` ^1.2.0 (MIT) | FR-48, FR-65, FR-68, FR-87, ADR-0005, ADR-0002 |

## 3. Components
| Component | Responsibility | Talks to |
|---|---|---|
| `worker/src/catalog.ts` | Unico accesso al catalogo: validazione (FR-2), `resolve(localita)` (FR-22), corpo ed ETag di `/locations` (memoizzati per isolate) | `locations.json` (bundle) |
| `worker/src/store.ts` | Accesso tipizzato alla KV: `forecast:<slug>`, `meta`, lettura bulk, `latest` (sola lettura, modalità legacy). Esiti come valori (`ok`/`missing`/`unreadable`) | KV |
| `worker/src/history.ts` (nuovo) | Funzioni pure dello storico: data Europe/Rome da un istante, estrazione della riga del giorno 0 da una `Forecast` (FR-69, FR-70), validazione dei parametri di `/history` (FR-77), scelta del `Cache-Control` (FR-79), `CASE` del rango Douglas generato dalla scala FR-10 | `aggregate.ts` (etichette FR-10) |
| `worker/src/history_store.ts` (nuovo) | Accesso tipizzato a D1: `writeHistory(db, rows, batchRows)` (upsert a blocchi in un `batch()`), `readDays`, `readMonths` (query di ADR-0002 §3); esiti come valori (`ok`/`unreadable`), mai eccezioni verso le route | D1 `HISTORY` |
| Route `routes/forecast.ts` | `GET /forecast`: risolve lo slug dal catalogo, legge record + `meta` in 1 operazione, ripiego `latest`, 404 troncato (FR-58) | catalog, store |
| Route `routes/health.ts` | `GET /health` dal solo `meta` (FR-56); modalità legacy se `meta` manca. **Invariata** (FR-81) | store |
| Route `routes/locations.ts` | `GET`/`HEAD /locations` con `ETag`, `Cache-Control`, 304 (FR-62, FR-63). Invariata | catalog |
| Route `routes/history.ts` (nuova) | `GET`/`HEAD /history`: validazione 422, 404 dal catalogo, 1 query D1, involucro JSON, `Cache-Control` breve/lungo, 503 se D1 non leggibile (FR-74..FR-80) | catalog, history, history_store |
| `worker/src/index.ts` | Composizione Hono (aggiunge `app.route("/history", …)`), CORS (FR-28) invariato, handler `scheduled` (passa a `runUpdate` un `HistoryWriter` costruito da `env.HISTORY`), log `forecast_update` | route, job |
| Job `update.ts` + `blocks.ts` + `forecast.ts` + `aggregate.ts` + `open_meteo.ts` | Fase blocchi multi-coordinata (FR-53), interruttore e fase fallback (FR-54), budget di durata e di subrequest (FR-54, NFR-15, ora con le istruzioni D1 riservate), secchiello pesato (NFR-20), scrittura per località poi `meta`, seed di migrazione (FR-59), **poi scrittura dello storico** (FR-70..FR-72) tramite `deps.history`, `paid_alerts` nel log | Open-Meteo, KV, `HistoryWriter` |
| `open_meteo.ts` | `fetchJson` (FR-17), `buildUrl` con liste di coordinate, `mapWithConcurrency`, limitatore pesato, contatore di subrequest | Open-Meteo |
| `worker/migrations/0001_daily_history.sql` (nuovo) | Schema di `daily_history` (ADR-0002 §1) | D1 |
| `worker/wrangler.jsonc` | Aggiunge `d1_databases: [{ binding: "HISTORY", database_name: "maestrale-history", database_id: "<id reale>", migrations_dir: "migrations" }]`; le nuove `vars` restano facoltative (default nel codice) | — |
| `README.md` | Sezione `/history`: parametri, errori, "previsioni del giorno stesso, non misure", nessun backfill, data di attivazione (FR-82) | — |
| App `LocationRepository` + `LocationCatalogApi` + `LocationCacheStore` + snapshot | Catalogo subito da copia locale o snapshot, poi sostituito da quello di rete (FR-65, FR-66) | Worker `/locations`, `shared_preferences`, asset |
| App `services/api_errors.dart` (nuovo) | Estrazione del messaggio d'errore con le regole di FR-33 (`detail` testuale o `detail.message`, altrimenti messaggio generico con il codice), condivisa da `ForecastApi` (comportamento invariato) e `HistoryApi` | — |
| App `services/history_api.dart` (nuovo) | `HistoryApi({baseUrl, http.Client? client})`: `fetchDays(slug, from, to)` e `fetchMonths(slug, from, to)` → `GET /history?localita=<slug>&from&to&granularity`, timeout 15 s; risposta → `HistoryResult`; struttura non valida → "Risposta del server non valida" (FR-91) | Worker `/history` |
| App `models/history.dart` (nuovo) | `HistoryGranularity { day, month }`, `HistoryDay` (data + 7 valori nullable), `HistoryMonth` (mese, `days` + 7 valori nullable), `HistoryResult` (slug, nome, granularità, `from`, `to`, elementi) | — |
| App `services/rome_date.dart` (nuovo) | `romeToday(DateTime utcNow)` (regola UE dell'ora legale) e calcolo dei preset 7 giorni / 30 giorni / 12 mesi (FR-84) e del primo giorno ammesso dal selettore (FR-85) | — |
| App `screens/history_screen.dart` + `widgets/history_chart.dart`, `widgets/sea_state_strip.dart`, `widgets/history_table.dart` (nuovi) | Preset, intervallo personalizzato, granularità, stati di caricamento/vuoto/errore con "Riprova", nota FR-90 sempre visibile con dati, grafico (`fl_chart`), fascia stato del mare, tabella a righe a due livelli (FR-84..FR-90) | `HistoryApi` |
| App schermate (`forecast_screen.dart`, `coastal_map_screen.dart`) | Ricerca, mappa con cluster, previsioni; catalogo solo dal repository (FR-67, FR-68); `ForecastScreen` riceve anche `HistoryApi` e mostra il comando "Storico" solo con una previsione caricata (FR-83) | repository, `ForecastApi`, `HistoryScreen` |
| `scripts/sync_app_catalog.mjs` | Genera lo snapshot `app/assets/locations.json` da `locations.json` (C-6) | file |
| `scripts/compare_backends.mjs` | Parità e smoke test | HTTP |

### Flusso del job (ADR-0003 §4, ADR-0002 §2)
1. Valida il catalogo (FR-2). Legge `meta`; se manca (prima esecuzione dopo la migrazione) legge
   anche `latest`. Calcola la data Europe/Rome dell'avvio (giorno 0).
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
9. Log `forecast_update` con le metriche di NFR-21, `fallback_breaker` (esito FR-52), le metriche
   dello storico (§6) e `paid_alerts` (NFR-15).

## 4. Data model
**Catalogo** (`locations.json`, ADR-0004): array di `{ slug, name, latitude, longitude }`. Vincoli
verificati da test: slug univoci e già normalizzati, nomi normalizzati senza collisioni, coordinate
valide, nome ≤ 60 caratteri.

**KV `FORECASTS`** (ADR-0003), invariata:
| Chiave | Valore | Note |
|---|---|---|
| `forecast:<slug>` | JSON della previsione di una località, struttura congelata in `tests/fixtures/forecast.schema.json` (`location`, `cells`, `timezone`, `generated_at`, `sources`, `daily`) | 1 `put` atomica per esecuzione e località (FR-19); non riscritta se la località fallisce (FR-18) |
| `meta` | `{ schema_version: 1, generated_at, updated_locations: [slug], errors: {slug: msg}, locations: n, slugs: [slug] }` | ultima scrittura KV dell'esecuzione; `locations = slugs.length`; nessun campo dello storico |
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

**App** (`shared_preferences`): `maestrale_home_location` (esistente), `maestrale_catalog_json`
(corpo di `/locations`), `maestrale_catalog_etag`. Asset `assets/locations.json` (snapshot generato,
C-6). Lo storico non è salvato sul dispositivo (non-goal v0.5).

## 5. Interfaces / APIs
- `GET /health`: sempre 200, `status` `ok`|`degraded`; da `meta`: `generated_at`, `age_hours`,
  `stale`, `locations`, `update_errors`; `meta` (e `latest`) assente o illeggibile: `error` e
  `cache_path` (`kv:FORECASTS`, eccezione OQ-19). Contratto invariato (FR-26, FR-50, FR-56, FR-81):
  gli errori dello storico **non** lo influenzano. 1 lettura KV (2 in modalità legacy).
- `GET /forecast?localita=<nome o slug>`: 200 con l'oggetto località (contratto invariato); 404 con
  `detail.message` invariato e `detail.available` = primi **50** nomi ordinati, stesso formato
  (FR-58: identico a FR-23 con ≤ 50 località); 422 se `localita` manca o è vuoto; 503 se il cache
  manca o è illeggibile. 1 operazione KV nel caso 200, ≤ 2 negli altri.
- `GET /locations` (FR-62/FR-63, ADR-0004): 200
  `{ "schema_version": 1, "version": "<hash>", "count": n, "locations": [{slug, name, latitude, longitude}] }`
  ordinato per `name`; header `ETag: "<hash>"` (SHA-256 del corpo, 16 esadecimali),
  `Cache-Control: public, max-age=<LOCATIONS_MAX_AGE_SECONDS>` (default 86400),
  `Access-Control-Expose-Headers: ETag`; `If-None-Match` corrispondente → 304 senza corpo. `HEAD`
  come `GET` senza corpo. Nessuna lettura KV, nessuna chiamata ai provider.
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
  - **503**: binding `HISTORY` assente, tabella assente o query fallita; `detail` "Storico
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
| `UPDATE_MAX_SUBREQUESTS` | `45` (Free); `9000` su Paid | NFR-15: tetto di subrequest per esecuzione, KV e D1 incluse |
| `FALLBACK_BREAKER_THRESHOLD` | `0.5` (scatta se strettamente maggiore) | FR-54, OQ-28 |
| `PAID_ALERT_SUBREQUESTS` | `40` | NFR-15 (b), segnalazione nel log |
| `PAID_ALERT_KV_WRITES_PER_DAY` | `700` | NFR-15 (c), OQ-29, segnalazione nel log |
| `LEGACY_LATEST_FALLBACK` | `true` | FR-59; disattivato nel rilascio che precede la cancellazione di `latest` (FR-60) |
| `HISTORY_WRITE_BATCH_ROWS` | `100` (1..400) | righe per istruzione di upsert (ADR-0002 §2, OQ-35) |
| `HISTORY_MAX_AGE_SHORT_SECONDS` | `900` | FR-79, OQ-32: `to` ≥ oggi |
| `HISTORY_MAX_AGE_LONG_SECONDS` | `86400` | FR-79, OQ-32: intervallo tutto nel passato |
| `PAID_ALERT_D1_SIZE_MB` | `350` | proposta OQ-35: `paid_alerts: d1_size` se `size_after` > soglia |

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

## 6. Cross-cutting concerns
- **Errori**: lettura KV e parse come valori tipizzati (`store.ts`), mai eccezioni verso le route;
  `/health` non fallisce mai (FR-26). Il job lancia solo per catalogo invalido (FR-2) o scrittura KV
  fallita; errori per località in `errors` (FR-18, FR-54). Una `put` fallita a metà esecuzione lascia
  record nuovi e `meta` vecchio: stato coerente per località, accettato come R-9. **Storico**: ogni
  errore D1 nel job è catturato dopo la pubblicazione del cache (FR-72); in `/history` D1 restituisce
  esiti tipizzati (`history_store.ts`) e un errore diventa 503; nessuna eccezione non gestita.
- **Sicurezza**: nessun endpoint di scrittura (NFR-11, FR-73): D1 è scritto solo dall'handler
  `scheduled`; tutte le query usano parametri legati (`bind`), date validate prima del bind, slug
  sempre dal catalogo; il messaggio di 503 non espone SQL. Il catalogo si modifica solo via git +
  deploy (credenziali dell'account Cloudflare); nessun segreto (NFR-8, l'id del database non è un
  segreto); la posizione non lascia il dispositivo (NFR-9).
- **Osservabilità**: log JSON `forecast_update` (NFR-18, NFR-21, FR-52) con durata, blocchi,
  richieste e fallimenti di blocco, `fallback_breaker`, fallback, subrequest (KV e D1 incluse),
  scritture/cancellazioni KV, peso consumato, budget esaurito (`duration`/`subrequests`),
  `paid_alerts`, e per lo storico: `history_date`, `history_rows` (righe scritte), `history_queries`,
  `history_failed` (righe non scritte), `history_error`, `history_missing_day0`, `d1_rows_written`,
  `d1_size_bytes` (da `meta` del risultato D1); un `console.error` per località fallita e per errore
  dello storico; `console.error` sui 503 di `/history`. Workers Logs abilitati
  (`observability.enabled`). CPU e invocazioni fallite si leggono da Workers Logs/dashboard (regola
  go/no-go, NFR-15).
- **Test** (NFR-13): fetch/sleep/now iniettati; parità FR-51 sulla funzione pura condivisa fra
  risposta singola e lista; test esistenti su `latest` coperti dalla modalità legacy (FR-64) e
  invariati (FR-81); test del catalogo reale; **D1 di Miniflare** dal binding di `wrangler.jsonc` con
  le migrazioni di `worker/migrations/` applicate in un file di setup di Vitest (`applyD1Migrations`),
  per upsert, giro di andata e ritorno dei valori (identità FR-69, `null` inclusi), divisione in
  blocchi (100/101 righe), query `day`/`month` (moda, pareggio, tutti `null`, mesi parziali); job con
  `HistoryWriter` finto (errore → cache identico, FR-72; località fallita → nessuna riga, FR-71);
  route con D1 finto che fallisce (503) e casi limite di 422 e `Cache-Control` (`to` = oggi). Test
  Flutter con repository, client e store finti; `HistoryApi` con `http.Client` finto (FR-91);
  `romeToday` sui cambi d'ora; widget test della schermata storico con 366 elementi.
- **Rilascio** (ADR-0003 §5-§6, ADR-0002 §1): prima il nuovo layout con le 13 località sul piano
  Free; ogni ampliamento del catalogo in un deploy separato, solo se rispetta la regola go/no-go
  (oltre ~35 località, o con `paid_alerts`, prima il passaggio a Paid e
  `UPDATE_MAX_SUBREQUESTS = 9000`). Storico: `wrangler d1 create maestrale-history --location=weur`,
  id in `wrangler.jsonc`, `wrangler d1 migrations apply maestrale-history --remote`, poi deploy; la
  data del primo deploy con lo storico è la data di attivazione da dichiarare nel README (FR-82).
  Un deploy prima delle migrazioni non rompe il cache (errore storico nel log, `/history` 503).
  Cancellazione di `latest` secondo FR-60.

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
| NFR-11 | Solo `GET`/`HEAD` (anche `/history`); D1 scritto solo dal job; catalogo modificabile solo via deploy |
| NFR-12 | Workers + KV per il cache (invariato); D1 solo per lo storico (C-8) |
| NFR-13 | Dipendenze iniettabili backend e app (`HistoryWriter`, `http.Client` di `HistoryApi`); Miniflare per KV e D1 con migrazioni applicate nei test |
| NFR-14 | Ogni chiave scritta una volta per esecuzione (≤ 1/s); `put` atomica per località |
| NFR-15 | Free ora: con 13 località **18** subrequest nominali (17 + 1 istruzione D1), 56 scritture KV/giorno, 52 righe D1/giorno; tetto `UPDATE_MAX_SUBREQUESTS` (45) con le istruzioni D1 riservate evita invocazioni fallite e garantisce < 50 query D1; `paid_alerts` per (b) subrequest > 40 (~35 località), (c) > 700 scritture KV/giorno e, proposta OQ-35, `d1_size` > 350 MB; CPU letta dagli strumenti Cloudflare. Paid alla soglia: ~528 subrequest nominali con 500 località (5 istruzioni D1), ~3.600 caso peggiore (< 10.000); ≤ ~505 operazioni KV (< 1.000); 5 query D1 (< 1.000); CPU ≪ 15 min; 6 connessioni rispettate. D1: 100 parametri/query rispettati con 1 parametro JSON per istruzione; istruzione < 100 KB con ≤ 400 righe |
| NFR-16 | Consistenza eventuale KV accettata; ripiego `latest` durante la migrazione; D1 a consistenza forte sul primario (nessuna replica) |
| NFR-17 | ≤ 4 richieste in volo (blocchi e fallback) |
| NFR-18 | Log `forecast_update` + errori per località + metriche ed errori dello storico |
| NFR-19 | Catalogo nel bundle; cache per località; ≤ 2 letture per richiesta; `/locations` ≈ 40 KB con 500 voci; 500 località solo dopo il passaggio a Paid |
| NFR-20 | Peso 1 per località per API → 1.000/esecuzione, 4.000/giorno; secchiello a 300/min (< 600); interruttore del fallback nel guasto diffuso; lo storico non chiama i provider |
| NFR-21 | Metriche nel log, incluse istruzioni e righe D1 scritte; fan-out non introdotto |
| NFR-22 | Catalogo da copia locale/snapshot pubblicato subito, rete in parallelo (FR-65); nomi normalizzati precalcolati; marker cluster |
| NFR-23 | `/history` = 1 query D1 su `location_slug = ?` e `date BETWEEN` sulla PK `WITHOUT ROWID` (scansione contigua, ≤ 366 righe per `day`, ≤ ~3.660 per `month`), aggregazione in SQL; costo indipendente dal catalogo; 0 letture KV; primario D1 in `weur`; `Cache-Control` lungo per il passato |
| NFR-24 | ~150-190 byte/riga → 500 × 10 anni ≈ 280-350 MB (< 10 GB Paid, piano obbligatorio a quella scala; entro 500 MB anche su Free); 13 località ≈ 8 MB; `d1_size_bytes` nel log per la misura; nessuna cancellazione (OQ-36) |
| NFR-25 | Una transazione da ⌈N/100⌉ istruzioni (1 con 13, 5 con 500), ordine delle centinaia di ms (< 5 s); istruzioni nel budget di subrequest; `history_queries`/`d1_rows_written` nel log |
| NFR-26 | `fl_chart` con limiti degli assi espliciti e ≤ 366 punti per serie; fascia stato del mare in un solo `CustomPainter`; tabella pigra ad altezza fissa (`SliverFixedExtentList`); nessun calcolo pesante nel `build` (serie precalcolate alla ricezione) |

## 8. Decisions
| ADR | Title | Status |
|---|---|---|
| [ADR-0001](adr/0001-cloudflare-workers-kv.md) | Backend su Cloudflare Workers con cache su Workers KV | proposed |
| [ADR-0002](adr/0002-storico-giornaliero-d1.md) | Storico giornaliero del giorno 0 su D1, `GET /history` e schermata storico | proposed |
| [ADR-0003](adr/0003-cache-per-localita-e-blocchi-open-meteo.md) | Cache per località su KV, chiamate Open-Meteo a blocchi, migrazione da `latest` | accepted |
| [ADR-0004](adr/0004-catalogo-localita-file-versionato.md) | Catalogo come file versionato e `GET /locations` | accepted |
| [ADR-0005](adr/0005-location-repository-app.md) | LocationRepository nell'app, snapshot, clustering | accepted |

Il numero 0002, lasciato libero in v0.4, è ora usato dallo storico su D1.

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
    13 località, 5 con 500); 280-350 MB per 500 × 10 anni; nessuna nuova soglia go/no-go, sola
    segnalazione `d1_size` a 350 MB (inserirla nella regola di NFR-15 spetta all'owner).
- **Domande aperte non dell'architect che toccano il disegno**: **OQ-34** (preset iniziale, granularità
  di "12 mesi", "Storico" con previsione in errore: oggi il comando richiede una previsione caricata,
  come FR-83); **OQ-36** (conservazione; slug rimossi o rinominati: oggi righe conservate, non
  interrogabili, nessuna migrazione dello slug); **OQ-37** (fedeltà di C-8 a D-1..D-6).
- **Interpretazione di FR-78**: `detail.available` del 404 di `/history` usa i nomi del **catalogo**
  (nessuna lettura KV), mentre `/forecast` usa i nomi delle località con un record (`meta.slugs`). A
  regime coincidono; da confermare se l'owner vuole l'identità esatta.
- **Subrequest e D1**: la documentazione non chiarisce se un `batch()` conti come una o più
  subrequest; si contano le istruzioni (prudenziale). La soglia (b) su Free scende da ~36 a ~35
  località.
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
  (strettamente maggiore); **OQ-29** soglia go/no-go di scritture KV, `PAID_ALERT_KV_WRITES_PER_DAY
  = 700`.
- **Budget di subrequest** (`UPDATE_MAX_SUBREQUESTS`): meccanismo dell'architect per rispettare
  NFR-15 sul piano Free; le località non tentate ricevono un messaggio esplicito come per il budget
  di durata di FR-54. Va alzato a 9.000 al passaggio a Paid (passo del runbook).
- **Località senza record valido escluse dal fallback dall'interruttore**: quelle di un blocco
  riuscito ma con elemento non valido ricevono lo stesso messaggio dell'interruttore, perché FR-54
  vieta qualunque richiesta singola nell'esecuzione.
- **CPU su Free non stimabile a priori**: la soglia (b) di 7 ms va verificata con la misura (NFR-21,
  E01-S07 AC-9 ancora da misurare).
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
