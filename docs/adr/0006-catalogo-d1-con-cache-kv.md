---
id: ADR-0006
status: accepted     # proposed | accepted | superseded by ADR-XXXX
date: 2026-11-02
---

# ADR-0006: Catalogo località su D1 con cache su KV e seed una tantum

Allineato al PRD v0.7: il catalogo è nel database letto tramite cache (OQ-45 risolta, FR-61,
NFR-33) e `locations.json` è solo il seed iniziale (FR-104). Sostituisce ADR-0004 per la fonte del
catalogo; l'endpoint `GET /locations` (FR-62/FR-63) resta invariato nel contratto.

## Context
- **FR-61, FR-101**: una sola fonte per job, `/forecast`, `/history` e `/locations`; una modifica
  salvata dal backoffice è effettiva **subito** (entro NFR-33, proposta 60 s), senza deploy.
- **FR-98, FR-103**: validazione per campo e controllo delle modifiche concorrenti con rifiuto, non
  sovrascrittura.
- **FR-100, FR-119**: la rimozione è una disattivazione; la voce e il suo storico restano.
- **FR-104**: al primo rilascio il catalogo contiene esattamente le 13 voci di `locations.json`,
  migrazione eseguita una sola volta.
- **FR-57, NFR-19**: `/forecast` a costo costante, ≤ 2 letture storage per richiesta API; `/locations`
  non deve leggere il database a ogni richiesta.
- **FR-120**: cache assente **e** database irraggiungibile → 503, nessun catalogo di ripiego.
- **FR-65**: lo snapshot dell'app deriva dal database (ADR-0010).
- Oggi `worker/src/catalog.ts` importa `locations.json` nel bundle e memoizza per isolate.

## Options
1. **D1 `maestrale-core` + cache KV `catalog:current` + memo per isolate (TTL)**
   - Pro: D1 è già in uso nel progetto (storico) e ha transazioni e concorrenza ottimistica; la KV
     assorbe le letture (1 `get` per richiesta, 2 per `/forecast` con il record della località);
     invalidazione esplicita al salvataggio; ETag calcolabile una volta; il pattern è lo stesso del
     cache previsioni di ADR-0003.
   - Contro: due storage da tenere allineati; KV a consistenza eventuale (fino a ~60 s in altre
     regioni); serve un meccanismo di riparazione se la `put` fallisce.
2. **D1 letto a ogni richiesta (senza cache)**
   - Pro: una sola fonte, nessuna incoerenza.
   - Contro: 1 query D1 per ogni `/locations`/`/forecast`/`/history`: viola NFR-19 (≤ 2 letture
     storage) e NFR-4 (p95 < 200 ms), e mette il database sul percorso critico dell'API pubblica.
3. **Solo KV, con il backoffice che scrive direttamente la chiave**
   - Pro: 1 lettura, nessun database sul percorso.
   - Contro: KV non è transazionale: due admin concorrenti (FR-103) non hanno un modo affidabile di
     confrontare la versione; niente storico delle modifiche né backup strutturato (FR-121).
4. **Durable Object come autorità del catalogo**
   - Pro: serializzazione naturale delle scritture, cache in memoria.
   - Contro: nuova primitiva da gestire e testare, costo e complessità non giustificati da 1–3
     amministratori e poche modifiche al giorno.

## Decision
**Opzione 1.** Database **D1 `maestrale-core`** (binding `CORE`, primario `weur`), distinto da
`maestrale-history`, per isolare i dati di amministrazione dallo storico (NFR-28). Tabelle in
`worker/migrations-core/`:

```sql
CREATE TABLE catalog_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,          -- contatore globale, incrementato a ogni scrittura
  updated_at TEXT NOT NULL           -- UTC ISO 8601
);

CREATE TABLE locations (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, -- 1 attiva, 0 disattivata (FR-100)
  version INTEGER NOT NULL,          -- versione della riga, per FR-103
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;
```

- **Scrittura** (`admin` Worker): una `db.batch()` (transazionale) con (a) `UPDATE … WHERE slug = ?
  AND version = ?` oppure `INSERT` per una nuova località, (b) l'incremento di `catalog_meta.version`,
  (c) una riga in `admin_actions` (FR-113). (b) e (c) sono condizionati con `changes()` di SQLite
  all'esito di (a): se l'UPDATE non modifica righe, `catalog_meta` non avanza e **nessuna** voce di
  registro viene scritta, così un conflitto (FR-103) non produce effetti parziali; il Worker risponde
  409 "La località è stata modificata nel frattempo: ricarica la voce". Dopo il commit il Worker
  ricostruisce il catalogo attivo e fa `put` della chiave KV.
- **Chiave KV** `catalog:current` (namespace `FORECASTS`), valore:
  `{ schema_version: 1, catalog_version: <n>, etag: "<16 hex>", locations: [{slug, name, latitude, longitude}] }`
  con le sole località **attive**, ordinate per `name`. `etag` = SHA-256 del corpo canonico di
  `/locations`, calcolato al momento della scrittura, così FR-63 resta "cambia se e solo se cambia il
  contenuto" anche per un salvataggio senza variazioni (che non incrementa `catalog_version`).
- **Lettura** (`src/catalog.ts`, unico punto): memo per isolate con TTL 30 s → `get` di
  `catalog:current` → su miss lettura D1 (`WHERE active = 1 ORDER BY name`) e `put` best-effort →
  risposta. Errore di KV e di D1 → `unavailable` → 503 (FR-120). La memo di 30 s è sotto il target di
  60 s di NFR-33.
- **Riparazione**: il cron di dispatch (ADR-0009, ogni minuto) confronta `catalog_meta.version` con
  `catalog:current.catalog_version` e ricostruisce la chiave se differiscono. Se la `put` KV fallisce
  durante un salvataggio, il backoffice mostra un avviso ("Salvata; la cache sarà aggiornata entro un
  minuto") e il cron ripara: nessun salvataggio perso, FR-101 rispettato entro ~60 s.
- **Disattivazione e riattivazione** (FR-100, FR-119): la disattivazione mette `active = 0` senza
  toccare la chiave `forecast:<slug>`; la riattivazione la **elimina**, così `/forecast` risponde 503
  "Previsioni non ancora disponibili" fino al primo aggiornamento riuscito invece di servire la
  previsione precedente (OQ-53).
- **Seed** (FR-104): `scripts/seed_catalog.mjs` legge `locations.json` e genera
  `worker/migrations-core/0002_seed_locations.sql` (tutte attive, `version = 1`, `catalog_meta.version = 1`);
  eseguito **una volta** con `wrangler d1 migrations apply maestrale-core --remote`. Dopo il seed
  `locations.json` non è più letto da job, API o backoffice: un test lo verifica (il bundle non
  contiene più il file).
- **Validazione** (FR-98) in `src/catalog_validation.ts`, funzione pura condivisa da backoffice e test:
  campi obbligatori; `slug` = `slugify(slug)` e unico su **tutte** le voci (attive e disattivate);
  `name` non vuoto e normalizzato diverso da ogni altro slug/nome normalizzato; coordinate nei limiti
  `CATALOG_AREA_MIN_LAT/LON` e `CATALOG_AREA_MAX_LAT/LON` (default 38,5/7,5/41,5/10,2, verificati in
  `wrangler.admin.jsonc` e nel codice); avviso (non blocco) oltre `CATALOG_MAX_LOCATIONS` (500).
- **`GET /locations`**: identico nel contratto (FR-62/FR-63); cambia solo la sorgente (KV invece del
  bundle) e il fatto che l'ETag è calcolato alla scrittura. Nessuna lettura D1 sul percorso caldo.

## Consequences
- **Più semplice**: modifiche senza deploy (FR-101); `/locations` e `/forecast` restano a 1–2 letture
  storage; il database è la fonte di verità e il backup (FR-121) è un normale export D1.
- **Più difficile**: coerenza D1→KV da presidiare (riparazione a cron); un secondo database da
  creare e migrare; i test devono applicare due set di migrazioni (Miniflare); `locations.json`
  resta nel repository solo come seed e va tenuto allineato alla migrazione generata.
- **Rischio residuo**: durante un guasto di KV e D1 insieme l'API risponde 503 (FR-120, accettato);
  con KV sana e D1 giù il servizio continua (FR-120).
