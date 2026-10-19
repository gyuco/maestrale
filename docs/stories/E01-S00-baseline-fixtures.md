---
id: E01-S00
epic: E01
title: "Baseline: fixture Open-Meteo e contratto API congelato"
type: feature
status: done
requirements: [FR-3, FR-4, FR-6, FR-7, FR-8, FR-12, FR-13, FR-19, FR-50, FR-51]
depends_on: []
verify:
  - python3 -m unittest discover -s tests -v
---

# E01-S00: Baseline — fixture Open-Meteo e contratto API congelato

## Context

Prima di riscrivere il backend su Cloudflare Workers serve una baseline riproducibile
dell'implementazione Python. Le risposte reali di Open-Meteo Marine e Weather per due
località vengono salvate in `tests/fixtures/` insieme allo snapshot del cache
`forecasts.json` e alla risposta di `GET /forecast?localita=torre-dei-corsari`. Uno
JSON Schema draft 2020-12 fissa il contratto (`schema_version: 1`) e un test automatico
lo valida.

Nota: `data/*.json` è in `.gitignore`, per questo i file di riferimento vivono in
`tests/fixtures/`, che è tracciata.

Riferimenti:

- `data_sources.py` — parametri esatti delle richieste (`hourly`, `daily`,
  `timezone=Europe/Rome`, `forecast_days=7`, `cell_selection=sea|land`,
  `models=best_match`).
- `previsioni_mare.py` — `build_forecast(...)`.
- `update_forecasts.py` — struttura del cache (`schema_version`, `generated_at`,
  `updated_locations`, `errors`, `locations`).
- `backend/main.py` — `GET /forecast?localita=` restituisce
  `payload["locations"][slug]`.

## Acceptance criteria

- **AC-1** — Esistono in `tests/fixtures/` le risposte grezze Open-Meteo Marine e Weather
  per 2 località (Torre dei Corsari e Cagliari), ottenute con gli stessi parametri di
  `data_sources.py`.
- **AC-2** — Esistono il golden del cache (`golden_forecasts.json`) e il golden della
  risposta di `/forecast?localita=torre-dei-corsari`
  (`golden_forecast_torre-dei-corsari.json`).
- **AC-3** — `tests/fixtures/forecast.schema.json` è uno JSON Schema draft 2020-12 che
  copre `locations`, `daily.sea`, `daily.weather` e `sources` con `schema_version: 1`.
- **AC-4** — Un test automatico valida il golden contro lo schema; fixture e golden sono
  committati e `python3 -m unittest discover -s tests -v` passa.

## Tasks

- [x] Scrivere `tests/test_fixtures.py` (schema, sanity fixture, golden) e vederlo fallire
- [x] Scaricare le fixture reali Open-Meteo per Torre dei Corsari e Cagliari
- [x] Generare golden cache e golden `/forecast` dal codice Python esistente
- [x] Scrivere `tests/fixtures/forecast.schema.json`
- [x] Documentare la rigenerazione in `tests/fixtures/README.md`
- [x] Aggiungere `jsonschema` a `requirements-dev.txt` ed eseguire i verify

## Dev notes

**File creati**

- `tests/fixtures/open_meteo_marine_{torre-dei-corsari,cagliari}.json`
- `tests/fixtures/open_meteo_weather_{torre-dei-corsari,cagliari}.json`
- `tests/fixtures/golden_forecasts.json`
- `tests/fixtures/golden_forecast_torre-dei-corsari.json`
- `tests/fixtures/forecast.schema.json`
- `tests/fixtures/regenerate.py`
- `tests/fixtures/README.md`
- `tests/test_fixtures.py`

**File modificati**

- `requirements-dev.txt` — aggiunto `jsonschema>=4.20,<5`.

**Decisioni**

- Le fixture grezze sono state scaricate con `previsioni_mare.fetch_json` e i
  parametri di `data_sources.py`, quindi riflettono esattamente le richieste di
  produzione.
- I golden sono costruiti **dalle fixture committate**, non da una seconda
  chiamata di rete: `regenerate.py` fa monkeypatch di
  `previsioni_mare.fetch_json`. Questo rende lo snapshot riproducibile e lega
  ogni byte del golden alle fixture.
- `generated_at` / `fetched_at` sono normalizzati a
  `2026-10-19T09:00:00+00:00` (determinismo; il contratto non dipende dagli
  istanti, cfr. FR-51).
- Il golden del cache contiene entrambe le località; il golden di `/forecast` è
  l'entry di `torre-dei-corsari`, verificata anche contro l'app FastAPI reale.
- Lo schema usa `additionalProperties: false` sui blocchi principali per
  congelare davvero il contratto; i numeri calcolati ammettono `null` perché
  l'aggregatore Python può emettere `null` quando una serie è vuota.
- `timezone` è `const: Europe/Rome` (unico valore della pipeline operativa).

**Verifica**

```bash
python3 -m unittest discover -s tests -v
# Ran 17 tests — OK
```

La rigenerazione senza `--fetch` è deterministica (hash dei golden identici tra
due run).

## Run log

<!-- Autopilot: iteration | command | result | note -->

## Review log

### 2026-10-19 — Reviewer — Verdetto: done

Verify: `python3 -m unittest discover -s tests -v` → Ran 17 tests — OK (anche con proxy
fittizio verso 127.0.0.1:1, quindi offline). Golden verificate: hash di `regenerate.py`
identici su due run; i 4 fixture grezzi sono byte-identici (salvo `generationtime_ms`)
alle risposte live Open-Meteo ottenute con i `request_params` di `data_sources.py`;
`golden_forecasts.json` == output di `update_forecasts.update_one` normalizzato;
golden `/forecast` == risposta FastAPI (mutation test: modificare un valore o aggiungere
un campo inventato fa fallire 2/3 test).

- R-1 (nit) `tests/fixtures/regenerate.py:115-121` — il payload del cache duplica
  `update_forecasts.py:100-106`; oggi identico, ma può derivare in silenzio.
  Fix: riusare `update_forecasts.update_one`/un helper condiviso, o test di confronto.
- R-2 (nit) `tests/test_fixtures.py:119` con `forecast.schema.json:37,147,172-173` —
  `format: date-time`/`uri` non applicati (manca `format_checker`). Fix: passare
  `FORMAT_CHECKER` o togliere i `format`.
- R-3 (nit) `tests/test_fixtures.py:25-36`, `tests/fixtures/regenerate.py:43-51` —
  catalogo località replicato (anche `locations.json`). Fix: derivarlo o documentare il pin.

Note non bloccanti: `timezone` const `Europe/Rome` giustificato ma da annotare nel README;
`location.slug` è aggiunto da `update_forecasts`, non da `build_forecast`;
`jsonschema` è solo dev-dependency (ok).
