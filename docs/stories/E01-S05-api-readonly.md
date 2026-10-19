---
id: E01-S05
epic: E01
title: "API read-only su Workers (/health e /forecast) con parità col backend Python"
type: feature
status: review
requirements: [FR-19, FR-22, FR-23, FR-24, FR-25, FR-26, FR-28, FR-50, NFR-13]
depends_on: [E01-S00, E01-S01, E01-S02, E01-S03]
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
  - python3 -m unittest discover -s tests -v
---

# E01-S05: API read-only su Workers (`/health`, `/forecast`) con parità

## Context

Il backend Python/FastAPI (`backend/main.py`) espone due sole route di lettura: `GET /health`
(stato del cache) e `GET /forecast?localita=…` (previsione di una località). Su Cloudflare Workers
(NFR-12) la cache è su Workers KV (`binding FORECASTS`, E01-S01) e non esiste filesystem: questa
storia scrive il **livello di lettura** su Hono, replicando codici HTTP, nomi di campo, tipi e
semantica del Python (FR-50), così che l'app Flutter esistente funzioni senza modifiche.

Comportamento di riferimento (`backend/main.py`, `tests/test_backend.py`):

- `GET /health` — risponde **sempre 200**. Cache assente → `degraded` con
  `error: "Cache forecast non ancora generato"`, `locations: 0` e identificativo del cache; cache
  illeggibile → `degraded` con `error: "Cache forecast non leggibile: …"`; altrimenti
  `status` = `degraded` se l'età supera `FORECAST_MAX_AGE_HOURS` (default 12), se `generated_at`
  manca o se `errors` non è vuoto, altrimenti `ok`, con `generated_at`, `age_hours` (2 decimali),
  `stale`, `locations` (numero di località), `update_errors` (FR-26, FR-28).
- `GET /forecast?localita=X` — 422 se `localita` è assente/vuoto (FR-25); 503 con
  `detail` = `"Previsioni non ancora disponibili"` (cache assente) o descrizione dell'errore
  (cache invalida) (FR-24); 404 con `detail.message`/`detail.available` se non trovata (FR-23);
  200 con l'oggetto località **esattamente com'è in cache** (FR-22). Match per slug
  (`slugify(X)`, E01-S02) e, in fallback, confrontando lo slug del **nome** di ogni località.
- **CORS** (FR-28): origini da `CORS_ORIGINS` (default `*`, lista separata da virgola), solo
  metodo `GET`, header `*`; middleware `cors` di Hono.

### Differenze inevitabili da Python (motivate una per una)

1. **Nessun filesystem** (NFR-12): il campo `cache_path` di `/health` in v0.1 era il percorso del
   file. La PRD ammette un'eccezione a FR-50 proprio per questo (OQ-19; l'app non usa il campo).
2. **Dizionario/mappa**: Python passa da `dict`; `JSON.parse` in TS è non tipizzato e va asserito
   una volta sola al confine (`as ForecastCache`), senza validazione a runtime (come il `json.load`
   di Python, che non valida).
3. **Messaggi d'errore di parse**: il prefisso `"Cache forecast non leggibile: "` è identico, ma il
   testo dell'eccezione sotto è quello di `JSON.parse` di V8, non di `json.JSONDecodeError`.
4. **`round(x, 2)`**: `Math.round(x * 100) / 100` coincide con Python per i valori non di frontiera;
   le differenze possibili sono solo sui tie binari (R-5 della PRD), irrilevanti per `age_hours`.

## Acceptance criteria

- **AC-1** — `GET /health` risponde **sempre 200** e rispetta la regola di `status` di FR-26:
  `ok` con cache valido, fresco (`age_hours ≤ 12`, default) e `errors` vuoto; `degraded` se l'età
  supera la soglia, se `generated_at` manca o è invalido, se `errors` non è vuoto, se la cache è
  assente (`error` = `"Cache forecast non ancora generato"`, `locations` = 0) o illeggibile
  (`error` con prefisso `"Cache forecast non leggibile: "`). I campi del caso valido sono
  `generated_at`, `age_hours` (2 decimali), `stale`, `locations` (numero), `update_errors`.
- **AC-2** — `GET /forecast?localita=X` restituisce 200 con l'oggetto località **deep-equal** a
  quello in cache: per la località di riferimento la risposta è deep-equal a
  `tests/fixtures/golden_forecast_torre-dei-corsari.json` (il corpo esatto del backend Python,
  E01-S00), sia cercando per nome (`Torre dei Corsari`) sia per slug (`torre-dei-corsari`).
- **AC-3** — Il match segue FR-22: slug esatto e, in fallback, slug del nome di ogni località;
  località inesistente → 404 con `detail.message` = `"Localita '<X>' non trovata"` e
  `detail.available` = nomi **ordinati** (FR-23); cache assente → 503
  `"Previsioni non ancora disponibili"`, cache invalida → 503 con la descrizione dell'errore
  (FR-24); `localita` assente o vuoto → 422 con `detail` (FR-25).
- **AC-4** — CORS: con `CORS_ORIGINS` non configurato l'header `Access-Control-Allow-Origin` è `*`;
  con una lista di origini viene riflessa solo l'origine richiesta se consentita; le origini
  arrivano dall'ambiente della richiesta (`env.CORS_ORIGINS`), default `*` (FR-28).
- **AC-5** — `worker/src/store.ts` legge da KV con chiave `latest`, distingue in modo tipizzato
  cache assente, cache presente e cache illeggibile (JSON invalido), senza mai lanciare (lo stato
  d'errore è un valore). Nessun `any` o `as` non necessario in `worker/src`.
- **AC-6** — Tutti i comandi di `verify` passano: `npm test` (test nuovi **e** quelli di
  E01-S01/S02 già presenti), `npm run typecheck` (0 errori), `python3 -m unittest discover -s tests
  -v` (17 test OK, backend Python intatto).

## Tasks

- [x] Scrivere `worker/test/api.test.ts` e vederlo fallire (AC-1..AC-4)
- [x] Implementare `worker/src/store.ts` con errori tipizzati (AC-5)
- [x] Implementare `worker/src/env.ts` (binding `FORECASTS` + variabili FR-28)
- [x] Implementare `worker/src/routes/health.ts` (AC-1)
- [x] Implementare `worker/src/routes/forecast.ts` (AC-2, AC-3)
- [x] Cablare le route e CORS in `worker/src/index.ts` (AC-4)
- [x] Eseguire tutti i comandi di `verify` (AC-6)
- [x] Compilare Dev notes (decisioni `cache_path`, route `/`, arrotondamento, 422)

## Dev notes

**File creati**

- `worker/src/store.ts` — lettura del cache dal KV `FORECASTS` (chiave `latest`), risultato
  tipizzato `CacheReadResult` (`ok` / `missing` / `unreadable`); replica `ForecastStore.read` di
  `backend/main.py` con lo stesso testo `"Cache forecast non leggibile: <causa>"`. Non lancia mai.
- `worker/src/env.ts` — `Bindings extends Env` con `CORS_ORIGINS?` e `FORECAST_MAX_AGE_HOURS?`
  (opzionali) e `CorsEnv` per la risoluzione delle origini.
- `worker/src/routes/health.ts` — `GET /health` (FR-26, FR-28) + costante `CACHE_IDENTIFIER`.
- `worker/src/routes/forecast.ts` — `GET /forecast` (FR-22..FR-25).
- `worker/test/api.test.ts` — 19 test (health, forecast, CORS), di cui 2 di CORS con `createApp()`.
- `docs/stories/E01-S05-api-readonly.md` (questa storia).

**File modificati**

- `worker/src/index.ts` — `createApp()` con middleware `cors` (origini per-request), route di
  prova `/` mantenuta, montaggio di `/health` e `/forecast`, `export default { fetch }`.
  Rimane il commento gancio `scheduled` (E01-S04).

**File non toccati** — `worker/src/types.ts`, `slugify.ts`, `data_sources.ts`, i test di
E01-S01/S02, le fixture/golden di E01-S00, `wrangler.jsonc`, `worker-configuration.d.ts`,
`package.json`/lockfile, i README, il backend/app Python.

**Decisioni**

- **`cache_path` → costante `"kv:FORECASTS"`** (non rimosso). La PRD ammette esplicitamente
  un'eccezione a FR-50 per l'identificativo del cache (OQ-19) e l'app non usa il campo: si
  mantiene il **nome** del campo per non rompere il contratto, cambiandone il valore da percorso
  di file (senza senso su Workers) a identificativo del KV. Il valore è in una costante esportata
  `CACHE_IDENTIFIER`, così è un punto unico e testabile.
- **Route di prova `GET /` mantenuta.** Non fa parte del contratto con l'app (che usa solo
  `/health` e `/forecast`; il Python non aveva una route `/`), ma è coperta dal test di E01-S01
  (`worker/test/app.test.ts`) che dev'essere mantenuto verde. Tenuta come sonda di liveness e
  documentata nel codice come tale.
- **CORS per-request.** Su Workers `env` è per-richiesta, quindi l'origine è risolta con una
  funzione `(origin, c) => …` passata al middleware `cors` di Hono (non una lista fissa). Come in
  Python: default `*`, lista separata da virgola con voci vuote ignorate, solo `GET`, header `*`.
  Differenza minima: con origine funzione Hono aggiunge `Vary: Origin` anche nel caso `*` (il
  Python con `allow_origins=["*"]` no); irrilevante per l'app e non fa parte di FR-50.
- **`CORS_ORIGINS`/`FORECAST_MAX_AGE_HOURS` fuori da `wrangler.jsonc`.** I default (`*`, `12`)
  vivono nel codice come in `backend/main.py`, le variabili sono opzionali: il Worker funziona
  senza `vars` e i test iniettano valori diversi senza rigenerare `worker-configuration.d.ts`
  (625 KB). Un operatore può impostarle in `wrangler.jsonc`/dashboard; nessun `vars` aggiunto qui
  per non toccare il file condiviso con i coder in parallelo (FR-28 resta soddisfatta).
- **422 per `localita` assente/vuoto.** Richiesto da FR-25; replicato lo **status** (422) con un
  corpo `{ "detail": "…" }` minimo (FR-25 chiede solo il campo `detail`). Non si replica il corpo
  di validazione di FastAPI (`detail` è una lista di oggetti) perché l'app non invia mai una
  richiesta senza `localita`. Whitespace-only è valido per Python (`len ≥ 1`) e produce 404.
- **`store.ts` e i dati non tipizzati.** `JSON.parse` non è tipizzato: c'è **una** asserzione
  `as ForecastCache` al confine, necessaria e commentata (come `json.load` di Python, non c'è
  validazione a runtime). Nessun altro `any`/`as` in `worker/src`.
- **`generated_at` non interpretabile.** Python lancia `ValueError` non gestito (500); qui viene
  trattato come mancante → `degraded`, `stale: true`, `age_hours: null` (FR-26: è `degraded` se
  `generated_at` manca). Scelta di robustezza, non coperta dal Python.
- **`round2`.** `Math.round(x * 100) / 100` coincide con `round(x, 2)` di Python per i valori non
  di frontiera; i tie binari (R-5) non sono raggiungibili in pratica per un'età in ore. Il test
  fissa gli estremi (1 h e 13 h) che arrotondano a interi esatti.
- **Test deterministici.** Il test `/health` "ok" usa il golden con `generated_at` a 1 ora fa
  (come `tests/test_backend.py`, che scrive `datetime.now()`): asserire `status: "ok"` sul
  `generated_at` **fisso** del golden (`2026-10-19T09:00:00Z`) renderebbe il test dipendente
  dall'orologio di esecuzione. Un secondo test usa il golden **esatto** e verifica i campi
  indipendenti dal tempo (`locations`, `generated_at`, `update_errors`).
- **Numeri e JSON.** `JSON.stringify` di V8 rende `0.0` come `0` (Python `json.dumps` come `0.0`):
  il confronto con il golden è **deep-equal** sul JSON interpretato (come da consegna). L'app legge
  con `(json[key] as num).toDouble()` (`app/lib/models/forecast.dart:139`), quindi `0` e `0.0`
  sono equivalenti e non c'è impatto di contratto.

**Verifica**

```bash
cd worker && npm test          # Test Files 5 passed — Tests 35 passed (19 nuovi + 16 di E01-S01/S02)
cd worker && npm run typecheck # tsc --noEmit, nessun errore
cd worker && npx wrangler deploy --dry-run --outdir dist  # Total Upload 65.02 KiB, binding FORECASTS
python3 -m unittest discover -s tests -v   # Ran 19 tests — OK (backend Python intatto)
```

Controllo di mutazione (temporaneo, poi ripristinato): disattivando il fallback per nome in
`forecast.ts` fallisce il test del fallback; rendendo `allowOrigin` sempre permissivo fallisce il
test dell'origine non consentita.

**Dubbi / note per il reviewer**

- Il corpo del 422 (FR-25) e il messaggio sotto `"Cache forecast non leggibile: "` non possono
  essere byte-identici a Python (validazione FastAPI / `JSONDecodeError` di V8): replicati status e
  prefisso, non il testo interno. Da confermare che sia accettabile per FR-50 (nessun OQ lo copre).
- `worker/test/api.test.ts` è un file unico (health + forecast + CORS); se si preferiscono file
  separati è una rinomina senza logica.
- `FR-29` (`/docs`, OpenAPI) resta fuori scope: E01-S06.

## Run log

| Iterazione | Comando | Esito | Note |
|---|---|---|---|
| 1 | `cd worker && npm test` (solo test nuovi) | rosso | `Cannot find module '../src/store'` (giusto: moduli non ancora scritti) |
| 2 | `cd worker && npm test` | verde | 5 file / 35 test |
| 2 | `cd worker && npm run typecheck` | verde | 0 errori |
| 3 | mutazioni (fallback forecast, `allowOrigin`) | rosso atteso | 2 test falliscono → poi ripristinato |
| 3 | `npx wrangler deploy --dry-run --outdir dist` | verde | 65.02 KiB, binding `FORECASTS` |
| 3 | `npm test` + typecheck + `python3 -m unittest discover -s tests -v` | verde | 35 / 0 errori / 19 test OK |

## Review log
