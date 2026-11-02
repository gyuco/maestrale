---
id: E05-S01
epic: E05
title: "Schema D1 CORE, seed del catalogo e validazione pura"
type: feature
status: done
requirements: [FR-1, FR-2, FR-61, FR-98, FR-104, NFR-33]
depends_on: []
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
  - node --test scripts/*.test.mjs
  - cd worker && npm test
  - cd worker && npm run typecheck
---

# E05-S01: Schema D1 `CORE`, seed del catalogo e validazione pura

## Context
Primo mattone del catalogo a runtime: il database, il seed una tantum e le regole di validazione
condivise. Nessuna route cambia ancora comportamento.

**Requisiti (testo operativo)**
- FR-61: il catalogo è in un **database** letto tramite cache; `locations.json` è solo il seed della
  migrazione iniziale (FR-104) e dopo l'attivazione non è più una fonte.
- FR-104: al primo rilascio il catalogo contiene **esattamente** le 13 voci di `locations.json` (stessi
  `slug`, `name`, `latitude`, `longitude`), tutte attive.
- FR-98: campi obbligatori; `slug` = forma normalizzata (minuscole, senza accenti, trattini al posto
  di spazi e underscore) e unico su **tutte** le voci, attive e disattivate; `name` non vuoto e la sua
  forma normalizzata non coincide con lo slug o il nome normalizzato di un'altra località; coordinate
  in `[38,5, 41,5]` × `[7,5, 10,2]` (estremi inclusi); oltre 500 località attive solo **avviso**.
- FR-2: una voce del catalogo senza uno dei quattro campi rende il catalogo non valido.

**Decisioni architetturali (ADR-0006)**
- D1 `maestrale-core`, binding `CORE`, primario `weur`; migrazioni in `worker/migrations-core/`.
- Tabelle del catalogo: `catalog_meta(id=1, version, updated_at)` e `locations(slug PK, name,
  latitude, longitude, active, version, created_at, updated_at)`.
- La migrazione `0001_backoffice.sql` crea **tutte** le tabelle del backoffice (catalogo, registri,
  `run_requests`, `job_lock`) e inserisce la riga unica di `catalog_meta` e di `job_lock`
  (`lease_until = '1970-01-01T00:00:00Z'`). Le storie successive usano le tabelle, non le creano.
- `0002_seed_locations.sql` è **generata** da `scripts/seed_catalog.mjs` leggendo `locations.json`.

**File probabili**: `worker/migrations-core/0001_backoffice.sql` (nuovo),
`worker/migrations-core/0002_seed_locations.sql` (generata), `scripts/seed_catalog.mjs`
(nuovo), `worker/src/catalog_validation.ts` (nuovo), `worker/src/env.ts`, setup Vitest con
`applyD1Migrations` per `CORE`, test `worker/test/catalog_schema.test.ts`,
`worker/test/catalog_validation.test.ts`, `worker/test/seed_catalog.test.ts`.

## Acceptance criteria
- **AC-1** — Given un D1 vuoto, when si applicano le migrazioni di `migrations-core/`, then esistono
  tutte le tabelle e gli indici del backoffice, `catalog_meta` ha una riga con `version = 1` e
  `job_lock` una riga con lease nel passato; riapplicare le migrazioni non fallisce.
- **AC-2** — Given `locations.json` con 13 voci, when si esegue `node scripts/seed_catalog.mjs`, then
  il file `0002_seed_locations.sql` contiene 13 `INSERT` con gli stessi valori; applicato a un D1
  vuoto, `SELECT` restituisce le stesse 13 voci con `active = 1` e `version = 1` (FR-104).
- **AC-3** — Given una voce, when `validateCatalogInput` la valuta, then rifiuta: campi mancanti o
  vuoti; slug non normalizzato o duplicato (anche con una voce disattivata); `name` vuoto o la cui
  forma normalizzata collide con uno slug o un nome di un'altra località; coordinate fuori area
  (limiti inclusi); e restituisce errori **per campo** in italiano (FR-98).
- **AC-4** — Given 500 località attive, when si valida l'aggiunta di una nuova, then l'esito è valido
  con `warning` (non bloccante); a 499 nessun avviso (FR-98).
- **AC-5** — Given un catalogo con una voce disattivata, when si valida una nuova voce con lo stesso
  slug, then è rifiutata (unicità su attive e disattivate).
- **AC-6** — `npm test` e `npm run typecheck` verdi; i test esistenti del catalogo restano verdi
  (FR-95: nessuna modifica alle fixture).

## Tasks
- [x] Scrivere i test falliti: schema/migrazioni (AC-1), seed (AC-2), validazione (AC-3..AC-5)
- [x] Creare `0001_backoffice.sql` con tutte le tabelle e le righe singole (AC-1)
- [x] Scrivere `scripts/seed_catalog.mjs` (funzione esportata + CLI) e generare `0002_seed_locations.sql` (AC-2)
- [x] Implementare `catalog_validation.ts` con `slugify` esistente e i limiti configurabili (AC-3..AC-5)
- [x] Aggiungere `CORE` a `worker/wrangler.jsonc` e il setup `applyD1Migrations` nei test
- [x] Eseguire `npm test` e `npm run typecheck` (AC-6)

## Dev notes
- **File**: `worker/migrations-core/0001_backoffice.sql` (tutte le tabelle del backoffice in un'unica
  migrazione, come da ADR-0006/0008/0009), `worker/migrations-core/0002_seed_locations.sql` (generata),
  `scripts/seed_catalog.mjs`, `worker/src/catalog_validation.ts`, `worker/src/env.ts` (`CORE`),
  `worker/wrangler.jsonc` (binding `CORE` con id segnaposto), `worker/vitest.config.ts` + setup (secondo
  set di migrazioni), test `catalog_schema.test.ts`, `catalog_validation.test.ts`,
  `scripts/seed_catalog.test.mjs`.
- `wrangler types` rigenerato: `Env` include `CORE`.
- Il seed usa un istante fisso (`SEEDED_AT`) per un diff stabile; `INSERT OR REPLACE` rende la
  migrazione innocua se riapplicata.
- Verifica: `npm test` 305 verdi, `npm run typecheck` pulito, `node --test scripts/*.test.mjs` 19 verdi.

## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
### 2026-11-02 — verdict: done
Verify: `cd worker && npm test` (305 test), `npm run typecheck`, `node --test scripts/*.test.mjs` (19
test). AC-1..AC-6 coperti: schema e righe singole, parità seed/`locations.json`, regole FR-98
(anche disattivate e limiti), avviso oltre 500. Nessun blocker. R-1 (nit): l'id del database `CORE` è
un segnaposto e va sostituito al primo deploy (documentato nel runbook).
