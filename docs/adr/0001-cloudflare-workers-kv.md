---
id: ADR-0001
status: proposed     # proposed | accepted | superseded by ADR-XXXX
date: 2026-10-19
---

# ADR-0001: Backend su Cloudflare Workers con cache su Workers KV

Descrive ciò che è stato costruito in E01 (S00..S07). È **proposto**: lo approva solo il proprietario.

## Context
Il backend v0.1 era Python (FastAPI + uvicorn) con un cache JSON su file (`data/forecasts.json`)
aggiornato da un job lanciato da `cron` su un server proprio. Requisiti coinvolti:

- FR-49: il job di aggiornamento gira ogni 6 h sulla piattaforma Cloudflare, senza server né
  scheduler esterni.
- FR-50: parità di contratto di `/forecast` e `/health` con l'implementazione Python (l'app Flutter
  non cambia; unica eccezione: l'identificativo del cache in `/health`, OQ-19).
- NFR-11: API in sola lettura, nessuna autenticazione, CORS configurabile, solo HTTPS.
- NFR-12: backend su Cloudflare Workers in TypeScript con cache su Workers KV.
- NFR-15: limiti di piattaforma. Piano Free: 10 ms di CPU e 50 subrequest per invocazione; piano Paid:
  10.000 subrequest, CPU fino a 15 min per cron con intervallo >= 1 h. Un'esecuzione completa richiede
  26 chiamate provider nominali (13 località x 2), fino a 78 con i retry (3 tentativi, FR-17).
- OQ-22 (piano Cloudflare) e OQ-23 (Python in parallelo / migrazione del cache): il Python non resta in
  parallelo oltre la verifica di parità, il cache non si migra (basta il primo aggiornamento).

L'app è in sviluppo con un solo utente (il proprietario): il deploy è di sviluppo su `*.workers.dev`.

## Options
1. **Mantenere Python su un server proprio** — nessun porting e nessun limite di piattaforma, ma
   serve gestire server, processo uvicorn e cron; contraddice FR-49/NFR-12.
2. **Workers + Hono + Workers KV con Cron Trigger** — nessun server, scheduler integrato, cache
   chiave-valore adatta a un solo documento letto spesso e scritto 4 volte al giorno. Contro: limiti
   per invocazione (NFR-15), KV a consistenza eventuale (NFR-16), cron solo in UTC.
3. **Altra persistenza Cloudflare (D1, R2)** — D1 (SQL) e R2 (oggetti) aggiungono schema, migrazioni o
   API più pesanti per un unico JSON di poche decine di KiB; nessun vantaggio per il caso d'uso.

## Decision
Opzione 2: **Cloudflare Workers** (TypeScript) con router **Hono**, cache nella KV **`FORECASTS`**
sotto la chiave **`latest`** (un solo oggetto con tutte le località), aggiornata dal **Cron Trigger**
`30 0,6,12,18 * * *` (UTC) tramite l'handler `scheduled`. API: `GET /health` e `GET /forecast`.
Python rimosso dopo la verifica di parità (`scripts/compare_backends.mjs`, 0 differenze su 23 casi
con golden e a cache vuota); il codice resta nel tag locale `python-baseline`, le fixture JSON sono
congelate e fanno da riferimento ai test del Worker.

## Consequences
- **Più semplice**: nessun server da gestire, deploy con `wrangler deploy`, scheduler e log
  (Workers Logs, `wrangler tail`) inclusi nella piattaforma.
- **Consistenza eventuale (NFR-16)**: dopo un aggiornamento alcune location possono servire per breve
  tempo il dato precedente; accettabile con intervallo di 6 h e soglia `stale` di 12 h.
- **Cron solo UTC**: l'intervallo resta di 6 h, cambia di 1 h l'ora locale con l'ora legale
  (00:30 UTC = 02:30 CEST / 01:30 CET).
- **Limiti Free/Paid**: 10 ms CPU / 50 subrequest contro 26 nominali, 78 con i retry. Sul Free il
  cron probabilmente non completa; si tollera e si misura (runbook). I retry restano a 3 (FR-17):
  scendere sotto 50 subrequest nel caso peggiore richiederebbe 1 solo tentativo. Passaggio a Paid:
  decisione futura sulle misure, comunque prima di aprire l'app ad altri utenti.
- **Nessuna documentazione interattiva `/docs`**: FR-29 è escluso dal proprietario.
- **Dismissione di Python**: nessun processo Python operativo; rigenerare le fixture richiede il tag
  `python-baseline` (vedi `tests/fixtures/README.md`). Nessun test valida più i golden contro
  `forecast.schema.json`.
- **Deploy di sviluppo** su `workers.dev`, senza custom domain; CI e Workers Builds sono un passo
  futuro.
