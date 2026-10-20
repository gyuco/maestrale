---
id: E03-S01
epic: E03
title: "Modelli storico, api_errors, rome_date e HistoryApi con http.Client iniettabile"
type: feature
status: done
requirements: [FR-91, FR-89, FR-33, FR-84, FR-85, NFR-6, NFR-10, NFR-13]
depends_on: []
verify:
  - cd app && flutter analyze
  - cd app && flutter test
---

# E03-S01: Modelli storico, `api_errors`, `rome_date` e `HistoryApi`

## Context

Strato dati dell'app per lo storico, senza UI. Testabile senza backend (client HTTP finto). Il
contratto del server è quello di `GET /history` (E02, architettura §5).

**Requisiti (testo esatto)**
- FR-91: «L'app shall accedere a `/history` tramite un componente dedicato (HistoryApi) con
  `http.Client` iniettabile (NFR-13), che costruisce la richiesta di FR-74 sull'URL di FR-48 e
  converte la risposta nei modelli HistoryDay (granularità giorno) e HistoryMonth (granularità
  mese); i campi di valore `null` sono accettati senza errore (diversamente da R-2), mentre una
  risposta strutturalmente non valida produce l'errore "Risposta del server non valida".»
- FR-33 (regole del messaggio d'errore): HTTP ≠ 200, timeout di 15 s o risposta non valida →
  messaggio del backend (`detail` testuale o `detail.message`) oppure messaggio generico con il
  codice HTTP. Timeout app → backend: 15 s (NFR-6).
- FR-84: preset che terminano oggi (incluso): "7 giorni" da oggi − 6 giorni; "30 giorni" da oggi −
  29 giorni; "12 mesi" dal giorno successivo alla stessa data di 12 mesi prima. Date nel fuso
  Europe/Rome (NFR-10).
- FR-85: selettore intervallo personalizzato: fine ≤ oggi, inizio ≤ fine, intervallo ≤ 120 mesi
  toccati (limite FR-77 per `month`).
- FR-48: URL del backend da `--dart-define=API_BASE_URL` (esistente in `app/lib/config/api_config.dart`).

**Contratto della risposta** (200)
`{ "schema_version": 1, "location": {"slug","name"}, "granularity": "day"|"month", "from", "to",
"timezone": "Europe/Rome", "items": [...] }`. Con `day` ogni elemento ha `date` (`YYYY-MM-DD`) e 7
valori: `air_temperature_mean_c`, `air_temperature_min_c`, `air_temperature_max_c`,
`water_temperature_mean_c`, `state` (stringa), `wave_height_mean_m`, `wave_height_max_m` (numeri o
`null`). Con `month` ogni elemento ha `month` (`YYYY-MM`), `days` (intero) e gli stessi 7 valori.
Errori: 404 `{detail: {message, available}}`, 422 `{detail: "testo"}`, 503 `{detail: "testo"}`.

**Architettura app (§3)**
- `app/lib/models/history.dart` (nuovo): `HistoryGranularity { day, month }` (con valore wire
  `day`/`month`), `HistoryDay` (data + 7 valori nullable), `HistoryMonth` (mese `YYYY-MM`, `days` + 7
  valori nullable), `HistoryResult` (slug, nome, granularità, `from`, `to`, elementi). I numeri si
  leggono con `(v as num?)?.toDouble()` (anche interi JSON come `0`).
- `app/lib/services/api_errors.dart` (nuovo): estrazione del messaggio d'errore con le regole di
  FR-33, **estratta dal codice esistente di `ForecastApi`** e condivisa da `ForecastApi` (comportamento
  **invariato**, test esistenti verdi) e `HistoryApi`.
- `app/lib/services/history_api.dart` (nuovo): `HistoryApi({baseUrl, http.Client? client})` con
  `fetchDays(slug, from, to)` e `fetchMonths(slug, from, to)` →
  `GET <baseUrl>/history?localita=<slug>&from=<YYYY-MM-DD>&to=<YYYY-MM-DD>&granularity=<day|month>`,
  timeout 15 s; 200 → `HistoryResult`; errore → eccezione con il messaggio di `api_errors`;
  struttura non valida (JSON non oggetto, `items` mancante/non lista, elemento senza `date`/`month`,
  granularità incoerente, valore non numerico dove atteso) → errore "Risposta del server non valida".
  Slug e date vanno codificati con `Uri` (query parameters), non concatenati.
- `app/lib/services/rome_date.dart` (nuovo): `DateTime romeToday(DateTime utcNow)` → data (solo
  anno/mese/giorno) in Europe/Rome con la regola UE dell'ora legale (dall'ultima domenica di marzo
  01:00 UTC all'ultima domenica di ottobre 01:00 UTC: UTC+2, altrimenti UTC+1); funzioni pure per i
  preset (`last7Days`, `last30Days`, `last12Months` → coppia `from`/`to`), per `firstPickerDate`
  (1° giorno del mese di 119 mesi prima del mese corrente) e per `daysInclusive(from, to)`;
  formattazione `YYYY-MM-DD`. Nessuna nuova dipendenza.
- Gli errori dell'app seguono lo stile esistente (vedere `app/lib/services/forecast_api.dart` e i suoi
  test per il tipo di eccezione e le fixture in `app/test/fixtures.dart`).

**File probabili**: i 4 file nuovi sopra, `app/lib/services/forecast_api.dart` (solo refactoring per
usare `api_errors.dart`), test `app/test/history_models_test.dart`, `history_api_test.dart`,
`rome_date_test.dart`, `api_errors_test.dart`, fixture di risposta in `app/test/`.

## Acceptance criteria

- **AC-1** — Given una risposta 200 `day` con un elemento con tutti i valori e uno con tutti i
  valori `null`, when `fetchDays`, then restituisce un `HistoryResult` con `HistoryDay` corretti; i
  `null` sono accettati senza errore; un intero JSON (`0`, `22`) diventa `double`.
- **AC-2** — Given una risposta 200 `month`, when `fetchMonths`, then elementi `HistoryMonth` con
  mese, `days` e valori (nullable).
- **AC-3** — Given il client finto, when `fetchDays("torre-dei-corsari", 2026-10-14, 2026-10-20)`,
  then la richiesta è `GET {baseUrl}/history?localita=torre-dei-corsari&from=2026-10-14&to=2026-10-20&granularity=day`
  (parametri codificati correttamente; `month` per `fetchMonths`); l'URL base viene da `ApiConfig`
  quando non è passato `baseUrl`.
- **AC-4** — Given HTTP 404 con `detail.message`, 422 e 503 con `detail` testuale, e un altro codice
  senza `detail` (es. 500), when si chiama l'API, then il messaggio d'errore è rispettivamente il
  `detail.message`, il `detail`, e un messaggio generico con il codice HTTP (FR-33, FR-89).
- **AC-5** — Given una risposta non valida (corpo non JSON, JSON non oggetto, `items` mancante,
  `items` non lista, elemento senza `date`, valore di tipo sbagliato), when si chiama l'API, then
  errore "Risposta del server non valida".
- **AC-6** — Given un client che non risponde entro 15 s (futuro mai completato, con timeout
  iniettabile o `fakeAsync`) o che lancia errore di rete, then errore con messaggio in italiano e
  l'API non resta in sospeso.
- **AC-7** — `romeToday` restituisce la data Europe/Rome corretta per: `2026-10-24T22:30Z` (ancora
  CEST → 25 ottobre 00:30), `2026-10-25T00:30Z` (ultima domenica di ottobre prima del cambio),
  `2026-10-25T01:00Z` (dopo il cambio: CET), `2026-03-28T23:30Z` (CET → 29 marzo 00:30),
  `2026-03-29T01:00Z` (dopo il cambio: CEST), e mezzanotte esatta locale.
- **AC-8** — Preset (con "oggi" = 2026-10-20): "7 giorni" = 2026-10-14..2026-10-20; "30 giorni" =
  2026-09-21..2026-10-20; "12 mesi" = 2025-10-21..2026-10-20; anche per "oggi" = 2026-02-28 e
  2028-02-29 (anno bisestile: "12 mesi" = 2027-03-01..2028-02-29); `daysInclusive` = 7/30/365 con
  estremi inclusi; `firstPickerDate` per oggi 2026-10-20 = 2016-11-01 (119 mesi prima: 120 mesi
  toccati ammessi).
- **AC-9** — `ForecastApi` si comporta come prima (test esistenti verdi senza modifiche) usando
  `api_errors.dart`; `flutter analyze` senza problemi.

## Tasks

- [x] Scrivere i test falliti: `api_errors_test.dart` (AC-4, AC-9), `history_models_test.dart`
      (AC-1, AC-2, AC-5), `history_api_test.dart` con `http.Client` finto (AC-1..AC-6),
      `rome_date_test.dart` (AC-7, AC-8)
- [x] Estrarre `api_errors.dart` da `ForecastApi` senza cambiarne il comportamento (AC-4, AC-9)
- [x] Implementare `models/history.dart` (AC-1, AC-2, AC-5)
- [x] Implementare `services/history_api.dart` (AC-1..AC-6)
- [x] Implementare `services/rome_date.dart` (AC-7, AC-8)
- [x] Eseguire i comandi di `verify` (AC-9)
- [x] Compilare Dev notes

## Dev notes
- Nuovi: `app/lib/models/history.dart`, `services/{api_errors,history_api,rome_date}.dart`; `forecast_api.dart` usa solo `apiErrorMessage` (comportamento invariato, test esistenti verdi).
- Test nuovi: `api_errors_test`, `history_models_test`, `history_api_test`, `rome_date_test`, fixture `history_fixtures.dart`. `flutter test` 68 verdi, `flutter analyze` pulito.
- Decisioni: `HistoryApi({baseUrl?, client?, timeout})` con timeout iniettabile (default 15 s). Eccezione `HistoryApiException(message)`; timeout -> "Il server ha impiegato troppo tempo a rispondere", errore di rete -> "Impossibile contattare il server: controlla la connessione"; struttura non valida (incl. granularità diversa da quella richiesta) -> "Risposta del server non valida" (senza dettaglio, come da AC-5). Il corpo è decodificato come UTF-8 da `bodyBytes`.
- `HistoryResult` espone `days` e `months` (una sola popolata secondo la granularità); `HistoryDay`/`HistoryMonth` condividono `HistoryValues`. Date e preset sono `DateTime.utc` a mezzanotte; i preset ritornano record `({from, to})`.

## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
<!-- Reviewer: date, verdict, findings R-1… (blocker/should/nit) with file:line. -->
### 2026-10-20 — done
Verify: `flutter test` 68 verdi, `flutter analyze` pulito. Test esistenti di `ForecastApi` non toccati;
`apiErrorMessage` è l'estrazione letterale di `_errorMessage`. `forecast_screen.dart` risulta modificato
nel working tree (rimosso il pulsante "Notifiche"), ma la modifica è precedente alla storia (mtime 12:31,
storie create alle 13:54): fuori scope, non attribuita a questa storia.

- **R-1 (should)** `app/test/rome_date_test.dart:9-27` — i casi AC-7 al cambio d'ora (25/10 00:30Z e
  01:00Z, 29/03 01:00Z) danno la stessa data con +1 e con +2, quindi non verificano gli istanti di
  transizione: spostare l'inizio dell'ora legale al 1° aprile o la fine al 1° novembre in
  `app/lib/services/rome_date.dart:14-15` non fa fallire nessun test. Fix: aggiungere istanti in cui la
  data cambia in base all'offset, vicini alle transizioni, es. `2026-03-29T22:30Z` → 30/03 (CEST) e
  `2026-10-25T22:30Z` → 25/10 (CET), più `2026-03-28T22:30Z` → 28/03 (ancora CET).
- **R-2 (nit)** `app/lib/services/history_api.dart:47` — `ForecastApi` applica `trim()` allo slug,
  `HistoryApi` no. Va bene se gli slug arrivano sempre dal catalogo; altrimenti uniformare.
- **R-3 (nit)** `app/test/history_api_test.dart:123-124` — per il 500 `contains('500')` è debole;
  `api_errors_test.dart` controlla già il testo esatto, ma qui si può confrontare la stringa intera
  `'Il server ha risposto con errore 500'`.
