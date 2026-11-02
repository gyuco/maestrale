---
id: E05-S11
epic: E05
title: "\"Esegui ora\": richiesta, rifiuti e registrazione"
type: feature
status: done
requirements: [FR-114, FR-115, FR-116]
depends_on: [E05-S09, E05-S08, E05-S04]
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
---

# E05-S11: "Esegui ora": richiesta, rifiuti e registrazione

## Context
Il backoffice accetta una richiesta di esecuzione, la registra in `run_requests` e risponde subito; il
dispatcher (S12) la eseguirà entro ~60 s. Qui si implementano solo accettazione e rifiuto, con le
regole di FR-115.

**Requisiti (testo operativo)**
- FR-114: l'amministratore, previa conferma, avvia un'esecuzione su **tutte** le località attive o su
  **una sola** località attiva scelta dal catalogo; per una sola, le altre località, il loro cache e il
  loro storico restano invariati. Un'esecuzione su una sola località non modifica `/health` (OQ-52).
- FR-115: esecuzione rifiutata, con messaggio che indica il motivo, se un'altra esecuzione
  (pianificata o su richiesta) è in corso, o se dall'avvio dell'ultima esecuzione su richiesta non
  sono trascorsi almeno **15 minuti** (configurabile, mai sotto 15). Il rifiuto è registrato nel
  registro operazioni e **non** crea un registro di esecuzione.
- FR-116: l'esecuzione su richiesta si comporta come una pianificata (cache, interruttore, budget,
  storico del giorno 0) ed è registrata con origine "su richiesta", ambito e identità.

**Decisioni architetturali (ADR-0009)**
- `GET /esegui` mostra la conferma con la scelta "tutte" / "una località" (select delle attive);
  `POST /esegui` esegue una sola istruzione atomica:
  `INSERT INTO run_requests … SELECT … WHERE NOT EXISTS (richiesta pending/claimed) AND NOT EXISTS
  (lock attivo) AND (ultima su richiesta < 15 min)`.
- 0 righe inserite → motivo ricavato e voce `admin_actions` `run_rejected` (`outcome = 'rejected'`);
  303 con messaggio di rifiuto. Inserimento riuscito → 303 con "Esecuzione richiesta: partirà entro un
  minuto" e voce `admin_actions` `run` (`outcome = 'ok'`).
- La pagina `/esecuzioni` mostra le richieste `pending` come banner "in attesa di avvio" (FR-114).
- L'esecuzione vera e propria è S12: qui non si esegue nulla.

**File probabili**: `worker/src/admin/routes/esegui.ts`,
`worker/src/admin/views/esegui_form.tsx`, `worker/src/admin/routes/esecuzioni.ts` (banner),
test `worker/test/admin_esegui.test.ts`.

## Acceptance criteria
- **AC-1** — Given nessuna esecuzione in corso e nessuna richiesta recente, when si invia "tutte", then
  303 con conferma, una riga `run_requests` `pending` con email e ambito `tutte`, una voce
  `admin_actions` `run` e **nessuna** riga in `job_runs` (FR-114, FR-116).
- **AC-2** — Given la scelta "una località" con uno slug attivo, then la richiesta ha `scope` `singola`
  e lo slug; con uno slug disattivato o inesistente, then errore e nessuna riga (FR-114).
- **AC-3** — Given `job_lock` attivo (esecuzione in corso) o una richiesta `pending`/`claimed`, then il
  POST è rifiutato con il motivo "esecuzione in corso", nessuna riga in `run_requests`/`job_runs` e una
  voce `admin_actions` `run_rejected` (FR-115).
- **AC-4** — Given l'ultima esecuzione su richiesta iniziata 10 minuti fa, then rifiuto con il motivo
  "attendi almeno 15 minuti"; a 16 minuti l'accettazione riesce; con `MIN_ON_DEMAND_INTERVAL_SECONDS`
  configurato a 900 (minimo) il comportamento non cambia (FR-115).
- **AC-5** — Given una richiesta `pending`, when si apre `/esecuzioni`, then compare il banner "in
  attesa di avvio" con l'ambito e l'email; senza richieste non compare (FR-114).
- **AC-6** — Given un rifiuto, then `job_runs` resta invariato e il registro operazioni contiene il
  motivo (FR-115, FR-113).
- **AC-7** — `npm test` e `npm run typecheck` verdi.

## Tasks
- [x] Scrivere i test falliti (AC-1..AC-6) con clock iniettato e lock nel D1 di test
- [x] Implementare la pagina di conferma e il POST con l'istruzione atomica (AC-1, AC-2)
- [x] Implementare i rifiuti e le voci di registro (AC-3, AC-4, AC-6)
- [x] Aggiungere il banner delle richieste in attesa (AC-5)
- [x] Eseguire `npm test` e `npm run typecheck` (AC-7)

## Dev notes
- **File**: `worker/src/admin/routes/esegui.tsx`, `worker/src/admin/views/esegui_form.tsx`,
  `worker/test-admin/admin_esegui.test.ts`.
- Accettazione in un'unica `batch()` condizionata (nessuna richiesta pending/claimed, lock libero,
  ultima su richiesta < 15 min) con voce `run`; rifiuto con voce `run_rejected` e motivo.
- Il banner delle richieste in attesa è in S10.
- Verifica: `npm test`, `npm run typecheck`.

## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
### 2026-11-02 — verdict: done
AC-1..AC-7 coperti: accettazione tutte/singola, località inattiva, richiesta in attesa, lease attivo,
intervallo di 15 minuti, nessuna riga in `job_runs` sui rifiuti. Nessun blocker.
