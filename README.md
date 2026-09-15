# Maestrale — Sardegna Mare

Backend FastAPI e client Flutter per le previsioni marine e meteorologiche
giornaliere delle località costiere della Sardegna.

## Caratteristiche

- Previsioni a 7 giorni per 13 località costiere sarde (`locations.json`)
- Dati mare (onde, direzione, periodo, temperatura acqua) + dati meteo (aria, vento, raffiche)
- Provenienza completa dei dati in ogni risposta (`sources`: provider, endpoint, cella risolta, licenza)
- Cache JSON atomica con fallback agli ultimi dati validi
- Documentazione OpenAPI automatica

## Origine dei dati

Le sorgenti operative sono dichiarate una sola volta in `data_sources.py`:

- **Open-Meteo Marine Weather API** (`cell_selection=sea`): altezza, direzione e periodo delle onde, temperatura superficiale dell'acqua
- **Open-Meteo Weather Forecast API** (`cell_selection=land`): temperatura dell'aria, vento e raffiche

Entrambi i servizi usano la selezione `best_match`: il modello sottostante può
cambiare dinamicamente in base alla località e alla disponibilità. Ogni risposta
`/forecast` espone provider, servizio, endpoint, variabili richieste, coordinate
della cella effettiva, istante di acquisizione, attribuzione, documentazione e
licenza nel campo `sources`.

> Gli script Copernicus storici sono isolati in `legacy/` come solo riferimento
> sperimentale e non partecipano alla pipeline operativa.

## Requisiti

- Python 3.11+
- Flutter 3.x (solo per `app/`)
- Nessuna API key richiesta (Open-Meteo è libero, con attribuzione)

## Avvio rapido

```bash
# 1. Backend
python3 -m pip install -r requirements.txt
python3 update_forecasts.py          # scarica i dati in data/forecasts.json
uvicorn backend.main:app --host 0.0.0.0 --port 8000

# 2. Verifica
curl "http://localhost:8000/forecast?localita=Torre%20dei%20Corsari"
```

Documentazione interattiva: `http://localhost:8000/docs`

## Aggiornamento dati

Lo scaricamento rimane un processo separato dal server HTTP:

```bash
python3 update_forecasts.py
python3 update_forecasts.py --location torre-dei-corsari   # una sola località
```

In produzione va pianificato ogni sei ore, per esempio con cron:

```cron
30 2,8,14,20 * * * cd /app && /usr/bin/python3 update_forecasts.py
```

## Backend

Endpoint:

```text
GET /health
GET /forecast?localita=Torre%20dei%20Corsari
```

Configurazione opzionale (variabili d'ambiente):

| Variabile | Default | Descrizione |
|---|---|---|
| `FORECAST_CACHE_PATH` | `data/forecasts.json` | percorso del cache JSON |
| `FORECAST_MAX_AGE_HOURS` | `12` | soglia dati vecchi (ore) |
| `CORS_ORIGINS` | `*` | origini consentite, separate da virgola |

## Test backend

```bash
python3 -m pip install -r requirements-dev.txt
python3 -m unittest discover -s tests -v
```

## App Flutter

Lo scaffold si trova in `app/`. Il backend si configura a runtime:

```bash
cd app
flutter run --dart-define=API_BASE_URL=http://localhost:8000
```

## Struttura del progetto

```text
.
├── app/                 # client Flutter
├── backend/             # API FastAPI (main.py)
├── data/                # cache locale (ignorata da git)
├── legacy/              # script sperimentali, non operativi
├── tests/               # test backend
├── data_sources.py      # catalogo unico delle sorgenti dati
├── locations.json       # località costiere supportate
└── update_forecasts.py  # scaricamento parallelo Marine + Weather
```

## Licenza e attribuzione

Dati meteo e marini: [Open-Meteo.com](https://open-meteo.com/en/terms) — si prega
di mantenere l'attribuzione esposta nel campo `sources` delle risposte API.
