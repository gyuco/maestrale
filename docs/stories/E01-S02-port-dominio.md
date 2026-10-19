---
id: E01-S02
epic: E01
title: "Port del dominio: tipi TS del payload, slugify e catalogo sorgenti"
type: feature
status: done
requirements: [FR-3, FR-4, FR-5, FR-12, FR-13, FR-19, FR-22, FR-50, FR-51]
depends_on: [E01-S00, E01-S01]
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
  - python3 -m unittest discover -s tests -v
---

# E01-S02: Port del dominio — tipi TS, slugify e catalogo sorgenti

## Context

Il backend passa da Python a Cloudflare Workers (NFR-12) e deve restare **byte-compatibile**
col contratto congelato in `tests/fixtures/` (FR-50, FR-51). Prima di implementare job e API
(E01-S03..S05) servono i tre pezzi di dominio *puri*, senza I/O:

1. **Tipi del payload** — derivati da `tests/fixtures/forecast.schema.json` (JSON Schema draft
   2020-12, `schema_version: 1`): cache (`schema_version`, `generated_at`, `updated_locations`,
   `errors`, `locations`), previsione per località (`location`, `cells`, `timezone`,
   `generated_at`, `sources`, `daily`), `daily.sea`, `daily.weather` e provenienza (FR-12,
   FR-13, FR-19). I tipi ammettono `null` **esattamente** dove lo schema lo ammette.
2. **`slugify`** — port fedele di `backend/main.py:slugify`, usata dalla normalizzazione di
   FR-22 (slug o nome → slug) e dal catalogo località:
   ```python
   normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
   return "-".join(normalized.lower().strip().split()).replace("_", "-")
   ```
3. **`data_sources.ts`** — port di `data_sources.py` (FR-5): unico punto in cui vivono endpoint,
   variabili, `cell_selection`, attribuzione e URL di documentazione/licenza, da cui derivano
   sia i parametri delle richieste (FR-3, FR-4) sia il blocco di provenienza (FR-12).

Contesto tecnico:

- Scaffold in `worker/` (E01-S01): Vitest + `@cloudflare/vitest-pool-workers`, `tsconfig.json`
  in `strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`, `resolveJsonModule: true`.
- **Nessuna nuova dipendenza**: niente zod, niente librerie slugify; solo TypeScript standard.
- **Non toccare** `worker/src/index.ts` (il routing arriva in E01-S05) né le route esistenti,
  né i fixture/golden di E01-S00 (se ne possono solo aggiungere di nuovi), né il backend Python.
- Le fixture di questa storia (`slug_cases.json`, `request_params.json`) sono generate dal
  **codice Python reale** (`backend.main.slugify`, `data_sources.py`) così che i test TS
  verifichino la parità, non un'aspettativa scritta a mano.

Riferimenti:

- `backend/main.py` — `slugify`.
- `data_sources.py` — `DataSource.request_params`, `DataSource.provenance`, `MARINE_SOURCE`,
  `WEATHER_SOURCE`.
- `tests/fixtures/golden_forecast_torre-dei-corsari.json` — golden di `GET /forecast` con i
  blocchi `sources.sea` / `sources.weather`.
- `docs/stories/E01-S00-baseline-fixtures.md`, `E01-S01-scaffold-worker.md`.

## Acceptance criteria

- **AC-1** — Il port di `slugify` (TS) restituisce, per ogni caso di
  `tests/fixtures/slug_cases.json` (generato con `backend.main.slugify`), esattamente il valore
  atteso: accenti rimossi, apostrofi conservati, spazi multipli collassati, `_` → `-`, ogni
  carattere non-ASCII (anche non scomponibile, es. `Ł`) eliminato e caso vuoto → `""`.
- **AC-2** — `tests/fixtures/request_params.json` (generato con `data_sources.py`) è
  deep-equal e con lo **stesso ordine di chiavi** di `MARINE_SOURCE.request_params(...)` /
  `WEATHER_SOURCE.request_params(...)` per la località di riferimento (`hourly`, `daily` solo
  per weather, `timezone`, `forecast_days`, `cell_selection`, `models=best_match`).
- **AC-3** — `provenance(...)`, chiamata con `requested_coordinates` e `fetched_at` del golden e
  con la fixture grezza Open-Meteo corrispondente, è deep-equal (struttura **e** ordine di
  chiavi, ricorsivamente) a `sources.sea` e `sources.weather` di
  `tests/fixtures/golden_forecast_torre-dei-corsari.json`.
- **AC-4** — `worker/src/types.ts` esporta i tipi del payload congelato; il golden di
  `torre-dei-corsari` è assegnabile a `Forecast` e i `daily.sea` / `daily.weather` ai tipi
  `SeaAggregate` / `WeatherAggregate` senza errori di `tsc --noEmit`. I campi nullable sono
  `null` (non opzionali) esattamente dove lo schema lo prevede: `resolved_cell.elevation_m` è
  opzionale, `cells.weather.elevation_m` è `number | null` richiesto.
- **AC-5** — Tutti i comandi di `verify` passano: `npm test` (tutti verdi), `npm run typecheck`
  (0 errori) e la suite Python resta a 17 test OK.

## Tasks

- [x] Scrivere `tests/fixtures/gen_domain_fixtures.py` e generare `slug_cases.json` +
      `request_params.json` dal codice Python reale
- [x] Scrivere `worker/test/slugify.test.ts` e vederlo fallire (AC-1)
- [x] Scrivere `worker/test/data_sources.test.ts` e vederlo fallire (AC-2, AC-3)
- [x] Scrivere `worker/test/types.test.ts` e vederlo fallire (AC-4)
- [x] Implementare `worker/src/slugify.ts`
- [x] Implementare `worker/src/data_sources.ts`
- [x] Implementare `worker/src/types.ts`
- [x] Eseguire i comandi di `verify`

## Dev notes

**File creati**

- `worker/src/types.ts` — tipi del payload congelato (`ForecastCache`, `Forecast`,
  `ForecastLocation`, `ForecastCells`, `ForecastSource`, `SeaAggregate`, `WeatherAggregate`,
  `DailyDay`, `Coordinates`, `ResolvedCell`, `SchemaVersion = 1`, `Timezone = "Europe/Rome"`).
- `worker/src/slugify.ts` — port di `backend/main.py:slugify`.
- `worker/src/data_sources.ts` — port di `data_sources.py`: `DataSource`/`DataSourceSpec`,
  `MARINE_SOURCE`, `WEATHER_SOURCE`, `DATA_SOURCES`, `requestParams()`, `provenance()`.
- `worker/test/types.test.ts`, `worker/test/slugify.test.ts`, `worker/test/data_sources.test.ts`.
- `tests/fixtures/gen_domain_fixtures.py`, `tests/fixtures/slug_cases.json`,
  `tests/fixtures/request_params.json`.
- `docs/stories/E01-S02-port-dominio.md`.

**File modificati**

- `tests/fixtures/README.md`, `worker/README.md` — solo documentazione (rigenerazione fixture,
  struttura `worker/src`). Nessuna modifica a fixture/golden esistenti, a `worker/src/index.ts`
  o all'app/backend Python.

**Decisioni**

- **Tipi nullable**: `null` è modellato dove lo schema lo ammette e *solo* lì — i sei campi di
  `daily.sea` e i dieci di `daily.weather` che lo schema dichiara `[..., "null"]` sono
  `T | null` **richiesti** (non opzionali), così `undefined` è un errore di compilazione.
  Unica proprietà opzionale del contratto: `resolved_cell.elevation_m?: number` (lo schema non
  la mette fra le `required`; `data_sources.provenance` la omette quando il provider non manda
  la quota). `cells.weather.elevation_m` è invece **richiesto** e `number | null`.
  Le due costanti dello schema sono modellate come tipi letterali (`SchemaVersion = 1`,
  `Timezone = "Europe/Rome"`) e verificate negativamente con `@ts-expect-error`
  (`schema_version: 2` non compila).
- **`types.test.ts` e i moduli JSON**: `resolveJsonModule` inferisce tipi **allargati**
  (`timezone: string`, `schema_version: number`), quindi il golden non è assegnabile
  direttamente ai tipi con costanti. Invece di un cast, il test allarga il tipo atteso con un
  helper `Widened<T>` e assegna lì il golden: restano verificati dal compilatore nomi, struttura,
  opzionalità e nullabilità, mentre le due costanti sono asserite sul valore grezzo a runtime
  (`expect(goldenForecast.timezone).toBe("Europe/Rome")`). Nessun `as` che aggiri il controllo.
- **`slugify`**: fedele anche nei dettagli non ovvi. Il whitespace di `str.split()`/`str.strip()`
  di Python è `[ \t\n\v\f\r\x1c-\x1f]` (i separatori ASCII `\x1c-\x1f` *sono* whitespace per
  Python, a differenza di `\s` di JS: coperto dalla fixture `"A\x1cB"`); il filtro ASCII è
  `/[^\x00-\x7F]/g` (elimina anche caratteri non scomponibili: `Ł`, `Ø`, `Œ`, `Ω`);
  `toLowerCase()` è applicato *dopo* il filtro, quando la stringa è ASCII, quindi coincide con
  `str.lower()`. `split` + filtro degli elementi vuoti replica `strip().split()`.
- **`RequestParams`**: chiavi nello stesso ordine del dict Python (per il weather `daily` è
  l'**ultima** chiave, dopo `models`), verificato con un confronto ricorsivo di ordine chiavi
  (`expectSameKeyOrder`) oltre che con `toEqual`.
- **`provenance`**: `resolved_cell` è costruito come in Python — `elevation_m` presente solo se
  la risposta ha `elevation` diversa da `null`/assente (lo `0` è tenuto) — e le coordinate
  risolte arrivano dalla risposta del provider, non da quelle richieste.
- **`OpenMeteoResponse`** dichiara `latitude`/`longitude` **richiesti** (lo schema li richiede in
  `resolved_cell`: il port non deve emettere `null` lì) e `elevation` opzionale/nullable.
- `MARINE_SOURCE`/`WEATHER_SOURCE` sono congelati (`Object.freeze`), come il dataclass
  `frozen=True`; `DATA_SOURCES` è esportato per parità col modulo Python (sarà usato da
  E01-S03/S04) — oggi non è referenziato altrove.
- Nessuna dipendenza aggiunta; `worker/src/index.ts` intatto.

**Verifica**

```bash
cd worker && npm test          # Test Files 4 passed — Tests 16 passed
cd worker && npm run typecheck # tsc --noEmit, nessun errore (incluse tutte le @ts-expect-error)
python3 -m unittest discover -s tests -v   # Ran 17 tests — OK
```

Controllo di mutazione (temporaneo, poi ripristinato): togliendo `.replace(/_/g, "-")` da
`slugify` falliscono 2 test; scambiando `attribution` e `fetched_at` in `provenance` falliscono
i 2 test di ordine delle chiavi (mentre `toEqual` da solo non li avrebbe visti).

**Dubbi / note per il reviewer**

- `slugify` può produrre slug che **non** rispettano il pattern dello schema
  (`^[a-z0-9]+(?:-[a-z0-9]+)*$`): `"Sant'Antioco"` → `"sant'antioco"`, `"San Teodoro (OT)"` →
  `"san-teodoro-(ot)"`. È il comportamento del Python attuale e va preservato (FR-51); se il
  catalogo un giorno includesse nomi con apostrofi, il vincolo andrebbe rivisto a monte, non qui.
- I test leggono `tests/fixtures/*.json` con import relativi (`../../tests/fixtures/…`): Vite li
  incorpora a build time, quindi nessun accesso al filesystem a runtime nel Worker.
- I tipi descrivono il contratto ma non c'è ancora nessun decodificatore/validatore a runtime
  (es. dati KV corrotti): arriverà col job/route (E01-S03..S05).

## Run log

| Iterazione | Comando | Esito | Note |
|---|---|---|---|
| 1 | `python3 tests/fixtures/gen_domain_fixtures.py` | ok | `slug_cases.json` (25 casi), `request_params.json` |
| 1 | `cd worker && npm test` | rosso | `Cannot find module '../src/slugify'` / `'../src/data_sources'` (giusto: moduli non ancora scritti); `types.test.ts` girava perché l'import era solo di tipi |
| 1 | `cd worker && npm run typecheck` | rosso | golden non assegnabile per i tipi JSON allargati + 1 `@ts-expect-error` non usata |
| 2 | `cd worker && npm test` | verde | 16 test |
| 2 | `cd worker && npm run typecheck` | verde | 0 errori |
| 2 | mutazioni (slugify/provenance) | rosso atteso | 2+2 test falliscono → poi ripristinato |
| 3 | `cd worker && npm test` + typecheck + `python3 -m unittest discover -s tests -v` | verde | 16 / 0 errori / 17 test OK |


## Review log

### 2026-10-19 — Reviewer — Verdetto: done

Verify rieseguiti: `cd worker && npm test` → 4 file / 16 test verdi; `npm run typecheck` → 0 errori;
`python3 -m unittest discover -s tests -v` → 17 OK.

Parità reale verificata, non dichiarata: `gen_domain_fixtures.py` rigenera JSON byte-identici; confronto
sistematico TS↔Python su 4062 input `slugify`, 200 `request_params`, 18 `provenance` → 0 divergenze.
Mutazioni su `slugify`/`provenance`/`requestParams` fanno fallire i test. Scope rispettato: nessuna
dipendenza nuova, `worker/src/index.ts` intatto, fixture/golden esistenti non modificati.

- R-1 (should) `worker/test/types.test.ts:93-94` — il `@ts-expect-error` su `schema_version` è soddisfatto
  da un errore diverso (spread dei tipi allargati) e non vincola la costante. Fix: asserire su un literal
  puro. Raccolto in E01-S03, dove arriva la validazione a runtime.
- R-2 (nit) `worker/test/types.test.ts:36-51` — l'assegnazione del golden copre solo golden→tipi e non
  intercetta un `null` in più; il confronto con lo schema è comunque corretto.
- R-3 (nit) `docs/stories/E01-S02-port-dominio.md:115` — "sei campi di `daily.sea`" → sono sette.
- R-4 (nit) `worker/src/data_sources.ts:101-104` — divergenza residua solo su risposte provider senza
  `latitude`/`longitude` (tipo non producibile da Open-Meteo): guard da valutare nel fetch (E01-S03/S04).

Note: gli slug con apostrofi/parentesi non rispettano il `pattern` dello schema ma è la parità richiesta
con `backend/main.py` (FR-51); le 13 località del catalogo non lo attivano.
