# Maestrale — Sardegna Mare

Backend su **Cloudflare Workers** (TypeScript, Hono, cache su Workers KV) e client Flutter per le
previsioni marine e meteorologiche giornaliere delle località costiere della Sardegna.

## Caratteristiche

- Previsioni a 7 giorni per 13 località costiere sarde (`locations.json`)
- Dati mare (onde, direzione, periodo, temperatura acqua) + dati meteo (aria, vento, raffiche)
- Provenienza completa dei dati in ogni risposta (`sources`: provider, endpoint, cella risolta, licenza)
- Cache su Workers KV (chiave `latest`) con fallback agli ultimi dati validi per località
- Aggiornamento automatico con Cron Trigger ogni 6 ore, senza server né scheduler esterni

## Origine dei dati

Le sorgenti operative sono dichiarate una sola volta in `worker/src/data_sources.ts`:

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

- Node.js 22+ e npm 10+ (per `worker/`)
- Flutter 3.x (solo per `app/`)
- Nessuna API key richiesta (Open-Meteo è libero, con attribuzione)
- Un account Cloudflare serve solo per il deploy (vedi sotto)

## Avvio rapido

```bash
cd worker
npm ci
npm test            # test in locale, senza rete né account Cloudflare
npm run dev         # Worker su http://localhost:8787 (KV simulata, vuota all'inizio)

# in un altro terminale: verifica
curl "http://localhost:8787/health"
curl "http://localhost:8787/forecast?localita=Torre%20dei%20Corsari"   # 503 finché la KV è vuota
```

La KV locale parte vuota: per avere dati in locale si può seminare lo snapshot di esempio
(`cd worker && npx wrangler kv key put --binding FORECASTS latest --path ../tests/fixtures/golden_forecasts.json --local --preview false`)
oppure far girare il job (`npx wrangler dev --test-scheduled`, poi
`curl "http://localhost:8787/__scheduled?cron=30+0+*+*+*"`; richiede accesso a Open-Meteo).

## Backend

Endpoint (sola lettura, solo `GET`):

```text
GET /health
GET /forecast?localita=Torre%20dei%20Corsari
GET /history?localita=Cagliari&from=2026-10-14&to=2026-10-20
```

Configurazione opzionale (variabili del Worker): `FORECAST_MAX_AGE_HOURS` (default `12`, soglia dati
vecchi in ore) e `CORS_ORIGINS` (default `*`).

### Storico (`GET /history`)

Serie storica dei valori del **giorno 0** di una località (sola lettura, `GET`/`HEAD`).

**Importante (FR-82)**: i valori di `/history` sono **previsioni del giorno stesso** (giorno 0,
ultima esecuzione riuscita del giorno), **non misure osservate**. Lo storico **parte dalla data di
attivazione** (`<data di attivazione>`, da compilare al primo deploy con lo storico, vedi
[`docs/runbook.md`](docs/runbook.md)), **senza backfill**: i giorni precedenti non esistono.

Parametri:

| Parametro | Obbligatorio | Significato |
|---|---|---|
| `localita` | si | nome o slug, risolto come in `/forecast` |
| `from`, `to` | si | date `YYYY-MM-DD` (fuso Europe/Rome), estremi inclusi; `to` nel futuro ammesso |
| `granularity` | no | `day` (default) oppure `month` |

Limiti: al più **366 giorni** (`day`) o **120 mesi** toccati (`month`); anche con `month`, `from`/`to`
restano `YYYY-MM-DD` e i mesi parziali agli estremi si riconoscono da `days`.

Esempio `day` (`granularity=day`):

```json
{
  "schema_version": 1,
  "location": { "slug": "cagliari", "name": "Cagliari" },
  "granularity": "day",
  "from": "2026-10-14",
  "to": "2026-10-20",
  "timezone": "Europe/Rome",
  "items": [
    { "date": "2026-10-14", "air_temperature_mean_c": 21.3, "air_temperature_min_c": 17.0,
      "air_temperature_max_c": 25.1, "water_temperature_mean_c": 22.4, "state": "Poco mosso",
      "wave_height_mean_m": 0.42, "wave_height_max_m": 0.61 }
  ]
}
```

Esempio `month` (`granularity=month`): gli elementi hanno `month` (`YYYY-MM`) e `days` (giorni
aggregati) al posto di `date`:

```json
{ "month": "2026-10", "days": 7, "air_temperature_mean_c": 20.8, "air_temperature_min_c": 15.2,
  "air_temperature_max_c": 26.0, "water_temperature_mean_c": 22.1, "state": "Poco mosso",
  "wave_height_mean_m": 0.45, "wave_height_max_m": 1.1 }
```

Aggregazione mensile: medie di temperatura (1 decimale) e onde (2 decimali), minimo dei minimi,
massimo dei massimi; i valori `null` sono ignorati nelle medie (tutti `null` danno `null`); `state` e'
la **moda** degli stati del mese e, a parita', vince lo stato piu' alto della scala Douglas. Giorni o
mesi senza record sono omessi; nessun record: `items` vuoto, 200.

Codici: **200** ok; **404** localita' non nel catalogo (`detail.message` e `detail.available`, come
`/forecast`); **422** parametri non validi (`detail` in italiano); **503** storico temporaneamente
non disponibile (`detail`: "Storico temporaneamente non disponibile").

`Cache-Control` (solo sulla 200): `public, max-age=900` (15 min) se `to` e' oggi o futuro
(Europe/Rome), `public, max-age=86400` (24 h) se l'intervallo e' interamente nel passato.

Il job di aggiornamento gira come Cron Trigger `30 0,6,12,18 * * *` (UTC). Dettagli,
deploy, rollback, osservabilità e limiti del piano Cloudflare:
[`worker/README.md`](worker/README.md) e [`docs/runbook.md`](docs/runbook.md). Decisioni di
architettura: [`docs/architecture.md`](docs/architecture.md) e `docs/adr/`.

## Deploy

Il deploy richiede l'account Cloudflare del proprietario e passi manuali (namespace KV, `wrangler
deploy`): vedi [`worker/README.md`](worker/README.md#passi-manuali-account-cloudflare) e per lo storico D1 la sezione "Rilascio dello storico" del
[`docs/runbook.md`](docs/runbook.md). Il Worker risponde su
`https://maestrale.<sottodominio-account>.workers.dev`.

## App Flutter

Lo scaffold si trova in `app/`. L'URL del backend si configura in fase di build
(default `http://localhost:8000`, quindi in pratica va sempre indicato):

```bash
cd app
flutter run --dart-define=API_BASE_URL=https://maestrale.<sottodominio-account>.workers.dev
# in locale, con `npm run dev` nel Worker:
flutter run --dart-define=API_BASE_URL=http://localhost:8787
```

Dettagli (Android emulator, dispositivo fisico) in [`app/README.md`](app/README.md).

## Test

```bash
cd worker && npm test && npm run typecheck     # Worker (parità con le fixture congelate)
node --test scripts/*.test.mjs                 # script di confronto/smoke
cd app && flutter analyze && flutter test      # app
```

Lo smoke test di un Worker pubblicato: `node scripts/compare_backends.mjs --smoke <url>`.

## Struttura del progetto

```text
.
├── app/                 # client Flutter
├── worker/              # backend Cloudflare Workers (src/, test/, migrations/, wrangler.jsonc)
├── scripts/             # confronto di parità e smoke test (compare_backends.mjs)
├── tests/fixtures/      # fixture JSON congelate della baseline Python (vedi il loro README)
├── docs/                # PRD, architettura, ADR, storie, runbook
├── legacy/              # script sperimentali, non operativi
└── locations.json       # località costiere supportate
```

## Località supportate

Alghero, Arbatax, Cagliari, Carloforte, Chia, La Maddalena, Olbia, Oristano, Porto Torres,
Santa Teresa Gallura, Siniscola, Torre dei Corsari, Villasimius (`locations.json`).

## Licenza e attribuzione

Dati meteo e marini: [Open-Meteo.com](https://open-meteo.com/en/terms) — si prega
di mantenere l'attribuzione esposta nel campo `sources` delle risposte API.
