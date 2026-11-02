---
id: E05-S08
epic: E05
title: "Backoffice: registro delle operazioni"
type: feature
status: ready
requirements: [FR-113, NFR-29]
depends_on: [E05-S05]
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
---

# E05-S08: Backoffice: registro delle operazioni

## Context
Tutte le scritture del backoffice (aggiunta, modifica, disattivazione, riattivazione, avvio di "Esegui
ora") hanno una voce non modificabile. Qui si completa la pagina di consultazione; la scrittura delle
voci è già introdotta in S05–S07 e S11.

**Requisiti (testo operativo)**
- FR-113: ogni operazione di scrittura è registrata con identità dell'amministratore (email da
  Cloudflare Access), istante (UTC ISO 8601), tipo, slug e, per modifiche/disattivazioni/
  riattivazioni, valori precedenti e successivi e stato. Conservazione ≥ 24 mesi. Anche i tentativi
  rifiutati per validazione o modifica concorrente sono registrati con il motivo. Il backoffice mostra
  il registro dal più recente, filtrabile per slug e per amministratore; **nessuna** funzione consente
  di modificarlo o cancellarlo.
- NFR-29: tracciabilità completa; ogni modifica ricostruibile (prima/dopo, autore, istante).

**Decisioni architetturali (ADR-0008 §Registro operazioni)**
- Tabella `admin_actions(id, at, admin_email, action, slug, before_json, after_json, reason, outcome)`
  con indici su `at` e `slug`; le voci sono inserite nella stessa `batch()` della modifica.
- `GET /registro?slug=&admin=&page=` mostra le voci dalla più recente, 50 per pagina, con tipo,
  istante in Europe/Rome, email, slug, esito e dettaglio prima/dopo (JSON leggibile o differenza dei
  campi); nessun controllo di modifica/cancellazione.
- La retention (24 mesi) è del dispatcher (S12); qui non si cancella nulla.

**File probabili**: `worker/src/admin/routes/registro.ts`, `worker/src/admin/views/registro_list.tsx`,
test `worker/test/admin_registro.test.ts`.

## Acceptance criteria
- **AC-1** — Given voci scritte da S05–S07, when arriva `GET /registro`, then compaiono dalla più
  recente con tipo, istante (Europe/Rome), email, slug, esito; per una modifica mostra i valori
  precedenti e successivi (FR-113).
- **AC-2** — Given `?slug=<slug>`, then solo le voci di quello slug; given `?admin=<email>`, then solo
  quelle dell'amministratore; i filtri si combinano; nessun filtro → tutte (FR-113).
- **AC-3** — Given i tentativi rifiutati (validazione, conflitto 409), then compaiono con
  `outcome = 'rejected'` e il motivo (FR-113).
- **AC-4** — Given la pagina, then non esiste alcun link o form per modificare o cancellare una voce;
  i metodi `DELETE`/`PUT` sul percorso rispondono 405/404 (NFR-29).
- **AC-5** — Given 120 voci, then la pagina 1 ne mostra 50, la 2 le successive e la 3 le ultime,
  sempre in ordine decrescente di istante (FR-113); pagine oltre l'ultima mostrano lo stato vuoto.
- **AC-6** — Given l'email dell'identità finta, then ogni voce è attribuita correttamente (nessuna
  condivisione di credenziali, NFR-29).
- **AC-7** — `npm test` e `npm run typecheck` verdi.

## Tasks
- [ ] Scrivere i test falliti (AC-1..AC-6) con voci inserite nel D1 di test
- [ ] Implementare lettura paginata e filtri per slug/amministratore
- [ ] Implementare la pagina SSR con dettaglio prima/dopo e istanti in Europe/Rome
- [ ] Verificare l'assenza di percorsi di modifica/cancellazione (AC-4)
- [ ] Eseguire `npm test` e `npm run typecheck` (AC-7)

## Dev notes
<!-- Coder: decisioni, deviazioni, riepilogo. -->

## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
<!-- Reviewer: date, verdict, findings R-1… (blocker/should/nit) with file:line. -->
