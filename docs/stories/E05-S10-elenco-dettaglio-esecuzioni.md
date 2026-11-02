---
id: E05-S10
epic: E05
title: "Backoffice: elenco paginato e dettaglio delle esecuzioni"
type: feature
status: ready
requirements: [FR-107, FR-108, FR-109]
depends_on: [E05-S09, E05-S03]
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
---

# E05-S10: Backoffice: elenco paginato e dettaglio delle esecuzioni

## Context
La vista di diagnosi: elenco delle esecuzioni conservate, dalla più recente, con filtri, e dettaglio
completo di una esecuzione.

**Requisiti (testo operativo)**
- FR-108: elenco delle esecuzioni conservate (NFR-30), dalla più recente, con inizio, durata, origine,
  esito, numero di aggiornate e fallite, indicatore di interruttore; **paginato** e filtrabile per
  esito e intervallo di date. Solo elenco e dettaglio: nessuna evidenziazione automatica di anomalie,
  nessuna vista per località.
- FR-109: selezionando un'esecuzione, mostra tutte le informazioni di FR-105, con l'elenco delle
  località fallite (slug, nome se ancora nel catalogo, messaggio) **ordinato per slug**.
- FR-107 (visualizzazione): un'esecuzione `non completata` compare nell'elenco con inizio e le
  informazioni disponibili.

**Decisioni architetturali (ADR-0007 §Pagine, ADR-0008 §Elenco)**
- `GET /esecuzioni?esito=&da=&a=&page=` con `ADMIN_PAGE_SIZE = 20`, `ORDER BY started_at DESC LIMIT
  20 OFFSET n`, conteggio totale per la paginazione; date del filtro in Europe/Rome, istanti mostrati
  in Europe/Rome (NFR-10).
- `GET /esecuzioni/:id` legge `job_runs` e, con `LEFT JOIN locations`, i fallimenti ordinati per slug;
  nome assente se la voce non è più nel catalogo. Mostra ambito, origine con email per "su richiesta",
  esiti, interruttore, metriche, storico.
- Una esecuzione inesistente → 404.

**File probabili**: `worker/src/admin/routes/esecuzioni.ts`,
`worker/src/admin/views/esecuzioni_list.tsx`, `worker/src/admin/views/esecuzione_detail.tsx`,
test `worker/test/admin_esecuzioni.test.ts`.

## Acceptance criteria
- **AC-1** — Given 45 esecuzioni, when arriva `GET /esecuzioni`, then mostra le 20 più recenti in
  ordine decrescente con inizio, durata, origine, esito, aggiornate/fallite e indicatore interruttore;
  il link a pagina 2 mostra le successive (FR-108).
- **AC-2** — Given `?esito=parziale`, then solo le parziali; `?da=&a=`, then solo nell'intervallo
  (date Europe/Rome, estremi inclusi); i filtri si combinano e la paginazione li conserva (FR-108).
- **AC-3** — Given il dettaglio di un'esecuzione, then mostra tutti i campi di FR-105 e le località
  fallite ordinate per slug con nome corrente quando presente e messaggio (FR-109).
- **AC-4** — Given una località fallita non più nel catalogo, then il nome è assente e la riga resta
  visibile con slug e messaggio (FR-109).
- **AC-5** — Given un'esecuzione `non completata`, then compare nell'elenco con inizio e, nel
  dettaglio, con le informazioni disponibili (FR-107).
- **AC-6** — Given un id inesistente, then 404; given una pagina oltre l'ultima, then elenco vuoto con
  un messaggio (FR-108).
- **AC-7** — Given 500 fallimenti, then il dettaglio risponde 200 in < 1 s nel test e non supera i
  limiti D1 per istruzione (NFR-31).
- **AC-8** — `npm test` e `npm run typecheck` verdi.

## Tasks
- [ ] Scrivere i test falliti (AC-1..AC-6) con D1 popolato
- [ ] Implementare l'elenco con paginazione e filtri
- [ ] Implementare il dettaglio con join dei nomi e ordinamento per slug
- [ ] Verificare le prestazioni con 500 fallimenti (AC-7)
- [ ] Eseguire `npm test` e `npm run typecheck` (AC-8)

## Dev notes
<!-- Coder: decisioni, deviazioni, riepilogo. -->

## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
<!-- Reviewer: date, verdict, findings R-1… (blocker/should/nit) with file:line. -->
