---
id: E02-S01
epic: E02
title: "Migrazione D1, binding HISTORY e verifica del supporto SQL in Miniflare"
type: feature
status: done
requirements: [FR-69, FR-81, NFR-12, NFR-13, NFR-24]
depends_on: []
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
---

# E02-S01: Migrazione D1, binding `HISTORY` e verifica del supporto SQL in Miniflare

## Context

Lo storico giornaliero è su Cloudflare D1 (decisione owner C-8, NFR-12). Questa storia prepara le
fondamenta: schema, binding, applicazione delle migrazioni nei test e **verifica che la D1 di
Miniflare del pool in uso supporti le funzionalità SQLite su cui si regge ADR-0002**. Se una
funzionalità non è supportata, la storia va in `blocked` con la descrizione (non si aggira
cambiando lo schema: serve l'architect).

**Requisiti**
- FR-69: «Il sistema shall conservare al massimo un record di storico per coppia (slug località,
  data Europe/Rome), con i valori del giorno 0 della previsione: `air_temperature_mean_c`,
  `air_temperature_min_c`, `air_temperature_max_c`, `water_temperature_mean_c`, `state`,
  `wave_height_mean_m`, `wave_height_max_m`.»
- FR-81: lo storico non modifica `/forecast`, `/health`, `/locations`; i test di parità esistenti
  restano verdi senza modifiche alle fixture.
- NFR-13: i test girano in locale senza account Cloudflare, con D1 locale/simulato.
- NFR-24: ~150-190 byte/riga; 500 località × 10 anni ≈ 280-350 MB.

**Decisioni di ADR-0002 §1** (schema esatto)
```sql
CREATE TABLE daily_history (
  location_slug            TEXT NOT NULL,
  date                     TEXT NOT NULL,   -- YYYY-MM-DD, fuso Europe/Rome
  air_temperature_mean_c   REAL,
  air_temperature_min_c    REAL,
  air_temperature_max_c    REAL,
  water_temperature_mean_c REAL,
  state                    TEXT,            -- etichetta FR-10 o NULL
  wave_height_mean_m       REAL,
  wave_height_max_m        REAL,
  PRIMARY KEY (location_slug, date)
) WITHOUT ROWID;
```
Nessuna colonna oltre FR-69, nessun indice secondario. Database `maestrale-history`, binding
`HISTORY`, `migrations_dir: "migrations"`.

**Funzionalità SQLite da verificare nella D1 di Miniflare** (architettura §9)
1. `WITHOUT ROWID` con PK composta.
2. `INSERT … SELECT … FROM json_each(?1) WHERE true ON CONFLICT (location_slug, date) DO UPDATE …`
   con `json_extract(value, '$.campo')` (un solo parametro JSON; JSON `null` → SQL `NULL`).
3. CTE con `ROW_NUMBER() OVER (PARTITION BY … ORDER BY COUNT(*) DESC, <CASE> DESC)` su `GROUP BY`
   (funzioni finestra) e `LEFT JOIN`.
4. `HISTORY.batch([...])` transazionale (rollback se un'istruzione fallisce) e, se esposto
   dall'ambiente, `meta.size_after` nel risultato.
5. API per applicare le migrazioni nel pool `@cloudflare/vitest-pool-workers` 0.23
   (`applyD1Migrations` / `readD1Migrations`): da usare in un file di setup di Vitest.

**File probabili**: `worker/migrations/0001_daily_history.sql` (nuovo), `worker/wrangler.jsonc`
(aggiunge `d1_databases`), `worker/vitest.config.ts` (+ file di setup, es.
`worker/test/setup/apply-migrations.ts`), `worker/src/env.ts` (aggiunge `HISTORY: D1Database` ai
`Bindings`; `HISTORY` resta tipizzato come presente, la sua assenza a runtime sarà gestita da
E02-S02/S03), `worker/worker-configuration.d.ts` se generato (`npm run cf-typegen` o equivalente
in `package.json`), nuovo test `worker/test/d1_support.test.ts`.

**Binding in `wrangler.jsonc`**: `d1_databases: [{ binding: "HISTORY", database_name:
"maestrale-history", database_id: "<id>", migrations_dir: "migrations" }]`. L'id reale si ottiene
con `wrangler d1 create maestrale-history --location=weur` (operazione dell'operatore, runbook in
E02-S05). Per i test in locale serve solo un id segnaposto valido sintatticamente (es.
`"00000000-0000-0000-0000-000000000000"`) con commento `TODO operatore: sostituire con l'id reale
dopo wrangler d1 create`; l'id non è un segreto. **Non** eseguire comandi `--remote`.

## Acceptance criteria

- **AC-1** — Given il file `worker/migrations/0001_daily_history.sql`, when è applicato alla D1 di
  Miniflare, then la tabella `daily_history` esiste con le 9 colonne di ADR-0002 §1, PK
  `(location_slug, date)` e `WITHOUT ROWID` (verificabile da `sqlite_master.sql`), e non esiste
  alcun indice secondario.
- **AC-2** — Given la tabella, when si inserisce due volte la stessa coppia (slug, data) con
  `INSERT … ON CONFLICT DO UPDATE`, then resta una sola riga con i valori dell'ultima scrittura
  (FR-69, upsert).
- **AC-3** — Given un array JSON di righe con valori numerici, stringhe e `null`, when si esegue
  l'upsert `INSERT … SELECT … FROM json_each(?1) WHERE true ON CONFLICT … DO UPDATE` con un solo
  parametro, then le righe sono scritte, il JSON `null` diventa SQL `NULL` e un numero (es.
  `0.42`, `21.3`) rilegge identico come `number` JS.
- **AC-4** — Given alcune righe con `state` diversi per mesi diversi, when si esegue la query con
  CTE, `GROUP BY substr(date,1,7)`, `ROW_NUMBER() OVER (PARTITION BY month ORDER BY COUNT(*) DESC,
  <CASE> DESC)` e `LEFT JOIN`, then la query è eseguita senza errori e restituisce una riga per mese
  (verifica del supporto delle funzioni finestra; la logica completa è in E02-S04).
- **AC-5** — Given un `HISTORY.batch()` con un'istruzione valida e una che fallisce (es. violazione
  `NOT NULL`), when è eseguito, then nessuna riga della prima istruzione resta scritta (transazione).
  Se `meta.size_after` è presente nel risultato, il test lo registra; la sua assenza non fa fallire
  il test ma è annotata nelle Dev notes.
- **AC-6** — Given `worker/wrangler.jsonc`, when il Worker è caricato dai test, then il binding
  `HISTORY` è risolto dalla stessa configurazione del deploy (non duplicato in `vitest.config.ts`) e
  le migrazioni di `worker/migrations/` sono applicate in un file di setup di Vitest prima di ogni
  file di test.
- **AC-7** — Tutti i test esistenti del Worker (`/forecast`, `/health`, `/locations`, job, parità
  FR-50/FR-51) restano verdi **senza modifiche alle fixture** (FR-81); `npm run typecheck` ha 0
  errori.

## Tasks

- [x] Scrivere `worker/test/d1_support.test.ts` e vederlo fallire (AC-1..AC-5): usa il binding
      `HISTORY` di `cloudflare:test`
- [x] Creare `worker/migrations/0001_daily_history.sql` con lo schema di ADR-0002 §1 (AC-1)
- [x] Aggiungere `d1_databases` a `worker/wrangler.jsonc` e `HISTORY: D1Database` ai `Bindings`
      (`worker/src/env.ts`); rigenerare i tipi se il progetto li genera (AC-6)
- [x] Aggiungere il file di setup che applica le migrazioni e collegarlo in
      `worker/vitest.config.ts` (AC-6)
- [x] Far passare AC-2..AC-5; se una funzionalità non è supportata: stop, `status: blocked`, Dev
      notes con errore e versione del pool
- [x] Eseguire i comandi di `verify` e controllare AC-7
- [x] Compilare Dev notes (supporto verificato, `meta.size_after` presente o no, API di migrazione
      usata)

## Dev notes
- Supporto verificato nella D1 di Miniflare (pool 0.23.0): `WITHOUT ROWID` con PK composta,
  `INSERT ... SELECT ... FROM json_each(?1) WHERE true ON CONFLICT DO UPDATE` (JSON null -> NULL,
  numeri identici), CTE con `ROW_NUMBER() OVER (PARTITION BY ...)` + `LEFT JOIN`, `batch()` con
  rollback. Nessun blocco.
- `meta.size_after` PRESENTE nel risultato di `batch()` (24576 nel test).
- API migrazioni: `readD1Migrations("./migrations")` in `vitest.config.ts` (Node), passate come
  binding Miniflare di sola prova `TEST_MIGRATIONS`; `applyD1Migrations(env.HISTORY, ...)` nel
  setup file `test/setup/apply-migrations.ts` (`test.setupFiles`). Il binding `HISTORY` resta
  solo in `wrangler.jsonc`.
- `database_id` segnaposto `0000...` con TODO operatore; nessun comando wrangler remoto.
- Tipi: `npm run cf-typegen` ha aggiunto `HISTORY: D1Database` a `worker-configuration.d.ts`;
  `Bindings` dichiara comunque `HISTORY` (come da storia).
- File: `worker/migrations/0001_daily_history.sql`, `worker/wrangler.jsonc`, `worker/vitest.config.ts`,
  `worker/test/setup/apply-migrations.ts`, `worker/src/env.ts`, `worker/worker-configuration.d.ts`,
  `worker/test/d1_support.test.ts` (5 test). Verifica: `npm test` 184/184 verdi (15 file),
  `npm run typecheck` 0 errori; fixture esistenti non modificate.

## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
<!-- Reviewer: date, verdict, findings R-1… (blocker/should/nit) with file:line. -->
### 2026-10-20 — verdict: done
Verify: `npm test` 184/184 (15 file), `npm run typecheck` 0 errori. AC-1..AC-7 coperti; schema
identico ad ADR-0002 §1; `HISTORY` solo in `wrangler.jsonc`; fixture non modificate; nessun comando
remoto né nuova dipendenza.
- **R-1** (nit) `worker/test/setup/apply-migrations.ts:1-7` — due `import` dallo stesso modulo e cast
  inline lungo `env as unknown as {...}`. Atteso: un solo import e tipizzazione di `TEST_MIGRATIONS`
  tramite augmentation di `Cloudflare.Env` (o `ProvidedEnv`) con `D1Migration[]`, riga entro la
  larghezza abituale.
- **R-2** (nit) `worker/test/d1_support.test.ts:66,79,91,109` — `all<any>()` unico uso di `any` nei test
  del Worker. Atteso: un tipo riga (`type HistoryRow = ReturnType<typeof row>` o simile), riusabile
  in E02-S02/S03.
- **R-3** (nit) `worker/test/d1_support.test.ts:147-148` — `meta.size_after` solo in `console.log`;
  dato che è presente (Dev notes) un `expect(typeof sizeAfter).toBe("number")` proteggerebbe la
  segnalazione `paid_alerts: d1_size` di ADR-0002 §5 (OQ-35) da regressioni del pool.
