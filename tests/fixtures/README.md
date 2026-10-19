# Fixture congelate della baseline Python (E01-S00 / E01-S07)

Artefatti prodotti dall'implementazione Python originale (commit `181c2f3` e successivi fino al tag
`python-baseline`) e usati dai test del Worker (`worker/test/`, `../../tests/fixtures/*.json`) come
riferimento di parità. Dopo E01-S07 il codice Python è stato **rimosso**: le fixture sono ora
**congelate** (nessun generatore nel repository). Vivono qui e non in `data/` perché `data/*.json` era in
`.gitignore`.

## File

| File | Cosa contiene |
|---|---|
| `open_meteo_marine_<slug>.json` | Risposta grezza Open-Meteo Marine per la località |
| `open_meteo_weather_<slug>.json` | Risposta grezza Open-Meteo Weather per la località |
| `golden_forecasts.json` | Snapshot del cache prodotto dal job Python (`schema_version: 1`) |
| `golden_forecast_torre-dei-corsari.json` | Esattamente il corpo di `GET /forecast?localita=torre-dei-corsari` |
| `forecast.schema.json` | JSON Schema draft 2020-12 del payload (contratto congelato) |
| `slug_cases.json` | Casi `input`/`expected` dello slug delle località |
| `request_params.json`, `request_urls.json` | Parametri e URL delle richieste alle sorgenti |
| `agg_cases.json`, `round_cases.json` | Casi di aggregazione e arrotondamento |

Località coperte: `torre-dei-corsari`, `cagliari`. L'elenco è un pin intenzionale (il catalogo
`locations.json` ne ha 13): cambiarlo richiederebbe di rigenerare i golden. Anche
`timezone=Europe/Rome` è un pin intenzionale (lo schema lo dichiara `const`).
I campi `generated_at` / `fetched_at` sono normalizzati a `2026-10-19T09:00:00+00:00` perché i golden
siano riproducibili.

## Perdita accettata

Non c'è più alcun test che valida i golden contro `forecast.schema.json` (la validazione era in
`tests/test_fixtures.py`, Python con `jsonschema`). La parità resta garantita dai test deep-equal del
Worker (`cd worker && npm test`) e dallo script `scripts/compare_backends.mjs`.

## Rigenerare le fixture (ricetta)

Tutto il codice Python rimosso (backend FastAPI, `previsioni_mare.py`, `data_sources.py`,
`update_forecasts.py`, i test e i generatori) è nel tag git locale **`python-baseline`**, che punta
all'ultimo commit che lo contiene:

```bash
git worktree add ../maestrale-python-baseline python-baseline   # oppure: git checkout python-baseline
cd ../maestrale-python-baseline
python3 -m pip install -r requirements.txt -r requirements-dev.txt
python3 tests/fixtures/regenerate.py            # ricostruisce i golden dalle risposte già presenti
python3 tests/fixtures/regenerate.py --fetch    # riscarica le risposte reali da Open-Meteo
python3 tests/fixtures/gen_domain_fixtures.py   # slug e parametri delle sorgenti
python3 -m unittest discover -s tests -v        # include la validazione contro lo schema
```

Poi copiare i JSON risultanti in `tests/fixtures/` del ramo corrente e rieseguire
`cd worker && npm test`. Il tag **non è pubblicato** (`git push origin python-baseline` se serve
altrove). Se il tag mancasse, il commit è recuperabile con
`git log --diff-filter=D --format=%H -1 -- tests/fixtures/regenerate.py` (commit che cancella i
generatori): si fa il checkout del suo **genitore** (`<hash>^`). Il commit `181c2f3` da solo
**non** basta, perché i generatori sono stati aggiunti dopo.
