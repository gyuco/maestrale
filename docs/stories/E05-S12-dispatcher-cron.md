---
id: E05-S12
epic: E05
title: "Dispatcher a cron: claim, lease, watchdog, retention e riparazione cache"
type: feature
status: ready
requirements: [FR-107, FR-112, FR-120, NFR-30, NFR-33]
depends_on: [E05-S11, E05-S02, E05-S09]
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
---

# E05-S12: Dispatcher a cron

## Context
Il cron ogni minuto è il motore che rende reale "Esegui ora" e mantiene sani cache e registri. Senza
di lui le richieste restano `pending`, la cache non si ripara e le esecuzioni interrotte non vengono
chiuse.

**Requisiti (testo operativo)**
- FR-107: un'esecuzione avviata ma non conclusa compare come **non completata** con inizio e, se
  disponibili, le informazioni registrate fino all'interruzione, al più tardi dopo la durata massima
  ammessa dal piano (NFR-15) dal suo inizio.
- FR-112: i registri più vecchi del periodo di conservazione (NFR-30, 90 giorni) sono eliminati
  automaticamente, senza intervento manuale; il backoffice non consente di modificarli o cancellarli.
- NFR-33: la cache del catalogo è riparata se `catalog_meta.version` diverge da `catalog:current`.
- NFR-30: retention configurabile (`RUN_RETENTION_DAYS = 90`, `ACTIONS_RETENTION_DAYS = 730`).

**Decisioni architetturali (ADR-0009)**
- Cron `* * * * *` sul Worker pubblico; `scheduled` distingue i due cron (`30 0,6,12,18 * * *` → job,
  `* * * * *` → `dispatch.ts`); `RUN_DISPATCH_ENABLED` (default `true`) consente di disattivarlo nei
  test di parità.
- Ordine del dispatcher: (1) riparazione `catalog:current`; (2) watchdog (`running` oltre
  `JOB_MAX_DURATION_SECONDS + 60` → `outcome = 'non_completata'`); (3) retention; (4) claim di una
  richiesta `pending` + lease su `job_lock` + esecuzione con l'ambito + rilascio del lease.
- Il job pianificato acquisisce lo stesso lease: se occupato salta l'esecuzione e lo registra nel log.
- Un claim non può avvenire due volte: `UPDATE … WHERE status = 'pending'` con controllo delle righe.

**File probabili**: `worker/src/dispatch.ts` (nuovo), `worker/src/index.ts` (routing dei cron),
`worker/src/runs_store.ts` (claim/lease/watchdog/retention), test `worker/test/dispatch.test.ts`.

## Acceptance criteria
- **AC-1** — Given una richiesta `pending` e `job_lock` libero, when il cron `* * * * *` gira, then la
  richiesta passa a `claimed`, il lease è acquisito, il job esegue con lo scope richiesto, il lease è
  rilasciato e la richiesta è `done` (ADR-0009).
- **AC-2** — Given due giri di dispatcher ravvicinati, then l'esecuzione parte **una sola volta** (il
  secondo giro non trova richieste `pending` e non duplica il run).
- **AC-3** — Given una esecuzione `running` con `started_at` oltre `JOB_MAX_DURATION_SECONDS + 60`,
  then il watchdog la chiude con `outcome = 'non_completata'` e `finished_at` valorizzato (FR-107).
- **AC-4** — Given registri più vecchi di 90 giorni e operazioni più vecchie di 24 mesi, then vengono
  eliminati; quelli più recenti restano (FR-112, NFR-30).
- **AC-5** — Given `catalog_meta.version` diversa da `catalog:current.catalog_version`, then il
  dispatcher ricostruisce e riscrive la chiave; se coincidono, nessuna scrittura (NFR-33).
- **AC-6** — Given `RUN_DISPATCH_ENABLED = false`, then il cron non esegue né claim né riparazioni e
  non fallisce (test di parità).
- **AC-7** — Given un'esecuzione in corso (lease attivo), when arriva il cron pianificato delle 6 h,
  then questa salta l'esecuzione e lo registra nel log; il lease non viene rubato (FR-115, ADR-0009).
- **AC-8** — `npm test` e `npm run typecheck` verdi; i test del job esistente restano verdi.

## Tasks
- [ ] Scrivere i test falliti con clock iniettato e D1 di test (AC-1..AC-7)
- [ ] Implementare `dispatch.ts` con i quattro passi e il routing dei cron (AC-1, AC-5, AC-6)
- [ ] Implementare claim/lease atomici e rilascio (AC-1, AC-2, AC-7)
- [ ] Implementare watchdog e retention (AC-3, AC-4)
- [ ] Eseguire `npm test` e `npm run typecheck` (AC-8)

## Dev notes
<!-- Coder: decisioni, deviazioni, riepilogo. -->

## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
<!-- Reviewer: date, verdict, findings R-1… (blocker/should/nit) with file:line. -->
