---
id: E05-S05
epic: E05
title: "Backoffice: aggiunta di una località con validazione"
type: feature
status: done
requirements: [FR-97, FR-98]
depends_on: [E05-S04]
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
---

# E05-S05: Backoffice: aggiunta di una località con validazione

## Context
Prima scrittura del backoffice: form di aggiunta, validazione per campo, inserimento atomico con
voce di registro operazioni e aggiornamento della cache del catalogo.

**Requisiti (testo operativo)**
- FR-97: l'amministratore aggiunge una località con `slug`, `name`, `latitude`, `longitude`; se la
  validazione (FR-98) è superata la località entra nel catalogo, altrimenti nessuna modifica è
  applicata e sono mostrati i messaggi d'errore **per campo**.
- FR-98: regole complete (campi obbligatori, slug normalizzato e unico su attive e disattivate, nomi
  senza collisioni, coordinate in `[38,5, 41,5]` × `[7,5, 10,2]`, oltre 500 solo avviso).
- FR-101: dopo il salvataggio la modifica è visibile in `GET /locations` e nella risoluzione entro il
  target di 60 s (implementazione: ricostruzione immediata della chiave KV).
- FR-113: ogni scrittura produce una voce nel registro operazioni con autore, istante, tipo, slug e
  valori prima/dopo.

**Decisioni architetturali (ADR-0006 §Scrittura, ADR-0007 §Pagine)**
- `GET /catalogo/nuovo` mostra il form vuoto; `POST /catalogo/nuovo` valida e, se ok, esegue una
  `db.batch()`: `INSERT` della località (`active = 1`, `version = 1`), incremento di
  `catalog_meta.version`, `INSERT` in `admin_actions` (`action = 'add'`, `after_json`). Poi ricostruisce
  e scrive `catalog:current`.
- Errori di validazione → stessa pagina con i messaggi per campo e i valori inseriti; nessuna
  scrittura. Successo → `303` a `/catalogo` con messaggio flash "Località aggiunta".
- Oltre 500 attive → avviso visibile ma salvataggio consentito (FR-98).
- Il modulo è protetto dal controllo dell'origine di S03.

**File probabili**: `worker/src/admin/routes/catalogo.ts` (POST),
`worker/src/admin/views/catalogo_form.tsx`, `worker/src/admin/actions.ts` (helper
`recordAction`/`refreshCatalog`), test `worker/test/admin_catalogo_add.test.ts`.

## Acceptance criteria
- **AC-1** — Given i quattro campi validi, when si invia il form, then 303 a `/catalogo` con "Località
  aggiunta", la località è nel database con `active = 1`, `GET /locations` la include e `GET /forecast`
  la risolve (salvo 503 "Previsioni non ancora disponibili" fino al job) (FR-97, FR-101).
- **AC-2** — Given un campo mancante o vuoto, when si invia, then la pagina risponde con l'errore sul
  campo, nessuna riga è inserita e nessuna voce di registro è scritta (FR-97, FR-98).
- **AC-3** — Given slug non normalizzato ("Torre Nuova"), già usato (anche da una disattivata), o nome
  che normalizzato collide con uno slug/nome altrui, then errore per campo e nessuna scrittura
  (FR-98).
- **AC-4** — Given coordinate fuori area (es. `latitude = 45`), then errore sul campo coordinate;
  ai limiti esatti (38.5, 7.5, 41.5, 10.2) il salvataggio riesce (FR-98).
- **AC-5** — Given 500 attive, then il form mostra l'avviso ma il salvataggio riesce (FR-98).
- **AC-6** — Given un salvataggio riuscito, then `admin_actions` contiene una voce con email
  dell'identità finta, `slug`, `after_json` con i quattro campi e `outcome = 'ok'` (FR-113).
- **AC-7** — Given un salvataggio, then `catalog:current` è stata riscritta e il suo `catalog_version`
  è avanzato (FR-101).
- **AC-8** — `npm test` e `npm run typecheck` verdi.

## Tasks
- [x] Scrivere i test falliti (AC-1..AC-7)
- [x] Implementare form e validazione con gli errori per campo (AC-2..AC-4)
- [x] Implementare la scrittura atomica, il registro e l'aggiornamento della cache (AC-1, AC-6, AC-7)
- [x] Aggiungere l'avviso oltre 500 (AC-5)
- [x] Eseguire `npm test` e `npm run typecheck` (AC-8)

## Dev notes
- **File**: `worker/src/admin/actions.ts`, `worker/src/admin/views/catalogo_form.tsx`, route
  `POST /catalogo/nuovo`, `worker/src/catalog.ts` (`refreshCatalogCache`), `worker/test-admin/admin_catalogo_add.test.ts`.
- Scrittura atomica in `batch()` (INSERT + `catalog_meta` + `admin_actions`); unicità dello slug
  garantita anche dal vincolo della PK. La `put` della cache è best effort (FR-101).
- Avviso oltre 500 tramite `?avviso=1` nel redirect.
- Verifica: `npm test`, `npm run typecheck`.

## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
### 2026-11-02 — verdict: done
AC-1..AC-8 coperti: salvataggio, errori per campo, slug duplicato (anche disattivato), normalizzazione,
collisioni di nome, limiti di coordinate, avviso 500, voce `add` con `after_json`. Nessun blocker.
