---
id: ADR-0009
status: accepted     # proposed | accepted | superseded by ADR-XXXX
date: 2026-11-02
---

# ADR-0009: "Esegui ora" asincrono con richieste in D1 e dispatcher a cron ogni minuto

Allineato al PRD v0.7: l'amministratore avvia un'esecuzione del job su tutte le località o su una
sola (FR-114), con rifiuto se un'esecuzione è in corso o se sono passati meno di 15 minuti
dall'ultima su richiesta (FR-115); l'esecuzione si comporta come una pianificata (FR-116); su una
sola località non tocca `/health` (OQ-52, FR-110).

## Context
- **FR-114..FR-116**: avvio previa conferma, ambito, comportamento identico a un'esecuzione
  pianificata, registrazione con origine e identità.
- **FR-115**: rifiuto motivato se un'esecuzione è in corso o se l'ultima su richiesta è più recente
  di 15 min (configurabile, mai sotto 15); il rifiuto va nel registro operazioni e non crea un
  registro di esecuzione.
- **NFR-15**: un'esecuzione può durare fino a 15 min sul piano Paid; una richiesta HTTP del browser
  non può restare aperta per quel tempo.
- **NFR-31**: la conferma di avvio deve rispondere in p95 < 1 s.
- **FR-49**: il job pianificato gira ogni 6 h (`30 0,6,12,18 * * *`); un'esecuzione su richiesta può
  sovrapporsi a una pianificata.
- **FR-102**: ogni esecuzione usa una sola versione del catalogo, letta all'inizio.
- Il Worker ha già un handler `scheduled` e il pattern "esiti come valori, mai eccezioni".

## Options
1. **Service binding sincrono** (il Worker admin chiama il Worker pubblico e attende)
   - Pro: nessun nuovo stato.
   - Contro: la richiesta del browser resterebbe aperta fino a 15 min; `waitUntil` non copre un job
     così lungo; il callee è legato al ciclo di vita della richiesta del chiamante.
2. **Cloudflare Queues** (messaggio "esegui", consumer sul Worker)
   - Pro: disaccoppiamento naturale, retry.
   - Contro: nuova primitiva e nuovo costo; il non-goal v0.3 esclude il fan-out via Queues finché la
     misura di NFR-21 non ne dimostra la necessità.
3. **Durable Object con alarm**
   - Pro: un solo punto di serializzazione, timer preciso.
   - Contro: nuova primitiva, più codice e test; il lock può stare in D1.
4. **Riga di richiesta in D1 + cron ogni minuto che dispaccia**
   - Pro: usa ciò che esiste (D1, handler `scheduled`); risposta immediata al browser; il ritardo di
     avvio è ≤ 60 s e va dichiarato all'utente; il lock e gli stati sono ispezionabili.
   - Contro: un cron ogni minuto (1.440 invocazioni/giorno, costo trascurabile sul piano Paid).

## Decision
**Opzione 4.** Il cron `* * * * *` sul Worker pubblico è il **dispatcher**.

```sql
CREATE TABLE run_requests (
  id TEXT PRIMARY KEY,
  requested_at TEXT NOT NULL,
  admin_email TEXT NOT NULL,
  scope TEXT NOT NULL,                 -- 'tutte' | 'singola'
  slug TEXT,
  status TEXT NOT NULL DEFAULT 'pending'  -- 'pending' | 'claimed' | 'done'
);

CREATE TABLE job_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  run_id TEXT,
  lease_until TEXT NOT NULL            -- UTC ISO 8601; nel passato = libero
);
-- La migrazione inserisce la riga unica: INSERT INTO job_lock (id, lease_until)
-- VALUES (1, '1970-01-01T00:00:00Z').
```

- **Accettazione** (Worker admin, `POST /esegui`): una sola istruzione atomica
  `INSERT INTO run_requests … SELECT … WHERE NOT EXISTS (richiesta pending/claimed) AND NOT EXISTS
  (lock attivo) AND (ultima su richiesta < 15 min)`; se inserisce 0 righe il motivo si ricava da una
  lettura successiva (richiesta o esecuzione in corso / intervallo non rispettato) e si scrive una
  voce `admin_actions` con `action = 'run_rejected'` e `outcome = 'rejected'` (FR-113, FR-115).
  Nessuna riga in `job_runs`. Risposta `303` alla pagina esecuzioni con il messaggio di rifiuto o
  "Esecuzione richiesta: partirà entro un minuto".
- **Dispatch** (cron ogni minuto, handler `scheduled` con `event.cron === "* * * * *"`):
  1. **riparazione cache catalogo** (ADR-0006): confronta `catalog_meta.version` con la chiave KV e
     ricostruisce se serve;
  2. **watchdog** (FR-107): chiude come `non_completata` le esecuzioni `running` oltre la durata
     massima;
  3. **retention** (FR-112, NFR-30): elimina registri oltre 90 giorni e operazioni oltre 24 mesi;
  4. **claim**: se `job_lock` è libero e c'è una richiesta `pending`, la marca `claimed`, acquisisce
     il lease (`JOB_MAX_DURATION_SECONDS + 120` s) ed esegue il job con l'ambito richiesto; al
     termine rilascia il lease.
- **Esecuzione**: riusa `runUpdate` con `scope` e registra il run in `job_runs` (origine
  `su-richiesta`, `triggered_by` = email, ambito e slug); se allo start la località richiesta non è
  più attiva (disattivata nel frattempo) il run è chiuso come `rifiutata` con il motivo. La richiesta
  passa a `done` al termine. Con `scope = 'singola'` aggiorna solo
  quella località e **non** scrive `meta`: `/health` resta invariato (OQ-52). Con `scope = 'tutte'`
  si comporta esattamente come la pianificata, `meta` compreso (FR-110).
- **Concorrenza con il cron delle 6 h**: anche la pianificata acquisisce lo stesso lease; se è
  occupato, salta l'esecuzione e lo registra nel log (scelta dell'architect, FR-115). Non si
  accodano esecuzioni pianificate.
- **Intervallo minimo**: `MIN_ON_DEMAND_INTERVAL_SECONDS` (default 900, minimo 900) valutato su
  `job_runs.started_at` delle esecuzioni `su-richiesta`; un'esecuzione rifiutata non lo consuma.
- **Configurazione**: `RUN_DISPATCH_ENABLED` (default `true`, per disattivare il cron durante i test
  di parità), `JOB_MAX_DURATION_SECONDS` (default 900).

## Consequences
- **Più semplice**: nessuna nuova primitiva; la richiesta risponde subito (NFR-31); lo stato è
  visibile nel registro esecuzioni; il lock è testabile con clock e D1 di Miniflare.
- **Più difficile**: l'avvio non è immediato (≤ 60 s) e va comunicato nell'interfaccia; un cron al
  minuto va monitorato (costo e log); se il dispatcher non gira (cron disabilitato) le richieste
  restano `pending` e vanno mostrate come tali.
- **Rischio residuo**: due Worker scrivono su `job_lock` (admin per la verifica, pubblico per il
  lease): la verifica in fase di accettazione è ottimistica, ma il claim atomico del dispatcher
  impedisce due esecuzioni contemporanee.
