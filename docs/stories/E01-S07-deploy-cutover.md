---
id: E01-S07
epic: E01
title: "Deploy, cutover Flutter e dismissione del backend Python"
type: feature
status: done
requirements: [FR-48, FR-49, FR-50, FR-52, NFR-11, NFR-12, NFR-13, NFR-15, NFR-18]
depends_on: [E01-S00, E01-S01, E01-S02, E01-S03, E01-S04, E01-S05, E01-S08]
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
  - cd worker && npx wrangler deploy --dry-run --outdir dist
  - node --test scripts/*.test.mjs
  - cd app && flutter analyze && flutter test
  - test -z "$(git ls-files '*.py' | grep -v '^legacy/')"
---

# E01-S07: Deploy, cutover Flutter e dismissione del backend Python

## Context

Dopo E01-S00..S05 e S08 il Worker (`worker/`) ha tutto il necessario: API `GET /health` e `GET
/forecast` (S05), job di aggiornamento con Cron Trigger e scrittura su KV (S04), pipeline e dominio
(S02/S03), fixture/golden della baseline Python (S00). Mancano tre cose: (1) **provare che il
Worker risponde come il backend Python** sugli stessi dati, (2) **pubblicarlo** e misurarne il
comportamento reale sul piano Cloudflare scelto, (3) **dismettere Python** e lasciare
documentazione e runbook. Questa storia le fa in quest'ordine: la parità si verifica **prima** di
cancellare il Python.

### Decisioni del product owner (2026-10-19)

Sovrascrivono il testo originale della storia ("deploy produzione con custom domain e Workers Builds").

1. **Solo sviluppo.** L'app è in sviluppo e l'unico utente è il proprietario. Il target è un
   **deploy di sviluppo su `*.workers.dev`** con il **piano Cloudflare Free**. **Nessun custom
   domain, nessun Workers Paid adesso.** Il passaggio a Paid sarà una decisione successiva, basata
   sulle misure (punto 2).
2. **Misurare su Free.** Dopo il deploy si fa girare il cron e si registrano **CPU time reale** e
   **numero di subrequest** (Workers Logs / dashboard / `wrangler tail`) in *Dev notes* e nel
   runbook. Limiti Free da documentare: **10 ms di CPU**, **50 subrequest** per invocazione; il job
   ne fa **26 nominali** (13 località x 2 chiamate Open-Meteo), fino a **78 con i retry**
   (3 tentativi), più le operazioni KV (1 `get` + 1 `put`) se la piattaforma le conta come
   subrequest (da verificare con la misura). Va documentata la **regola go/no-go per Paid** quando
   l'app andrà ad altri utenti (vedi AC-7).
3. **Retry: non si tocca `DEFAULT_RETRIES = 3`.** Portare il caso peggiore sotto 50 richiede
   **1 solo tentativo** (26 + 2 KV = 28; con 2 tentativi sono 52 + 2 = 54, oltre il limite), cioè
   eliminare i retry. Questo viola FR-17 ("fino a 3 tentativi") e un requisito non lo cambia il
   planner; renderlo configurabile richiederebbe una variabile `vars`, esclusa. **Fuori scope**:
   il numero va nel runbook come input per la decisione su Paid.
4. **E01-S06 è stata eliminata.** Niente OpenAPI/`/docs`, niente storia di logging strutturato,
   niente storia `vars`. Questa storia **non dipende da S06** e **non assume** `/docs`, un modulo
   `log.ts` né `vars` in `wrangler.jsonc`. **FR-29 (documentazione interattiva) è escluso**: il PRD
   lo aggiornerà il proprietario; **`docs/PRD.md` non va toccato**. L'osservabilità del runbook usa
   solo ciò che esiste: le righe `console.*` di `worker/src/index.ts` (S04), compreso il riepilogo
   JSON `forecast_update`, `wrangler tail`, `/health`.
5. **Azioni verso l'esterno non eseguite dal coder.** `wrangler deploy`, la creazione dei namespace
   KV, il seed della KV remota e ogni comando contro l'account Cloudflare li esegue
   **l'orchestratore previa conferma del proprietario** (sezione *Passi manuali*). Il coder fa solo
   codice, test, documentazione e comandi **locali** (`--local`, `--dry-run`). Gli AC di deploy
   (AC-8, AC-9, AC-10) sono verificati **dopo** il deploy.

### Risposte del proprietario alle domande aperte (2026-10-19)

Risolvono la sezione *Domande aperte* e hanno la precedenza sul testo precedente.

6. **Python: si cancella tutto** (`backend/`, moduli Python della radice, `requirements*`, test Python
   e i 3 generatori di fixture); le fixture JSON restano **congelate**. **Prima** del commit di
   cancellazione si crea il tag git locale `python-baseline` sull'ultimo commit che contiene ancora il
   Python (non va pushato). La ricetta di rigenerazione (`git checkout python-baseline`) va in
   `tests/fixtures/README.md` e nel runbook. Il Passo manuale 0 è quindi **eseguito dal coder**.
7. **Soglie go/no-go per Paid confermate** come da AC-7 (CPU del cron > 7 ms, subrequest > 40, o nessuna
   run completa nelle ultime 24 h; comunque Paid prima di aprire l'app ad altri utenti).
8. **Cron che fallisce su Free: si tollera e si misura** (Passo manuale 10: nessuna disattivazione).
9. **Si committa `docs/PRD.md`, `docs/adr/`, `docs/architecture.md`, `docs/epics/` insieme a S07**
   (contenuto del PRD invariato). I commit sono fatti dal coder sul branch `feat/e01-s07` (senza push).
10. **Nessun workflow GitHub in S07.** Il remoto esiste (`origin` = `github.com/gyuco/maestrale`), ma la
    CI (test + typecheck + Flutter) e Workers Builds restano un passo futuro, citato nel runbook.
    Dove il testo sotto dice "non risulta un remoto" va letto come superato da questo punto.

### Requisiti (testo esatto dal PRD)

- **FR-48** — L'URL del backend shall essere configurabile in fase di build con
  `--dart-define=API_BASE_URL=...` (default `http://localhost:8000`).
- **FR-49** — Il job di aggiornamento shall essere eseguito automaticamente sulla piattaforma
  Cloudflare ogni 6 ore, senza dipendere da server o scheduler esterni a Cloudflare.
- **FR-50** — Parità di contratto: per gli stessi dati in cache, le risposte di `/forecast` e
  `/health` del backend su Cloudflare shall avere gli stessi codici HTTP, nomi di campo, tipi,
  arrotondamenti e semantica dell'implementazione Python al commit `181c2f3`, così che l'app Flutter
  esistente funzioni senza modifiche. Eccezioni ammesse solo se elencate esplicitamente nel PRD
  (oggi: identificativo del cache in `/health`, OQ-19).
- **FR-52** — Ogni esecuzione del job shall rendere osservabile il proprio esito: località
  aggiornate, località fallite con messaggio d'errore, istante di completamento. Le fallite sono
  esposte da `/health` in `update_errors` (FR-26); l'esito complessivo è registrato anche nei log
  della piattaforma.
- **NFR-11** — API in sola lettura (solo `GET`), nessuna autenticazione, CORS configurabile; servita
  solo via HTTPS tramite Cloudflare.
- **NFR-12** — Backend su Cloudflare Workers in TypeScript con cache su Workers KV (sostituisce
  Python/FastAPI/uvicorn e `data/forecasts.json`).
- **NFR-13** — Backend e app hanno suite di test eseguibili in locale senza accesso ai provider né
  all'account Cloudflare; le suite coprono la parità FR-50/FR-51 con fixture.
- **NFR-15** — Limiti di piattaforma. Piano Free: 50 subrequest e 10 ms CPU per invocazione; piano
  Paid: 10.000 subrequest, CPU fino a 15 min per cron con intervallo >= 1 h. Un'esecuzione completa
  richiede 26 chiamate provider nominali e fino a 78 con tutti i retry.
- **NFR-18** — Esito e durata di ogni esecuzione del job e gli errori dell'API sono consultabili
  dall'operatore negli strumenti di log della piattaforma.
- **OQ-23** (PRD, domanda ora risolta da questa storia) — il backend Python **non** resta in
  parallelo oltre la verifica di parità; il cache attuale **non** si migra su KV: basta il primo
  aggiornamento (A-4).

### Stato attuale del repository (verificato in questo worktree)

- `worker/wrangler.jsonc`: `name: "maestrale"`, `main: "src/index.ts"`, `compatibility_date:
  "2026-08-22"`, `triggers.crons: ["30 0,6,12,18 * * *"]`, `observability.enabled: true`, KV
  `FORECASTS` con **`id` e `preview_id` = placeholder `00000000000000000000000000000000`**. Nessuna
  `routes`/custom domain, nessun `vars`. Il test AC-8 di S04 (`worker/test/update.test.ts:321`) legge
  questo file con `?raw` e **rimuove solo le righe che iniziano con `//`**: ogni nuovo commento va su
  **riga intera**, mai in coda a una riga di JSON.
- `worker/README.md`: già ha "Passi manuali (account Cloudflare)" e "Aggiornamento programmato". Il
  test AC-8 di S04 richiede nel README le stringhe `Aggiornamento programmato`, `30 0,6,12,18 * * *`,
  `Workers Paid`, `piano Free`, `wrangler dev --test-scheduled`, `__scheduled`: **non vanno
  rimosse**. Il paragrafo "Attenzione: serve il piano Workers Paid ... prima del deploy di
  produzione (E01-S07)" è **superato dalla decisione 1/2**: va riscritto (Free per lo sviluppo,
  Paid decisione futura) **mantenendo quelle stringhe**; il test non si modifica. Anche il blocco
  introduttivo "Stato: scaffold (E01-S01)" è obsoleto.
- `worker/src/index.ts`: `scheduled` fa `runUpdate`, poi `console.error` per ogni località fallita
  (`Aggiornamento fallito per <slug>: <messaggio>`), `console.error("Nessuna località aggiornata:
  cache KV non modificato")` se non scrive, e un `console.log` JSON `{event:"forecast_update",
  updated, failed, generated_at, duration_ms}`. **`duration_ms` è tempo di orologio (`Date.now()`),
  NON CPU time**: la CPU va letta dagli strumenti Cloudflare. Il numero di subrequest **non** è
  loggato dal job.
- **App**: `app/lib/config/api_config.dart` legge `String.fromEnvironment('API_BASE_URL', defaultValue:
  'http://localhost:8000')`. È l'**unico** punto in cui l'URL è definito; nessun `.env` nell'app.
  FR-48 fissa il default e G-6 vieta modifiche al codice: **nessuna modifica Dart**, l'URL si passa
  con `--dart-define`. Le docs da aggiornare sono `app/README.md` (cita "backend FastAPI", `:8000`)
  e il README radice. L'URL `workers.dev` non è un segreto ma contiene il sottodominio dell'account:
  nei file committati si usa il segnaposto `https://maestrale.<sottodominio-account>.workers.dev`.
- **CI**: `.github/` **non esiste** nel worktree (nessun workflow; il remoto `origin` esiste, ma la CI resta un passo futuro, decisione 10). Nessun file cron/launchd/systemd
  nel repository; il cron di v0.1 era solo nel README (`30 2,8,14,20 * * * cd /app && python3
  update_forecasts.py`), quindi può esistere **sul computer/server del proprietario** (crontab,
  launchd): è un passo manuale (vedi *Passi manuali*).
- **Python da rimuovere** (tutti tracciati nella radice): `backend/` (`__init__.py`, `main.py`),
  `previsioni_mare.py`, `update_forecasts.py`, `data_sources.py`, `requirements.txt`
  (`certifi`, `fastapi`, `uvicorn`), `requirements-dev.txt` (`httpx`, `jsonschema`), i test
  `tests/test_backend.py`, `tests/test_data_sources.py`, `tests/test_fixtures.py` e i generatori
  `tests/fixtures/gen_domain_fixtures.py`, `gen_pipeline_fixtures.py`, `regenerate.py` (importano
  `previsioni_mare`/`data_sources`/`backend.main`). `data/` contiene solo il cache ignorato da git
  (`data/*.json`); se la cartella ha file tracciati, rimuoverli.
- **Da NON rimuovere**: `locations.json` (importato dal Worker), tutte le fixture **JSON** in
  `tests/fixtures/` (i test del Worker le leggono con `../../tests/fixtures/*.json`: `golden_*`,
  `open_meteo_*`, `*_cases.json`, `request_*.json`, `forecast.schema.json`),
  `tests/fixtures/README.md` (da riscrivere), `legacy/copernicus/**` (prototipo sperimentale,
  non importa moduli rimossi; usa `dotenv`/`copernicusmarine`, quindi **`.env.example` resta**).

### Decisione: destino di Python e delle fixture (raccomandata dal planner)

Si **congelano le fixture JSON** come artefatti di parità e si **cancellano** generatori e test
Python. Motivi: i test del Worker (`npm test`) sono la guardia di parità e leggono solo JSON;
`legacy/` è per prototipi *non operativi*, e spostarvi i moduli di produzione manterrebbe codice
morto con dipendenze (`fastapi`, `jsonschema`) da installare. La baseline resta recuperabile da git.
Perdita accettata e da scrivere nel README delle fixture: **nessun test valida più i golden contro
`forecast.schema.json`** (la validazione era in `tests/test_fixtures.py`, Python); la parità resta
garantita dai test deep-equal del Worker. **Ricetta di rigenerazione che funziona in ogni caso**
(i generatori sono stati aggiunti dopo `181c2f3`, quindi NON citare quel commit):
`git log --diff-filter=D --format=%H -1 -- tests/fixtures/regenerate.py` restituisce il commit che li
cancella; si fa il checkout del suo **genitore** (`<hash>^`) per averli con `backend/` e i moduli.
Il tag locale `python-baseline` (decisione 6) è creato dal coder sul commit subito prima della
rimozione e citato nel README delle fixture: `git checkout python-baseline` restituisce tutto il
Python con i generatori.

### Verifica di parità "vecchio vs nuovo" (da eseguire PRIMA della rimozione)

Script Node 22 senza dipendenze `scripts/compare_backends.mjs` (fuori da `worker/`, così Vitest non
lo raccoglie). Due modi:

- `node scripts/compare_backends.mjs --old <urlA> --new <urlB>` — stesse richieste ai due backend,
  confronto risposta per risposta.
- `node scripts/compare_backends.mjs --smoke <url>` — solo il Worker (dopo la rimozione di Python e
  contro l'URL `workers.dev`): controlli di forma, nessun confronto. Lo script **resta** nel
  repository come strumento di smoke test.

Casi (dalla fixture `golden_forecasts.json`, che contiene `cagliari` e `torre-dei-corsari`):
`/health`; `/forecast?localita=` con `Torre dei Corsari`, `torre-dei-corsari`, `Cagliari`,
`CAGLIARI`, `  cagliari ` (spazi), ognuno dei 13 slug di `locations.json` (11 su 13 daranno 404 con
questa fixture: serve a confrontare `detail.available`), `Quartu Sant'Elena` e un nome sconosciuto
(404), `localita` assente e vuoto (422). Regole di confronto: **status uguale sempre**; `/forecast`
200 e 404: corpo **deep-equal**; 422: solo status e presenza di `detail` (FastAPI e Hono possono
differire nel testo, FR-25 richiede solo `detail`); `/health`: stesso insieme di chiavi, stessi tipi,
stessi `status`, `stale`, `locations`, `generated_at`, `update_errors`; **si ignorano i valori** di
`cache_path` (eccezione OQ-19) e `age_hours` (calcolati in istanti diversi). Secondo scenario con
cache **vuota** (Python con `FORECAST_CACHE_PATH` verso un file inesistente, Worker con KV locale
non seminata): `/forecast` 503 con lo stesso `detail`, `/health` 200 `degraded`. Con il golden
`generated_at` è del 2026-10-19: `/health` risulterà `degraded`/`stale` in **entrambi**; è atteso.

Avvio dei due lati in locale (nessun accesso all'account): Python
`FORECAST_CACHE_PATH=tests/fixtures/golden_forecasts.json uvicorn backend.main:app --port 8000`
(installare prima `requirements.txt` in un venv); Worker `cd worker && npx wrangler dev --local
--port 8787`, poi seed locale `npx wrangler kv key put --binding FORECASTS latest --path
../tests/fixtures/golden_forecasts.json --local` (**verificare i flag con `npx wrangler kv key put
--help`**: in wrangler 4 locale/remoto hanno default diversi, e serve `--local` esplicito perché il
seed finisca nella stessa KV simulata servita da `wrangler dev`).

### Piano Free: cosa aspettarsi (importante per gli AC post-deploy)

Il README di S04 già avvisa che sul piano Free il cron **probabilmente fallirà** (13 `buildForecast`
con aggregazioni e parsing di ~26 risposte JSON in 10 ms di CPU; 26–78 subrequest contro 50). Il
risultato "il cron fallisce su Free" **è una misura valida, non un fallimento della storia**: AC-9
copre entrambi i rami. Se il cron non scrive la KV, `/forecast` risponde 503 e per provare
l'app end-to-end si semina la KV remota dal golden (con `generated_at` fisso, quindi `/health` sarà
correttamente `degraded`/`stale`). Il seed dal golden è un'azione sull'account: passo manuale.

### File probabilmente toccati

- Nuovi: `scripts/compare_backends.mjs`, `scripts/compare_backends.test.mjs`, `docs/runbook.md`,
  `docs/adr/0001-cloudflare-workers-kv.md`.
- Modificati: `README.md` (radice), `app/README.md`, `worker/README.md`, `worker/wrangler.jsonc`
  (solo commenti su riga intera sul segnaposto KV, se serve), `tests/fixtures/README.md`,
  `legacy/copernicus/README.md`, `docs/architecture.md` (resta `status: draft`), `.gitignore`
  (solo voci Python obsolete: `__pycache__/`, `*.py[cod]`, `.pytest_cache/`, `data/*.json`; **restano**
  `.env`, `*.nc` perché usati da `legacy/`).
- Cancellati: elenco in *Python da rimuovere*.
- **Non toccati**: `app/lib/**`, `app/pubspec.*`, `app/android/**`, `app/ios/**`, `docs/PRD.md`,
  `worker/src/**`, `worker/test/**`, `worker/package.json`/lockfile, fixture JSON, `locations.json`,
  `.env.example`.

### Vincoli

- **Nessuna nuova dipendenza** (né npm né pip né Dart).
- **Nessun comando verso l'account Cloudflare** da parte del coder (niente `deploy`, `kv namespace
  create`, `kv key put` remoto, `tail`, `rollback`, `login`). Ogni comando `wrangler` scritto nel
  runbook va controllato con `--help` o `--dry-run`, mai contro il remoto.
- I **90 test** del Worker restano verdi senza modifiche; non indebolire né cancellare test del
  Worker. Si cancellano solo i test Python che testano codice Python rimosso.
- Commit sul branch `feat/e01-s07` (decisione 9), **senza push**. `docs/PRD.md` intatto nel contenuto.
- ADR e `architecture.md` li scrive il coder come descrizione **di ciò che è stato costruito** (non
  nuove decisioni): ADR `status: proposed`, architettura `status: draft`; **li approva solo il
  proprietario**.

### Fuori scope (esplicito)

- Custom domain, Workers Paid, Workers Builds / deploy automatico da GitHub (richiede configurazione
  dal dashboard; il remoto GitHub esiste: da citare nel runbook come passo futuro), workflow GitHub
  Actions di deploy (richiederebbe un API token come segreto).
- Riduzione dei retry (decisione 3), `vars`/configurazione runtime, `/docs`, logging strutturato.
- Aggiornamento manuale su richiesta di una sola località (FR-15 superato, OQ-17).
- Modifiche a `docs/PRD.md` (a cura del proprietario: FR-29 escluso, OQ-22/OQ-23 risolte).

## Acceptance criteria

Gli AC-1..AC-7 e AC-11 li verifica il coder/reviewer sul repository. Gli AC-8..AC-10 si verificano
**dopo** i *Passi manuali* e restano `[post-deploy]` finché l'orchestratore non annota l'esito in
*Dev notes*.

- **AC-1** — *Script di confronto.* Given due server HTTP finti (in `scripts/compare_backends.test.mjs`,
  eseguito con `node --test scripts/`), when `compare_backends.mjs` confronta risposte identiche, then
  esce con codice 0; when una differisce (status, un campo di `/forecast`, una chiave o un tipo di
  `/health`, `detail.available` di un 404), then esce con codice != 0 e stampa il caso e la differenza;
  `cache_path` e `age_hours` (valori) sono ignorati; per il 422 si confrontano solo status e presenza
  di `detail`. In modalità `--smoke <url>` controlla forma di `/health`, `/forecast` 200 **oppure**
  503 `Previsioni non ancora disponibili` (cache vuota), 404 con `detail.available`, 422 con `detail`,
  e dice esplicitamente quale ramo (200/503) ha trovato.
- **AC-2** — *Parità verificata prima della rimozione.* Given Python (uvicorn) con cache
  `tests/fixtures/golden_forecasts.json` e Worker locale (`wrangler dev --local`) con la stessa KV
  seminata, when si esegue `node scripts/compare_backends.mjs --old http://localhost:8000 --new
  http://localhost:8787`, then **0 differenze** su tutti i casi elencati nel Context (compresi i 13
  slug) e sullo scenario a cache vuota (503); inoltre, seminando il Worker con una copia del golden
  alterata in un campo di `torre-dei-corsari`, lo script **fallisce** (prova che il confronto non è
  vacuo). Output e comandi esatti, con data e `git rev-parse --short HEAD`, in *Dev notes*. Questo
  AC è prerequisito dell'AC-4.
- **AC-3** — *App invariata, solo `API_BASE_URL`.* Given il diff della storia, when si controlla
  `git diff --stat -- app/lib app/pubspec.yaml app/pubspec.lock app/android app/ios`, then è **vuoto**
  (FR-48 e G-6); `cd app && flutter analyze && flutter test` sono verdi; `app/README.md` descrive
  come puntare l'app al Worker (`flutter run
  --dart-define=API_BASE_URL=https://maestrale.<sottodominio-account>.workers.dev`, senza `/` finale),
  l'uso locale con `wrangler dev` (`http://localhost:8787`; Android emulator `http://10.0.2.2:8787`),
  non parla più di "backend FastAPI" né richiede di avviare Python; resta la nota che il cleartext
  Android è solo per lo sviluppo locale.
- **AC-4** — *Python rimosso.* Given AC-2 registrato in *Dev notes*, when si completa la rimozione,
  then (a) `git ls-files '*.py'` elenca solo file sotto `legacy/`; (b) non esistono più `backend/`,
  `previsioni_mare.py`, `update_forecasts.py`, `data_sources.py`, `requirements*.txt`,
  `tests/test_*.py`, `tests/fixtures/{gen_domain_fixtures,gen_pipeline_fixtures,regenerate}.py`;
  (c) `git diff --stat -- 'tests/fixtures/*.json' locations.json worker/src worker/test` non mostra
  modifiche; (d) `cd worker && npm test` (90 test), `npm run typecheck` e `npx wrangler deploy --dry-run
  --outdir dist` passano; (e) `grep -rIlE "update_forecasts|previsioni_mare|uvicorn|FastAPI|backend/main|requirements(-dev)?\.txt|FORECAST_CACHE_PATH"
  README.md app/README.md worker/README.md worker/wrangler.jsonc docs/architecture.md docs/runbook.md legacy`
  non trova nulla, **tranne** riferimenti storici esplicitamente etichettati come tali (es. "port
  di `update_forecasts.py`"); i commenti di provenienza in `worker/src/**`, il PRD, le storie `done`
  e l'ADR possono citare i nomi vecchi e sono esclusi dal controllo; (f) `legacy/copernicus/README.md`
  non rimanda più a `../../data_sources.py` ma al Worker (`worker/src/data_sources.ts`);
  (g) nessuna voce di cron/scheduler Python nel repository.
- **AC-5** — *Documentazione aggiornata.* Given i README, when li si legge, then: `README.md` radice
  descrive il Worker (non FastAPI), i comandi `cd worker && npm ci && npm test`, `npm run dev`, il
  deploy rimandando a `worker/README.md` e `docs/runbook.md`, `API_BASE_URL` e l'app, la struttura
  del progetto aggiornata (senza `backend/`, `data/`, `*.py` operativi), l'elenco delle località
  `locations.json`, l'attribuzione Open-Meteo; **senza** `/docs`/OpenAPI (FR-29 escluso) né cron
  Python. `worker/README.md`: rimosso il banner "scaffold", paragrafo Free/Paid riscritto
  (sviluppo su Free con cron probabilmente non completabile, misure in `docs/runbook.md`, Paid
  decisione futura) **conservando** le stringhe richieste dal test AC-8 di S04 (test non modificato e
  verde); `tests/fixtures/README.md` riscritto come "fixture congelate" con la ricetta di
  rigenerazione via cronologia git (vedi Context) e la perdita accettata (nessuna validazione
  schema automatica); i riferimenti Python che restano sono etichettati come storici.
- **AC-6** — *ADR e architettura.* Given `docs/adr/`, then esiste `0001-cloudflare-workers-kv.md`
  (template `0000-template.md`, `status: proposed`, data 2026-10-19) con: contesto (FR-49, FR-50,
  NFR-11, NFR-12, NFR-15, OQ-22/OQ-23), opzioni (mantenere Python su server proprio; Workers + KV
  con Cron Trigger; altra persistenza Cloudflare come D1/R2), decisione (Workers + Hono + KV
  `FORECASTS` chiave `latest` + Cron `30 0,6,12,18 * * *` UTC), conseguenze (consistenza eventuale
  NFR-16, cron solo UTC/ora legale, limiti Free/Paid con i numeri 10 ms / 50 / 26–78, nessun
  `/docs` perché FR-29 è escluso, dismissione di Python, deploy di sviluppo su `workers.dev` e
  Paid come decisione futura da misure). `docs/architecture.md` ha le sezioni 1, 2, 3, 5, 8 e 9
  compilate **con ciò che esiste** (contesto, stack, componenti Worker/KV/Cron/App, API
  `/health` e `/forecast`, riga ADR-0001, rischio limiti Free), resta `status: draft`; `docs/PRD.md` è
  invariato.
- **AC-7** — *Runbook.* Given `docs/runbook.md`, then contiene sezioni: **Deploy** (prerequisiti,
  `npx wrangler login`, ordine KV -> id in `wrangler.jsonc` -> `deploy`, URL `workers.dev`, nota
  che al primo deploy va registrato il sottodominio `workers.dev`); **Cron** (espressione, tabella
  UTC <-> Europe/Rome, come e quando gira, come lanciarlo a mano: attendere lo slot, `wrangler dev
  --test-scheduled` in locale, opzioni remote elencate con i loro limiti — in particolare se
  `wrangler dev --remote` usa `preview_id` e quindi **non** la KV di produzione); **Rigenerazione
  della cache** (far girare il cron; in sviluppo seminare dal golden con `wrangler kv key put`,
  specificando che i dati sono vecchi e `/health` sarà `degraded`; come leggere `latest` con
  `wrangler kv key get`); **Rollback** (`wrangler deployments list`, `wrangler rollback`, e che la KV
  **non** viene ripristinata dal rollback del codice; ripristino della cache dal golden o dal
  prossimo cron); **Osservabilità con ciò che esiste** (righe `console.*` di `index.ts` con il formato
  esatto di `forecast_update`, `wrangler tail`, Workers Logs, `/health` e i campi `status`,
  `stale`, `update_errors`; avviso che `duration_ms` è tempo di orologio e non CPU; da dove leggere
  CPU time e subrequest); **Limiti piano Free e misure** (tabella con i limiti 10 ms / 50
  subrequest; 26 nominali, 78 con retry, +2 KV se contate; i valori misurati in AC-9; spiegazione del
  perché i retry restano a 3, decisione 3); **Regola go/no-go per Paid** (vedi sotto);
  **Passi futuri** (custom domain, Workers Builds da GitHub, CORS ristretto). I comandi `wrangler`
  del documento sono stati controllati con `--help`/`--dry-run`.
  *Regola go/no-go proposta* (da confermare dal proprietario, vedi *Domande aperte*): **si passa a
  Paid prima di aprire l'app ad altri utenti**, e in ogni caso se almeno una misura su Free mostra
  (a) esecuzione fallita per CPU o subrequest, oppure (b) CPU > 7 ms o subrequest > 40 su una run
  nominale (margine ~30% sui limiti), oppure (c) nessuna run completa nelle ultime 24 h. Se tutte le
  misure rientrano e l'app resta personale, si può restare su Free con monitoraggio di `/health`.
- **AC-8** — *[post-deploy] Deploy di sviluppo.* Given i *Passi manuali* 1-4 eseguiti, when si apre
  `https://maestrale.<sottodominio-account>.workers.dev/`, then risponde 200 `{"status":"ok","service":"maestrale"}`;
  `wrangler deployments list` mostra la versione; `worker/wrangler.jsonc` non contiene `routes`
  né custom domain; il Worker è sul piano Free (nessun upgrade fatto).
- **AC-9** — *[post-deploy] Misura del cron su Free.* Given il Worker deployato, when l'orchestratore
  fa girare il cron (modo scelto e annotato), then in *Dev notes* e nella tabella del runbook sono
  registrati: modo di invocazione, data/ora UTC, **esito** (riga `forecast_update` o errore della
  piattaforma), **CPU time** e **numero di subrequest** con la fonte (Workers Logs, dashboard
  Metrics o `wrangler tail`; se una delle due misure non è ottenibile, scriverlo e dedurre
  dal log/dall'errore). **Ramo A** (cron riuscito): `updated` = 13, `failed` = 0 e `/forecast` risponde
  200. **Ramo B** (cron fallito per limiti Free): l'errore è registrato come misura e la KV viene
  seminata dal golden (Passo manuale 6) per consentire AC-10; la regola di AC-7 dà "no-go per l'uso
  multiutente senza Paid".
- **AC-10** — *[post-deploy] Smoke test e app Flutter contro il Worker.* Given la KV con dati (da cron o
  da golden), when si esegue `node scripts/compare_backends.mjs --smoke <url workers.dev>`, then passa
  (ramo 200); when il proprietario esegue `cd app && flutter run
  --dart-define=API_BASE_URL=<url workers.dev>` e cerca "Torre dei Corsari", then l'app mostra la
  previsione a 7 giorni e i suggerimenti/mappa funzionano senza modifiche al codice (FR-48, FR-50);
  esito annotato in *Dev notes*. Se i dati sono il golden, "Aggiornato" mostrerà la data del golden.
- **AC-11** — Tutti i comandi di `verify` passano sul repository finale (dopo la rimozione di
  Python), e `docs/stories/E01-S07-deploy-cutover.md` ha *Dev notes* e *Run log* compilati.

## Tasks

Ordine obbligatorio: il confronto con Python (task 1-5) precede la rimozione (task 6).

### Parte A — il coder (solo locale, nessuna azione sull'account Cloudflare)

- [x] 1. Scrivere `scripts/compare_backends.test.mjs` (`node:test`, server HTTP finti con
      `node:http`): casi identici, status diverso, campo diverso in `/forecast`, chiave/tipo diverso in
      `/health`, `cache_path`/`age_hours` ignorati, 422 confrontato solo su status e `detail`, modo
      `--smoke` (ramo 200 e ramo 503); vederlo fallire (AC-1)
- [x] 2. Implementare `scripts/compare_backends.mjs` (Node 22, solo `fetch` globale, nessuna
      dipendenza; argomenti `--old/--new` e `--smoke`; exit code 0/1) e rendere verdi i test (AC-1)
- [x] 3. Verifica di parità locale **prima** di rimuovere Python: creare un venv, installare
      `requirements.txt`, avviare uvicorn sul golden e `wrangler dev --local` con KV seminata dal
      golden (controllare i flag con `--help`); eseguire `--old/--new`; ripetere con cache vuota;
      ripetere con golden alterato e vedere il confronto fallire; fermare i processi (AC-2)
- [x] 4. Registrare in *Dev notes* comandi, output, data e hash del commit (AC-2). **Se c'è una
      differenza reale: fermarsi, annotarla, stato `blocked` e segnalarla** (è un difetto di S05
      o un'eccezione al PRD da decidere col proprietario, non da "sistemare" nel confronto)
- [x] 5. Aggiornare `app/README.md` (AC-3) e verificare che il diff su `app/lib`, `pubspec.*`,
      `android`, `ios` sia vuoto; eseguire `flutter analyze` e `flutter test`
- [x] 6. Rimuovere Python (solo se il task 4 è verde): file e cartelle dell'elenco, voci obsolete di
      `.gitignore`; riscrivere `tests/fixtures/README.md` e correggere `legacy/copernicus/README.md`;
      eseguire `cd worker && npm test`, `npm run typecheck`, `npx wrangler deploy --dry-run
      --outdir dist` e i controlli di AC-4 (a)-(g)
- [x] 7. Aggiornare `README.md` radice e `worker/README.md` (AC-5), mantenendo le stringhe richieste
      dal test AC-8 di S04; rieseguire `npm test`
- [x] 8. Scrivere `docs/adr/0001-cloudflare-workers-kv.md` (AC-6) e compilare `docs/architecture.md`
      restando in `draft`
- [x] 9. Scrivere `docs/runbook.md` (AC-7): controllare ogni comando `wrangler` con `--help` o
      `--dry-run` (mai contro il remoto); lasciare la tabella delle misure Free con celle `da misurare`
- [x] 10. Eseguire tutti i comandi di `verify` (AC-11) e compilare *Dev notes*: esito del confronto,
      elenco dei file cancellati, la scelta sul destino delle fixture, le conferme su "nessun
      `any`/dipendenza nuova"

### Passi manuali (eseguiti dall'orchestratore previa conferma dell'owner)

Il coder **non** li esegue. L'orchestratore chiede conferma al proprietario prima di ciascun gruppo
e annota in *Dev notes* data, comando, esito.

- [x] 0. ~~(facoltativo)~~ Tag locale `python-baseline`: **fatto dal coder** (decisione 6), vedi Dev notes.
- [ ] 1. `cd worker && npx wrangler login` (il proprietario autorizza nel browser).
- [ ] 2. Creare i namespace KV: `npx wrangler kv namespace create FORECASTS` e `npx wrangler kv
      namespace create FORECASTS --preview`; annotare i due id (non sono segreti).
- [ ] 3. Sostituire in `worker/wrangler.jsonc` `id` e `preview_id` (oggi `00000000000000000000000000000000`)
      con gli id reali, usando **solo commenti su riga intera** se si tocca il file (il test AC-8 di S04
      lo legge). Raccomandazione: committare gli id reali (servono per un deploy riproducibile e non
      sono segreti). Rieseguire `cd worker && npm test`.
- [ ] 4. `cd worker && npx wrangler deploy` (piano Free, sottodominio `workers.dev`; al primo deploy
      wrangler può chiedere di registrare il sottodominio). Annotare l'URL. Verifica AC-8.
- [ ] 5. Far girare il cron e misurare (AC-9). Opzioni, **da scegliere dall'orchestratore** perché non
      verificabili dal repository: (a) attendere il prossimo slot UTC (00:30, 06:30, 12:30, 18:30)
      con `npx wrangler tail` aperto; (b) lancio manuale dal dashboard, se disponibile; (c) `npx
      wrangler dev --remote --test-scheduled` + `curl "http://localhost:8787/__scheduled?cron=30+0+*+*+*"`
      — **controllare prima se `--remote` usa `preview_id`**: in tal caso seminerebbe la KV di
      anteprima e non quella smoke-testata. **Non** modificare temporaneamente il cron a ogni minuto.
      Registrare esito, CPU time e subrequest (fonte inclusa) e riempire la tabella del runbook.
- [ ] 6. Ramo B (cron non completato) o KV ancora vuota: seminare la KV di produzione dal golden con
      `npx wrangler kv key put --binding FORECASTS latest --path ../tests/fixtures/golden_forecasts.json
      --remote` (flag da verificare con `--help`; in wrangler 4 serve indicare esplicitamente il
      remoto). Annotare che `/health` risulterà `degraded`/`stale`.
- [ ] 7. Smoke test: `node scripts/compare_backends.mjs --smoke https://maestrale.<sottodominio>.workers.dev`
      (AC-10) e `curl` di `/health` e `/forecast?localita=Torre%20dei%20Corsari`.
- [ ] 8. Il proprietario prova l'app: `cd app && flutter run --dart-define=API_BASE_URL=<url>` (AC-10).
- [ ] 9. Dismissione lato host (la parte "nessun processo Python" che il repository non vede): sul
      computer/server del proprietario rimuovere la voce `crontab`/`launchd`/`systemd` di
      `update_forecasts.py`, fermare ogni `uvicorn backend.main:app` ancora in esecuzione, cancellare
      il vecchio `data/forecasts.json` se non serve più. Controllo: `pgrep -fl "uvicorn|update_forecasts"`
      senza risultati e `crontab -l` senza la riga (se il cron v0.1 non è mai stato installato, annotarlo).
- [ ] 10. Decidere se lasciare attivo il cron sul piano Free: se la misura dice che fallisce
      sempre, ogni 6 h genera una run fallita nei log (`/health` diventa `stale` dopo 12 h). Con Free e
      senza Paid, il proprietario sceglie se disabilitarlo (rimuovendo `triggers.crons`: richiede
      modificare anche il test AC-8 di S04, quindi una storia a parte) o tollerarlo.
      **Deciso (decisione 8): tollerare e misurare**; nessuna modifica al cron.

## Domande aperte

**Tutte risolte il 2026-10-19** (vedi decisioni 6-10 sopra). Testo originale conservato per storico.

1. **Fixture e generatori Python: cancellarli o tenerli in `legacy/`?** Raccomandato: **cancellare
   generatori e test Python, congelare le fixture JSON**, ricetta di rigenerazione via cronologia git
   (e tag `python-baseline` facoltativo). Alternativa: spostare `previsioni_mare.py`, `data_sources.py`,
   `backend/` e i generatori in `legacy/python-backend/` per poterli rieseguire senza git, al costo di
   mantenere codice e dipendenze morti. Se si sceglie `legacy/`, il task 6 e l'AC-4 vanno riformulati.
2. **Regola go/no-go per Paid** di AC-7 (soglie 7 ms / 40 subrequest / 24 h senza run completa):
   confermare o correggere le soglie.
3. **Cron su Free se non completa** (Passo manuale 10): tollerare le run fallite durante lo sviluppo
   o disabilitare il cron? Raccomandato: tollerare e leggere le misure; disabilitare richiede una
   storia a parte per non aggirare il test AC-8 di S04.
4. **Committare `docs/` ora?** In base allo snapshot git del workspace principale, `docs/PRD.md`,
   `docs/adr/` e `docs/architecture.md` risultano **non tracciati** (non verificato in questo
   worktree). Raccomandato: committarli insieme alla storia, così che ADR e runbook siano versionati
   (la verifica richiede "ADR e runbook committati"). Il commit lo decide il proprietario.
5. **Workflow GitHub solo test (`npm test` + `typecheck` + Flutter)**: non esiste `.github/` e non
   risulta un remoto. Raccomandato: **non aggiungerlo in S07**; ripresentare la domanda quando ci
   sarà un remoto GitHub e si configurerà Workers Builds dal dashboard.

## Dev notes
<!-- Coder: decisioni, deviazioni, riepilogo delle modifiche. Orchestratore: esiti dei passi manuali. -->

### Verifica di parità vecchio vs nuovo (AC-2) — 2026-10-19, prima della rimozione di Python

Commit di partenza: `57586d2` (script già committato). Ambiente: Python 3.12.2 con `fastapi`/`uvicorn`
già installati (nessun venv né `pip install` necessari), Node 22.16.0, wrangler 4.151.2. Nessun accesso
alla rete né all'account Cloudflare. KV locale persistita in una directory di lavoro temporanea
(`--persist-to`), non in `worker/`.

Comandi (da radice repo, salvo dove indicato):

```bash
# Python con cache = golden (porta 8000) e con cache inesistente (porta 8001)
FORECAST_CACHE_PATH=tests/fixtures/golden_forecasts.json python3 -m uvicorn backend.main:app --port 8000
FORECAST_CACHE_PATH=<dir>/nonexistent.json            python3 -m uvicorn backend.main:app --port 8001
# Worker locale (porta 8787), KV locale inizialmente vuota
cd worker && npx wrangler dev --local --port 8787 --persist-to <dir>/kv1
# Scenario cache vuota
node scripts/compare_backends.mjs --old http://localhost:8001 --new http://localhost:8787 --empty
# Seed del golden nella KV locale
cd worker && npx wrangler kv key put --binding FORECASTS latest --path ../tests/fixtures/golden_forecasts.json --local --preview false --persist-to <dir>/kv1
# Scenario golden
node scripts/compare_backends.mjs --old http://localhost:8000 --new http://localhost:8787
```

Risultati:

- Scenario cache vuota (`--empty`): **23 casi, 0 differenze** (exit 0): `/forecast` 503 con lo stesso
  `detail`, `/health` 200 `degraded` con le stesse chiavi (`error`, `locations`, `cache_path`, `status`).
- Scenario golden: **23 casi, 0 differenze** (exit 0): `/health`, 5 varianti di nome (`Torre dei Corsari`,
  `torre-dei-corsari`, `Cagliari`, `CAGLIARI`, `  cagliari `), i 13 slug di `locations.json` (2 con 200,
  11 con 404 e `detail.available` identico), `Quartu Sant'Elena` e un nome sconosciuto (404),
  `localita` assente e vuoto (422). Con il golden (`generated_at` 2026-10-19T09:00Z, ~10,4 h al momento
  dell'esecuzione) `/health` era `ok`/non stale in entrambi.
- Prova di non vacuità: seed di una copia del golden con `daily[0].sea.wave_height_mean_m` di
  `torre-dei-corsari` alterato (0.74 -> 0.75): exit **1**, 3 differenze (`Torre dei Corsari`,
  `torre-dei-corsari`, slug `torre-dei-corsari`), es.
  `$.daily[0].sea.wave_height_mean_m: 0.74 != 0.75`. Ripristinato il golden: di nuovo 0 differenze.
- `--smoke http://localhost:8787` sul Worker locale seminato: `Esito: ramo 200`, `SMOKE OK`.
- Processi uvicorn/wrangler/workerd fermati a fine prova.

Nessuna differenza reale di contratto: S05 conforme al comportamento Python sui casi coperti.

Scoperte utili per il runbook:

- `wrangler kv key put --binding FORECASTS ...` con `id` **e** `preview_id` configurati **fallisce** se non
  si passa `--preview false` (produzione) o `--preview` (anteprima). Vale anche per `--remote`: nei
  comandi del runbook si usa sempre `--preview false` esplicito.
- `node --test scripts/` (come scritto nel `verify` originale) **non funziona su Node 22**: la directory è
  trattata come modulo (`Cannot find module .../scripts`). Il `verify` della storia è stato corretto in
  `node --test scripts/*.test.mjs` (stesso intento, funziona su Node 22).

### Rimozione di Python e documentazione (coder, 2026-10-19)

- **Tag**: `python-baseline` (locale, leggero, non pubblicato) su `2ff2cd8`, l'ultimo commit che contiene
  ancora il Python; il commit di rimozione è `4188852`.
- **File cancellati** (`git rm`): `backend/__init__.py`, `backend/main.py`, `previsioni_mare.py`,
  `update_forecasts.py`, `data_sources.py`, `requirements.txt`, `requirements-dev.txt`,
  `tests/test_backend.py`, `tests/test_data_sources.py`, `tests/test_fixtures.py`,
  `tests/fixtures/gen_domain_fixtures.py`, `gen_pipeline_fixtures.py`, `regenerate.py`.
  `git ls-files '*.py'` elenca solo `legacy/copernicus/*.py`.
- **Fixture**: JSON congelate e invariate (`git diff` su `tests/fixtures/*.json`, `locations.json`,
  `worker/src`, `worker/test` vuoto). Perdita accettata: nessuna validazione automatica dei golden contro
  `forecast.schema.json`; ricetta di rigenerazione (tag) in `tests/fixtures/README.md` e nel runbook.
- **Modificati**: `README.md`, `app/README.md` (solo doc: nessuna modifica Dart, `git diff` su
  `app/lib`, `pubspec.*`, `android`, `ios` vuoto), `worker/README.md` (banner scaffold rimosso, paragrafo
  Free/Paid riscritto conservando le stringhe richieste dal test AC-8 di S04; una prima stesura spezzava
  "Workers Paid" su due righe e il test lo ha segnalato: corretto nel README, test non modificato),
  `tests/fixtures/README.md`, `legacy/copernicus/README.md` (+ docstring dei due `.py` legacy:
  "pipeline FastAPI" -> "pipeline operativa"), `.gitignore` (tolte le voci Python), `docs/architecture.md`
  (sezioni 1, 2, 3, 5, 8, 9; resta `draft`).
- **Nuovi**: `scripts/compare_backends.mjs`, `scripts/compare_backends.test.mjs` (15 test),
  `docs/adr/0001-cloudflare-workers-kv.md` (`proposed`), `docs/runbook.md` (`draft`).
- `wrangler.jsonc` non modificato (i placeholder KV restano finché l'orchestratore non crea i namespace).
- Nessun `any`, nessuna dipendenza nuova (npm/pip/Dart): lo script usa solo `fetch` e moduli `node:`.
- Comandi `wrangler` del runbook controllati con `--help`: `kv key put/get` (serve `--preview false`
  con `id`+`preview_id`), `deployments list`, `rollback [version-id] -m`, `tail --format json`,
  `dev --remote/--test-scheduled/--ip`. Non verificabile offline: quale KV usa `dev --remote` (scritto nel
  runbook come tale).
- Il `verify` della storia è stato corretto: `node --test scripts/` -> `node --test scripts/*.test.mjs`
  (su Node 22 la directory non è accettata).

### Stato degli AC

AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-11: soddisfatti sul repository (vedi Run log).
**AC-8, AC-9, AC-10: `[post-deploy]` PENDING** — da verificare dall'orchestratore dopo i Passi manuali 1-8
(le celle della tabella delle misure nel runbook sono `da misurare`). Passo manuale 9 (host) e le
conferme del proprietario restano a cura dell'orchestratore. Il Passo 0 (tag) è già fatto; il 10 è deciso
(tollerare).

### Esiti dei passi manuali (orchestratore)
<!-- data, comando, esito -->

Tutti il 2026-10-19, da `worker/`, con l'ok dell'owner.

| Passo | Comando | Esito |
|---|---|---|
| 1 | `npx wrangler whoami` | già autenticato (OAuth), login non necessario |
| 2 | `npx wrangler kv namespace create FORECASTS` / `--preview` | id `7b1c0444535542408cc05fa9dd59536b`, preview_id `b6b83416188441aea18ce2846ccad5d6` |
| 3 | id in `worker/wrangler.jsonc`, `npm test` | 90/90, typecheck 0 errori; commit `a9bd0ab` |
| 4 | `npx wrangler deploy` | `https://maestrale.giuseppe-concas.workers.dev`, versione `bf4c9433-004b-4b28-ad9d-80015267a84a`, 87.94 KiB (gzip 22.78), startup 3 ms, schedule `30 0,6,12,18 * * *`. `GET /` → 200 `{"status":"ok","service":"maestrale"}` (AC-8) |
| 6 | `npx wrangler kv key put --binding FORECASTS latest --path ../tests/fixtures/golden_forecasts.json --remote --preview false` | prima: `/health` degraded "Cache forecast non ancora generato"; dopo: `ok`, `locations: 2` |
| 7 | `node scripts/compare_backends.mjs --smoke <url>` + `curl` | `SMOKE OK` (ramo 200); `/forecast?localita=Torre%20dei%20Corsari` 200, località inesistente 404 (AC-10 parte smoke) |
| 5 | `npx wrangler tail maestrale --format json` in background | **in attesa** del cron delle 00:30 UTC (AC-9 pendente) |
| 8 | app Flutter con `--dart-define` | **in attesa** dell'owner |
| 9 | dismissione host owner | **in attesa** dell'owner |

## Run log
<!-- Autopilot: iteration | command | result | note -->
| iterazione | comando | esito | note |
|---|---|---|---|
| 1 | `node --test scripts/*.test.mjs` | 15 pass / 0 fail | prima del codice: falliva (script assente) |
| 1 | parità `--old :8000 --new :8787` (golden / cache vuota) | 0 differenze su 23 casi, entrambi | uvicorn + `wrangler dev --local` |
| 1 | stessa parità con golden alterato | exit 1, 3 differenze | prova di non vacuità |
| 1 | `cd worker && npm test` | 90/90 | dopo la rimozione di Python |
| 1 | `cd worker && npm run typecheck` | ok | |
| 1 | `cd worker && npx wrangler deploy --dry-run --outdir dist` | ok | `dist/` non committato |
| 1 | `cd app && flutter analyze && flutter test` | No issues / 10 test pass | |
| 1 | `test -z "$(git ls-files '*.py' | grep -v '^legacy/')"` | ok | |
| 1 | grep AC-4(e) su README/app/worker/architecture/runbook/legacy | solo riferimenti storici etichettati nel runbook | |

## Review log
<!-- Reviewer: date, verdict, findings R-1… (blocker/should/nit) with file:line. -->

### 2026-10-19 — Reviewer — verdetto: approvato, in attesa di AC-9 e passi owner (status resta `review`)

Verify eseguito dal reviewer su `776e7bb`: `npm test` 90/90, `typecheck` ok, `wrangler deploy --dry-run`
ok (binding KV reale), `node --test scripts/*.test.mjs` 15/15, `flutter analyze` no issues,
`flutter test` 10/10, nessun `*.py` fuori da `legacy/`. Smoke in sola lettura su
`https://maestrale.giuseppe-concas.workers.dev`: `SMOKE OK` ramo 200, `GET /` 200, `/health` ok.
Controlli: ordine commit corretto (parità `2ff2cd8` → tag `python-baseline` → rimozione `4188852`);
`app/lib`, `pubspec.*`, `android`, `ios`, `worker/src`, `worker/test`, fixture JSON, `locations.json`
invariati; `wrangler.jsonc` cambia solo gli id KV con commenti su riga intera; `docs/PRD.md`
identico all'originale; nessun segreto. Nessun blocker.

- **R-1** (should) `tests/fixtures/README.md:44-46` e `docs/runbook.md:164`: la ricetta di
  rigenerazione omette `python3 tests/fixtures/gen_pipeline_fixtures.py`, che al tag `python-baseline`
  genera `round_cases.json`, `agg_cases.json` e `request_urls.json`. Aggiungere il comando e indicare
  quale generatore produce ciascun file.
- **R-2** (should) `worker/README.md:57,73,90-91` e `docs/runbook.md:23-24`: parlano ancora del
  placeholder `000…0` "committato"/"oggi", ma da `a9bd0ab` gli id sono reali. Riformulare come
  procedura per un nuovo account (o "già fatto il 2026-10-19, id in `wrangler.jsonc`").
- **R-3** (nit) `scripts/compare_backends.test.mjs:193-203`: il test si chiama "503 con detail diverso
  fallisce", ma confronta 503 con 404 (differenza di status). Aggiungere un caso 503 vs 503 con `detail`
  diverso e un caso 422 senza `detail` che deve fallire (le regole già ci sono, mancano i test).
- **R-4** (nit) `.gitignore`: tolto `data/*.json`, ma il workspace principale ha ancora
  `data/forecasts.json`. Dopo il merge comparirà come non tracciato e potrebbe finire in un
  `git add -A`. Fare il Passo 9 (cancellarlo) prima del merge, oppure tenere la voce finché il file
  esiste.
- **R-5** (nit) `docs/architecture.md:4`: `prd_version: 0.1`, il PRD è alla `0.2`.

AC soddisfatti sul repository: AC-1..AC-7, AC-11; AC-8 verificato (deploy, `GET /` 200, nessun
`routes`). **Pendenti**: AC-9 (misura del cron su Free: tabella del runbook ancora `da misurare`),
AC-10 parte app (Passo 8, owner), Passo 9 (dismissione host, owner). R-1/R-2 da correggere insieme
all'annotazione di AC-9; poi `done`.

### Chiusura (2026-10-19)
Chiusa su decisione dell'owner con AC-1..AC-8, AC-10 (parte smoke) e AC-11 verificati. AC-9 (misura
del cron su Free), AC-10 (prova dell'app Flutter) e Passo 9 (dismissione lato host), insieme ai nit
R-3, R-4 e R-5, passano a un task di follow-up nel planner, fuori da E01.
