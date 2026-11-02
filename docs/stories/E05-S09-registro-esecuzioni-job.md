---
id: E05-S09
epic: E05
title: "Job: registro delle esecuzioni (esiti, fallimenti, coerenza con /health)"
type: feature
status: done
requirements: [FR-102, FR-105, FR-106, FR-110, FR-111]
depends_on: [E05-S01]
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
---

# E05-S09: Job: registro delle esecuzioni

## Context
Il job scrive nel database un registro strutturato di ogni esecuzione: è la fonte del backoffice
(S10) e non deve mai interferire con cache, storico e `/health`.

**Requisiti (testo operativo)**
- FR-105: per ogni esecuzione (pianificata o su richiesta) il registro contiene: id; origine e ambito
  (tutte / una località); inizio, fine e durata (UTC ISO 8601); esito; numero di località della
  versione di catalogo usata; aggiornate; fallite con slug e messaggio (lo stesso di
  `errors[<slug>]`), distinguendo le non tentate per budget; interruttore e conteggi per provider;
  misure di NFR-21; record di storico scritti ed errori.
- FR-106: esiti `riuscita` (nessuna fallita), `parziale` (almeno una aggiornata e una fallita),
  `fallita` (nessuna aggiornata), `rifiutata` (catalogo non valido, con motivo); un errore di storico
  non cambia l'esito. `non completata` è gestita dal watchdog (S12).
- FR-102: ogni esecuzione lavora su una sola versione del catalogo, letta all'inizio, e ne registra il
  numero di località.
- FR-110: a fine esecuzione, le località fallite nel registro coincidono con chiavi e messaggi di
  `update_errors` di `/health` (dopo il ritardo di NFR-16), e `finished_at` con `generated_at`; vale per
  le esecuzioni su tutte le località (OQ-52: una singola non tocca `/health`).
- FR-111: un errore di scrittura del registro non impedisce né annulla cache e storico e non cambia
  `/health`; l'errore è solo nei log.

**Decisioni architetturali (ADR-0008)**
- Tabelle `job_runs` e `job_run_failures` (già create in S01). Scrittura: riga `running` all'avvio
  (dopo lettura e validazione del catalogo); a fine esecuzione una `batch()` che chiude la riga e
  inserisce i fallimenti. Catalogo non valido → riga chiusa subito con `outcome = 'rifiutata'` e
  `reject_reason`.
- `RunsWriter` iniettabile nel job (NFR-13): in test un finto che può fallire.
- `metrics` in JSON; i fallimenti in righe separate (limite 100 KB per istruzione).

**File probabili**: `worker/src/runs_store.ts` (nuovo), `worker/src/update.ts`, `worker/src/index.ts`
(passa `env.CORE`), `worker/src/types.ts`, test `worker/test/runs_store.test.ts`,
`worker/test/update_runs.test.ts`.

## Acceptance criteria
- **AC-1** — Given un'esecuzione con tutte le località aggiornate, when termina, then `job_runs` ha una
  riga `done` con `outcome = 'riuscita'`, `catalog_version`/`catalog_size` della versione letta,
  `updated_count = N`, `failed_count = 0`, `started_at`/`finished_at`/`duration_ms` valorizzati
  (FR-105, FR-106).
- **AC-2** — Given alcune località fallite, then `outcome = 'parziale'` e `job_run_failures` contiene
  una riga per slug con lo stesso messaggio di `errors[<slug>]`; tutte fallite → `fallita` (FR-106).
- **AC-3** — Given un catalogo non valido (campo mancante), then nessuna scrittura su KV/D1 storico e
  una riga `done` con `outcome = 'rifiutata'` e `reject_reason` (FR-2, FR-106).
- **AC-4** — Given un'esecuzione completata su tutte le località, then le chiavi/messaggi dei
  fallimenti nel registro coincidono con `update_errors` di `/health` e `finished_at` con
  `generated_at` (FR-110).
- **AC-5** — Given un `RunsWriter` che fallisce all'avvio o alla chiusura, then cache e storico sono
  scritti come senza errore, `/health` è invariato, e l'errore compare solo nei log (FR-111).
- **AC-6** — Given un'esecuzione con località non tentate per budget/interruttore, then compaiono in
  `job_run_failures` con `kind = 'not_attempted'` e il messaggio di FR-54 (FR-105).
- **AC-7** — Given una modifica del catalogo durante l'esecuzione, then il registro riporta la
  versione letta all'inizio e il numero di località di quella versione (FR-102).
- **AC-8** — `npm test` e `npm run typecheck` verdi; i test esistenti del job (parità, budget, storico)
  restano verdi senza modifiche alle fixture (FR-95).

## Tasks
- [x] Scrivere i test falliti (AC-1..AC-7) con `RunsWriter` reale su D1 e finto in errore
- [x] Implementare `runs_store.ts` (avvio, chiusura, fallimenti, lettura)
- [x] Integrare il registro nel job: versione catalogo, esiti, metriche, fallimenti (AC-1..AC-3, AC-6, AC-7)
- [x] Garantire che un errore del registro non propaghi (AC-5)
- [x] Eseguire `npm test` e `npm run typecheck` (AC-8)

## Dev notes
- **File**: `worker/src/runs_store.ts`, `worker/src/update.ts` (avvio, esito, fallimenti, `safeRun`),
  `worker/src/index.ts` (binding `CORE` e `catalogVersion`), test `runs_store.test.ts` e
  `update_runs.test.ts`.
- `finish` usa un'unica `batch()` (update + `json_each` per i fallimenti); un errore del registro è
  catturato e loggato (FR-111). `rifiutata` è scritta prima di rilanciare l'errore di catalogo.
- Conteggi per provider (Marine/Forecast) non separati dalle metriche attuali: colonne presenti ma
  `NULL`; da completare quando `UpdateMetrics` li esporrà.
- Verifica: `npm test`, `npm run typecheck`.

## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
### 2026-11-02 — verdict: done
AC-1..AC-8 coperti: esiti, fallimenti con messaggio, rifiuto per catalogo invalido, `catalog_version`
letto all'inizio, registro in errore non bloccante. Nessun blocker. R-1 (should): i conteggi
dell'interruttore per provider restano `NULL` finché `UpdateMetrics` non li separa.
