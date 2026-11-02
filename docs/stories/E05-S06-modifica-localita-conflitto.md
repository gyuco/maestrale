---
id: E05-S06
epic: E05
title: "Backoffice: modifica di name e coordinate con controllo di versione"
type: feature
status: done
requirements: [FR-99, FR-103]
depends_on: [E05-S05]
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
---

# E05-S06: Backoffice: modifica di `name` e coordinate con controllo di versione

## Context
Modifica di una località esistente: lo `slug` è immutabile, `name` e coordinate sono modificabili, e
due salvataggi concorrenti non si sovrascrivono.

**Requisiti (testo operativo)**
- FR-99: si possono modificare `name`, `latitude` e `longitude` con la validazione di FR-98; lo
  `slug` **non** è modificabile dopo la creazione (per cambiarlo: disattivazione e nuova aggiunta).
  Una rinomina di `name` non cambia lo slug; una modifica delle coordinate ha effetto sui provider
  dalla prima esecuzione successiva; i record di storico precedenti restano invariati.
- FR-103: se un amministratore salva una modifica di una località che nel frattempo è stata modificata,
  disattivata o riattivata da un altro salvataggio, il sistema rifiuta con un messaggio che invita a
  ricaricare la voce, senza sovrascrivere.

**Decisioni architetturali (ADR-0006 §Scrittura)**
- Il form include `version` come campo nascosto; `UPDATE … WHERE slug = ? AND version = ?`; se
  `changes() = 0` la `batch()` non incrementa `catalog_meta` e non scrive `admin_actions`; risposta
  **409** con "La località è stata modificata nel frattempo: ricarica la voce".
- Su successo: `version = version + 1`, `updated_at`, voce `admin_actions` (`action = 'update'`,
  `before_json`/`after_json`), ricostruzione di `catalog:current`, `303` con flash.
- `GET /catalogo/:slug` mostra il form con lo slug in sola lettura; slug sconosciuto → 404.

**File probabili**: `worker/src/admin/routes/catalogo.ts`,
`worker/src/admin/views/catalogo_form.tsx`, `worker/src/admin/actions.ts`,
test `worker/test/admin_catalogo_edit.test.ts`.

## Acceptance criteria
- **AC-1** — Given una località esistente, when si modifica il nome, then 303, il nome è aggiornato, lo
  slug è invariato e `GET /locations` serve il nuovo nome (FR-99, FR-101).
- **AC-2** — Given una latitudine fuori area, then errore per campo e nessuna scrittura (FR-98).
- **AC-3** — Given il form con `version = 3` e nel frattempo un altro salvataggio ha portato la
  versione a 4, when si invia, then **409**, i valori dell'altro salvataggio restano e nessuna voce
  `update` è scritta per il tentativo (la voce di rifiuto è scritta con `outcome = 'rejected'` e il
  motivo) (FR-103, FR-113).
- **AC-4** — Given un salvataggio riuscito, then `version` della riga è avanzata di 1 e
  `catalog_meta.version` pure; `admin_actions` contiene `before_json` con i valori precedenti e
  `after_json` con i nuovi (FR-113).
- **AC-5** — Given lo slug nel form, then è in sola lettura (non inviato come modificabile) e un
  tentativo di cambiarlo non ha effetto (FR-99).
- **AC-6** — Given una rinomina, then i record di `daily_history` non cambiano (FR-99, R-18).
- **AC-7** — `npm test` e `npm run typecheck` verdi.

## Tasks
- [x] Scrivere i test falliti (AC-1..AC-6)
- [x] Implementare il form di modifica con slug in sola lettura e `version` nascosta
- [x] Implementare l'update condizionato, il 409 e il registro (AC-3, AC-4)
- [x] Verificare che la rinomina non tocchi lo storico (AC-6)
- [x] Eseguire `npm test` e `npm run typecheck` (AC-7)

## Dev notes
- **File**: `findLocation` in `catalog_store.ts`, `GET|POST /catalogo/:slug`, `catalogo_form.tsx` (modo
  edit), `worker/test-admin/admin_catalogo_edit.test.ts`.
- Concorrenza: `UPDATE ... WHERE slug = ? AND version = ?`; `catalog_meta` e `admin_actions` sono
  condizionati con `changes()` nella stessa `batch()`, quindi un conflitto non lascia effetti parziali.
  `409` + voce `rejected` con il motivo (FR-103, FR-113).
- La rinomina non tocca lo storico: il backoffice non ha il binding `HISTORY` (verifica strutturale).
- Verifica: `npm test`, `npm run typecheck`.

## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
### 2026-11-02 — verdict: done
AC-1..AC-7 coperti: modifica, errore coordinate, 409 con voce rejected, versione e meta avanzati,
slug immutabile, form con slug readonly. Nessun blocker.
