---
id: ARCH
status: draft        # draft | approved — only the user approves
prd_version: 0.1
owner: architect
---

# Architecture

## 1. Context
Maestrale mostra previsioni marine e meteo giornaliere (7 giorni) per 13 località costiere della
Sardegna. Attori: l'**app Flutter** (unico client, un solo utente in sviluppo) e il **proprietario**
(operatore). Sistemi esterni: **Open-Meteo** (Marine e Weather Forecast, nessuna API key) e
**Cloudflare** (Workers, Workers KV, Cron Triggers). Confine del sistema: il Worker `maestrale`
(`worker/`) e la KV `FORECASTS`; l'app lo raggiunge via HTTPS con `API_BASE_URL` (FR-48).

## 2. Stack
| Layer | Choice | Why |
|---|---|---|
| Runtime | Cloudflare Workers (TypeScript) | NFR-12; nessun server da gestire |
| Router | Hono | leggero, tipizzato, funziona su Workers |
| Cache | Workers KV, binding `FORECASTS`, chiave `latest` | un solo documento, letture frequenti, 4 scritture/giorno (ADR-0001) |
| Scheduler | Cron Trigger `30 0,6,12,18 * * *` (UTC) | FR-49, senza scheduler esterni |
| Test | Vitest + `@cloudflare/vitest-pool-workers` (workerd/Miniflare) | NFR-13: in locale, senza rete né account |
| Client | Flutter, `--dart-define=API_BASE_URL` | FR-48 |

## 3. Components
| Component | Responsibility | Talks to |
|---|---|---|
| Worker `fetch` (`worker/src/index.ts`, `routes/`) | `GET /health`, `GET /forecast`, CORS (NFR-11) | KV (sola lettura) |
| Worker `scheduled` + job (`src/update.ts`, `forecast.ts`, `aggregate.ts`, `open_meteo.ts`) | Ogni 6 h scarica Marine + Weather per 13 località (concorrenza 6, 3 tentativi), fa merge con il cache e scrive `latest`; registra l'esito (`forecast_update`) | Open-Meteo, KV (1 `get`, 1 `put`) |
| KV `FORECASTS` | Cache dell'ultimo snapshot valido (consistenza eventuale, NFR-16) | Worker |
| App Flutter (`app/`) | Ricerca/mappa/previsioni, nessuna logica di dominio lato server | Worker via HTTPS |
| `scripts/compare_backends.mjs` | Confronto di parità tra due backend e smoke test | HTTP |

## 4. Data model

## 5. Interfaces / APIs
- `GET /health`: sempre 200, `status` `ok`|`degraded`; con cache valido `generated_at`, `age_hours`,
  `stale`, `locations`, `update_errors`; cache assente o illeggibile: `error` e `cache_path`
  (valore `kv:FORECASTS`, unica eccezione di FR-50, OQ-19).
- `GET /forecast?localita=<nome o slug>`: 200 con l'oggetto località; 404 con
  `detail.message` e `detail.available`; 422 se `localita` manca o è vuoto; 503 se il cache manca
  o è illeggibile.
- Sola lettura (solo `GET`), nessuna autenticazione, CORS `*` di default. Nessun `/docs` (FR-29 escluso).
- Contratto del payload: `tests/fixtures/forecast.schema.json` (congelato).

## 6. Cross-cutting concerns
<!-- Errors, security, auth, observability, configuration. -->

## 7. Non-functional requirements mapping
| NFR | How it is met |
|---|---|

## 8. Decisions
| ADR | Title | Status |
|---|---|---|
| [ADR-0001](adr/0001-cloudflare-workers-kv.md) | Backend su Cloudflare Workers con cache su Workers KV | proposed |

## 9. Risks and open points
- **Limiti piano Free (NFR-15, OQ-22, R-7)**: 10 ms CPU e 50 subrequest per invocazione contro 26
  chiamate nominali (fino a 78 con i retry). Il cron su Free probabilmente non completa; misure e
  regola go/no-go per Paid in [`runbook.md`](runbook.md). Retry non ridotti (FR-17).
- **Consistenza eventuale della KV (NFR-16)**: accettata.
- **Cron solo UTC**: l'ora locale cambia di 1 h con l'ora legale.
- **Fixture congelate**: nessuna validazione automatica contro lo schema; rigenerazione dal tag
  `python-baseline`.
