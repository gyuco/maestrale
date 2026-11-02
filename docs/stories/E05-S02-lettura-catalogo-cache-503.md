---
id: E05-S02
epic: E05
title: "Lettura del catalogo da KV/D1 e 503 quando non disponibile"
type: feature
status: done
requirements: [FR-61, FR-62, FR-63, FR-101, FR-120, NFR-19, NFR-33]
depends_on: [E05-S01]
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
---

# E05-S02: Lettura del catalogo da KV/D1 e 503 quando non disponibile

## Context
Sostituisce il catalogo dal bundle con il catalogo a runtime: KV `catalog:current` come sorgente
calda, D1 `CORE` come fonte, `503` quando nessuno dei due risponde. Il contratto di `/locations` non
cambia (FR-62/FR-63); `/forecast` e `/history` continuano a risolvere lo slug come prima.

**Requisiti (testo operativo)**
- NFR-33: job, API e backoffice leggono il catalogo dal database **tramite cache**; `/locations`,
  `/forecast` e `/history` non leggono il database a ogni richiesta (≤ 2 letture storage per
  richiesta, NFR-19).
- FR-101: una modifica salvata dal backoffice è riflessa nella risposta del server entro il target di
  60 s; la memo per isolate dura 30 s (sotto il target).
- FR-120: se la cache è assente o illeggibile **e** il database non è leggibile, `/locations`,
  `/forecast` e `/history` rispondono **503** con `detail` "Catalogo temporaneamente non disponibile",
  senza catalogo di ripiego; con la cache disponibile le API continuano a servire anche se il DB non
  risponde.

**Decisioni architetturali (ADR-0006 §Decisione)**
- `catalog.ts` espone `getCatalog(env)` asincrono: memo per isolate (TTL 30 s) → `get` di
  `catalog:current` → su miss `SELECT … FROM locations WHERE active = 1 ORDER BY name` + `put`
  best-effort della chiave → risposta. Errori KV e D1 → `unavailable`.
- Chiave `catalog:current`: `{ schema_version: 1, catalog_version, etag, locations: [...] }` con le
  sole attive ordinate per `name`; `etag` = SHA-256 del corpo canonico di `/locations` (16 hex).
- Il payload di `/locations` resta identico a quello di ADR-0004 (stessi campi, stesso ordine,
  `ETag`, `Cache-Control`, 304).
- Il bundle non importa più `locations.json`.

**File probabili**: `worker/src/catalog.ts`, `worker/src/env.ts`, `worker/src/routes/locations.ts`,
`worker/src/routes/forecast.ts`, `worker/src/routes/history.ts`, `worker/src/index.ts` (passaggio di
`env`), test `worker/test/catalog_cache.test.ts`, `worker/test/locations_503.test.ts`.

## Acceptance criteria
- **AC-1** — Given `catalog:current` presente e valida, when arriva `GET /locations`, then la risposta
  è 200 con lo stesso corpo di prima, `ETag` uguale a quello memorizzato e **0 query D1**; una seconda
  richiesta entro 30 s non fa nemmeno `get` KV (memo) (NFR-19, NFR-33).
- **AC-2** — Given la chiave KV assente, when arriva `GET /locations`, then si legge D1, si ricostruisce
  la chiave (1 `put`) e la risposta è 200; con KV illeggibile ma D1 sano il comportamento è lo stesso
  (FR-120: solo cache assente **e** DB giù è 503).
- **AC-3** — Given cache assente e D1 in errore, when arrivano `GET /locations`, `GET /forecast` e
  `GET /history`, then rispondono **503** con `detail` "Catalogo temporaneamente non disponibile" e
  nessun dato del catalogo nel corpo (FR-120).
- **AC-4** — Given `If-None-Match` uguale all'`ETag`, when arriva `GET /locations`, then 304 senza
  corpo, con `ETag` e `Cache-Control` invariati (FR-63).
- **AC-5** — Given il catalogo del seed, when si confronta il corpo di `/locations` con quello
  atteso da `locations.json`, then le 13 voci e il loro ordine coincidono (FR-104, FR-95).
- **AC-6** — Given un `meta` valido, when arriva `GET /health`, then la risposta è invariata e non
  legge il catalogo (FR-50, FR-81).
- **AC-7** — `npm test` e `npm run typecheck` verdi; test di parità e fixture esistenti senza
  modifiche.

## Tasks
- [x] Scrivere i test falliti: hit/miss/memo (AC-1), D1 fallback (AC-2), 503 (AC-3), 304 (AC-4),
      parità del corpo (AC-5), health invariato (AC-6)
- [x] Riscrivere `catalog.ts` con `getCatalog` asincrono, memo TTL e payload/ETag
- [x] Aggiornare le route e `index.ts` al nuovo accesso asincrono, con i messaggi 503
- [x] Rimuovere l'import di `locations.json` dal bundle
- [x] Eseguire `npm test` e `npm run typecheck` (AC-7)

## Dev notes
- **File**: `worker/src/catalog.ts` riscritto (`getCatalog`, `buildSnapshot`, `locationsDocument`,
  `resetCatalogMemo`), `worker/src/env.ts` (variabili del contesto e TTL), `worker/src/index.ts`
  (middleware del catalogo e `scheduled`), route `locations`/`forecast`/`history`, test
  `catalog_cache.test.ts`; test esistenti con `createApp()` aggiornati a `createApp(locations)` quando
  usano binding finti senza `CORE`.
- La memo è per isolate e legata al namespace KV: due ambienti diversi non condividono il catalogo.
- Su miss KV si leggono `locations` (solo attive) e `catalog_meta.version`, poi `put` best effort.
- Il corpo e l'ETag sono ricostruiti in modo deterministico (hash del contenuto), così la parità con
  il contratto di `/locations` resta invariata.
- Verifica: `npm test` 305 verdi, `npm run typecheck` pulito.

## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
### 2026-11-02 — verdict: done
Verify: `cd worker && npm test`, `npm run typecheck`. AC-1..AC-7 coperti: hit/miss/memo (0 query D1
sull'hit), 503 con cache e DB giù, 304, parità del corpo con `locations.json`, `/health` invariato.
Nessun blocker. R-1 (nit): la `put` della cache è best effort; la riparazione è in S12, come da
ADR-0009.
