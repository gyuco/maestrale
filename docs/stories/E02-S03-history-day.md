---
id: E02-S03
epic: E02
title: "GET /history con granularità day (validazione, 404, 503)"
type: feature
status: done
requirements: [FR-74, FR-75, FR-77, FR-78, FR-80, FR-81, FR-69, NFR-10, NFR-11, NFR-23]
depends_on: [E02-S02]
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
---

# E02-S03: `GET /history` con granularità `day`

## Context

Nuova route di sola lettura che serve lo storico giornaliero scritto da E02-S02. In questa storia:
parsing e validazione di **tutti** i parametri (anche quelli di `month`), risoluzione della località,
404, 503, query `day`, `HEAD`, CORS. Il ramo `granularity=month` (query SQL, `Cache-Control`) è
completato da E02-S04: **in questa storia una richiesta `month` valida risponde 501** con
`detail` "Granularità mese non ancora disponibile" (placeholder temporaneo, rimosso da E02-S04).

**Requisiti (testo esatto)**
- FR-74: «`GET /history?localita=<valore>&from=<YYYY-MM-DD>&to=<YYYY-MM-DD>&granularity=<day|month>`
  shall risolvere `localita` come `/forecast` (slug o nome normalizzato, FR-22) e considerare
  l'intervallo di date Europe/Rome da `from` a `to`, estremi inclusi. `granularity` è facoltativo,
  default `day`. `from` e `to` sono obbligatori.»
- FR-75: «Con `granularity=day`, la risposta 200 shall contenere slug e nome della località,
  `granularity`, `from`, `to` e l'elenco, ordinato per data crescente, dei record di storico (FR-69)
  della località con data nell'intervallo, ciascuno con la propria data `YYYY-MM-DD`. I giorni senza
  record sono omessi (nessun riempimento); senza alcun record l'elenco è vuoto e la risposta resta
  200.»
- FR-77: 422 con corpo JSON contenente `detail` (in italiano) quando: `localita` assente o vuoto;
  `from` o `to` mancano o non sono date valide `YYYY-MM-DD`; `from` > `to`; `granularity` diverso da
  `day` e `month`; con `day` l'intervallo supera 366 giorni (estremi inclusi); con `month` tocca più
  di 120 mesi di calendario.
- FR-78: «Se la località non è nel catalogo, `/history` shall rispondere 404 con lo stesso formato
  di `/forecast` (`detail.message` come FR-23, `detail.available` come FR-58). Se lo storage dello
  storico non è leggibile, 503 con descrizione in `detail`.»
- FR-80: sola lettura (solo `GET`, più `HEAD` e le preflight), senza autenticazione, stessa
  configurazione CORS di FR-28, mai chiamate ai provider. FR-81: `/forecast`, `/health`,
  `/locations` invariati.

**Decisioni di ADR-0002 §3**
- Ordine di validazione (422, `detail` in italiano, stringa): `localita` assente/vuoto →
  `granularity` presente e non `day`/`month` → `from`/`to` assenti o non date di calendario valide
  (regex `^\d{4}-\d{2}-\d{2}$` + controllo di calendario: `2026-02-30` non valida) → `from` > `to` →
  `day` con più di 366 giorni estremi inclusi → `month` con più di 120 mesi toccati
  (`(anno_to·12 + mese_to) − (anno_from·12 + mese_from) + 1 > 120`). `to` nel futuro è ammesso.
- Poi: località non nel catalogo → **404** `{ "detail": { "message": "Localita '<valore>' non
  trovata", "available": [primi 50 nomi ordinati del catalogo] } }` (come `/forecast`, riusare
  `catalog.ts`/la logica di `routes/forecast.ts`; **nessuna lettura KV**); infine la query D1.
- D1 non leggibile (binding `HISTORY` assente, tabella assente, query fallita) → **503**
  `{ "detail": "Storico temporaneamente non disponibile" }`; errore originale solo in `console.error`.
- Query `day` (1 istruzione, scansione della PK, parametri legati con `bind`):
  `SELECT date, air_temperature_mean_c, air_temperature_min_c, air_temperature_max_c,
  water_temperature_mean_c, state, wave_height_mean_m, wave_height_max_m FROM daily_history WHERE
  location_slug = ?1 AND date BETWEEN ?2 AND ?3 ORDER BY date`. Lo slug viene sempre dal catalogo.
- Risposta 200: `{ "schema_version": 1, "location": { "slug", "name" }, "granularity": "day",
  "from", "to", "timezone": "Europe/Rome", "items": [ { "date", "air_temperature_mean_c",
  "air_temperature_min_c", "air_temperature_max_c", "water_temperature_mean_c", "state",
  "wave_height_mean_m", "wave_height_max_m" } ] }`. Nessun riempimento dei giorni mancanti; `items`
  vuoto → 200. Valori `null` restano `null`.
- `GET`/`HEAD` (HEAD via route GET di Hono come `/locations`), `allowMethods` CORS invariato
  (`["GET"]`), 1 query D1, 0 operazioni KV.

**Moduli/file probabili**: `worker/src/routes/history.ts` (nuovo), `worker/src/history.ts` (aggiunge
`parseHistoryParams` pura che restituisce un valore tipizzato `ok | invalid(detail)`),
`worker/src/history_store.ts` (aggiunge `readDays(db, slug, from, to)` con esito tipizzato
`ok`/`unreadable`, mai eccezioni), `worker/src/index.ts` (`app.route("/history", historyRoutes)`),
`worker/src/env.ts`, test nuovi `worker/test/history_params.test.ts`,
`worker/test/history_store_read.test.ts`, `worker/test/history_route.test.ts`.

## Acceptance criteria

- **AC-1** — Given `GET /history?localita=Cagliari&from=2026-10-14&to=2026-10-20` (nome o slug,
  `granularity` assente) con righe presenti in D1, when richiesto, then 200 con l'involucro di
  ADR-0002 (`schema_version`, `location.{slug,name}`, `granularity: "day"`, `from`, `to`,
  `timezone: "Europe/Rome"`, `items`) e `items` ordinati per data crescente, ciascuno con i campi
  elencati; nome ("Torre dei Corsari") e slug ("torre-dei-corsari") danno la stessa risposta (FR-74,
  FR-75).
- **AC-2** — Given estremi inclusi e giorni mancanti nell'intervallo, when richiesto, then compaiono
  solo i giorni con record in [`from`, `to`], nessun riempimento; un record con data = `from` e uno
  con data = `to` sono inclusi; i record fuori intervallo e di altre località sono esclusi.
- **AC-3** — Given nessun record nell'intervallo (o località appena aggiunta al catalogo), when
  richiesto, then 200 con `items: []` (non 404).
- **AC-4** — Given valori `null` in D1, when richiesto, then i campi corrispondenti sono `null` nel
  JSON (non omessi, non 0); i valori numerici coincidono con quelli scritti dal job (FR-69).
- **AC-5** — Given i casi non validi, when richiesti, then 422 con `detail` testuale in italiano:
  `localita` assente o `""`; `granularity=week`; `from` assente; `to` assente; `from=2026-13-01`;
  `from=2026-02-30`; `from=26-10-14`; `from` > `to`; `day` con 367 giorni (366 è ammesso); `month`
  con 121 mesi toccati (120 è ammesso; verificare anche l'esempio che attraversa il cambio anno).
  `to` nel futuro (es. domani) è accettato.
- **AC-6** — Given una località non nel catalogo (`localita=Atlantide`), when richiesto, then 404 con
  `detail.message` = `"Localita 'Atlantide' non trovata"` e `detail.available` = primi 50 nomi
  ordinati del catalogo; con un catalogo di ≤ 50 voci l'elenco è completo; nessuna lettura KV né D1
  (verificabile con binding `FORECASTS` e `HISTORY` che lanciano se usati).
- **AC-7** — Given binding `HISTORY` assente, tabella inesistente o query che fallisce, when
  richiesto con parametri validi, then 503 con `detail` = `"Storico temporaneamente non disponibile"`
  senza testo SQL o messaggi dell'errore originale; l'errore originale è passato a `console.error`.
- **AC-8** — Given `HEAD /history?…` valido, then stessi status e header di `GET` senza corpo;
  `OPTIONS` di preflight e CORS (`CORS_ORIGINS`) si comportano come per le altre route; `POST`/`PUT`/
  `DELETE` non esistono (404/405, nessuna scrittura, FR-80, NFR-11).
- **AC-9** — Given `granularity=month` con parametri validi, when richiesto in questa storia, then
  501 con `detail` "Granularità mese non ancora disponibile" (placeholder, sostituito da E02-S04).
- **AC-10** — I test esistenti (`/forecast`, `/health`, `/locations`, job, parità) restano verdi
  senza modifiche alle fixture (FR-81); `npm run typecheck` 0 errori.

## Tasks

- [x] Scrivere i test falliti: `history_params.test.ts` (AC-5, confini 366/367, 120/121, date di
      calendario), `history_store_read.test.ts` con D1 di Miniflare (AC-1 ordine, AC-2, AC-4),
      `history_route.test.ts` con route + D1 reale e D1 finta che fallisce (AC-1, AC-3, AC-6..AC-9)
- [x] Implementare `parseHistoryParams` in `worker/src/history.ts` (AC-5)
- [x] Implementare `readDays` in `worker/src/history_store.ts` con esito tipizzato (AC-1, AC-2, AC-4)
- [x] Implementare `worker/src/routes/history.ts`: validazione → catalogo (404) → D1 (503) →
      risposta (AC-1..AC-9) e montarla in `worker/src/index.ts`
- [x] Verificare che `GET /history` non legga KV e non chiami `fetch` (AC-6)
- [x] Eseguire i comandi di `verify` (AC-10)
- [x] Compilare Dev notes

## Dev notes
- `parseHistoryParams` (history.ts): validazione pura nell'ordine di ADR-0002 §3; date di calendario verificate con `Date.UTC` (round-trip), nessun orologio (`to` nel futuro ammesso, quindi nessuna dipendenza dall'ora).
- `readDays` (history_store.ts): esito `ok|unreadable` (`{ok:false,error}`), mai eccezioni; binding assente = errore gestito.
- `routes/history.ts`: 422 -> catalogo 404 (riuso di `notFound` di forecast.ts, ora esportata) -> 501 placeholder per `month` -> D1 (503 generico, errore solo in `console.error`). Montata in index.ts; CORS invariato.
- Il 404 precede la query D1 e non tocca KV/D1 (testato con binding Proxy che lanciano). `Cache-Control` non emesso (spetta a E02-S04/FR-79).
- Test nuovi: history_params.test.ts, history_store_read.test.ts, history_route.test.ts. `npm test` 268/268, `npm run typecheck` 0 errori.

## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
<!-- Reviewer: date, verdict, findings R-1… (blocker/should/nit) with file:line. -->
### 2026-10-20 — verdict: done
Verify: `npm test` 268/268, `npm run typecheck` 0 errori. Ordine 422 → 404 → 501 → D1 conforme ad
ADR-0002 §3 (`routes/history.ts:20-36`); 503 generico; SQL fisso con `bind`; `notFound` esportata
senza modifiche di comportamento per `/forecast`. Nessun blocker.
- **R-1 (should)** `worker/test/history_route.test.ts:183-208` — AC-7 verifica solo
  `toHaveBeenCalledTimes(3)`, non che l'errore originale arrivi a `console.error`. Fix: asserire
  che `error.mock.calls[i][0]` contenga `"boom"` / `"no such table"` / `"Binding D1 HISTORY"`.
- **R-2 (should)** `worker/test/history_route.test.ts:161-214` — l'ordine fra fasi non è testato a
  livello di route: mancano `localita=Atlantide` + date non valide → 422 (non 404),
  `localita=Atlantide&granularity=month` → 404 (non 501), e `granularity=month` valida con
  `HISTORY: throwing` → 501 (nessun accesso D1). Fix: aggiungere i tre casi (utile anche come
  rete per E02-S04).
- **R-3 (nit)** `worker/src/history.ts:73-85` — `Date.UTC` mappa gli anni 0..99 su 1900..1999, quindi
  `0050-01-01` viene rifiutata come data non valida pur rispettando il formato. Irrilevante in
  pratica; se si vuole correttezza, usare `new Date(0).setUTCFullYear(year, month - 1, day)`.
- **R-4 (nit)** `worker/test/history_route.test.ts:218-225` — HEAD confronta solo `content-type`;
  AC-8 chiede "stessi header". Confrontare anche `access-control-allow-origin` / `content-length`
  assente o l'insieme degli header.
- **R-5 (nit)** `worker/test/history_route.test.ts:191-199` — "tabella inesistente" è simulata con
  una D1 finta; un caso con D1 reale dopo `DROP TABLE` in una transazione isolata darebbe copertura
  reale (opzionale).
