---
id: ADR-0002
status: accepted     # proposed | accepted | superseded by ADR-XXXX
date: 2026-10-20
---

# ADR-0002: Storico giornaliero del giorno 0 su Cloudflare D1, `GET /history` e schermata storico

Allineato al PRD v0.5 (approvato). La scelta di **D1** come storage dello storico è una decisione
dell'owner (C-8, NFR-12): questo ADR decide schema, scrittura, lettura, aggregazione mensile e lato
app, e propone una risposta alle domande aperte per l'architect OQ-30, OQ-31, OQ-32, OQ-33, OQ-35
(da approvare dall'owner). Non modifica ADR-0001, ADR-0003, ADR-0004, ADR-0005: il cache delle
previsioni resta su Workers KV (`forecast:<slug>` + `meta`), il catalogo resta `locations.json` nel
bundle, l'app continua a ottenere il catalogo dal LocationRepository.

## Context
- **FR-69..FR-73** (scrittura): al più un record per (slug, data Europe/Rome) con 7 valori del
  giorno 0 (`air_temperature_mean_c`, `air_temperature_min_c`, `air_temperature_max_c`,
  `water_temperature_mean_c`, `state`, `wave_height_mean_m`, `wave_height_max_m`), **identici**
  (arrotondamenti e `null` compresi) a quelli serviti da `/forecast` dopo la stessa esecuzione;
  upsert a ogni esecuzione per le sole località aggiornate; una località fallita non scrive; un
  errore D1 è registrato nell'esito (FR-52) e **non** blocca né annulla il cache KV; scrive solo il
  job.
- **FR-74..FR-82** (`GET /history`): località risolta come `/forecast`; `from`/`to` inclusi;
  `granularity` `day` (default, ≤ 366 giorni) o `month` (≤ 120 mesi toccati); aggregazione mensile
  **in SQL** con moda di `state` e pareggio verso lo stato più alto della scala Douglas (FR-10);
  422/404/503; `Cache-Control` breve se `to` ≥ oggi, lungo se tutto nel passato; sola lettura,
  CORS di FR-28, nessuna chiamata ai provider; `/forecast`, `/health`, `/locations` invariati
  (FR-81); documentazione "previsioni, non misure" (FR-82).
- **FR-83..FR-91** (app): comando "Storico", preset, intervallo personalizzato, granularità,
  grafico con banda min/max e interruzioni sui `null`, stato del mare, tabella, stati, nota
  sempre visibile, `HistoryApi` con `http.Client` iniettabile.
- **NFR-23**: `/history` legge solo i record della località, costo indipendente dal catalogo,
  p95 < 300 ms (proposto). **NFR-24**: 500 località × 10 anni ≈ 1,83 M record entro il limite di
  dimensione del piano. **NFR-25**: scrittura < 5 s nominale e query D1 entro il limite per
  invocazione. **NFR-26**: grafico e tabella fluidi con 366 punti o 120 mesi.
- **NFR-15, C-5**: piano Workers **Free ora, Paid alla soglia** (ADR-0003 §5). Il job ha già un
  tetto di subrequest (`UPDATE_MAX_SUBREQUESTS` = 45 su Free) che conta anche le operazioni sui
  servizi Cloudflare.

### Limiti D1 e Workers verificati sulla documentazione corrente (2026-10-20)
| Fonte | Limite | Valore |
|---|---|---|
| D1 | query per invocazione del Worker | Free 50, Paid 1.000; i limiti per query valgono **per ogni istruzione** di un `batch()` |
| D1 | parametri per query | 100 |
| D1 | lunghezza istruzione SQL | 100 KB |
| D1 | stringa/BLOB/riga | 2 MB |
| D1 | durata massima di una query | 30 s |
| D1 | dimensione database | Free 500 MB, Paid 10 GB |
| D1 (prezzi) | righe lette / scritte | Free 5 M/giorno lette, 100.000/giorno scritte (oltre: errori fino al reset); Paid 25 G/mese e 50 M/mese inclusi |
| D1 (prezzi) | indici | ogni scrittura su una colonna indicizzata conta **2 righe scritte** (tabella + indice) |
| D1 | `batch()` | eseguito come transazione: rollback dell'intera sequenza se un'istruzione fallisce |
| Workers | subrequest | "qualsiasi richiesta via Fetch API o a servizi Cloudflare come R2, KV o D1": Free 50, Paid 10.000 |

Non è documentato se un `batch()` conti come una sola subrequest: per prudenza (come ADR-0003 per
la KV) ogni **istruzione** D1 è contata come una subrequest nel budget del job.

## Options

### A. Schema
1. **Una tabella `daily_history`, chiave primaria `(location_slug, date)`, `WITHOUT ROWID`, una
   colonna per valore di FR-69** — la PK garantisce "al più un record" (FR-69) e abilita l'upsert
   `ON CONFLICT` (FR-70); `WITHOUT ROWID` memorizza le righe ordinate per (slug, data), quindi la
   lettura di un intervallo è una scansione contigua della PK (NFR-23) senza indice secondario (1
   riga scritta per upsert invece di 2, meno spazio); colonne tipizzate → `GROUP BY` diretto (FR-76).
2. **Tabella con `rowid` + indice `(location_slug, date)`** — stesso comportamento logico, ma
   doppia scrittura per riga (indice) e più spazio (NFR-24); nessun vantaggio.
3. **Una riga per (slug, data) con il JSON del giorno** — scrittura banale, ma aggregazione mensile
   con `json_extract` su ogni riga e nessun tipo: contraddice lo spirito di FR-76 (SQL) e rende la
   moda più costosa.
4. **Rango Douglas memorizzato in una colonna aggiuntiva** — semplifica la moda, ma duplica `state`
   (dato derivato, da tenere allineato a FR-10). Scartata: il rango si calcola in SQL con un `CASE`
   generato dalla stessa costante TypeScript della scala (vedi §3).

### B. Raggruppamento delle scritture (OQ-35)
1. **Un'istruzione per riga** — N query e N subrequest per esecuzione: 13 su Free, 500 su Paid;
   oltre le 50 query Free già con poche decine di località. Scartata.
2. **`INSERT` multi-riga con parametri posizionali** — 9 parametri per riga → al più 11 righe per
   istruzione (limite di 100 parametri): ⌈N/11⌉ istruzioni (2 con 13 località, 46 con 500); testo SQL
   costruito dinamicamente in base al numero di righe.
3. **Un solo parametro JSON per istruzione, espanso con `json_each`** — `INSERT … SELECT … FROM
   json_each(?1) … ON CONFLICT DO UPDATE`: 1 parametro qualunque sia il numero di righe; limite dato
   dalla dimensione del valore (2 MB) e prudenzialmente da quella dell'istruzione (100 KB): con
   blocchi da 100 righe (~25 KB di JSON) servono ⌈N/100⌉ istruzioni (**1** con 13 località, **5** con
   500); testo SQL fisso, preparabile una volta. Richiede le funzioni JSON di SQLite (supportate da
   D1) e la clausola `WHERE true` prima di `ON CONFLICT` (ambiguità sintattica di SQLite con
   `INSERT … SELECT`).

### C. Atomicità ed esito della scrittura
1. **Tutte le istruzioni dell'esecuzione in un solo `batch()`** — transazione: o tutte le righe o
   nessuna; esito semplice (righe non scritte = tutte, con il messaggio). Con 1-5 istruzioni il costo
   è minimo.
2. **Istruzioni separate** — esito parziale possibile, più subrequest effettive e conteggio più
   complesso; nessun beneficio concreto.

### D. Momento della scrittura e tentativi
1. **Dopo la pubblicazione del cache KV (dopo `put meta`), un solo tentativo** — un guasto o un
   ritardo di D1 non può ritardare né annullare il cache (FR-72); l'upsert dell'esecuzione
   successiva (≤ 6 h) riscrive comunque il giorno 0, quindi un errore perde il giorno solo se
   colpisce l'ultima esecuzione riuscita del giorno (R-11).
2. **Prima del cache o con retry** — un retry consuma budget di subrequest su Free e non serve
   grazie all'upsert periodico; scrivere prima del cache espone il cache ai tempi di D1.

### E. Aggregazione mensile
1. **SQL con `GROUP BY substr(date, 1, 7)` + finestra `ROW_NUMBER()` per la moda** — come richiesto
   da C-8/FR-76; una sola query per richiesta.
2. **Aggregazione nel Worker** — esclusa dal PRD (FR-76, C-8).

### F. Libreria dei grafici nell'app (OQ-33)
1. **`fl_chart` ^1.2.0** (verificato su pub.dev il 2026-10-20: ultima versione 1.2.0, licenza MIT,
   publisher verificato `flchart.dev`, Dart SDK ≥ 3.6 compatibile con `^3.11.5`, tutte le
   piattaforme Flutter; dipendenze `equatable`, `vector_math`) — `LineChart` con `BetweenBarsData`
   (riempimento fra due linee: banda min/max), `FlSpot.nullSpot` (interruzione della linea sui
   `null`, FR-87), limiti degli assi espliciti (consigliati dalla documentazione per le prestazioni).
2. **`syncfusion_flutter_charts`** — completo, ma licenza commerciale/community con vincoli.
3. **Grafico disegnato con `CustomPainter`** — nessuna dipendenza, ma assi, etichette, banda e
   interruzioni da scrivere e testare.

## Decision

### 1. Schema (A.1) — `worker/migrations/0001_daily_history.sql`
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
- Nessuna colonna oltre FR-69 (niente `updated_at`: l'istante dell'esecuzione è nel log del job).
- Le date `YYYY-MM-DD` in `TEXT` si ordinano e si confrontano lessicograficamente
  (`BETWEEN ?2 AND ?3`); `substr(date, 1, 7)` dà il mese.
- Database `maestrale-history`, binding **`HISTORY`** in `worker/wrangler.jsonc`
  (`d1_databases`, `migrations_dir: "migrations"`), creato con
  `wrangler d1 create maestrale-history --location=weur` (primario in Europa occidentale, vicino
  agli utenti in Italia, NFR-23). Migrazioni applicate con `wrangler d1 migrations apply` **prima**
  del deploy del Worker che le usa (passo del runbook). Nessuna replica di lettura: non serve per
  NFR-23 con un utente.

### 2. Scrittura dal job `scheduled` (B.3, C.1, D.1)
1. Data del giorno 0 = data **Europe/Rome dell'avvio del job** (`Intl.DateTimeFormat` con
   `timeZone: "Europe/Rome"`). Con il cron attuale (00:30, 06:30, 12:30, 18:30 UTC) un'esecuzione
   non attraversa la mezzanotte locale.
2. Per ogni località **aggiornata** (`updated_locations`) si prende dalla **stessa** previsione
   scritta in `forecast:<slug>` l'elemento di `daily` con `date` = giorno 0 e se ne copiano i 7
   valori così come sono (FR-69: stessi numeri, stessi `null`). Se l'elemento manca: nessuna riga,
   slug in `history_missing_day0` nel log (FR-70). Le località fallite, del seed di migrazione da
   `latest`, dell'interruttore o del budget esaurito non producono righe (FR-71).
3. Righe divise in blocchi di `HISTORY_WRITE_BATCH_ROWS` (default **100**, ammesso 1..400); per
   blocco un'istruzione con un solo parametro (JSON array di oggetti con i nomi di FR-69 più
   `location_slug` e `date`):
   ```sql
   INSERT INTO daily_history (location_slug, date, air_temperature_mean_c, air_temperature_min_c,
     air_temperature_max_c, water_temperature_mean_c, state, wave_height_mean_m, wave_height_max_m)
   SELECT json_extract(value, '$.location_slug'), json_extract(value, '$.date'),
     json_extract(value, '$.air_temperature_mean_c'), json_extract(value, '$.air_temperature_min_c'),
     json_extract(value, '$.air_temperature_max_c'), json_extract(value, '$.water_temperature_mean_c'),
     json_extract(value, '$.state'), json_extract(value, '$.wave_height_mean_m'),
     json_extract(value, '$.wave_height_max_m')
   FROM json_each(?1) WHERE true
   ON CONFLICT (location_slug, date) DO UPDATE SET
     air_temperature_mean_c = excluded.air_temperature_mean_c, …, wave_height_max_m = excluded.wave_height_max_m;
   ```
   Il JSON `null` diventa SQL `NULL`; un numero JSON torna identico come `number` JS alla lettura
   (stessa stringa decimale → stesso double), quindi FR-69 vale anche dopo il giro su D1 (verificato
   da test).
4. Tutte le istruzioni in **un solo `HISTORY.batch()`** (transazione), eseguito **dopo**
   `put meta` (il cache è già pubblicato). **Un solo tentativo.** Qualunque eccezione (binding
   assente, tabella mancante, quota, rete) è catturata: righe non scritte = tutte, messaggio nel log
   (`history_failed`, `history_error`) e `console.error`; `errors[<slug>]`, `meta` e `/health` non
   cambiano (FR-72, OQ-31). Il job resta "rigetta solo per catalogo invalido o `KV.put` fallita".
5. Se nessuna località è aggiornata il job non scrive nulla, né in KV né in D1 (comportamento
   esistente).
6. **Budget** (NFR-15, NFR-25): le istruzioni D1 (⌈N/100⌉) si aggiungono alle scritture riservate
   del `RunBudget` (ADR-0003 §4.8), quindi il tetto `UPDATE_MAX_SUBREQUESTS` (45 < 50) garantisce
   anche il limite di 50 query D1 per invocazione su Free. Con 13 località: 17 → **18** subrequest
   nominali; la soglia (b) di 40 subrequest si raggiunge con ~35 località invece di ~36 (ADR-0003 §5,
   formula aggiornata: `2·⌈N/50⌉ + N + 2 + ⌈N/100⌉`). Durata: una transazione da 1-5 istruzioni,
   ordine delle centinaia di ms (NFR-25 < 5 s), coperta dai 3 min di margine del budget di durata.
7. Componente iniettabile: `runUpdate` riceve `deps.history` (interfaccia `HistoryWriter`), così i
   test del job usano un finto e i test di `history_store.ts` usano la D1 di Miniflare.

### 3. Lettura: `GET /history` (E.1)
**Parametri e validazione** (422 con `detail` in italiano, nell'ordine): `localita` assente o vuoto;
`granularity` presente e diverso da `day`/`month` (assente → `day`); `from` o `to` assenti o non
date di calendario valide `YYYY-MM-DD` (regex + controllo di calendario, es. `2026-02-30` non
valida); `from` > `to`; `day` con più di 366 giorni estremi inclusi; `month` con più di 120 mesi
toccati (`(anno_to·12 + mese_to) − (anno_from·12 + mese_from) + 1 > 120`). Poi: località non nel
catalogo → **404** con `detail.message` "Localita '<valore>' non trovata" e `detail.available` = primi
50 nomi ordinati **del catalogo** (stesso formato di FR-58, nessuna lettura KV); infine la query D1.

**Query `day`** (1 istruzione, PK range scan):
```sql
SELECT date, air_temperature_mean_c, air_temperature_min_c, air_temperature_max_c,
       water_temperature_mean_c, state, wave_height_mean_m, wave_height_max_m
FROM daily_history WHERE location_slug = ?1 AND date BETWEEN ?2 AND ?3 ORDER BY date;
```

**Query `month`** (1 istruzione):
```sql
WITH d AS (
  SELECT substr(date, 1, 7) AS month, * FROM daily_history
  WHERE location_slug = ?1 AND date BETWEEN ?2 AND ?3
),
agg AS (
  SELECT month, COUNT(*) AS days,
         ROUND(AVG(air_temperature_mean_c), 1)   AS air_temperature_mean_c,
         MIN(air_temperature_min_c)              AS air_temperature_min_c,
         MAX(air_temperature_max_c)              AS air_temperature_max_c,
         ROUND(AVG(water_temperature_mean_c), 1) AS water_temperature_mean_c,
         ROUND(AVG(wave_height_mean_m), 2)       AS wave_height_mean_m,
         MAX(wave_height_max_m)                  AS wave_height_max_m
  FROM d GROUP BY month
),
modes AS (
  SELECT month, state,
         ROW_NUMBER() OVER (PARTITION BY month
                            ORDER BY COUNT(*) DESC, <STATE_RANK_CASE> DESC) AS rn
  FROM d WHERE state IS NOT NULL GROUP BY month, state
)
SELECT agg.*, modes.state FROM agg
LEFT JOIN modes ON modes.month = agg.month AND modes.rn = 1
ORDER BY agg.month;
```
- `<STATE_RANK_CASE>` = `CASE state WHEN 'Calmo' THEN 0 … WHEN 'Tempestoso' THEN 9 END`, **generato**
  dalla lista ordinata delle etichette FR-10 esportata da `aggregate.ts` (unica fonte; un test
  verifica che copra tutte le etichette). A parità di frequenza vince il rango più alto (FR-76).
- `AVG`/`MIN`/`MAX` ignorano i `NULL`; tutti `NULL` → `NULL`; mese senza stati → `state` `NULL`
  (LEFT JOIN); `days` = record aggregati (`COUNT(*)`).
- Arrotondamento (OQ-32): `ROUND` di SQLite sulle sole medie; minimi e massimi non sono
  riarrotondati (sono già valori giornalieri arrotondati). Gli aggregati mensili sono valori nuovi,
  non soggetti alla parità FR-51.

**Risposta 200** (involucro scelto dall'architect, FR-75):
```json
{
  "schema_version": 1,
  "location": { "slug": "cagliari", "name": "Cagliari" },
  "granularity": "day",
  "from": "2026-10-14",
  "to": "2026-10-20",
  "timezone": "Europe/Rome",
  "items": [
    { "date": "2026-10-14", "air_temperature_mean_c": 21.3, "air_temperature_min_c": 17.0,
      "air_temperature_max_c": 25.1, "water_temperature_mean_c": 22.4, "state": "Poco mosso",
      "wave_height_mean_m": 0.42, "wave_height_max_m": 0.61 }
  ]
}
```
Con `month` gli elementi hanno `month` (`YYYY-MM`) e `days` al posto di `date`. Un solo nome di
elenco (`items`) per entrambe le granularità; giorni/mesi senza record omessi; nessun record → `items`
vuoto, 200.

**Header**: `Cache-Control: public, max-age=<HISTORY_MAX_AGE_SHORT_SECONDS>` (default **900**) se
`to` ≥ oggi Europe/Rome, altrimenti `public, max-age=<HISTORY_MAX_AGE_LONG_SECONDS>` (default
**86400**) (FR-79). Nessun header di cache sulle risposte d'errore. Nessuna cache al bordo con la
Cache API (non serve con il traffico atteso, A-3).

**Errori D1** (OQ-31): binding assente, tabella assente o query fallita → **503** con
`detail` = "Storico temporaneamente non disponibile" e l'errore originale solo nel log
(`console.error`), per non esporre dettagli SQL.

`GET`/`HEAD` (HEAD servito da Hono tramite la route GET, come `/locations`), CORS invariato
(`allowMethods: ["GET"]`), nessuna lettura KV, nessuna chiamata ai provider (FR-80); 1 query D1 per
richiesta, costo indipendente dal numero di località (NFR-23).

### 4. Lato app (F.1 e scelte di OQ-33)
- **`fl_chart` ^1.2.0**. Asse x = indice del giorno (o del mese) a partire da `from`: i giorni
  mancanti e i valori `null` diventano `FlSpot.nullSpot`, quindi interruzioni e nessun valore
  inventato (FR-87). Banda min/max = `BetweenBarsData` fra le due serie min e max (linee
  trasparenti); un punto della banda esiste solo se min **e** max sono non nulli (se uno dei due è
  `null` entrambi diventano `nullSpot`). Linee piene per aria media e mare medio, `isCurved: false`
  (una curva potrebbe uscire dalla banda), `minX/maxX/minY/maxY` espliciti, al più ~6 etichette
  sull'asse x.
- **Stato del mare**: fascia colorata sotto il grafico, una cella per giorno/mese allineata all'asse
  x, colore per rango Douglas (10 colori, grigio per `null`), disegnata da un solo `CustomPainter`;
  legenda con le sole etichette presenti; l'etichetta testuale è anche nella tabella.
- **Tabella su schermi stretti**: righe a due livelli ad altezza fissa (`SliverFixedExtentList`,
  costruzione pigra): livello 1 data (o mese + `days`) e chip con lo stato del mare; livello 2 aria
  media/min/max, mare medio, onde media/max, con intestazioni delle colonne fisse in alto; nessuno
  scorrimento orizzontale. `null` → "n.d." (FR-88).
- **Fuso Europe/Rome nell'app** (preset, "oggi", vincoli del selettore): funzione pura
  `romeToday(DateTime utcNow)` con la regola UE dell'ora legale (dall'ultima domenica di marzo
  01:00 UTC all'ultima domenica di ottobre 01:00 UTC: +2, altrimenti +1), nessuna nuova dipendenza.
- **Intervallo personalizzato** (FR-85): `showDateRangePicker` con `lastDate` = oggi Roma e
  `firstDate` = primo giorno del mese di 119 mesi prima del mese corrente: così ogni selezione
  confermabile ha fine ≤ oggi, inizio ≤ fine e al più 120 mesi toccati.

### 5. Risposte proposte alle domande aperte per l'architect (da approvare dall'owner)
| OQ | Proposta | Motivo |
|---|---|---|
| **OQ-30** | `from` e `to` **obbligatori** (assenza → 422). `to` nel futuro **ammesso** (200, dati fino a oggi; i limiti 366 giorni / 120 mesi valgono sull'intervallo richiesto). Con `month`, `from`/`to` restano **`YYYY-MM-DD`**; i mesi parziali agli estremi sono rivelati da `days`. | Nessun default implicito che dipenda dall'orologio del server; il `Cache-Control` dipende da `to`, che deve essere esplicito. Rifiutare il futuro farebbe fallire l'app intorno alla mezzanotte quando "oggi" del dispositivo precede quello di Roma. Un solo formato di data per entrambe le granularità; il preset "12 mesi" parte a metà mese. |
| **OQ-31** | Un errore di scrittura dello storico **non** rende `/health` `degraded`: va solo nel log `forecast_update` (`history_failed`, `history_error`) e in `console.error`. D1 non leggibile → `/history` **503** con `detail` "Storico temporaneamente non disponibile". | `/health` misura la freschezza delle previsioni ed è coperto dalla parità FR-26/FR-50; lo storico è uno storage distinto e non influisce su `/forecast` (FR-72, R-12). L'upsert dell'esecuzione successiva rimedia da solo. Messaggio generico per non esporre dettagli SQL. |
| **OQ-32** | Medie mensili arrotondate a **1 decimale** (temperature) e **2 decimali** (onde) con `ROUND` di SQLite; min/max non riarrotondati. `Cache-Control` **900 s** (breve) e **86.400 s** (lungo), configurabili. | Stessa precisione dei valori giornalieri (FR-7, FR-8). Il giorno corrente cambia al più ogni 6 h: 15 min limitano il ritardo dopo un'esecuzione. Il passato è immutabile (upsert solo sul giorno 0, nessun backfill): 24 h come `/locations`, durata limitata nel caso di future cancellazioni (OQ-36). |
| **OQ-33** | `fl_chart` ^1.2.0; stato del mare come fascia colorata + legenda + etichetta in tabella; tabella a righe a due livelli ad altezza fissa, senza scorrimento orizzontale (§4). | Licenza MIT, API che copre banda e interruzioni senza codice di disegno; righe a due livelli leggibili su 360 dp; liste pigre ad altezza fissa per NFR-26. |
| **OQ-35** | Scritture in blocchi da 100 righe con un parametro JSON (`json_each`), tutte in un `batch()`: **1** query con 13 località, **5** con 500. Capacità: ~150-190 byte per riga con la PK `WITHOUT ROWID` → 500 × 10 anni ≈ **280-350 MB**; con 13 località ≈ 8 MB in 10 anni. Go/no-go: **nessuna nuova soglia** per query e righe; **segnalazione nel log** `paid_alerts: d1_size` quando `size_after` del batch supera `PAID_ALERT_D1_SIZE_MB` (default **350**, 70% di 500 MB). | Le istruzioni D1 sono contate nelle subrequest e quindi già coperte dalla soglia (b) di 40 e dal tetto di 45 (< 50 query). Righe scritte 4·N/giorno (52 con 13 località, 2.000 con 500) contro 100.000/giorno Free; righe lette ≤ ~7.500 per richiesta mensile di 10 anni contro 5 M/giorno. I 500 MB Free basterebbero per ~500 località × 10 anni al limite della stima, scala a cui si è comunque su Paid (NFR-19, 10 GB); la segnalazione costa solo la lettura di `meta.size_after`. Inserirla nella regola formale di NFR-15 è una decisione dell'owner. |

## Consequences
- **Più semplice**: una tabella, due query di lettura e una di scrittura, testo SQL fisso; la
  pubblicazione del cache KV non dipende da D1; `/history` non legge la KV; `/forecast`, `/health`,
  `/locations` e `meta` invariati (FR-81).
- **Più difficile**: nuovo servizio Cloudflare (creazione del database, migrazioni da applicare
  prima del deploy, binding nei test con Miniflare e `applyD1Migrations` in un file di setup di
  Vitest); due storage distinti (R-12: dopo un errore D1 lo storico di un giorno può mancare o
  riflettere un'esecuzione precedente).
- **Vincoli**: su Free la soglia (b) scende a ~35 località; `HISTORY_WRITE_BATCH_ROWS` ≤ 400 per
  restare sotto 100 KB anche se il parametro contasse nella lunghezza dell'istruzione.
- **Da verificare in sviluppo**: supporto di `WITHOUT ROWID`, `json_each` e funzioni finestra nella D1
  di Miniflare del pool in uso (test della migrazione e delle query); API per applicare le migrazioni
  con `@cloudflare/vitest-pool-workers` 0.23; resa di `BetweenBarsData` con `nullSpot` (test widget o
  prova visiva); campo `meta.size_after` nel risultato di `batch()`.
- **Conservazione** (OQ-36, owner): il job non cancella mai righe; lo storico di uno slug rimosso dal
  catalogo resta nel database ma non è interrogabile (`/history` risponde 404); uno slug rinominato
  riparte da zero.
- **Rischio R-10/R-11**: valori previsti con `best_match`, giorno stabile solo dopo l'ultima
  esecuzione del giorno; mitigati da FR-82/FR-90 (nota nell'app e nel README).
