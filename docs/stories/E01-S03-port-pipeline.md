---
id: E01-S03
epic: E01
title: "Port pipeline: fetch Open-Meteo e aggregazioni giornaliere"
type: feature
status: done
requirements: [FR-3, FR-4, FR-6, FR-7, FR-8, FR-9, FR-10, FR-11, FR-12, FR-13, FR-17, FR-51]
depends_on: [E01-S00, E01-S01, E01-S02]
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
  - python3 -m unittest discover -s tests -v
---

# E01-S03: Port pipeline — fetch Open-Meteo e aggregazioni giornaliere

## Context

Il backend passa da Python a Cloudflare Workers (NFR-12) e deve restare **byte-compatibile**
col contratto congelato in `tests/fixtures/` (FR-50, FR-51). Dopo i pezzi di dominio puri di
E01-S02 manca il cuore operativo: lo scaricamento dei due provider e l'aggregazione oraria →
giornaliera. Questa storia porta in TypeScript `previsioni_mare.py` (la parte di calcolo, non la
CLI), così che `build_forecast` produca **la stessa struttura e gli stessi numeri** del Python.

Tre moduli:

1. **`worker/src/open_meteo.ts`** — `fetch_json` di `previsioni_mare.py` (FR-17):
   - `fetchJson(baseUrl, params, opts)`: URL con query string equivalente a `urlencode`, header
     `User-Agent: copernicus-sea-app/0.1`, timeout 30 s, **retry con backoff esponenziale**
     (`2**attempt` secondi, default 3 tentativi) e fallimento immediato se il payload contiene
     `error` (usa `reason`).
   - helper di **concorrenza max 6** (limite Workers/NFR-15), per il job di E01-S04.
   - `fetchImpl` e la funzione di sleep sono **iniettabili**: i test non attendono davvero.
2. **`worker/src/aggregate.ts`** — port esatto di `valid_numbers`, `mean`, `circular_mean`,
   `rounded`, `sea_state` (soglie Douglas/WMO, FR-10), `direction_name` (8 venti, FR-11),
   `hourly_by_date`, `daily_lookup`.
3. **`worker/src/forecast.ts`** — `buildForecast(name, latitude, longitude, days, timezoneName,
   deps)`, la stessa struttura di `previsioni_mare.build_forecast` (`location`, `cells.marine`,
   `cells.weather`, `timezone`, `generated_at`, `sources.sea`/`sources.weather`, `daily[]` con
   `sea` e `weather`), riusando `data_sources.ts` per parametri e provenienza (FR-3, FR-4,
   FR-12, FR-13). `fetchImpl` e `now` sono iniettabili per test deterministici.

Attenzioni di parità col Python:

- **Arrotondamento** (FR-51, rischio R-5 del PRD): `round()` di Python è *half-to-even* sulla
  rappresentazione decimale del double (`round(0.125, 2) == 0.12`, `round(2.675, 2) == 2.67`).
  Va implementato `roundHalfEven(value, digits)` senza usare `toFixed`/`Math.round`.
- `%` in JS può essere negativo: `circular_mean` usa `((x % 360) + 360) % 360`.
- `direction_name`: `int((degrees + 22.5) // 45) % 8` → `Math.floor`.
- `valid_numbers` scarta `null`/`undefined` e i non finiti; `mean`/`circular_mean` su serie vuota
  → `null`; `max(valid_numbers(...))` in Python **lancia** su lista vuota: il port replica.
- `hourly_by_date` raggruppa per `timestamp[:10]`; `common_dates` è l'intersezione ordinata di
  date marine, date meteo e date giornaliere ufficiali, limitata a `days`.

Contesto tecnico:

- Scaffold `worker/` (E01-S01): Vitest + `@cloudflare/vitest-pool-workers`, `tsconfig.json`
  `strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` + `resolveJsonModule`.
- **Nessuna nuova dipendenza**; **non toccare** `worker/src/index.ts` (S05),
  `worker/src/store.ts`, `worker/src/routes/**` (S05), i fixture/golden esistenti (solo
  aggiungerne), i README e i `package.json`/lockfile.
- Le fixture nuove sono generate dal **codice Python reale** (`previsioni_mare.py`,
  `data_sources.py`): i test TS verificano la parità, non un'aspettativa scritta a mano.

Riferimenti:

- `previsioni_mare.py` — `fetch_json`, `valid_numbers`, `mean`, `circular_mean`, `rounded`,
  `sea_state`, `direction_name`, `hourly_by_date`, `daily_lookup`, `build_forecast`.
- `data_sources.py` / `worker/src/data_sources.ts` — parametri e provenienza.
- `tests/fixtures/open_meteo_{marine,weather}_torre-dei-corsari.json` — risposte grezze.
- `tests/fixtures/golden_forecast_torre-dei-corsari.json` — output atteso di `build_forecast`
  (+ `location.slug`, aggiunto dal job).
- `docs/stories/E01-S02-port-dominio.md`.

## Acceptance criteria

- **AC-1** — `worker/src/open_meteo.ts` esporta `fetchJson` (URL come `urlencode`, header
  `User-Agent`, timeout 30 s, retry con backoff `2**attempt` s e default 3 tentativi), il
  fallimento immediato su payload con `error` (`reason`), un helper di concorrenza max 6, e rende
  iniettabili `fetchImpl` e sleep.
- **AC-2** — `worker/src/aggregate.ts` replica `valid_numbers`, `mean`, `circular_mean`,
  `rounded`, `sea_state`, `direction_name`, `hourly_by_date`, `daily_lookup`: parità al 100% su
  `tests/fixtures/agg_cases.json` e su `tests/fixtures/round_cases.json` (migliaia di
  `{value, digits, expected}` generati da `round()`), con i casi limite (serie vuota, valori
  nulli/NaN/±Infinity) trattati come in Python.
- **AC-3** — `worker/src/forecast.ts:buildForecast(...)` con `fetchImpl` che restituisce le
  fixture committate e `now` fisso produce un payload **deep-equal** a
  `tests/fixtures/golden_forecast_torre-dei-corsari.json` (a meno di `location.slug`, che il job
  aggiunge) e con lo **stesso ordine di chiavi**.
- **AC-4** — `worker/test/open_meteo.test.ts` dimostra: retry (primo tentativo fallisce, secondo
  ok, attesa 1 s), payload con `error` (nessun retry), timeout, e concorrenza mai oltre 6.
- **AC-5** — R-1 della review di E01-S02 corretto: il `@ts-expect-error` su `schema_version`
  in `worker/test/types.test.ts` usa un literal puro (`schema_version: 2`), non uno spread, e
  `npm run typecheck` fallisce se si allenta il tipo.
- **AC-6** — Tutti i comandi di `verify` passano: `npm test` verde, `npm run typecheck` 0 errori,
  la suite Python resta verde.

## Tasks

- [x] Creare `docs/stories/E01-S03-port-pipeline.md`
- [x] `tests/fixtures/gen_pipeline_fixtures.py`: generare `round_cases.json`, `agg_cases.json`,
      `request_urls.json` dal codice Python reale
- [x] Scrivere `worker/test/aggregate.test.ts` e vederlo fallire (AC-2)
- [x] Scrivere `worker/test/open_meteo.test.ts` e vederlo fallire (AC-1, AC-4)
- [x] Scrivere `worker/test/forecast.test.ts` e vederlo fallire (AC-3)
- [x] Correggere R-1 in `worker/test/types.test.ts` (AC-5)
- [x] Implementare `worker/src/aggregate.ts`
- [x] Implementare `worker/src/open_meteo.ts`
- [x] Implementare `worker/src/forecast.ts`
- [x] Eseguire tutti i comandi di `verify`

## Dev notes

- `roundHalfEven` in `aggregate.ts` usa aritmetica sulla rappresentazione decimale del double
  (niente `toFixed`/`Math.round`); parità 100% su `round_cases.json`.
- `circularMean`: parità sull'output osservabile (arrotondato) e entro 1 ulp sul valore grezzo
  (differenze libm sin/cos/atan2 tra Python e V8).
- AC-5: il `@ts-expect-error` sta sulla riga della proprietà `schema_version: 2` di un literal
  puro (il compilatore segnala l'errore su quella riga, non sulla dichiarazione).
- Fixture generate da `tests/fixtures/gen_pipeline_fixtures.py` (seed fisso, deterministico).
- File: `worker/src/{aggregate,open_meteo,forecast}.ts`, `worker/test/{aggregate,open_meteo,forecast}.test.ts`,
  `worker/test/types.test.ts`, `tests/fixtures/{gen_pipeline_fixtures.py,round_cases.json,agg_cases.json,request_urls.json}`.
- Nessuna nuova dipendenza; `index.ts`, `store.ts`, `routes/**` non toccati.

## Run log

| Iterazione | Comando | Esito | Note |
|---|---|---|---|
| 1 | cd worker && npm test | ok | 7 file, 44 test |
| 1 | cd worker && npm run typecheck | ok | 0 errori |
| 1 | python3 -m unittest discover -s tests -v | ok | 19 test |

## Review log

### 2026-10-19 — verdict: done

I re-ran all three verify commands myself: `npm test` passed (7 files, 44 tests), `npm run typecheck` had 0 errors, Python passed (19 tests, Python 3.12.2).
Checks done:
- Re-running `gen_pipeline_fixtures.py` gives byte-identical fixtures. The generator calls the real `round()` and `previsioni_mare.*`.
- `round_cases.json` (5444 cases, about 65 decimal ties) matches 100%. `roundHalfEven` uses `BigInt` only, with no `toFixed`/`Math.round`.
- AC-3: the golden is deep-equal and the key order matches (recursive check).
- AC-5 mutation: with `schema_version: number`, `tsc` fails with TS2578 at `types.test.ts:96`. Restored.
- Aggregate mutations, all caught, then restored:
  - `sea_state` threshold 1.25→1.3
  - `Math.floor`→`Math.trunc` in `directionName`
  - `pySum` without compensation (caught by the golden and `circularMean`)
- Fuzz of `directionName` against Python `//` (24,800 values near the sector boundaries): 0 mismatches.
- `git diff d5df2ea..HEAD --stat`: no forbidden files touched. Only new fixtures were added. No new dependencies.

- **R-1** (should) — `worker/test/aggregate.test.ts:92`: the tolerance is `1e-9` absolute, but the test name and the Dev notes say "≤1 ulp". Near 360, 1e-9 is about 17,000 ulp. Measured gap: only `[null,45,null]` differs (0.71 ulp), all other cases are exact. Expected fix: a relative tolerance, e.g. `<= 2 * Number.EPSILON * Math.abs(expected)`. Also add to the conventions/R-5 that a 1-ulp gap can, in theory, flip `rounded(...,0)` or `direction_name` right at a .5 / 22.5° boundary. This is an accepted residual risk, since the libm functions differ.
- **R-2** (nit) — `tests/fixtures/gen_pipeline_fixtures.py:139`: the `mean` cases never exercise Neumaier summation. Removing the compensation breaks only the golden and `circularMean`, not `agg_cases.mean`. Add a case such as `[0.1]*10` or `[1e16, 1.0, -1e16]`. Note in the conventions that parity assumes CPython ≥ 3.12.
- **R-3** (nit) — `worker/test/open_meteo.test.ts:127`: `.rejects.toThrow()` with no matcher. Assert `/Impossibile consultare/`, so the test shows that a timeout goes through the retry path like `TimeoutError` in Python.
- **R-4** (nit) — `worker/src/forecast.ts:102`: `dailyNumber` returns `null` when the key is missing, while Python's `daily["..."]` raises `KeyError`. Missing provider data passes silently. Fail on `undefined` instead (keep `null` → `null`).
- **R-5** (nit) — `worker/src/open_meteo.ts:144`: `mapWithConcurrency` skips `undefined` items and leaves holes typed as `R`. Remove the skip, or make the constraint `T extends {}`.
