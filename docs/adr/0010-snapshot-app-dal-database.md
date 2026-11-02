---
id: ADR-0010
status: accepted     # proposed | accepted | superseded by ADR-XXXX
date: 2026-11-02
---

# ADR-0010: Snapshot del catalogo nell'app generato dal database a ogni release

Allineato al PRD v0.7: lo snapshot incluso nell'app deriva dal catalogo nel database (OQ-45, FR-65)
e `locations.json` non è più una fonte dopo il seed (FR-104).

## Context
- **FR-65**: il LocationRepository mostra subito la copia locale o, se assente, lo **snapshot
  incluso nell'app**, poi lo sostituisce con `GET /locations`. Lo snapshot va aggiornato a ogni
  release.
- **FR-104**: `locations.json` è solo il seed della migrazione iniziale; una sua modifica dopo
  l'attivazione non ha effetto.
- **FR-61**: una sola fonte (il database) per job, API e app.
- **ADR-0005**: `app/assets/locations.json` è già generato da `locations.json` con
  `scripts/sync_app_catalog.mjs` e un test Flutter verifica l'allineamento.
- **CI/CD (E04)**: la pipeline esegue test e deploy; non ha oggi accesso al database di produzione.
- Vincolo pratico: lo snapshot è un **asset di build**, non un dato letto a runtime dall'app.

## Options
1. **Export D1 in fase di release + conversione in asset, versionato**
   - Pro: lo snapshot riflette davvero il catalogo di produzione; l'asset è deterministico e
     verificabile; nessun accesso al database a runtime.
   - Contro: la release richiede una credenziale con accesso a D1 (API token o `wrangler`); se il
     database non è raggiungibile la release dell'app si blocca.
2. **Snapshot dal build del Worker (endpoint `GET /locations` "congelato" al momento del deploy)**
   - Pro: nessuna credenziale extra in CI.
   - Contro: lo snapshot rifletterebbe il catalogo del momento del deploy del Worker, non della
     release dell'app; due pipeline da coordinare; richiede comunque che quel deploy legga il DB.
3. **Mantenere `locations.json` come snapshot**
   - Pro: nessun cambio di processo.
   - Contro: dopo l'attivazione il file non è più aggiornato dal backoffice: lo snapshot invecchia e
     contraddice FR-65/FR-104.

## Decision
**Opzione 1.**

- **Produzione dello snapshot** (passo di release, documentato nel runbook):
  1. `npx wrangler d1 execute maestrale-core --remote --json --command "SELECT slug, name, latitude,
     longitude FROM locations WHERE active = 1 ORDER BY name"` (oppure la stessa query con l'API D1 e
     un token con permesso di lettura); `--json` restituisce le righe, non un file SQL;
  2. `node scripts/sync_app_catalog.mjs --from /tmp/locations.json` normalizza l'output (accetta sia
     l'involucro di `d1 execute --json` sia la forma `{ locations: [...] }`) e scrive
     `app/assets/locations.json` con le sole località **attive**, ordinate per `name`, nella forma
     `{ schema_version: 1, version, count, locations: [{slug, name, latitude, longitude}] }`;
     `version` è un hash del contenuto, non la versione del database.
- **Verifica**: il test Flutter esistente (snapshot allineato) resta, ma confronta lo snapshot con il
  file generato in release, non più con `locations.json`; in CI un test Node verifica che
  `app/assets/locations.json` sia valido (schema, slug univoci, coordinate nei limiti, nessuna voce
  disattivata).
- **Release dell'app**: lo snapshot è committato insieme alla release; il runbook indica di
  rigenerarlo **prima** del build dell'app e di non modificarlo a mano.
- **Fallback**: se il database non è raggiungibile durante una release dell'app, lo snapshot
  precedente resta valido (può essere vecchio di una release): il repository non viene mai
  sovrascritto con un catalogo vuoto o parziale.

## Consequences
- **Più semplice**: lo snapshot è sempre derivato dalla fonte unica; nessun doppio aggiornamento
  manuale; `locations.json` resta solo come seed.
- **Più difficile**: la release dell'app dipende dalla disponibilità di D1 e da una credenziale di
  lettura in CI; il file `app/assets/locations.json` cambia a ogni release in cui il catalogo è
  cambiato, con diff rumorosi ma attesi.
- **Nota per E04**: la pipeline dell'app va estesa con il passo di export (segreto `CLOUDFLARE_API_TOKEN`
  con permesso D1 Read) e con il test di validazione dello snapshot.
