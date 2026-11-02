---
id: ADR-0008
status: accepted     # proposed | accepted | superseded by ADR-XXXX
date: 2026-11-02
---

# ADR-0008: Registri delle esecuzioni e delle operazioni su D1

Allineato al PRD v0.7: registro di ogni esecuzione del job (FR-105..FR-112) e registro delle
operazioni di scrittura (FR-113), conservazione 90 giorni e 24 mesi (NFR-29, NFR-30), nessuna
modifica o cancellazione dal backoffice.

## Context
- **FR-105**: per ogni esecuzione — id, origine (`pianificata`/`su richiesta` con email), ambito
  (tutte / una località), inizio/fine/durata, esito, numero località della versione di catalogo,
  aggiornate, fallite con messaggio, non tentate per budget, interruttore con conteggi per provider,
  misure di NFR-21, record di storico scritti ed errori.
- **FR-106**: cinque esiti (riuscita, parziale, fallita, rifiutata, non completata); un errore di
  storico non cambia l'esito.
- **FR-107**: un'esecuzione interrotta compare come "non completata" entro la durata massima
  ammessa dal piano (NFR-15: 15 min).
- **FR-108/FR-109**: elenco paginato con filtri esito e date; dettaglio con i fallimenti ordinati
  per slug e nome corrente se ancora nel catalogo.
- **FR-110**: coerenza con `/health` per le esecuzioni su tutte le località (OQ-52).
- **FR-111**: un errore di scrittura del registro non blocca cache e storico, non cambia `/health`.
- **FR-112, NFR-30**: eliminazione automatica oltre 90 giorni.
- **FR-113, NFR-29**: registro operazioni con autore, istante, tipo, slug, valori prima/dopo e
  motivo; conservazione ≥ 24 mesi; non modificabile né cancellabile dal backoffice.
- **FR-115**: i rifiuti di "Esegui ora" sono registrati nel registro operazioni e non creano un
  registro di esecuzione.
- **NFR-31**: p95 < 1 s (proposta) per una pagina di elenco e un dettaglio con 500 fallimenti.
- Vincolo D1: 100 KB per istruzione, 100 parametri per query, 1.000 query per invocazione (Paid).

## Options
1. **Tabelle relazionali in `maestrale-core`, fallimenti in righe separate**
   - Pro: filtri e paginazione in SQL; nessun valore JSON vicino al limite di 100 KB per istruzione
     (500 fallimenti ≈ 100 KB in un solo valore); query di dettaglio per indice; retention con una
     `DELETE` per tabella.
   - Contro: più tabelle e join; la scrittura del registro è un `batch()` di più istruzioni.
2. **Un documento JSON per esecuzione (colonna `TEXT`)**
   - Pro: una riga per esecuzione, scrittura banale.
   - Contro: con 500 località fallite il documento supera i 100 KB per istruzione (limite D1) e non è
     filtrabile in SQL; la paginazione richiederebbe di leggere e scartare righe.
3. **Log della piattaforma + KV**
   - Pro: nessun database.
   - Contro: KV non è interrogabile per data/esito, non ha retention dichiarativa e non è
     consultabile da un elenco paginato; FR-112 richiederebbe un indice in KV mantenuto a mano.

## Decision
**Opzione 1.** Tabelle in `worker/migrations-core/`:

```sql
CREATE TABLE job_runs (
  id TEXT PRIMARY KEY,                 -- es. 20261102T083000Z-<6 hex>
  origin TEXT NOT NULL,                -- 'pianificata' | 'su-richiesta'
  scope TEXT NOT NULL,                 -- 'tutte' | 'singola'
  scope_slug TEXT,                     -- valorizzato se scope = 'singola'
  triggered_by TEXT,                   -- email Access, solo 'su-richiesta' (FR-105)
  status TEXT NOT NULL,                -- 'running' | 'done'
  started_at TEXT NOT NULL,            -- UTC ISO 8601
  finished_at TEXT,
  duration_ms INTEGER,
  outcome TEXT,                        -- FR-106, NULL finché status = 'running'
  reject_reason TEXT,                  -- esito 'rifiutata'
  catalog_version INTEGER NOT NULL,
  catalog_size INTEGER NOT NULL,       -- località della versione usata (FR-102)
  updated_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  not_attempted_count INTEGER NOT NULL DEFAULT 0,
  breaker INTEGER NOT NULL DEFAULT 0,  -- FR-54
  breaker_blocks_failed INTEGER,
  breaker_blocks_total INTEGER,
  marine_blocks_failed INTEGER,
  marine_blocks_total INTEGER,
  forecast_blocks_failed INTEGER,
  forecast_blocks_total INTEGER,
  metrics TEXT,                        -- JSON NFR-21
  history_rows INTEGER,
  history_error TEXT
);
CREATE INDEX job_runs_started_at ON job_runs(started_at DESC);

CREATE TABLE job_run_failures (
  run_id TEXT NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  message TEXT NOT NULL,               -- stesso testo di errors[<slug>] (FR-18)
  kind TEXT NOT NULL,                  -- 'failed' | 'not_attempted'
  PRIMARY KEY (run_id, slug)
);

CREATE TABLE admin_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,                    -- UTC ISO 8601
  admin_email TEXT NOT NULL,           -- da Cloudflare Access (OQ-51)
  action TEXT NOT NULL,                -- 'add'|'update'|'deactivate'|'reactivate'|'run'|'run_rejected'
  slug TEXT,
  before_json TEXT,                    -- valori precedenti (FR-113)
  after_json TEXT,                     -- valori successivi
  reason TEXT,                         -- motivo del rifiuto/conflitto
  outcome TEXT                         -- 'ok' | 'rejected'
);
CREATE INDEX admin_actions_at ON admin_actions(at DESC);
CREATE INDEX admin_actions_slug ON admin_actions(slug);
```

- **Scrittura del registro di esecuzione**: il job legge e valida il catalogo per primo; se non è
  valido inserisce subito una riga chiusa con `outcome = 'rifiutata'` e `reject_reason` (FR-2,
  FR-106), senza scrivere cache né storico. Altrimenti inserisce la riga con `status = 'running'` e i
  dati di catalogo, e alla fine la aggiorna e inserisce i fallimenti in un unico `db.batch()`. Un errore del registro è catturato, loggato (`console.error`) e **non**
  propaga (FR-111): cache, storico e `/health` restano invariati.
- **Esecuzione non completata (FR-107)**: se la riga resta `running` oltre
  `JOB_MAX_DURATION_SECONDS + 60` (default 960 s), il cron di dispatch la chiude con
  `outcome = 'non_completata'` e `finished_at` = ultimo istante noto. Il dettaglio mostra ciò che era
  stato registrato.
- **Retention (FR-112, NFR-30)**: lo stesso cron elimina `job_runs` più vecchie di
  `RUN_RETENTION_DAYS` (default 90; i fallimenti seguono per `ON DELETE CASCADE`) e `admin_actions`
  più vecchie di `ACTIONS_RETENTION_DAYS` (default 730 = 24 mesi). Il backoffice non espone né
  modifiche né cancellazioni.
- **Dettaglio**: l'elenco delle fallite unisce `job_run_failures` con `locations` per il nome
  corrente (`LEFT JOIN`, nome assente se la voce non è più nel catalogo) e ordina per `slug`
  (FR-109).
- **Elenco**: `WHERE` sui filtri (esito, da/a) + `ORDER BY started_at DESC LIMIT 20 OFFSET n`;
  conteggio totale per la paginazione.
- **Registro operazioni**: inserito nella stessa `batch()` della modifica di catalogo (FR-113), così
  che non esista una modifica senza voce; i tentativi rifiutati (validazione, conflitto) scrivono una
  riga con `outcome = 'rejected'` e `reason`, senza modificare il catalogo.

## Consequences
- **Più semplice**: filtri e paginazione in SQL; nessun rischio del limite di 100 KB; retention
  dichiarativa; il registro operazioni è ricostruibile e immutabile per costruzione (nessun endpoint
  di modifica).
- **Più difficile**: ogni esecuzione costa 1 `INSERT` + 1 `batch()` (registro) in più nel budget di
  subrequest del job (NFR-32: < 2 s nominale, da misurare); due tabelle da migrare e testare; il
  watchdog va testato con clock iniettato.
- **Rischio residuo**: un'esecuzione interrotta prima della prima scrittura non lascia traccia; il
  caso è coperto solo se la riga `running` è stata inserita all'avvio (è la prima operazione del job,
  dopo la lettura del catalogo).
