---
id: E02-S02
epic: E02
title: "Scrittura a blocchi dello storico nel job scheduled"
type: feature
status: done
requirements: [FR-69, FR-70, FR-71, FR-72, FR-73, FR-52, FR-81, NFR-3, NFR-15, NFR-18, NFR-21, NFR-25]
depends_on: [E02-S01]
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
---

# E02-S02: Scrittura a blocchi dello storico nel job `scheduled`

## Context

Dopo la pubblicazione del cache KV, il job scrive in D1 una riga di storico (giorno 0) per ogni
località aggiornata con successo. Un errore D1 non deve mai bloccare né annullare il cache.

**Requisiti (testo esatto)**
- FR-69: al massimo un record per (slug, data Europe/Rome) con `air_temperature_mean_c`,
  `air_temperature_min_c`, `air_temperature_max_c` (da `weather`, FR-8), `water_temperature_mean_c`,
  `state`, `wave_height_mean_m`, `wave_height_max_m` (da `sea`, FR-7, FR-10). «I valori sono
  identici, compresi arrotondamenti e `null`, a quelli che `/forecast` serve per quel giorno dopo la
  stessa esecuzione.»
- FR-70: «A ogni esecuzione del job (FR-49), per ogni località aggiornata con successo, il sistema
  shall scrivere il record del giorno 0 con semantica di upsert […]. Se la previsione non contiene
  il giorno 0, nessun record è scritto per quella località e il fatto è registrato nell'esito
  dell'esecuzione (FR-52).» Giorno 0 = giorno della previsione la cui data (Europe/Rome) coincide
  con la data di esecuzione del job nello stesso fuso.
- FR-71: «Una località fallita nell'esecuzione (FR-18, inclusi i casi di interruttore e di budget
  esaurito di FR-54) shall non scrivere né modificare alcun record di storico».
- FR-72: «Un errore di scrittura dello storico (parziale o totale) shall essere registrato
  nell'esito dell'esecuzione (FR-52, con numero di record non scritti e messaggio) e shall non
  impedire né annullare l'aggiornamento del cache delle previsioni […]. L'errore non è aggiunto a
  `errors[<slug>]`, quindi non cambia `/health`.»
- FR-73 / NFR-11: lo storico è scritto solo dal job; nessun endpoint di scrittura.
- NFR-15, NFR-25: le istruzioni D1 contano come subrequest nel budget; < 5 s nominali.

**Decisioni di ADR-0002 §2** (da seguire alla lettera)
1. Data del giorno 0 = data Europe/Rome dell'**avvio** del job (`Intl.DateTimeFormat` con
   `timeZone: "Europe/Rome"`, formato `YYYY-MM-DD`, usa il `now` iniettato).
2. Per ogni località **aggiornata** (`updated_locations`) si prende dalla **stessa** previsione
   scritta in `forecast:<slug>` l'elemento di `daily` con `date` = giorno 0 e se ne copiano i 7
   valori così come sono. Elemento mancante: nessuna riga, slug in `history_missing_day0`. Non
   producono righe: località fallite, località solo "seed" da `latest` (migrazione), interruttore,
   budget esaurito.
3. Righe divise in blocchi di `HISTORY_WRITE_BATCH_ROWS` (default **100**, ammesso 1..400; fuori
   range → default/clamp come le altre variabili in `worker/src/config.ts`); un'istruzione per
   blocco con **un solo parametro** (JSON array di oggetti con i nomi di FR-69 più `location_slug`
   e `date`):
   `INSERT INTO daily_history (…9 colonne…) SELECT json_extract(value,'$.location_slug'),
   json_extract(value,'$.date'), … FROM json_each(?1) WHERE true ON CONFLICT (location_slug, date)
   DO UPDATE SET <le 7 colonne di valore> = excluded.<colonna>`.
4. Tutte le istruzioni in **un solo `HISTORY.batch()`** (transazione), eseguito **dopo** `put meta`.
   **Un solo tentativo.** Qualunque eccezione (binding assente, tabella mancante, quota, rete) è
   catturata: righe non scritte = tutte; messaggio nel log (`history_failed`, `history_error`) e
   `console.error`; `errors[<slug>]`, `meta` e `/health` invariati.
5. Nessuna località aggiornata → nessuna scrittura (né KV né D1).
6. **Budget**: le ⌈N/`HISTORY_WRITE_BATCH_ROWS`⌉ istruzioni D1 si aggiungono alle operazioni
   riservate del `RunBudget` (stesso meccanismo delle scritture KV riservate, ADR-0003 §4.8), così
   `UPDATE_MAX_SUBREQUESTS` (45 su Free) garantisce anche < 50 query D1. Con 13 località: 17 → **18**
   subrequest nominali; formula soglia (b): `2·⌈N/50⌉ + N + 2 + ⌈N/100⌉`.
7. Iniettabile: `runUpdate` riceve `deps.history` (interfaccia `HistoryWriter`); in `index.ts`
   l'handler `scheduled` ne costruisce uno da `env.HISTORY`. I test del job usano un finto, i test di
   `history_store.ts` usano la D1 di Miniflare.

**Moduli (architettura §3)**
- `worker/src/history.ts` (nuovo, funzioni pure): `romeDate(instant: Date): string`;
  `dayZeroRow(slug, forecast, date): HistoryRow | null` (null se `daily` non ha `date`); lista
  etichette Douglas non duplicata (usa quella di `aggregate.ts`, esportandola se serve).
- `worker/src/history_store.ts` (nuovo): `writeHistory(db, rows, batchRows): Promise<HistoryWriteResult>`
  con esito tipizzato (`ok` con `rows_written`, `queries`, `size_after?`, `rows_written_meta?`, oppure
  `unreadable`/errore con messaggio e `rows_failed`), mai eccezioni verso il chiamante.
- `worker/src/update.ts`: aggiunge `deps.history?: HistoryWriter`, riserva budget, chiama il writer
  dopo `put meta`, aggiunge le metriche a `UpdateMetrics`/`UpdateResult`.
- `worker/src/config.ts`: `HISTORY_WRITE_BATCH_ROWS`, `PAID_ALERT_D1_SIZE_MB` (default 350).
- `worker/src/index.ts`: log `forecast_update` con i campi di storico.

**Log `forecast_update` (NFR-18, NFR-21, FR-52)**: nuovi campi `history_date`, `history_rows` (righe
scritte), `history_queries`, `history_failed` (righe non scritte), `history_error`,
`history_missing_day0` (array di slug), `d1_rows_written`, `d1_size_bytes` (da `meta` del risultato
D1, se presente). `paid_alerts` contiene `d1_size` se `size_after` > `PAID_ALERT_D1_SIZE_MB` × 1 MiB
(proposta OQ-35). `console.error` per ogni errore dello storico.

**Rischio noto**: se un'esecuzione D1 fallisce sull'ultima esecuzione del giorno, il giorno ha il
valore di un'esecuzione precedente o nessun record (R-11/R-12, accettato).

## Acceptance criteria

- **AC-1** — Given una previsione con `daily` contenente la data di oggi Europe/Rome, when
  `dayZeroRow` è chiamata, then restituisce un oggetto con `location_slug`, `date` e i 7 valori
  **strettamente uguali** (stessi numeri, stessi `null`, stessa stringa `state`) a quelli di
  `daily[d0]` (FR-69); se `daily` non contiene quella data restituisce `null`.
- **AC-2** — Given istanti a cavallo della mezzanotte locale (es. `2026-10-24T22:30:00Z`, `2026-10-24T21:59:00Z`,
  `2026-03-28T23:30:00Z`, `2026-10-31T23:30:00Z`), when si chiama `romeDate`, then restituisce la
  data Europe/Rome corretta nei cambi d'ora legale/solare.
- **AC-3** — Given 13 righe (una per località), when `writeHistory` è chiamata con D1 di Miniflare,
  then le righe sono scritte con una sola istruzione (`queries = 1`); chiamata di nuovo con gli
  stessi slug e data ma valori diversi, then restano 13 righe con i nuovi valori (upsert, FR-70).
- **AC-4** — Given 100 righe, when scritte, then 1 istruzione; given 101 righe, then 2 istruzioni
  nello stesso `batch()`; con `HISTORY_WRITE_BATCH_ROWS = 1..400` rispettato (cfr. config).
- **AC-5** — Given una riga con `null` su tutti i 7 valori e una con valori decimali, when scritte e
  riletta con `SELECT`, then i `null` tornano `null` e i `number` tornano identici (FR-69, giro di
  andata e ritorno).
- **AC-6** — Given un job con una località aggiornata e `HistoryWriter` finto, when `runUpdate`
  termina, then il writer è stato chiamato **dopo** `put meta` con la riga della sola località
  aggiornata e con la data Europe/Rome dell'avvio (FR-70).
- **AC-7** — Given una località fallita (errore provider, interruttore del fallback, budget
  esaurito, seed da `latest`), when il job termina, then il writer non riceve nessuna riga per quella
  località (FR-71).
- **AC-8** — Given una previsione senza il giorno 0, when il job termina, then nessuna riga per
  quella località, lo slug è in `history_missing_day0` nel risultato/log (FR-70, FR-52).
- **AC-9** — Given un `HistoryWriter` che lancia o restituisce errore (es. tabella mancante nella D1
  reale di Miniflare, binding `HISTORY` assente), when il job termina, then: il job **non rigetta**;
  `forecast:<slug>` e `meta` sono identici a quelli di un'esecuzione senza storico; `errors` e
  `/health` invariati; il risultato riporta `history_failed` = numero di righe non scritte e
  `history_error` con il messaggio; `console.error` è stato chiamato (FR-72).
- **AC-10** — Given nessuna località aggiornata, when il job termina, then né KV né D1 vengono
  scritte (writer non chiamato).
- **AC-11** — Given 13 località e tutto riuscito, when il job termina, then `subrequests` nominali
  = 18 (era 17) e `history_queries` = 1; given budget di subrequest basso, then le istruzioni D1
  sono riservate (il job non supera `UPDATE_MAX_SUBREQUESTS`) (NFR-15).
- **AC-12** — Given `size_after` del batch > `PAID_ALERT_D1_SIZE_MB`, when il job termina, then
  `paid_alerts` contiene `d1_size`; sotto soglia o con `size_after` assente non lo contiene.
- **AC-13** — Nessuna route di scrittura è introdotta (FR-73): i test esistenti di
  `/forecast`, `/health`, `/locations`, job e parità restano verdi senza modifiche alle fixture
  (FR-81; i test del job che contavano 17 subrequest sono aggiornati solo nel numero, motivando la
  modifica nelle Dev notes).

## Tasks

- [x] Scrivere i test falliti: `worker/test/history.test.ts` (AC-1, AC-2),
      `worker/test/history_store.test.ts` con D1 di Miniflare (AC-3, AC-4, AC-5, AC-12 parte
      `size_after`), `worker/test/update_history.test.ts` con `HistoryWriter` finto (AC-6..AC-11)
- [x] Implementare `worker/src/history.ts` (AC-1, AC-2)
- [x] Implementare `worker/src/history_store.ts` (AC-3, AC-4, AC-5)
- [x] Aggiungere le variabili in `worker/src/config.ts` con validazione e default (AC-4, AC-12)
- [x] Integrare in `worker/src/update.ts`: riserva di budget, chiamata dopo `put meta`, cattura
      errori, metriche (AC-6..AC-11)
- [x] Cablare `HistoryWriter` da `env.HISTORY` e i nuovi campi del log in `worker/src/index.ts`
      (AC-9, AC-12)
- [x] Verificare il giro completo con un test di integrazione `scheduled` su D1 di Miniflare
      (righe presenti dopo il job; tabella assente → cache intatto)
- [x] Eseguire i comandi di `verify` e controllare AC-13
- [x] Compilare Dev notes (formula subrequest aggiornata, esito `meta.size_after`)

## Dev notes
- Nuovi: `worker/src/history.ts` (`romeDate`, `dayZeroRow`, `HistoryRow`), `worker/src/history_store.ts`
  (`writeHistory`, `HistoryWriter`, `d1HistoryWriter`; esito `ok`/`ok:false`, mai eccezioni). Modificati:
  `config.ts` (`historyWriteBatchRows` 100 clamp 1..400, `paidAlertD1SizeMb` 350, env `HISTORY_WRITE_BATCH_ROWS`,
  `PAID_ALERT_D1_SIZE_MB`), `update.ts` (`deps.history`, riserva budget, scrittura dopo `put meta`, metriche), `index.ts`
  (writer da `env.HISTORY`, campi nel log). Test: `history.test.ts`, `history_store.test.ts` (D1 Miniflare),
  `update_history.test.ts` (finto + integrazione `scheduled`).
- Senza `deps.history` nulla cambia (17/18 subrequest): i test esistenti del job restano invariati. Con il writer la
  riserva è ⌈catalogo/batch⌉ e il conteggio effettivo aggiunge le istruzioni eseguite (0 se nessuna riga). Prima
  esecuzione (get latest) = 19, successive = 18 con 13 località.
- L'unica modifica a un test esistente: `update.test.ts` (scheduled) asserisce `subrequests: 19` e
  `history_queries: 1` (era 18), perché lo `scheduled` usa ora il writer D1; l'orologio è fissato con
  `vi.setSystemTime` al 2026-10-19 (giorno 0 presente nelle fixture), quindi i valori sono costanti; motivo: AC-13.
- Fix review: R-1 orologio fisso + costanti; R-2 caso parziale reale (date di Cagliari spostate nelle risposte
  provider, 12 righe, `history_missing_day0 = ["cagliari"]`); R-3 `writeHistory` in errore riporta `queries` = istruzioni
  tentate (0 se binding assente; 1 con tabella mancante), asserito in `history_store.test.ts`; R-4 test AC-7 con
  interruttore e località comunque aggiornate dal blocco.
- `now()` iniettato è chiamato all'avvio solo se `deps.history` è presente (il test "generated_at" conta le chiamate).
- Lista etichette Douglas non toccata: serve solo a E02-S04 (moda mensile), non a questa storia.
- `size_after`: letto da `meta.size_after` dei risultati di `batch()`; in Miniflare può essere assente/0, il test
  lo verifica solo se presente. Il test AC-12 usa un writer finto.
- Formula soglia (b) aggiornata come da ADR: `2·⌈N/50⌉ + N + 2 + ⌈N/100⌉`.

## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
<!-- Reviewer: date, verdict, findings R-1… (blocker/should/nit) with file:line. -->

### 2026-10-20 — changes-requested
Verify: `npm test` 222/222 verdi, `npm run typecheck` ok. Implementazione conforme ad ADR-0002 §2
(scrittura dopo `put meta`, un solo `batch()`, riserva ⌈catalogo/batch⌉ nel `RunBudget`, errori D1
catturati senza toccare `errors`/`meta`, nessun `any`).

- **R-1 (blocker)** `worker/test/update.test.ts:361-362` — l'asserzione `subrequests: 18` è
  sostituita da `18 + history_queries` senza vincolare `history_queries`: il test passa per qualunque
  numero di istruzioni D1 (es. 5 per un bug di blocchi) e il valore atteso dipende dalla data reale
  di esecuzione. Non è "aggiornato solo nel numero" (AC-13) ed è un indebolimento. Fix: fissare
  l'orologio come già fatto in `update_history.test.ts:250-251` (`vi.useFakeTimers({ toFake: ["Date"] })`
  + `vi.setSystemTime` su una data presente nelle fixture) e asserire costanti: `subrequests: 19`,
  `history_queries: 1` (oppure data fuori fixture → `18` e `0`), motivando nelle Dev notes.
- **R-2 (should)** `worker/test/update_history.test.ts:178-184` — il test "giorno 0 mancante solo per
  alcune: scrive le altre" non verifica quanto dichiara (tutte le 13 hanno il giorno 0). Fix:
  costruire il caso parziale (es. una località con `daily` privo di d0 tramite fixture/provider
  finto) e verificare righe = 12 e `history_missing_day0` = [slug]; altrimenti rimuovere/rinominare.
- **R-3 (nit)** `worker/src/history_store.ts:87` — in errore `queries: 0` anche quando `batch()` è
  stato tentato con N istruzioni: le subrequest effettive del log risultano sottostimate. Valutare
  `queries: statements.length` se l'eccezione avviene dopo `db.batch(...)` (budget comunque già
  riservato, quindi nessun superamento del tetto).
- **R-4 (nit)** `worker/test/update_history.test.ts:133-140` — il caso "interruttore" copre AC-10
  (nessuna aggiornata) ma non AC-7 con interruttore e alcune località aggiornate dal blocco; aggiungere
  se praticabile con `fakeProvider`.

### 2026-10-20 — done (ri-verifica)
Verify: `npm test` 223/223 verdi, `npm run typecheck` ok.
- R-1 risolto: `worker/test/update.test.ts` fissa l'orologio (`vi.useFakeTimers({ toFake: ["Date"] })`
  + `setSystemTime("2026-10-19T09:00:00Z")`, ripristino in `finally`) e asserisce costanti
  `history_queries = 1`, `subrequests = 19`; nessun altro campo del test indebolito.
- R-2 risolto: `worker/test/update_history.test.ts:199-226` sposta il giorno 0 solo per Cagliari;
  asserisce 12 righe, Cagliari aggiornata ma assente dalle righe, `history_missing_day0 = ["cagliari"]`.
- R-3 risolto: `worker/src/history_store.ts:61-89` riporta `queries` = istruzioni tentate; asserito
  (1 con tabella mancante, 0 con binding assente) in `history_store.test.ts:111,120`.
- R-4 risolto: `update_history.test.ts:142-161` interruttore con località aggiornate dal blocco;
  righe = esattamente `updated_locations`, nessuna fallita.
Nessun nuovo finding.
