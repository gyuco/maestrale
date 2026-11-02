---
id: RUNBOOK
status: draft
updated: 2026-11-02
---

# Runbook — Maestrale (Cloudflare Worker)

Operatività del backend in `worker/`. Tutti i comandi `wrangler` si lanciano da `worker/` (con
`npx`); quelli marcati **[account]** agiscono sull'account Cloudflare. I comandi sono stati controllati
con `--help` o `--dry-run` (wrangler 4.151.2), mai eseguiti contro il remoto da chi ha scritto il
documento. URL di esempio: `https://maestrale.<sottodominio-account>.workers.dev` (il sottodominio
dipende dall'account).

## Deploy

Prerequisiti: Node.js 22+, `cd worker && npm ci`, account Cloudflare (piano **Paid**; il
backoffice richiede un custom domain `admin.<dominio>`).

1. **[account]** `npx wrangler login` (autorizzazione nel browser).
2. **[account]** Crea i namespace KV e annota i due id (non sono segreti):
   `npx wrangler kv namespace create FORECASTS` e `npx wrangler kv namespace create FORECASTS --preview`.
3. Scrivi gli id in `worker/wrangler.jsonc` (`id` e `preview_id`; dal 2026-10-19
   sono `7b1c0444535542408cc05fa9dd59536b` e `b6b83416188441aea18ce2846ccad5d6`). Se aggiungi commenti usa solo righe intere che iniziano con
   `//` (il test `worker/test/update.test.ts` legge il file così). Poi `cd worker && npm test`.
4. Prova di build senza pubblicare: `npx wrangler deploy --dry-run --outdir dist` (`dist/` non si committa).
5. **[account]** `npx wrangler deploy`. Al primo deploy wrangler può chiedere di **registrare il
   sottodominio `workers.dev`** dell'account; annota l'URL stampato.
6. Verifica: `curl https://maestrale.<sottodominio-account>.workers.dev/` deve rispondere 200
   `{"status":"ok","service":"maestrale"}`; `npx wrangler deployments list` mostra la versione;
   smoke test: `node scripts/compare_backends.mjs --smoke https://maestrale.<sottodominio-account>.workers.dev`
   (dice se ha trovato il ramo 200 con dati o 503 a cache vuota).

Non ci sono `routes` né `vars` in `wrangler.jsonc`. Il deploy automatico da GitHub non è configurato
(vedi *Passi futuri*).

## Cron

Espressione (UTC): `30 0,6,12,18 * * *`, definita in `triggers.crons`.

| UTC | Europe/Rome, ora legale (CEST) | Europe/Rome, inverno (CET) |
|---|---|---|
| 00:30 | 02:30 | 01:30 |
| 06:30 | 08:30 | 07:30 |
| 12:30 | 14:30 | 13:30 |
| 18:30 | 20:30 | 19:30 |

Il cron non conosce fusi orari: l'intervallo resta di 6 h. Ad ogni slot gira l'handler `scheduled`
(`worker/src/index.ts`): aggiorna le località del catalogo con chiamate Open-Meteo a blocchi (ADR-0003),
scrive un record `forecast:<slug>` per ogni località aggiornata e, per ultima, la chiave `meta`.
**`latest` non viene più scritta** (FR-59). Una località che non si aggiorna conserva il proprio
record precedente (FR-18). Se **nessuna** località si aggiorna la KV non viene toccata e l'handler
risolve comunque (nessun ritentativo del cron).

Parametri del job (variabili d'ambiente opzionali, default nel codice; si impostano in `vars` di
`wrangler.jsonc` o dal dashboard, nessuna modifica di codice):

| Variabile | Default | Significato |
|---|---|---|
| `OPEN_METEO_BLOCK_SIZE` | 50 | località per richiesta multi-coordinata (1..100) |
| `FALLBACK_BREAKER_THRESHOLD` | 0.5 | interruttore: fallback per località saltato se richieste di blocco fallite / totali > soglia (FR-54, OQ-28) |
| `UPDATE_MAX_SUBREQUESTS` | 45 | tetto di subrequest (Free); su Paid 9000 |
| `UPDATE_BUDGET_SECONDS` | 720 | budget di durata dell'esecuzione (12 min su 15) |
| `UPDATE_CONCURRENCY` | 4 | richieste Open-Meteo in volo (max 6) |
| `OPEN_METEO_MAX_WEIGHT_PER_MIN` | 300 | chiamate pesate al minuto verso Open-Meteo (limite provider 600) |
| `PAID_ALERT_SUBREQUESTS` | 40 | soglia dell'avviso `subrequests` (NFR-15 b) |
| `PAID_ALERT_KV_WRITES_PER_DAY` | 700 | soglia dell'avviso `kv_writes_per_day` (NFR-15 c, OQ-29) |
| `LOCATIONS_MAX_AGE_SECONDS` | 86400 | `max-age` del `Cache-Control` di `GET /locations` (FR-63) |
| `HISTORY_WRITE_BATCH_ROWS` | 100 | righe per istruzione D1 di scrittura dello storico (1..400) |
| `HISTORY_MAX_AGE_SHORT_SECONDS` | 900 | `max-age` di `GET /history` se `to` >= oggi Europe/Rome (FR-79) |
| `HISTORY_MAX_AGE_LONG_SECONDS` | 86400 | `max-age` di `GET /history` se l'intervallo e' tutto nel passato |
| `PAID_ALERT_D1_SIZE_MB` | 350 | soglia dell'avviso `d1_size` (70% dei 500 MB Free; MB = 1024*1024 byte) |
| `LEGACY_LATEST_FALLBACK` | attivo | `false`/`0` disattiva il ripiego su `latest` di `/forecast` (solo dopo la dismissione, sotto) |

Lancio manuale, in ordine di praticità:

- **Attendere lo slot** UTC con `npx wrangler tail --format json` aperto **[account]**.
- **In locale**: `npx wrangler dev --test-scheduled` poi
  `curl "http://localhost:8787/__scheduled?cron=30+0+*+*+*"` (usa la KV simulata locale e scarica
  davvero da Open-Meteo). Non misura i limiti Free.
- **Remoto**: `npx wrangler dev --remote --test-scheduled` esegue il codice sulla rete Cloudflare
  **[account]**. Quale KV usa (`preview_id` o `id` di produzione) **non è verificabile offline**:
  per i namespace con `preview_id` la documentazione indica la KV di anteprima, quindi
  **non** popola la KV di produzione. Controllare la tabella dei binding stampata all'avvio.
- **Dashboard** (Workers & Pages -> maestrale -> Settings -> Triggers): se offre un lancio manuale del
  cron, usarlo; da verificare, il repository non lo può provare.
- Non modificare temporaneamente il cron a ogni minuto (il test di S04 lo vieta e peggiora le misure).

## Rigenerazione della cache

- **Produzione**: far girare il cron (sopra). Il primo aggiornamento ricostruisce tutto (OQ-23).
- **Sviluppo, KV vuota o cron fallito sul piano Free**: seminare dallo snapshot di esempio
  **[account]**. Finché `meta` manca, il Worker serve da `latest` (modalità legacy, FR-59), quindi il
  seed va su `latest`:

  ```bash
  npx wrangler kv key put --binding FORECASTS latest --path ../tests/fixtures/golden_forecasts.json --remote --preview false
  ```

  I dati sono **vecchi** (`generated_at` 2026-10-19T09:00Z): `/health` risulterà `degraded` e
  `stale: true` dopo 12 h, e l'app mostrerà quella data in "Aggiornato". `--preview false` è
  obbligatorio perché `id` e `preview_id` sono entrambi configurati (altrimenti wrangler si rifiuta).
  In locale lo stesso comando con `--local` al posto di `--remote`. **Non seminare `latest` quando
  `meta` esiste già**: non verrebbe letta (a parte il ripiego per le località senza record).
- **Leggere il cache** (nuovo layout): `npx wrangler kv key get --binding FORECASTS meta --remote --preview false --text`
  e, per una località, `... forecast:cagliari ...`. `latest` è congelata (vedi *Migrazione e
  dismissione di `latest`*).
- Ripristino: aspettare il prossimo cron riuscito.

## Migrazione e dismissione di `latest` (FR-59, FR-60, C-7)

1. **Rilascio di migrazione con lo stesso catalogo (13 località)**: nessuna nuova località nello
   stesso deploy. Finché il primo cron non gira, `/forecast` e `/health` servono da `latest` con la
   logica precedente. La **prima esecuzione** del nuovo job (`meta` assente) scrive i record per
   località e, per le località di `latest` che non riesce ad aggiornare, copia il dato di `latest` nel
   record; poi scrive `meta`. Da quel momento nessuna località di `latest` risponde 404/503. In quella
   esecuzione il job fa 1 lettura in più (`get latest`: 18 subrequest nominali invece di 17).
2. **`latest` non viene mai scritta dal nuovo Worker** e resta com'era all'ultima esecuzione della
   versione precedente. Annotare qui la **data del rilascio del cache per località** (inizio del
   conteggio): _da compilare al deploy_.
3. **Rollback** (sezione sotto): finché `latest` esiste, il ritorno alla versione precedente del Worker
   (che legge `latest`) ripristina il servizio senza interventi sui dati; il suo cron riscrive `latest`
   entro 6 h e nel frattempo `/health` può essere `degraded` per età del dato (atteso, FR-60). **Ogni
   rollback fa ripartire il conteggio dei 14 giorni** dal rilascio successivo: annotare qui data e
   motivo di ogni rollback.
4. **Cancellazione di `latest`**: consentita solo se (a) sono trascorsi **almeno 14 giorni** dal
   rilascio del cache per località **senza alcun rollback**, e (b) `/health` risponde `status: ok`
   al momento della cancellazione. Procedura: rilascio che imposta `LEGACY_LATEST_FALLBACK=false` (poi
   rimozione della modalità legacy dal codice, con i test riscritti sul nuovo layout), verifica di
   `/health`, quindi **[account]**
   `npx wrangler kv key delete --binding FORECASTS latest --remote --preview false`.
   **Dopo la cancellazione il rollback alla versione v0.2 non è più supportato.**

## Storico giornaliero su D1 (FR-69..FR-82, ADR-0002)

Database D1 `maestrale-history`, binding `HISTORY` (`worker/wrangler.jsonc`, `d1_databases`,
`migrations_dir: "migrations"`), tabella `daily_history` (migrazione `worker/migrations/0001_daily_history.sql`).
Scrive solo il job `scheduled` (dopo `put meta`, un solo tentativo, un solo `batch()`); legge `GET /history`.

### Rilascio dello storico

In `wrangler.jsonc` il `database_id` e' un **segnaposto** (`00000000-0000-0000-0000-000000000000`):
va sostituito con l'id reale prima del deploy. Da `worker/`:

1. **[account]** `npx wrangler d1 create maestrale-history --location=weur` (primario in Europa occidentale).
2. Copiare il `database_id` stampato in `worker/wrangler.jsonc` al posto del segnaposto (blocco
   `d1_databases`, binding `HISTORY`). L'id non e' un segreto. Poi `npm test`.
3. **[account]** `npx wrangler d1 migrations apply maestrale-history --remote` **prima** del deploy del
   Worker che usa lo storico. Verifica: `npx wrangler d1 execute maestrale-history --remote --command "SELECT name FROM sqlite_master WHERE type='table'"`
   deve mostrare `daily_history`.
4. **[account]** `npx wrangler deploy`. La **data del primo deploy con lo storico e' la data di
   attivazione** (nessun backfill): _data di attivazione: da compilare al deploy_ (riportarla anche nel
   `README.md`, sezione "Storico").
5. Dopo il primo cron: `npx wrangler d1 execute maestrale-history --remote --command "SELECT COUNT(*) FROM daily_history"`
   (= numero di localita' aggiornate) e log `forecast_update` con `history_rows` > 0 e `history_failed: 0`.

Effetto di un deploy **prima** delle migrazioni: il cache KV non si rompe (il job registra l'errore
storico nel log, `history_failed`/`history_error`, e `/forecast` e `/health` restano invariati);
`GET /history` risponde **503** finche' le migrazioni non sono applicate.

### Osservabilita' dello storico

Campi aggiuntivi del log `forecast_update`: `history_date` (giorno 0, Europe/Rome), `history_rows`
(righe scritte), `history_queries` (istruzioni D1, contate come subrequest), `history_failed` (righe
non scritte), `history_error` (messaggio, se la scrittura e' fallita; anche `console.error`),
`history_missing_day0` (slug senza elemento del giorno 0, nessuna riga), `d1_rows_written` e
`d1_size_bytes` (da `meta` del `batch()`, se riportati da D1). Un errore D1 non rende `/health`
`degraded`: l'upsert dell'esecuzione successiva (entro 6 h) riscrive il giorno 0.

**Allarme `d1_size`**: `paid_alerts` contiene `d1_size` quando `d1_size_bytes` supera
`PAID_ALERT_D1_SIZE_MB` (default 350 MB, 70% dei 500 MB Free). Azione: valutare il piano **Paid**
(10 GB). Stime (NFR-24): 500 localita' x 10 anni ~ 280-350 MB; 13 localita' ~ 8 MB in 10 anni.
Dimensione a mano: `npx wrangler d1 info maestrale-history` **[account]**.

Subrequest con lo storico: `2·ceil(N/50) + N + 2 + ceil(N/100)` (N localita', blocchi Open-Meteo da 50,
1 `get meta`, N `put`, 1 `put meta`, ceil(N/100) istruzioni D1): **18** nominali con 13 localita'; la
soglia (b) di 40 si raggiunge a circa **35** localita' su Free (sostituisce la stima di ~36 sopra).

### Rollback e conservazione

- Tornare a una versione senza storico **non tocca D1**: i giorni del rollback mancano, senza backfill.
- Il job **non cancella mai righe**. Uno slug rimosso dal catalogo resta in D1 ma non e' interrogabile
  (`/history` risponde 404); uno slug rinominato riparte da zero (OQ-36).

## Rollback

1. `npx wrangler deployments list` **[account]**: elenca le ultime 10 versioni distribuite.
2. `npx wrangler rollback [version-id] -m "motivo"` **[account]**: riporta il codice a una versione
   precedente (senza argomento torna alla precedente).
3. Il rollback ripristina **solo il codice**, non la **KV**: il cache resta quello attuale. Se i dati
   sono sbagliati, riseminare dal golden (sopra) o attendere il prossimo cron.
4. Rollback dal cache per località alla v0.2: vedi *Migrazione e dismissione di `latest`* (funziona
   solo finché `latest` esiste; il conteggio dei 14 giorni riparte dal rilascio successivo).

## Osservabilità (con ciò che esiste)

`observability.enabled` è attivo (Workers Logs). Il Worker scrive con `console.*`:

- `console.error("Aggiornamento fallito per <slug>: <messaggio>")` per ogni località fallita;
- `console.error("Nessuna località aggiornata: cache KV non modificato")` se non scrive la KV;
- `console.log` di un riepilogo JSON per ogni esecuzione (NFR-21), esempio (13 località, esecuzione
  nominale con `meta` già presente):

  ```json
  {"event":"forecast_update","updated":13,"failed":0,"generated_at":"2026-10-19T12:30:05+00:00","duration_ms":4210,"blocks":1,"block_requests":2,"block_failures":0,"fallback_breaker":false,"fallbacks":0,"subrequests":17,"kv_writes":14,"kv_deletes":0,"weight_used":26,"budget_exhausted":"none","paid_alerts":[]}
  ```

  `fallback_breaker` = `true` indica che l'interruttore del fallback è scattato (le località
  interessate hanno in `errors` il messaggio "interruttore del fallback attivo"). `budget_exhausted`
  vale `none`, `duration` o `subrequests`. `paid_alerts` elenca i motivi per passare a Paid:
  `subrequests` (> 40), `kv_writes_per_day` (scritture x 4 esecuzioni/giorno > 700),
  `budget_subrequests` (tetto raggiunto).

  **`duration_ms` è tempo di orologio** (`Date.now()`), attesa di rete inclusa: **non è il CPU time**.

Dove guardare:

- `npx wrangler tail --format json` **[account]**: log in tempo reale (cron compreso).
- Dashboard Cloudflare -> Workers & Pages -> maestrale -> Logs / Metrics: Workers Logs e invocazioni;
  **CPU time** per invocazione si legge qui (il job logga le subrequest che conta, ma non il CPU time).
- `GET /health` (sempre 200): `status` (`ok`|`degraded`), `stale` (dati più vecchi di 12 h),
  `update_errors` (località fallite con messaggio), `generated_at`, `locations`. Cache assente o
  illeggibile: `error` e `cache_path` (`kv:FORECASTS`).

## Limiti di piattaforma e misure

| Limite | Free | Paid |
|---|---|---|
| CPU per invocazione | 10 ms | fino a 15 min per cron con intervallo >= 1 h |
| Subrequest per invocazione | 50 | 10.000 |

> Nota: dal 2026-11-01 il servizio è sul piano **Paid** (vedi *Piano Workers Paid* più sotto); i
> riferimenti al piano Free in questa sezione restano come storia e come margine.

Fabbisogno del job con il cache per località e le chiamate a blocchi (ADR-0003 §5), N località e
blocchi da 50: `2·ceil(N/50)` richieste Open-Meteo + 1 `get meta` + N `put` + 1 `put meta`; con 13
località **17 subrequest** nominali senza storico (18 alla prima esecuzione), **18** con la scrittura dello storico D1 (19 alla prima esecuzione), 22 con i retry dei blocchi. Il tetto
`UPDATE_MAX_SUBREQUESTS` (45) fa sì che il caso peggiore (fallback con retry) non faccia mai fallire
l'invocazione: le località non tentate finiscono in `errors` con il messaggio "budget di subrequest
esaurito" e conservano il dato precedente. Su Free la soglia (b) di 40 subrequest si raggiunge a circa
35 località; le 700 scritture KV/giorno a circa 174.

**I retry restano a 3** (`DEFAULT_RETRIES = 3`, FR-17 "fino a 3 tentativi").

Misure su Free (da compilare dopo il deploy; il cron su Free probabilmente non completa, ed è una
misura valida):

| Data/ora UTC | Modo di invocazione | Esito (`forecast_update` o errore) | CPU time | Subrequest | Fonte |
|---|---|---|---|---|---|
| da misurare | da misurare | da misurare | da misurare | da misurare | da misurare |

## Catalogo località e backoffice (FR-61, FR-92..FR-121, ADR-0006..ADR-0010)

Il catalogo vive nel database D1 `maestrale-core` (binding `CORE`) ed è letto tramite la cache KV
`catalog:current`. `locations.json` alla radice è **solo il seed** della migrazione iniziale
(FR-104): dopo l'attivazione non è più letto da job, API o backoffice, e modificarlo non ha effetto.

### Primo rilascio del backoffice
1. **[account]** `npx wrangler d1 create maestrale-core --location=weur`, annota `database_id`.
2. Metti l'id in `worker/wrangler.jsonc` e `worker/wrangler.admin.jsonc` (binding `CORE`).
3. `node scripts/seed_catalog.mjs` genera `worker/migrations-core/0002_seed_locations.sql` dalle 13
   voci di `locations.json` (tutte attive).
4. **[account]** `npx wrangler d1 migrations apply maestrale-core --remote`.
5. **[account]** `npx wrangler deploy` (Worker pubblico; ora legge il catalogo da `CORE`).
6. **[account]** `npx wrangler deploy -c wrangler.admin.jsonc` (Worker `maestrale-admin`).
7. **[account]** Crea l'applicazione **Cloudflare Access** sull'hostname `admin.<dominio>`: policy
   `Allow` con le email degli 1–3 amministratori, identity provider Google/GitHub o codice monouso,
   sessione 8 h. Annota il team domain (`ACCESS_TEAM_DOMAIN`, es. `https://<team>.cloudflareaccess.com`)
   e l'audience (`ACCESS_AUD`) nelle `vars` del Worker admin.
8. Verifica: `https://admin.<dominio>/catalogo` apre il login Access; una richiesta senza JWT
   risponde 401; `GET /locations` pubblica serve le stesse 13 località di prima (FR-104).

### Modifica del catalogo
Dal backoffice (area **Catalogo**). Effetto immediato su `/locations` e sulla risoluzione di
`/forecast`/`/history` (FR-101); i dati delle previsioni arrivano dalla prima esecuzione del job o da
"Esegui ora". Non modificare `locations.json`: non ha effetto.

### Revoca di un amministratore (FR-94)
1. **[account]** Rimuovi l'email dalla policy dell'applicazione Access.
2. **[account]** Revoca le sessioni attive dell'utente in Access.
Effetto entro 15 minuti (NFR-27). L'elenco degli amministratori non è nel backoffice.

### Backup e ripristino (FR-121)
- **Time Travel** (finestra 30 giorni): `npx wrangler d1 time-travel info maestrale-core
  --timestamp=<RFC3339>` restituisce il bookmark; `npx wrangler d1 time-travel restore maestrale-core
  --bookmark=<bookmark>` ripristina.
- **Export periodico** (almeno mensile, e prima di ogni migrazione): `npx wrangler d1 export
  maestrale-core --remote --output backup-YYYY-MM-DD.sql`. Conserva gli export per almeno 24 mesi
  (NFR-29), fuori dal database (R2 o repository privato).
- **Ripristino da export**: crea un database nuovo, applica l'export, aggiorna `database_id` nei due
  `wrangler` config, riapplica le migrazioni mancanti, deploy.
- Il backoffice non offre export/import (non-goal): il backup è operativo.

### "Esegui ora" e dispatcher (ADR-0009)
- Il cron `* * * * *` sul Worker pubblico è il dispatcher: senza, le richieste restano `pending` e la
  cache del catalogo non viene riparata.
- Controllo: `npx wrangler d1 execute maestrale-core --remote --command "SELECT * FROM run_requests
  WHERE status='pending'"`; `SELECT * FROM job_lock`.
- Il dispatcher ripara `catalog:current` se `catalog_meta.version` diverge, chiude le esecuzioni
  `running` oltre `JOB_MAX_DURATION_SECONDS + 60` come "non completata" (FR-107) ed elimina i registri
  oltre 90 giorni e le operazioni oltre 24 mesi.

## Piano Workers Paid

Dal 2026-11-01 il servizio è sul piano **Workers Paid** (decisione owner, PRD v0.6.1/NFR-15): la
regola go/no-go Free→Paid non si applica più e non va implementata. `UPDATE_MAX_SUBREQUESTS` vale
`9000`. Gli avvisi `paid_alerts` restano solo come segnalazione nei log (NFR-21), senza blocchi.

## Passi futuri

- Custom domain (`routes`) invece di `workers.dev`.
- CI su GitHub Actions (`.github/workflows/ci.yml`, epic E04, storia E04-S01): su push e pull
  request verso `develop` e `main` esegue tre job (`worker`: `npm ci`, `npm run typecheck`,
  `npm test`; `scripts`: `node --test scripts/*.test.mjs`; `app`: `flutter pub get`,
  `flutter analyze`, `flutter test`). **Stato: pianificata, non ancora implementata.** Il remoto
  `origin` (github.com/gyuco/maestrale) esiste.
- Deploy automatico del Worker su `main` dopo CI verde (E04-S02, **bloccata** in attesa che E04-S01
  sia completata e che l'owner scelga tra Workers Builds dal dashboard e GitHub Actions con
  `wrangler-action`; le migrazioni D1 `migrations apply --remote` devono precedere il deploy).
- CORS ristretto: oggi `CORS_ORIGINS` vale `*` (nessuna `vars` definita).

## Rigenerare le fixture / baseline Python

Il codice Python rimosso è nel tag git **locale** `python-baseline` (non pubblicato). Ricetta completa
in [`tests/fixtures/README.md`](../tests/fixtures/README.md): `git checkout python-baseline`, poi
`python3 tests/fixtures/regenerate.py [--fetch]`, `gen_domain_fixtures.py` e `gen_pipeline_fixtures.py`.

## Dismissione lato host del backend Python storico (una tantum)

Riferimenti **storici** alla v0.1. Sul computer/server del proprietario, se esisteva il cron v0.1 (`update_forecasts.py`) o un `uvicorn`:
rimuovere la riga da `crontab -l`/launchd/systemd, fermare ogni `uvicorn backend.main:app` e cancellare
il vecchio `data/forecasts.json`. Controllo: `pgrep -fl "uvicorn|update_forecasts"` senza risultati.
