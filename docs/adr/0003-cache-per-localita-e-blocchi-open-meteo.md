---
id: ADR-0003
status: accepted     # proposed | accepted | superseded by ADR-XXXX
date: 2026-10-20
---

# ADR-0003: Cache per località su Workers KV, chiamate Open-Meteo a blocchi, migrazione da `latest`

Allineato al PRD v0.4: recepisce le decisioni dell'owner del 2026-10-20 su OQ-22 (C-5, NFR-15),
OQ-24 (FR-58), OQ-27 (C-7, FR-59, FR-60) e sull'interruttore del fallback (FR-54). Restano aperte
solo OQ-28 (soglia dell'interruttore) e OQ-29 (soglia di 700 scritture KV/giorno), gestite come
parametri configurabili con default.

## Context
Con il catalogo che cresce da 13 a ~500 località (C-4, NFR-19) il disegno di ADR-0001 (un solo
documento `latest` con tutte le località, 2 chiamate provider per località) non scala:

- **FR-55..FR-57**: ogni località diventa un record indipendente più un record di metadati;
  `/health` legge solo i metadati, `/forecast` solo il record della località (costo costante,
  NFR-19 proposto: ≤ 2 letture storage per richiesta API, NFR-4 p95 < 200 ms).
- **FR-19, FR-18, NFR-14, NFR-3**: mai una previsione di località parziale o mista; località fallita
  servita con l'ultimo dato valido. **R-9**: `/health` e `/forecast` possono riflettere esecuzioni
  diverse per un breve intervallo (accettato salvo diversa indicazione dell'owner).
- **FR-53, FR-54, NFR-5, NFR-17, NFR-20**: chiamate multi-coordinata a blocchi, retry per blocco
  (FR-17), fallback per località entro il budget di durata, concorrenza limitata, mai oltre
  600 chiamate pesate/min. **Interruttore** (FR-54, v0.4): con più del 50% delle richieste di
  blocco fallite nessun fallback per singola località.
- **FR-58**: `detail.available` del 404 = primi 50 nomi, stesso formato.
- **FR-59, FR-60, C-7**: passaggio da `latest` senza 404/503, nessuna doppia scrittura, rollback
  senza interventi sui dati, cancellazione di `latest` dopo 14 giorni senza rollback e con
  `/health` `ok`.
- **NFR-15, C-5**: piano Workers **Free ora, Paid alla soglia** (regola go/no-go a-f); 500 località
  solo su Paid (NFR-19).
- **FR-64**: i test di parità esistenti (che popolano `latest`) restano verdi senza modifiche alle
  fixture.
- **NFR-21**: misura (durata, blocchi, fallback, subrequest, scritture) prima di qualsiasi fan-out.

### Limiti verificati sulla documentazione corrente (2026-10-20)
| Fonte | Limite | Valore |
|---|---|---|
| Workers | subrequest per invocazione ("qualsiasi richiesta via Fetch API o a servizi Cloudflare come KV, R2, D1") | Free 50, Paid 10.000 |
| Workers | connessioni simultanee in attesa di header | 6 (Free e Paid) |
| Workers | CPU per Cron Trigger | Free 10 ms; Paid 30 s (intervallo < 1 h), 15 min (intervallo ≥ 1 h) |
| Workers | durata (wall time) di un'invocazione `scheduled` | 15 min |
| Workers | memoria per isolate | 128 MB |
| KV | operazioni per invocazione | 1.000 (Free e Paid) |
| KV | scritture/giorno su chiavi diverse | Free 1.000, Paid illimitate |
| KV | letture/giorno | Free 100.000, Paid illimitate |
| KV | scritture sulla stessa chiave | 1/s |
| KV | dimensione valore / chiave | 25 MiB / 512 byte |
| KV | lettura bulk `get([k1, k2, ...])` | max 100 chiavi, conta come **1 operazione** |
| KV | cache al bordo (anche delle letture negative) | `cacheTtl` default 60 s, minimo 30 s |
| D1 | query per invocazione | Free 50, Paid 1.000 (ogni istruzione di un `batch()` conta) |
| D1 | `batch()` | transazione SQL: rollback dell'intera sequenza se un'istruzione fallisce |
| D1 | riga/stringa/BLOB, istruzione SQL, parametri | 2 MB, 100 KB, 100 parametri |
| D1 | dimensione database | Free 500 MB, Paid 10 GB |
| Open-Meteo | multi-coordinata | `latitude=a,b&longitude=c,d`; la risposta JSON diventa una **lista** di strutture; fino a **1.000 località** per richiesta (blog ufficiale Open-Meteo) |
| Open-Meteo | peso di una richiesta | `nLocations × (nDays/14) × (nVariables/10)`, con minimo 1 per località (oltre 10 variabili o 2 settimane conta di più) |
| Open-Meteo | quota gratuita | 600/min, 5.000/h, 10.000/giorno, 300.000/mese; uso non commerciale |
| Open-Meteo | lunghezza URL massima, POST | **non documentati** |

Peso per località con i parametri attuali: Marine 4 variabili × 7 giorni = 1; Forecast
4 orarie + 5 giornaliere = 9 variabili × 7 giorni = 1. Con 500 località: 1.000 chiamate pesate per
esecuzione, 4.000/giorno (40% della quota giornaliera, coerente con la stima di NFR-20). R-8 resta:
il peso effettivo va confermato con la misura di NFR-21.

## Options

### A. Layout del cache
1. **Workers KV, chiavi `forecast:<slug>` + `meta`** (proposta del task)
   - Pro: KV già in uso (C-2, NFR-12, ADR-0001), nessuno schema né migrazioni; letture servite dal
     bordo; una `put` per chiave è atomica, quindi FR-19 per località è garantito per costruzione;
     **FR-18 gratis**: una località fallita semplicemente non viene riscritta e il suo record resta
     quello valido precedente; il job non deve rileggere le previsioni precedenti. Lettura bulk
     (`forecast:<slug>` + `meta` in 1 operazione) tiene `/forecast` a 1 operazione nel caso 200.
   - Contro: nessuna atomicità fra chiavi (R-9, NFR-16 accettati); ogni `put` è una subrequest
     (Free: 50 per invocazione) e una scrittura giornaliera: con 500 località ~501 `put` per
     esecuzione (~2.004/giorno) superano la quota Free di 1.000/giorno → a quella scala serve il
     piano Paid, mentre con poche decine di località il layout resta nei limiti Free (§5); tetto di
     1.000 operazioni KV per invocazione → catalogo massimo ~990 località senza fan-out (sufficiente
     per NFR-19); cache negativa al bordo fino a 60 s durante la migrazione (gestita sotto).
2. **Cloudflare D1, tabella `forecast_cache(slug PRIMARY KEY, payload TEXT, updated_at)` + `run_meta`**
   - Pro: `batch()` transazionale: pubblicazione atomica di tutte le località e dei metadati (elimina
     R-9); consistenza forte sul primary; SQL utile per ispezione; catalogo potrebbe stare nella
     stessa base (ADR-0004).
   - Contro: nuova tecnologia, binding, migrazioni di schema e test con D1 locale; un primary in una
     sola regione (latenza a freddo comparabile o peggiore di KV per utenti in Italia, replica di
     lettura da abilitare a parte); ogni istruzione conta come query (Paid 1.000/invocazione): con
     500 righe da ~5 KB servono INSERT multi-riga sotto i 100 KB per istruzione e 100 parametri
     (~20 righe/istruzione, ~25 istruzioni) o 500 istruzioni singole; nessun vantaggio su FR-18;
     contraddice C-2/NFR-12 (KV) e richiede di aggiornarli.
3. **KV, documento unico `latest` come oggi** — scartata: viola FR-55..FR-57 (ogni lettura e
   scrittura tocca ~2,5 MB con 500 località; CPU di `JSON.parse` per ogni richiesta API).

### B. Chiamate al provider
1. **Blocchi multi-coordinata a dimensione fissa configurabile** (FR-53), retry per blocco, fallback
   singolo (FR-54), cadenzamento per peso.
2. **Una sola richiesta da 500 località per API** — scartata: URL di ~12 KB (limite non documentato),
   risposta di diversi MB per singola richiesta, un errore costringe a 1.000 fallback.
3. **Fan-out su Cloudflare Queues** — fuori ambito finché NFR-21 non lo giustifica (non-goal v0.3).

### C. Migrazione da `latest` (FR-59)
1. **Seed una tantum fuori banda** (script `wrangler kv` prima del deploy) — richiede un passo manuale
   e non copre la finestra fra deploy e prima esecuzione.
2. **Modalità legacy in lettura + seed automatico alla prima esecuzione** — il nuovo Worker, finché
   `meta` non esiste, serve `/forecast` e `/health` da `latest` con la logica attuale; la prima
   esecuzione del nuovo job copia nei record per località le voci di `latest` che non riesce ad
   aggiornare, prima di scrivere `meta`.

## Decision

### 1. Layout: Workers KV (opzione A.1)
Nella KV esistente `FORECASTS`:

| Chiave | Contenuto | Scritta da | Letta da |
|---|---|---|---|
| `forecast:<slug>` | JSON della previsione della località (stessa struttura dell'elemento `locations[<slug>]` di v0.1, contratto congelato) | job, 1 `put` per località aggiornata | `/forecast` |
| `meta` | `{ schema_version: 1, generated_at, updated_locations[], errors{}, locations: <n>, slugs[] }` | job, **ultima** scrittura dell'esecuzione | `/health`, `/forecast` (404/503), job |
| `latest` | documento v0.1, **congelato** (non più scritto dal nuovo job) | solo la versione precedente del Worker | modalità legacy e ripiego di migrazione |

- `meta.slugs` = slug con un record valido (unione fra `meta.slugs` precedente e località aggiornate,
  meno le località uscite dal catalogo); `meta.locations` = `slugs.length` (è il `locations` di
  `/health`, FR-26).
- **Località rimosse dal catalogo**: il job cancella `forecast:<slug>` e le toglie da `meta.slugs`
  (FR-61: rimuovere una località richiede una sola modifica). Differenza consapevole dal merge
  v0.1, che le conservava per sempre; non tocca la parità con lo stesso catalogo.
- **Se nessuna località è aggiornata** il job non scrive nulla (comportamento attuale): `generated_at`
  invecchia e `/health` segnala `stale`.
- Ordine delle scritture: prima i record delle località, poi `meta`. Così un `meta` visibile non
  annuncia località senza record (al netto della consistenza eventuale, R-9).
- Budget KV per esecuzione: 1 `get` `meta` + (solo in migrazione) 1 `get` `latest` + ≤ N `put` +
  eventuali `delete` + 1 `put` `meta` ≤ 1.000 operazioni per N ≤ ~990. Le `put` vanno con
  concorrenza limitata (`mapWithConcurrency`, 6).

### 2. Percorsi di lettura dell'API (FR-56, FR-57, FR-59)
Risoluzione nome → slug sul **catalogo incluso nel Worker** (ADR-0004), 0 letture storage.

- **`/forecast`, località risolta allo slug `S`**: lettura bulk `get(["forecast:S", "meta"])`
  (1 operazione KV).
  - record presente → 200 con il record;
  - record assente e `meta` presente → ripiego di migrazione: se `LEGACY_LATEST_FALLBACK` è attivo e
    `latest` contiene `S`, 200 con il dato di `latest` (copre la cache negativa al bordo e
    l'intervallo FR-59); altrimenti 404;
  - `meta` assente → **modalità legacy**: logica v0.1 su `latest` (200/404/503) invariata.
- **`/forecast`, località non nel catalogo**: `get("meta")`; presente → 404; assente → modalità legacy.
- **`/health`**: `get("meta")` → risposta da `meta` (contratto FR-26 invariato, `cache_path` =
  `kv:FORECASTS`); `meta` assente → modalità legacy su `latest`.
- Record o `meta` non interpretabili → 503 / `degraded` con l'errore, come FR-24/FR-26.
- Letture per richiesta: 1 nel caso 200 nominale, ≤ 2 in tutti i casi di produzione (NFR-19).
- I test esistenti che popolano solo `latest` passano dalla modalità legacy: restano verdi senza
  modifiche alle fixture (FR-64).

### 3. 404 di `/forecast` (FR-58, decisione owner OQ-24)
`detail.available` = **primi 50 nomi** dell'elenco ordinato (nomi del catalogo con un record, cioè
le voci di `meta.slugs`), stesso tipo e forma (array di stringhe, nessun campo aggiuntivo);
`detail.message` invariato. Con ≤ 50 località l'output è identico a FR-23, quindi la parità e i test
esistenti non cambiano; corpo limitato (~3 KB con nomi ≤ 60 caratteri, limite verificato dalla
validazione del catalogo, ADR-0004). In modalità legacy i nomi vengono da `latest` (stesso
troncamento, ininfluente con 13 località). Il limite 50 è una costante del contratto (FR-58), non un
parametro. Alternative scartate dall'owner: rimuovere il campo, suggerire le località simili,
aggiungere `available_total`.

### 4. Job a blocchi (FR-53, FR-54) — opzione B.1
1. Valida il catalogo (FR-2, ADR-0004); legge `meta` (e `latest` se `meta` manca).
2. Divide il catalogo, nell'ordine del file, in blocchi di `OPEN_METEO_BLOCK_SIZE` località
   (default **50**, ammesso 1..100). Per ogni blocco una richiesta Marine e una Forecast con gli
   stessi parametri di FR-3/FR-4 e coordinate separate da virgola. 50 località producono un URL di
   ~1,5 KB (≤ 13 caratteri per coordinata con la virgola codificata `%2C`); il tetto 100 tiene l'URL
   sotto ~4 KB, perché il limite del provider non è documentato. Risposta di un blocco Marine ≈
   0,3-0,5 MB: memoria trascurabile rispetto ai 128 MB.
3. Ogni richiesta passa da `fetchJson` (3 tentativi, 30 s, backoff, FR-17). La risposta deve essere
   una lista lunga quanto il blocco; l'elemento `i` corrisponde alla località `i` (stesso ordine
   delle coordinate). La previsione di ogni elemento è costruita dalla **stessa funzione pura** usata
   per la risposta singola (`buildForecast` viene separata in fetch + `buildForecastFromPayloads`),
   così FR-53 "previsione identica" è verificabile con le fixture esistenti (FR-51).
4. **Due fasi distinte.** *Fase blocchi*: tutte le richieste di blocco (Marine e Forecast) vengono
   eseguite fino all'esaurimento dei rispettivi tentativi; nessuna richiesta singola parte durante
   questa fase. Al termine si classificano: località aggiornate; località di un blocco **fallito**
   (dopo tutti i tentativi); località di un blocco riuscito il cui elemento non è valido o non si
   aggrega (il blocco **non** conta come fallito, FR-54).
5. **Interruttore del fallback** (FR-54), valutato una sola volta, dopo la fase blocchi e prima di
   qualunque richiesta singola: `richieste_di_blocco_fallite / richieste_di_blocco_totali` con
   Marine e Forecast contate separatamente (con 500 località e blocchi da 50: 40 richieste). Se il
   rapporto è **strettamente maggiore** di `FALLBACK_BREAKER_THRESHOLD` (default **0.5**, OQ-28)
   l'interruttore scatta: nessuna richiesta singola per l'intera esecuzione; ogni località che
   avrebbe richiesto un fallback conserva il dato precedente (FR-18, il suo record non viene
   riscritto) e riceve in `errors[<slug>]`
   `"Aggiornamento non tentato: interruttore del fallback attivo (guasto diffuso del provider)"`;
   le località dei blocchi riusciti sono scritte normalmente. Con esattamente il 50% il fallback si
   esegue. Con 13 località (1 blocco per API, 2 richieste) l'interruttore scatta solo se falliscono
   entrambe.
6. *Fase fallback* (interruttore non scattato): le località interessate vanno in coda per richieste
   singole (la stessa `fetchJson`), solo per il provider mancante (se il blocco Marine è riuscito e
   quello Forecast no, si richiede singolarmente solo il Forecast).
7. **Concorrenza** (NFR-17): al più `UPDATE_CONCURRENCY` richieste in volo (default **4**, ≤ 6 per il
   limite di connessioni), in entrambe le fasi. **Cadenzamento** (NFR-20, vincolo 600/min): un
   secchiello a gettoni pesato (peso = località × fattori giorni/variabili) limita il consumo a
   `OPEN_METEO_MAX_WEIGHT_PER_MIN` (default **300**, metà del limite, margine per R-6). Con 500
   località: 1.000 pesate → ~3,3 min nominali (< 5 min, NFR-19).
8. **Budget dell'esecuzione** (NFR-5, NFR-15). *Durata*: scadenza `UPDATE_BUDGET_SECONDS` (default
   **720** = 12 min) dall'avvio; nessuna richiesta parte se non può concludersi entro la scadenza
   (30 s di timeout); località non tentate → `errors[<slug>]` =
   `"Aggiornamento non tentato: budget di durata esaurito"`. I 3 min residui coprono le scritture KV.
   *Subrequest*: tetto `UPDATE_MAX_SUBREQUESTS` (default **45**, sotto i 50 del piano Free; su Paid
   si alza a 9.000 senza modifiche di codice). Prima di ogni tentativo verso il provider il job
   verifica che restino subrequest sufficienti per il tentativo **e** per le operazioni KV
   riservate (1 `get` `meta`, +1 `get` `latest` in migrazione, ≤ N `put`, `delete`, 1 `put` `meta`);
   altrimenti la località non è tentata: `"Aggiornamento non tentato: budget di subrequest
   esaurito"`. Così un'esecuzione non fallisce mai per il limite di subrequest (condizione (a) di
   NFR-15 evitata per costruzione) e degrada come per il budget di durata.
9. Scritture come al punto 1. Log `forecast_update` esteso (NFR-21, FR-52): `duration_ms`, `blocks`,
   `block_requests`, `block_failures`, `fallback_breaker` (bool), `fallbacks`, `subrequests`,
   `kv_writes`, `kv_deletes`, `weight_used`, `budget_exhausted` (`none`/`duration`/`subrequests`) e
   `paid_alerts` (vedi §5).

Conteggi per esecuzione con 500 località e blocchi da 50 (Paid): 20 richieste nominali, 60 con tutti
i retry di blocco; fallback al più per le località di 20 richieste di blocco fallite su 40 (oltre
scatta l'interruttore): ≤ 1.000 richieste singole × 3 tentativi ≈ 3.060 nel caso peggiore; più
~503 operazioni KV. Totale < 10.000 subrequest Paid. CPU stimata (parse ~10 MB di JSON +
aggregazioni) nell'ordine dei centinaia di ms: lontana dai 15 min Paid, incompatibile con i 10 ms
Free (500 località solo su Paid, NFR-19).

### 5. Piano Cloudflare (decisione owner OQ-22, C-5): Free ora, Paid alla soglia
Lo **stesso disegno** (cache per località, blocchi, interruttore, budget) gira su entrambi i piani;
il passaggio a Paid è una modifica di configurazione dell'account e di `UPDATE_MAX_SUBREQUESTS`,
non di codice.

**Il layout per località regge su Free con poche località.** Con N località, blocchi da 50 e 4
esecuzioni/giorno (le `put` KV contano come subrequest):

| Grandezza per esecuzione | Formula | N = 13 (oggi) | Soglia NFR-15 |
|---|---|---|---|
| Subrequest nominali | 2·⌈N/50⌉ + 1 `get meta` + N `put` + 1 `put meta` | **17** (oggi, v0.2: 26 provider + KV) | (b) > 40 → N ≥ 37 |
| Subrequest con retry dei blocchi | 6·⌈N/50⌉ + N + 2 | 21 | limite 50 |
| Subrequest con fallback (1 blocco su 2 fallito, retry ovunque) | 3 + 3 + 3·N + N + 2 | 60 → **troncato a 45** dal budget di subrequest | limite 50 |
| Prima esecuzione (migrazione) | + 1 `get latest`; seed nelle `put` | 18 | — |
| Scritture KV/giorno | 4·(N + 1) | **56** | (c) > 700 → N ≥ 175 |
| Letture KV/giorno | 1 per richiesta API | ≪ 100.000 (un utente) | — |

- Su Free la soglia che si raggiunge prima è quella delle **subrequest** (b): circa **36 località**
  in condizioni nominali, ben prima delle 700 scritture/giorno (~174 località). Il tetto
  `UPDATE_MAX_SUBREQUESTS` impedisce che un caso peggiore (fallback con retry) faccia fallire
  l'invocazione: le località eccedenti finiscono in `errors` e conservano il dato precedente.
- **CPU (10 ms Free)**: non stimabile in modo affidabile a priori (parse di 2 risposte di blocco +
  13 aggregazioni + 14 serializzazioni); va letta da Workers Logs/dashboard (NFR-21). Il disegno a
  blocchi la riduce rispetto a v0.2 (2 risposte invece di 26). Se supera 7 ms → Paid (b).
- **Supporto alla regola go/no-go**: il job calcola nel log `paid_alerts`, una lista di motivi fra
  `subrequests` (subrequest dell'esecuzione > `PAID_ALERT_SUBREQUESTS`, default **40**) e
  `kv_writes_per_day` (scritture dell'esecuzione × esecuzioni/giorno > `PAID_ALERT_KV_WRITES_PER_DAY`,
  default **700**, OQ-29), più `budget_exhausted = subrequests`. CPU (b), esecuzione fallita (a) e
  assenza di run in 24 h (d) si leggono dagli strumenti Cloudflare e da `/health` (`stale`); (e) e
  (f) sono decisioni di rilascio.
- **Crescita del catalogo**: una modifica di `locations.json` che porta N oltre ~36 (o che fa
  comparire `paid_alerts`) si rilascia solo dopo il passaggio a Paid (NFR-15); 500 località solo su
  Paid (NFR-19). Al passaggio: abilitare Paid, `UPDATE_MAX_SUBREQUESTS = 9000`, poi ampliare.
- Alternative scartate: Paid subito (costo senza necessità con 13 località e un utente); su Free
  scrivere solo `meta` con tutte le previsioni (riduce le `put`, ma è il documento unico scartato in
  A.3 e non scala comunque).

### 6. Migrazione e rollback (FR-59, FR-60, OQ-27) — opzione C.2
Sequenza di rilascio:
1. **Rilascio di migrazione con lo stesso catalogo di 13 località** (nessuna nuova località nello
   stesso deploy). Finché il primo cron non gira, il nuovo Worker è in modalità legacy su `latest`.
2. **Prima esecuzione del nuovo job** (`meta` assente): scrive `forecast:<slug>` per ogni località
   aggiornata e, per ogni slug di `latest` presente nel catalogo e **non** aggiornato, copia il dato
   di `latest` nel suo record (seed); poi scrive `meta`. Da qui ogni località di `latest` ha un
   record: nessun 404/503 (FR-59). Il ripiego `LEGACY_LATEST_FALLBACK` copre la cache negativa al
   bordo (≤ 60 s) delle chiavi lette prima del seed.
3. L'ampliamento del catalogo avviene in deploy separati e solo nel rispetto della regola go/no-go
   (§5, NFR-15): oltre la soglia Free, dopo il passaggio a Paid.

**`latest` non viene mai scritto dal nuovo Worker** (FR-59, decisione owner OQ-27/C-7: nessuna
doppia scrittura) e resta presente e non modificato finché valgono le condizioni di FR-60. Dopo un
rollback la versione precedente del Worker riscrive `latest` con il proprio cron (dati di nuovo
freschi entro ≤ 6 h; nel frattempo `/health` `degraded` per età, accettato da FR-60).
Nota: dopo un rollback seguito da un nuovo rilascio, `/forecast` serve i record per località
(più vecchi di `latest`) fino al cron successivo; `/health` è coerente perché legge `meta`.

**Cancellazione di `latest`** (FR-60): consentita solo quando (a) sono trascorsi almeno **14 giorni**
dal rilascio del cache per località senza alcun rollback (un rollback fa ripartire il conteggio dal
rilascio successivo) e (b) `/health` risponde `status = ok` al momento della cancellazione.
Procedura: un rilascio disattiva `LEGACY_LATEST_FALLBACK` e rimuove la modalità legacy (i test che
popolano `latest` vengono riscritti sul nuovo layout in quella storia); poi, verificato (b),
l'operatore cancella `latest` con `wrangler kv key delete`. Da quel momento il rollback alla
versione v0.2 del Worker non è più supportato. La data di partenza del conteggio e gli eventuali
rollback vanno annotati nel runbook di rilascio.

## Consequences
- **Più semplice**: `/forecast` e `/health` a costo costante (1 operazione KV nel caso nominale);
  FR-18 ottenuto senza merge; nessun nuovo servizio Cloudflare; test con la KV di Miniflare.
- **Più difficile**: il job diventa uno scheduler (blocchi, coda di fallback, secchiello pesato,
  scadenza, interruttore, budget di subrequest) e va testato con `sleep`/`now`/`fetch` iniettati;
  la modalità legacy è codice temporaneo da rimuovere alla cancellazione di `latest` (FR-60).
- **Consistenza**: nessuna atomicità fra località (R-9, NFR-16); una singola località è sempre
  coerente (FR-19).
- **Vincoli**: su Free ~36 località nominali (soglia (b) di NFR-15), poi Paid; catalogo ≤ ~990
  località senza fan-out; blocchi ≤ 100.
- **Verifiche da fare in sviluppo**: disponibilità di `get([...])` bulk nella versione di
  `@cloudflare/vitest-pool-workers` in uso (in mancanza: due `get` in parallelo, 2 operazioni,
  ancora entro NFR-19); che Open-Meteo restituisca la lista nell'ordine delle coordinate e accetti
  URL da ~4 KB (test di contratto manuale prima del rilascio); peso reale delle richieste (R-8).
- **Quota nel caso peggiore** (R-8): l'interruttore elimina il fallback nel guasto diffuso (> 50%
  dei blocchi). Resta il caso "fino al 50% dei blocchi fallito": con il cadenzamento a 300/min e
  12 min di budget un'esecuzione consuma al massimo ~3.600 chiamate pesate; più esecuzioni di questo
  tipo nello stesso giorno possono avvicinare i 10.000 (OQ-9). Misurato con `weight_used` (NFR-21).
- **Parametri aperti**: `FALLBACK_BREAKER_THRESHOLD` (OQ-28) e `PAID_ALERT_KV_WRITES_PER_DAY`
  (OQ-29) sono variabili d'ambiente con i default del PRD; un cambio di decisione dell'owner non
  richiede modifiche di codice.
