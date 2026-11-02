---
id: E05-S14
epic: E05
title: "Snapshot dell'app dal database e aggiornamento CI"
type: feature
status: done
requirements: [FR-65, FR-104]
depends_on: [E05-S01]
verify:
  - node --test scripts/*.test.mjs
  - cd app && flutter analyze
  - cd app && flutter test
---

# E05-S14: Snapshot dell'app dal database e aggiornamento CI

## Context
Lo snapshot incluso nell'app deve derivare dal catalogo nel database (FR-65, OQ-45), non più da
`locations.json`. Lo script oggi legge `locations.json` e scrive un array nudo; va adattato a leggere
l'output di `wrangler d1 execute --json` e a scrivere l'involucro di `GET /locations`.

**Requisiti (testo operativo)**
- FR-65: lo snapshot incluso nell'app è derivato dal catalogo nel database; a ogni release il
  LocationRepository mostra subito la copia locale o lo snapshot e poi lo sostituisce con `GET
  /locations`.
- FR-104: dopo l'attivazione `locations.json` non è più una fonte; lo snapshot non va rigenerato da
  lì.

**Decisioni architetturali (ADR-0010)**
- Passo di release: `wrangler d1 execute maestrale-core --remote --json --command "SELECT slug, name,
  latitude, longitude FROM locations WHERE active = 1 ORDER BY name"` → file temporaneo;
  `node scripts/sync_app_catalog.mjs --from <file>` scrive `app/assets/locations.json` nella forma
  `{ schema_version: 1, version: <hash>, count, locations: [...] }` (solo attive, ordinate per nome).
- Lo script normalizza l'input: accetta l'output di `d1 execute --json` (array di oggetti con
  `results`) e la forma `{ locations: [...] }`; scarta le voci non attive se presenti.
- `--check` confronta con lo snapshot e esce con 1 se non allineato; senza `--from` resta possibile
  generare dal seed `locations.json` per lo sviluppo, con un avviso che non è il flusso di release.
- `app/test/catalog_sync_test.dart`: confronta le **località** dello snapshot con `locations.json`
  (finché il seed coincide), non più il JSON grezzo; verifica anche l'involucro e l'assenza di
  duplicate.
- CI (epica E04): aggiungere il passo di release con `CLOUDFLARE_API_TOKEN` con permesso D1 Read e il
  test dello script; il workflow va esteso in E04, qui si preparano script e documentazione.

**File probabili**: `scripts/sync_app_catalog.mjs`, `scripts/sync_app_catalog.test.mjs` (nuovo),
`app/test/catalog_sync_test.dart`, `app/lib/services/catalog_snapshot.dart` (se serve),
`docs/runbook.md` (passo di release).

## Acceptance criteria
- **AC-1** — Given l'output JSON di `d1 execute` con 13 righe, when si esegue lo script con `--from`,
  then `app/assets/locations.json` contiene l'involucro con `schema_version`, `version` (hash),
  `count = 13` e le 13 località ordinate per nome (FR-65, ADR-0010).
- **AC-2** — Given righe con `active = 0`, then sono escluse; given un input vuoto, then lo script
  fallisce senza scrivere un catalogo vuoto.
- **AC-3** — Given uno snapshot già allineato, when si esegue `--check`, then esce con 0; given uno
  snapshot diverso, then esce con 1 e non modifica il file.
- **AC-4** — Given lo snapshot generato, when l'app lo carica, then `LocationCatalog.parse` accetta
  l'involucro e i suggerimenti funzionano (FR-65); il test `catalog_sync_test.dart` confronta le
  località con `locations.json` e passa.
- **AC-5** — Given `node scripts/sync_app_catalog.mjs` senza `--from` (sviluppo), then genera dal seed
  `locations.json` con un avviso esplicito che in release la fonte è il database (FR-104).
- **AC-6** — Il runbook documenta il comando di release e la credenziale richiesta; nessun segreto nel
  repository (NFR-8).
- **AC-7** — `node --test scripts/*.test.mjs`, `flutter analyze` e `flutter test` verdi.

## Tasks
- [x] Scrivere i test falliti dello script (AC-1..AC-3, AC-5)
- [x] Aggiornare `sync_app_catalog.mjs` con `--from`, normalizzazione, involucro e `--check` (AC-1..AC-3)
- [x] Aggiornare `catalog_sync_test.dart` al confronto per località (AC-4)
- [x] Documentare il passo di release nel runbook e l'estensione CI per E04 (AC-6)
- [x] Eseguire i comandi di verifica (AC-7)

## Dev notes
- **File**: `scripts/sync_app_catalog.mjs` (`normalizeCatalog`, `render`, `--from`, `--check`),
  `scripts/sync_app_catalog.test.mjs`, `app/assets/locations.json` (involucro rigenerato),
  `app/test/catalog_sync_test.dart` e `coastal_location_test.dart` aggiornati.
- Accetta l'output di `d1 execute --json`, `{locations: [...]}` o un elenco nudo; scarta le disattivate,
  ordina per nome, `version` = hash del contenuto (16 hex).
- In release: `wrangler d1 execute maestrale-core --remote --json --command "SELECT ... WHERE active = 1"`
  → `node scripts/sync_app_catalog.mjs --from <file>`.
- Verifica: `node --test scripts/*.test.mjs` (23), `flutter analyze`, `flutter test` (116).

## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
### 2026-11-02 — verdict: done
AC-1..AC-7 coperti: involucro e hash, esclusione disattivate, `--check`, caricamento dell'app,
modalità sviluppo con avviso. Nessun blocker. R-1 (should): l'estensione della CI con
`CLOUDFLARE_API_TOKEN` (D1 Read) resta in E04.
