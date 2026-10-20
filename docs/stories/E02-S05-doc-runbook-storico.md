---
id: E02-S05
epic: E02
title: "Documentazione API, README e runbook dello storico (setup D1, attivazione, d1_size)"
type: feature
status: done
requirements: [FR-82, FR-52, NFR-15, NFR-18, NFR-24]
depends_on: [E02-S02, E02-S04]
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
  - grep -n "previsioni del giorno" README.md
---

# E02-S05: Documentazione API, README e runbook dello storico

## Context

Storia solo di documentazione (nessun cambio di codice sotto `worker/src`): rende operabile e
corretta per i client la funzionalità costruita in E02-S01..S04.

**Requisito (testo esatto)** — FR-82: «La documentazione dell'API per i client (README e, se
mantenuta, FR-29) shall dichiarare che i valori di `/history` sono **previsioni del giorno stesso**
(giorno 0, ultima esecuzione riuscita del giorno), non misure osservate, e che lo storico parte
dalla data di attivazione senza backfill.» FR-29 (`/docs`) è escluso dal Worker (architettura §5):
vale solo il README.

**Stato dei file**: `README.md` ha le sezioni "Backend" (riga ~55), "Deploy" (~72), "App Flutter",
"Test"; `docs/runbook.md` ha "Deploy", "Cron", "Osservabilità", "Limiti piano Free e misure",
"Regola go/no-go per Paid", "Rollback". Aggiungere sezioni, non riscrivere quelle esistenti.

**Procedura di rilascio dello storico** (architettura §6 "Rilascio", ADR-0002 §1), da riportare nel
runbook con i comandi esatti:
1. `cd worker && npx wrangler d1 create maestrale-history --location=weur` (primario in Europa
   occidentale).
2. Copiare il `database_id` stampato in `worker/wrangler.jsonc` (blocco `d1_databases`, binding
   `HISTORY`, `migrations_dir: "migrations"`); l'id non è un segreto.
3. `npx wrangler d1 migrations apply maestrale-history --remote` **prima** del deploy del Worker
   che usa lo storico. Verifica: `npx wrangler d1 execute maestrale-history --remote --command
   "SELECT name FROM sqlite_master WHERE type='table'"` mostra `daily_history`.
4. Deploy del Worker. La **data del primo deploy con lo storico è la data di attivazione**: annotarla
   nel README (`<data>` da compilare dall'operatore al rilascio) e nel runbook.
5. Dopo il primo cron: `SELECT COUNT(*) FROM daily_history` (= numero di località aggiornate) e log
   `forecast_update` con `history_rows`, `history_failed: 0`.
Nota: un deploy **prima** delle migrazioni non rompe il cache (errore storico nel log,
`/history` risponde 503).

**Cosa documentare nel runbook (osservabilità)**: campi del log `forecast_update` per lo storico
(`history_date`, `history_rows`, `history_queries`, `history_failed`, `history_error`,
`history_missing_day0`, `d1_rows_written`, `d1_size_bytes`); `paid_alerts: d1_size` quando la
dimensione supera `PAID_ALERT_D1_SIZE_MB` (default 350 MB, 70% dei 500 MB Free) e cosa fare (valutare
il piano Paid, 10 GB; NFR-24: 500 località × 10 anni ≈ 280-350 MB; 13 località ≈ 8 MB in 10 anni);
come leggere la dimensione con `wrangler d1 info maestrale-history`; nuove variabili di
configurazione e default (`HISTORY_WRITE_BATCH_ROWS` 100, `HISTORY_MAX_AGE_SHORT_SECONDS` 900,
`HISTORY_MAX_AGE_LONG_SECONDS` 86400, `PAID_ALERT_D1_SIZE_MB` 350); la formula di subrequest
aggiornata `2·⌈N/50⌉ + N + 2 + ⌈N/100⌉` (18 nominali con 13 località; soglia (b) ≈ 35 località);
rollback: tornare a una versione senza storico non tocca D1, i giorni del rollback mancano (nessun
backfill); conservazione: il job non cancella righe, slug rimosso → 404, slug rinominato riparte da
zero (OQ-36).

**Cosa documentare nel README** (sezione "Storico (`GET /history`)"): parametri
(`localita`, `from`, `to`, `granularity` = `day` default | `month`), limiti (366 giorni / 120 mesi),
formato della risposta con un esempio `day` e uno `month` (ADR-0002 §3), codici 200/404/422/503,
`Cache-Control` (15 min se `to` ≥ oggi Europe/Rome, 24 h altrimenti), **«previsioni del giorno
stesso (giorno 0, ultima esecuzione riuscita del giorno), non misure osservate»**, «lo storico parte
dalla data di attivazione, senza backfill», moda dello stato del mare e pareggio verso lo stato più
alto della scala Douglas, mesi parziali rivelati da `days`, `null` ignorati nelle medie. Aggiornare
anche "Struttura del progetto" con `worker/migrations/` e "Test" se necessario.

## Acceptance criteria

- **AC-1** — Given `README.md`, when letto, then contiene una sezione su `/history` con parametri,
  limiti, esempi `day` e `month`, errori, `Cache-Control` e le due dichiarazioni di FR-82
  (previsioni del giorno stesso/non misure; nessun backfill dalla data di attivazione).
- **AC-2** — Given `docs/runbook.md`, when letto, then contiene la procedura di rilascio dello
  storico (create → id in `wrangler.jsonc` → `migrations apply --remote` → deploy → verifica) con i
  comandi esatti, l'ordine "migrazioni prima del deploy" e l'effetto di un deploy anticipato.
- **AC-3** — Given il runbook, then documenta i campi di log dello storico, l'allarme `d1_size` con
  soglia e azione, le nuove variabili con i default, la formula di subrequest aggiornata,
  rollback e conservazione (OQ-36).
- **AC-4** — I nomi di variabili, campi di log, default e comandi citati nei documenti coincidono
  con il codice implementato da E02-S01..S04 (verifica incrociata con `grep` in `worker/src` e
  `worker/wrangler.jsonc`; eventuali discrepanze corrette nei **documenti**, e segnalate nelle Dev
  notes se è il codice a divergere dall'ADR).
- **AC-5** — Nessun file sotto `worker/src` o `worker/test` modificato; `npm test` e `npm run
  typecheck` restano verdi.

## Tasks

- [x] Verificare con `grep` nomi di variabili e campi di log effettivi in `worker/src` (AC-4)
- [x] Scrivere la sezione `/history` del `README.md` (AC-1)
- [x] Scrivere le sezioni di `docs/runbook.md`: rilascio dello storico, osservabilità D1,
      configurazione, rollback/conservazione (AC-2, AC-3)
- [x] Controllare i link/riferimenti incrociati e lasciare `<data di attivazione>` come segnaposto
      esplicito da compilare al rilascio
- [x] Eseguire i comandi di `verify` (AC-5)
- [x] Compilare Dev notes

## Dev notes
Modificati solo `README.md` (sezione `/history`, endpoint, struttura) e `docs/runbook.md` (variabili,
sezione "Storico giornaliero su D1"). Nessun file in `worker/src` o `worker/test`.
- AC-4: nomi verificati con grep (variabili in `config.ts`, campi log in `update.ts`/`index.ts`,
  `d1_size` in `update.ts`). Il codice coincide con l'ADR. Nota: la soglia `PAID_ALERT_D1_SIZE_MB` e' in
  MiB (x 1024 x 1024 byte), documentato. `wrangler.jsonc` ha `database_id` segnaposto di zeri.
- `<data di attivazione>` lasciata come segnaposto in README e runbook. Esempi `month` del README sono illustrativi.
- Verifica: vedi Run log sotto.

## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
<!-- Reviewer: date, verdict, findings R-1… (blocker/should/nit) with file:line. -->
### 2026-10-20 — verdict: done
Verify: `npm test` 22 file / 284 test verdi, `npm run typecheck` pulito, grep "previsioni del giorno"
trovato (README.md:72). Incrocio con codice: variabili e default (`config.ts:43-44,123-124`), campi log
(`index.ts:110-117`), `d1_size` in MiB (`update.ts:547`), 366/120 (`history.ts:59-60`), 422/404/503 e
`Cache-Control` solo sulla 200 (`routes/history.ts:22-41`), blocco `d1_databases` (`wrangler.jsonc:29-38`)
coerenti con README, runbook e ADR-0002. Nessun file `worker/src`/`worker/test` attribuibile a questa storia.
- **R-1** (should) `docs/runbook.md:177` — "sostituisce la stima di ~36 sopra", ma i ~36 sono *sotto*
  e restano non aggiornati (`docs/runbook.md:237-238` "circa 36 località", `:255` "oltre ~36 località";
  `:234` "17 subrequest nominali"). Correggere il riferimento e aggiornare quelle righe a ~35 / 18
  (o rimandare esplicitamente alla sezione storico).
- **R-2** (nit) `README.md:129-135` rimanda a `worker/README.md` per i passi manuali di deploy, che non
  citano D1 (create / migrations apply prima del deploy). Aggiungere lì un rimando a
  `docs/runbook.md` "Rilascio dello storico".
