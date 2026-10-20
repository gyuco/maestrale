---
id: ADR-0004
status: accepted     # proposed | accepted | superseded by ADR-XXXX
date: 2026-10-20
---

# ADR-0004: Catalogo località come file versionato incluso nel Worker ed endpoint `GET /locations`

Allineato al PRD v0.4: la fonte del catalogo è decisa dall'owner (OQ-25 risolta, C-6: file
versionato `locations.json`), così come lo snapshot nell'app (OQ-26 risolta). Coordinato con
ADR-0003 (layout del cache) e ADR-0005 (app).

## Context
- **FR-61**: una sola fonte del catalogo per job, risoluzione di `/forecast` (FR-22) e
  `GET /locations`; aggiungere/rimuovere/rinominare una località = una modifica in un solo punto,
  senza toccare il codice dell'app. **R-1**: oggi il catalogo è duplicato fra `locations.json` e
  `app/lib/models/coastal_location.dart`.
- **FR-1, FR-2**: voci con `slug`, `name`, `latitude`, `longitude`; il job rifiuta un catalogo con
  campi mancanti. Fino a ~500 voci (NFR-19).
- **FR-57, NFR-19**: `/forecast` a costo costante, ≤ 2 letture storage per richiesta.
- **FR-62, FR-63, FR-64**: `GET /locations` (sola lettura, `GET`/`HEAD`/preflight, CORS di FR-28,
  nessuna chiamata ai provider), ordinato per `name`, `Cache-Control` pubblico configurabile
  (proposta 24 h), `ETag` che cambia se e solo se cambia il contenuto, 304 su `If-None-Match`;
  `/forecast` e `/health` invariati. NFR-19 proposto: risposta < 100 KB non compressa con 500 voci.
- **NFR-11**: nessun endpoint pubblico di scrittura.
- **A-1**: il catalogo cambia raramente e a mano.
- Oggi `worker/src/index.ts` importa già `../../locations.json` nel bundle (limite bundle 64 MiB non
  compressi: 500 voci ≈ 40 KB, irrilevante).
- **FR-65, C-6** (ADR-0005): l'app include uno snapshot del catalogo, che deve derivare dalla stessa
  fonte.
- **NFR-15, C-5**: l'aggiunta di località è soggetta alla regola go/no-go per il piano Paid.

## Options
1. **File versionato `locations.json` nel repository, incluso nel bundle del Worker**
   - Pro: già così oggi; storico, revisione e rollback via git; 0 letture storage per risolvere il
     nome (FR-57) e per servire `/locations`; `ETag` calcolabile una volta per isolate dal contenuto;
     validabile nei test prima del deploy; lo snapshot dell'app si genera dallo stesso file;
     nessuna superficie di scrittura (NFR-11).
   - Contro: ogni modifica richiede commit + `wrangler deploy` (accettabile con A-1); l'operatore
     deve saper fare un deploy.
2. **Tabella D1 `locations`**
   - Pro: modifica senza deploy; se ADR-0003 scegliesse D1, catalogo e cache nella stessa base.
   - Contro: +1 query D1 per ogni `/forecast` (risoluzione) e per `/locations`; serve uno strumento
     di modifica protetto (`wrangler d1 execute` con credenziali dell'account, oppure un endpoint
     autenticato che contraddice NFR-11); nessuno storico/revisione salvo progettarlo; `ETag` da
     gestire con una colonna di versione; validazione FR-2 solo a runtime; lo snapshot dell'app
     andrebbe esportato dalla base; ADR-0003 sceglie KV, quindi D1 entrerebbe solo per il catalogo.
3. **Chiave KV `catalog`** — modifica senza deploy via `wrangler kv`, ma stessi contro di D1 sullo
   storico e una lettura in più per richiesta; nessun vantaggio sul file.

## Decision
**Opzione 1** (decisione owner, OQ-25/C-6). Il file `locations.json` alla radice del repository
resta l'**unica fonte modificata a mano**.

- **Modulo `worker/src/catalog.ts`** (unico accesso al catalogo nel Worker): importa il file, lo valida
  una volta per isolate e espone `catalog()` (voci validate), `resolve(localita) → slug | null`
  (slug esatto, poi `slugify(name)`, come FR-22) e `locationsBody()` + `etag()` (memoizzati).
  Lo usano job (`update.ts`), `/forecast` e `/locations`.
- **Validazione**: a runtime FR-2 invariato (campi mancanti → il job rifiuta l'esecuzione). In più,
  un **test del Worker sul file reale** fallisce se: slug duplicati, nomi che normalizzati
  collidono fra loro o con uno slug altrui, `slug` non uguale a `slugify(slug)`, coordinate fuori
  intervallo, nome più lungo di 60 caratteri. Così l'errore emerge prima del deploy, senza cambiare
  il comportamento a runtime richiesto da FR-2.
- **`GET /locations`** (route `worker/src/routes/locations.ts`):
  - corpo 200:
    ```json
    { "schema_version": 1, "version": "<etag senza virgolette>", "count": 13,
      "locations": [ { "slug": "alghero", "name": "Alghero", "latitude": 40.56, "longitude": 8.26 } ] }
    ```
    `locations` ordinate per `name` (confronto per code unit, come `sorted()` di Python e
    `Array.prototype.sort` di default; parità a pari input). 500 voci ≈ 40 KB (< 100 KB, NFR-19).
  - `ETag` forte = `"` + primi 16 caratteri esadecimali di SHA-256 del corpo serializzato `"`,
    calcolato con `crypto.subtle` alla prima richiesta dell'isolate (cambia se e solo se cambia il
    contenuto servito, FR-63; `version` lo ripete nel corpo per i client che non vedono gli header).
  - `Cache-Control: public, max-age=<LOCATIONS_MAX_AGE_SECONDS>` (variabile d'ambiente, default
    `86400`; proposta 24 h di FR-63, OQ-13).
  - `If-None-Match` uguale all'ETag corrente (anche in lista o con prefisso `W/`) → **304** senza
    corpo, con `ETag` e `Cache-Control`.
  - `HEAD` gestito da Hono tramite la route `GET` (stessi header, senza corpo).
  - CORS: stesso middleware di FR-28, `allowMethods` resta `["GET"]` (`HEAD` è un metodo semplice e
    non richiede preflight; lasciare la lista invariata evita di cambiare le preflight di
    `/forecast`, FR-64). Solo su questa route si aggiunge `Access-Control-Expose-Headers: ETag`, per i
    client web.
  - Nessuna lettura KV, nessuna chiamata ai provider.
- **Snapshot per l'app** (FR-65, C-6, ADR-0005): `app/assets/locations.json` è **generato**
  da `locations.json` con uno script (`scripts/sync_app_catalog.mjs`); un test Flutter confronta i due
  file e fallisce se lo snapshot non è allineato. La modifica manuale resta una sola (FR-61).
- **Processo di modifica** (risponde alla parte residua di OQ-5): PR che modifica `locations.json`
  (+ rigenerazione dello snapshot) → test verdi → verifica della regola go/no-go di NFR-15 (sul
  piano Free, con blocchi da 50, oltre ~36 località serve prima il passaggio a Paid, ADR-0003 §5)
  → `wrangler deploy`. Al primo cron successivo il job
  scarica le nuove località; fino ad allora `/forecast` risponde 404 per quelle nuove (FR-23) e
  `/locations` le elenca già.

## Consequences
- **Più semplice**: nessun nuovo binding; `/forecast` risolve il nome senza letture (FR-57);
  `/locations` costa solo CPU trascurabile; storico in git.
- **Più difficile**: aggiungere una località richiede un deploy; fra deploy e cron successivo una
  località nuova è in `/locations` ma non ancora in `/forecast` (al più 6 h; l'app mostra il
  messaggio di FR-33). Se il proprietario volesse delegare la modifica a chi non fa deploy,
  servirebbe rivedere questa scelta (opzione 2).
- **ETag e deploy**: il valore cambia solo se cambia il contenuto, non a ogni deploy.
- **Rinominare una località**: cambiare `name` mantenendo `slug` conserva il record di cache; cambiare
  lo `slug` equivale a rimuovere e aggiungere (ADR-0003: il vecchio record viene cancellato).
