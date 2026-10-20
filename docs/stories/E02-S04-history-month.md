---
id: E02-S04
epic: E02
title: "GET /history con granularità month, Cache-Control e rifinitura errori"
type: feature
status: done
requirements: [FR-76, FR-77, FR-78, FR-79, FR-80, FR-81, NFR-23, NFR-26]
depends_on: [E02-S03]
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
---

# E02-S04: `GET /history` con granularità `month`, `Cache-Control` e rifinitura errori

## Context

Completa `/history` (route e validazione esistono da E02-S03): aggregazione mensile **in una sola
query SQL**, header `Cache-Control` per entrambe le granularità e verifica finale dei casi 404/422/503.

**Requisiti (testo esatto)**
- FR-76: «Con `granularity=month`, la risposta 200 shall contenere un elemento per ogni mese di
  calendario (`YYYY-MM`) che ha almeno un record nell'intervallo, ordinati per mese crescente,
  calcolato sui soli record con data in [`from`, `to`]: media di `air_temperature_mean_c`, minimo di
  `air_temperature_min_c`, massimo di `air_temperature_max_c`, media di `water_temperature_mean_c`,
  media di `wave_height_mean_m`, massimo di `wave_height_max_m`, `state` = moda degli stati
  giornalieri (a parità di frequenza vince lo stato più alto della scala Douglas di FR-10), `days` =
  numero di record aggregati. I valori `null` sono ignorati; se tutti i valori di un campo sono
  `null` il risultato è `null`. L'aggregazione è eseguita nello storage (SQL). Arrotondamento a 1
  decimale per le temperature e a 2 decimali per le onde.»
- FR-79: «La risposta 200 di `/history` shall includere `Cache-Control` pubblico **breve** se `to` è
  uguale o successivo alla data odierna Europe/Rome, **lungo** se l'intervallo è interamente nel
  passato. Entrambe le durate sono configurabili senza modificare il codice (proposta: 15 min e 24
  h).»
- FR-77 / FR-78 / FR-80 / FR-81: come in E02-S03 (422, 404, 503, sola lettura, additività).

**Decisioni di ADR-0002 §3**
- Query `month` (1 istruzione; parametri `?1` slug, `?2` from, `?3` to):
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
  dalla lista ordinata delle etichette FR-10 esportata da `aggregate.ts` (unica fonte: "Calmo",
  "Quasi calmo", "Poco mosso", "Mosso", "Molto mosso", "Agitato", "Molto agitato", "Grosso", "Molto
  grosso", "Tempestoso"); un test verifica che il `CASE` copra tutte le etichette. A parità di
  frequenza vince il rango più alto.
- `AVG`/`MIN`/`MAX` ignorano i `NULL`; tutti `NULL` → `NULL`; mese senza stati → `state` `null`;
  `days` = `COUNT(*)` dei record del mese nell'intervallo (mesi parziali rivelati da `days`). Gli
  aggregati mensili sono valori nuovi (non soggetti alla parità FR-51). `from`/`to` restano
  `YYYY-MM-DD`.
- Risposta 200 `month`: stesso involucro di `day` con `granularity: "month"` e `items` di forma
  `{ month: "YYYY-MM", days, air_temperature_mean_c, air_temperature_min_c, air_temperature_max_c,
  water_temperature_mean_c, state, wave_height_mean_m, wave_height_max_m }`. Mesi senza record
  omessi; nessun record → `items: []`, 200.
- `Cache-Control` (200, `day` e `month`): `public, max-age=<HISTORY_MAX_AGE_SHORT_SECONDS>` (default
  **900**) se `to` ≥ oggi Europe/Rome (`romeDate(now)`, `now` iniettabile per i test), altrimenti
  `public, max-age=<HISTORY_MAX_AGE_LONG_SECONDS>` (default **86400**). Variabili in
  `worker/src/config.ts` con validazione come le altre (non numeriche/negative → default). **Nessun
  header di cache sulle risposte d'errore** (404, 422, 503, 501).
- 503 / 404 / 422: come E02-S03 (il 501 placeholder di `month` viene rimosso).

**Moduli/file probabili**: `worker/src/history_store.ts` (aggiunge `readMonths`), `worker/src/history.ts`
(`stateRankCase()`, `cacheControlFor(to, today, config)`), `worker/src/aggregate.ts` (solo export
della lista etichette se non già esportata), `worker/src/config.ts`, `worker/src/routes/history.ts`,
test: `history_months.test.ts`, estensione di `history_route.test.ts`.

## Acceptance criteria

- **AC-1** — Given record giornalieri di due mesi con valori noti, when `granularity=month`, then
  un elemento per mese in ordine di mese crescente, con `days` corretto e: media aria media a 1
  decimale, minimo delle minime, massimo delle massime, media mare a 1 decimale, media onda media a 2
  decimali, massimo onda massima, calcolati sui soli giorni con data in [`from`, `to`] (FR-76).
- **AC-2** — Given un intervallo che parte a metà mese e finisce a metà di un altro, when richiesto,
  then i mesi parziali sono aggregati solo sui giorni nell'intervallo e `days` lo riflette.
- **AC-3** — Given valori `null` sparsi, when aggregati, then sono ignorati nel calcolo; se tutti i
  valori di un campo nel mese sono `null` il campo è `null` (non 0); `days` conta comunque i record.
- **AC-4** — Given un mese con stati {Poco mosso ×3, Mosso ×2}, then `state` = "Poco mosso" (moda);
  given {Poco mosso ×2, Mosso ×2}, then "Mosso" (pareggio → rango Douglas più alto); given {Calmo ×1,
  Tempestoso ×1}, then "Tempestoso"; given tutti gli stati `null`, then `state` = `null`.
- **AC-5** — Given il `CASE` del rango generato dalla lista di `aggregate.ts`, then contiene tutte le
  10 etichette di FR-10 in ordine (test che fallisce se si aggiunge un'etichetta non coperta).
- **AC-6** — Given nessun record nell'intervallo o mesi senza record, then `items` contiene solo i
  mesi con almeno un record; nessun record → `items: []` e 200; l'aggregazione è eseguita con **una
  sola** `prepare/bind` D1 per richiesta (verificabile con un wrapper che conta le query, NFR-23).
- **AC-7** — Given `to` = oggi Europe/Rome, `to` nel futuro, o `to` = ieri, when richiesto (`day` e
  `month`), then `Cache-Control` = `public, max-age=900` per oggi e futuro, `public, max-age=86400`
  per ieri e prima; con variabili `HISTORY_MAX_AGE_SHORT_SECONDS=60` e
  `HISTORY_MAX_AGE_LONG_SECONDS=3600` i valori cambiano senza modifiche di codice. Test con orologio
  iniettato anche a cavallo della mezzanotte locale (es. 22:30 UTC con ora legale: "oggi" Roma è già
  il giorno dopo).
- **AC-8** — Given errori 404, 422, 503 e richieste `HEAD`, then le risposte d'errore non hanno
  `Cache-Control`; `HEAD` 200 ha lo stesso `Cache-Control` di `GET`; il placeholder 501 di E02-S03 non
  esiste più.
- **AC-9** — Given `month` con 120 mesi toccati ammessi su 10 anni di dati simulati (≈ 3.650 righe),
  when richiesto, then 200 con ≤ 120 elementi (test di scala: nessun errore, esecuzione in tempo
  ragionevole nei test).
- **AC-10** — Given D1 che fallisce nella query `month`, then 503 "Storico temporaneamente non
  disponibile" (come E02-S03); errore originale solo nel log.
- **AC-11** — I test esistenti restano verdi senza modifiche alle fixture (FR-81); `npm run
  typecheck` 0 errori.

## Tasks

- [x] Scrivere i test falliti: `history_months.test.ts` con D1 di Miniflare (AC-1..AC-6, AC-9), test
      di `cacheControlFor` e della route con orologio iniettato (AC-7, AC-8), 503 su `month` (AC-10)
- [x] Esportare la lista ordinata delle etichette FR-10 da `aggregate.ts` (se serve) e implementare
      `stateRankCase()` (AC-5)
- [x] Implementare `readMonths` in `worker/src/history_store.ts` con la query di ADR-0002 (AC-1..AC-4,
      AC-6)
- [x] Aggiungere `HISTORY_MAX_AGE_SHORT_SECONDS`/`HISTORY_MAX_AGE_LONG_SECONDS` a `config.ts`
      e implementare `cacheControlFor` (AC-7)
- [x] Aggiornare `routes/history.ts`: ramo `month`, header `Cache-Control` solo sulla 200, rimozione
      del 501 (AC-7, AC-8)
- [x] Eseguire i comandi di `verify` (AC-11)
- [x] Compilare Dev notes (eventuali differenze di `ROUND` SQLite rispetto a JS)

## Dev notes
- `aggregate.ts` esporta `SEA_STATE_LABELS` (10 etichette FR-10, derivate da `SEA_STATE_LIMITS` + "Tempestoso"); `history.ts`: `stateRankCase()`, `cacheControlFor(to, today, config)`; `history_store.ts`: `readMonths` (1 sola prepare/bind, esito `ok|unreadable`); `config.ts`: `historyCacheConfigFromEnv` (non numerico/negativo -> default 900/86400); `env.ts`: due nuove variabili; `routes/history.ts`: ramo `month` unificato con `day`, 501 rimosso, `Cache-Control` impostato solo dopo l'esito 200 di D1.
- "Oggi" Europe/Rome = `romeDate(new Date())`; nei test l'orologio è fissato con `vi.useFakeTimers({toFake:["Date"]})` (incluso 22:30 UTC con CEST).
- Rilievi E02-S03 portati qui: R-1 (console.error contiene "Binding D1 HISTORY"/"boom"/"no such table"), R-2 (422 prima di 404, 404 su month, month valido con HISTORY che lancia -> 503 senza Cache-Control). Il vecchio test AC-9 (501) di E02-S03 è sostituito dal 503, come previsto dalla storia.
- ROUND di SQLite: nei test i valori sono scelti non ambigui (es. 18.67 -> 18.7); nessuna differenza osservata rispetto a JS.
- Test: `history_months.test.ts` (nuovo), `history_route.test.ts` esteso. `npm test` 284/284, `npm run typecheck` 0 errori.

## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
<!-- Reviewer: date, verdict, findings R-1… (blocker/should/nit) with file:line. -->

### 2026-10-20 — verdict: done
Verify: `npm test` 284/284, `npm run typecheck` 0 errori. Query mensile conforme ad ADR-0002 §3 (SQL fisso + bind ?1..?3, CASE generato da `SEA_STATE_LABELS`), Cache-Control solo sulla 200, 501 rimosso; sostituzione del test AC-9 di E02-S03 (501 -> 503) legittima: il placeholder era dichiarato temporaneo e il nuovo test asserisce anche l'assenza di Cache-Control.
- R-1 (nit) — `worker/test/history_months.test.ts:173-174`: `toBeGreaterThan(0)` + `toBeLessThanOrEqual(120)` è debole; i 3.650 giorni dal 2017-01-01 coprono esattamente 120 mesi. Fix: `expect(items).toHaveLength(120)` (e opzionalmente primo/ultimo `month`).
- R-2 (nit) — `worker/test/history_months.test.ts:184`: `vi.restoreAllMocks()` senza mock attivi; rimuovere.
- R-3 (nit) — `worker/src/history_store.ts:150`: `readMonthsSql()` ricostruisce la stringa a ogni richiesta; può essere una costante di modulo come `READ_DAYS_SQL`.
