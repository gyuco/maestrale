---
id: E03-S02
epic: E03
title: "Schermata storico: preset, selettore date, granularità, stati, nota e comando Storico"
type: feature
status: done
requirements: [FR-83, FR-84, FR-85, FR-86, FR-89, FR-90, NFR-10, NFR-13]
depends_on: [E03-S01]
verify:
  - cd app && flutter analyze
  - cd app && flutter test
---

# E03-S02: Schermata storico (controlli, stati, nota) e comando "Storico"

## Context

Costruisce la schermata `HistoryScreen` con tutti i controlli e gli stati, e il punto di accesso dalla
schermata previsioni. Il contenuto grafico (grafico, fascia stato del mare, tabella) è realizzato da
E03-S03: qui, con dati presenti, la schermata mostra la nota FR-90 e un **segnaposto** minimale dei
risultati (es. un widget `HistoryContent` che per ora elenca solo il numero di elementi) che E03-S03
sostituisce. Usa i componenti di E03-S01 (`HistoryApi`, modelli, `romeToday`, preset, `api_errors`).

**Requisiti (testo esatto)**
- FR-83: «Con una previsione caricata, la schermata previsioni shall offrire un comando "Storico"
  che apre la schermata storico della località mostrata (identificata dallo slug della previsione).
  Senza previsione caricata il comando non è disponibile.»
- FR-84: preset "7 giorni", "30 giorni" e "12 mesi", che terminano oggi (incluso). All'apertura è
  selezionato "7 giorni" (proposta OQ-34).
- FR-85: «intervallo personalizzato scelto con un selettore di date (inizio e fine): la fine non può
  essere successiva a oggi, l'inizio non può essere successivo alla fine e l'intervallo non può
  superare il limite di FR-77 per la granularità `month` [120 mesi di calendario]; selezioni che
  violano questi vincoli non sono confermabili.»
- FR-86: «per intervalli fino a 366 giorni (estremi inclusi) l'app shall offrire un selettore
  giorno/mese, con default giorno; per intervalli più lunghi usa solo `month` e il selettore non
  consente "giorno". Ogni cambio di preset, intervallo o granularità invia una nuova richiesta
  `/history` con i parametri corrispondenti.»
- FR-89: «durante il caricamento la schermata shall mostrare un indicatore di avanzamento; con
  risposta 200 ed elenco vuoto mostra un messaggio di assenza dati ("Nessun dato storico per il
  periodo selezionato"); in caso di errore (HTTP ≠ 200 incluso 404 e 422, timeout di 15 s, errore di
  rete, risposta non valida) mostra il messaggio estratto con le stesse regole di FR-33 e un
  pulsante "Riprova" che ripete l'ultima richiesta.»
- FR-90: «Quando sono mostrati dati storici, la schermata shall mostrare in modo sempre visibile la
  nota che i valori sono previsioni del giorno, non misure»: testo «Valori previsti per il giorno
  stesso, non misure osservate».

**Decisioni architetturali (§5 "App: schermata storico")**
- `HistoryScreen({required String slug, required String name, HistoryApi? api, DateTime Function()?
  now})` con `Navigator.push`; titolo con il nome della località. `api` e orologio iniettabili (NFR-13).
- Controlli: tre preset (es. `ChoiceChip`/`SegmentedButton`) più "Personalizzato" che apre
  `showDateRangePicker` con `firstDate = firstPickerDate(oggi)` e `lastDate = oggi Roma` (così ogni
  selezione confermabile rispetta FR-85); selettore giorno/mese (`SegmentedButton`), "giorno"
  disabilitato oltre 366 giorni (`daysInclusive`); quando il nuovo intervallo supera 366 giorni la
  granularità passa a `month`. Il preset "12 mesi" (365 giorni) consente `day` (default giorno).
  Cambiando intervallo a ≤ 366 giorni la granularità resta quella scelta dall'utente se ancora
  valida, altrimenti `day`.
- Ogni cambio → nuova richiesta; **un contatore di richiesta scarta le risposte superate** (race).
  Se la schermata è smontata durante una richiesta non deve fare `setState`.
- Stati: caricamento (indicatore), vuoto, errore + "Riprova" (ripete l'ultima richiesta con gli stessi
  parametri), dati (nota + contenuto).
- `ForecastScreen` (`app/lib/screens/forecast_screen.dart`) riceve anche un `HistoryApi` (iniettabile
  con default da `ApiConfig`) e mostra il comando "Storico" **solo con `_forecast` caricata**, che
  apre `HistoryScreen(slug: forecast.location.slug, name: forecast.location.name)`. Nota: il file
  ha modifiche locali non committate dell'utente al momento della pianificazione: leggere lo stato
  corrente, modificare solo ciò che serve (un `Navigator.push` + parametro del costruttore) senza
  sovrascrivere altro; verificare il costruttore usato da `main.dart` e dai test esistenti.
- Stringhe in italiano (NFR-10).

**File probabili**: `app/lib/screens/history_screen.dart` (nuovo), `app/lib/screens/forecast_screen.dart`,
`app/lib/main.dart` (solo se serve passare `HistoryApi`), test `app/test/history_screen_test.dart`,
`app/test/forecast_screen_history_test.dart` (o estensione di `widget_test.dart`), fake di
`HistoryApi` in `app/test/support/`.

## Acceptance criteria

- **AC-1** — Given la schermata previsioni con una previsione caricata, when si osserva la UI, then
  è presente il comando "Storico"; given nessuna previsione (benvenuto, caricamento, errore), then
  non è presente. Premendolo si apre `HistoryScreen` per lo slug della previsione e il nome della
  località (FR-83).
- **AC-2** — Given l'apertura con "oggi" = 2026-10-20, when la schermata è costruita, then è
  selezionato "7 giorni", granularità `day` e la prima richiesta è
  `fetchDays(slug, 2026-10-14, 2026-10-20)` (FR-84).
- **AC-3** — Given i preset, when si seleziona "30 giorni" → `fetchDays(2026-09-21..2026-10-20)`;
  "12 mesi" → `fetchDays(2025-10-21..2026-10-20)` (365 giorni, `day` ancora consentito); ogni cambio
  invia una nuova richiesta (FR-84, FR-86).
- **AC-4** — Given "Personalizzato", when si apre il selettore, then `lastDate` = oggi Roma e
  `firstDate` = 1° giorno del mese di 119 mesi prima (2016-11-01 per oggi 2026-10-20); confermando
  un intervallo valido parte una richiesta con quelle date; la fine non può superare oggi e l'inizio
  non può superare la fine (vincoli del picker, FR-85).
- **AC-5** — Given un intervallo di 367 o più giorni (es. personalizzato da 2025-01-01), then il
  selettore giorno/mese ha "Giorno" disabilitato, la granularità è `month` e la richiesta usa
  `granularity=month` (`fetchMonths`); con 366 giorni (estremi inclusi) "Giorno" è abilitato; cambiando
  granularità manualmente parte una nuova richiesta (FR-86).
- **AC-6** — Given una richiesta in corso, then è visibile un indicatore di avanzamento; given una
  risposta con `items` vuoto, then compare "Nessun dato storico per il periodo selezionato" (e
  nessuna nota FR-90 con "dati"); given un errore (404, 422, 503, timeout, rete, risposta non
  valida), then compare il messaggio di `api_errors` e il pulsante "Riprova" che ripete l'ultima
  richiesta con gli stessi parametri (FR-89).
- **AC-7** — Given risposte che arrivano fuori ordine (cambio rapido preset mentre la prima richiesta
  è in volo), then viene mostrata solo quella dell'ultima selezione (contatore di richiesta); dopo
  `dispose` nessuna eccezione per `setState`.
- **AC-8** — Given dati presenti, then la nota «Valori previsti per il giorno stesso, non misure
  osservate» è sempre visibile (anche con la lista scorrevole) (FR-90).
- **AC-9** — Tutti i test esistenti dell'app restano verdi (ricerca, mappa, catalogo, località
  iniziale); `flutter analyze` senza problemi.

## Tasks

- [x] Scrivere i test widget falliti con `HistoryApi` finto e `now` iniettato:
      `history_screen_test.dart` (AC-2..AC-8) e `forecast_screen_history_test.dart` (AC-1)
- [x] Implementare `HistoryScreen`: stato (preset, intervallo, granularità), richieste con contatore
      di richiesta, stati caricamento/vuoto/errore/dati (AC-2, AC-3, AC-6, AC-7, AC-8)
- [x] Implementare selettore date con `showDateRangePicker` e vincoli (AC-4) e regola di
      granularità (AC-5)
- [x] Aggiungere il comando "Storico" in `forecast_screen.dart` (AC-1)
- [x] Eseguire `flutter analyze` e `flutter test` (AC-9)
- [x] Compilare Dev notes (decisione su granularità al cambio intervallo, segnaposto dei risultati)

## Dev notes
- Nuovi: `app/lib/screens/history_screen.dart` (`HistoryScreen`, `HistoryContent` segnaposto che mostra "N elementi", sostituito da E03-S03); test `history_screen_test.dart`, `forecast_screen_history_test.dart`, fake `test/support/history_fakes.dart`.
- Modificati (minimo): `forecast_screen.dart` (param `historyApi`, `_openHistory`, pulsante `Storico` nella top bar solo con `_forecast != null`; la rimozione locale del pulsante "Notifiche" dell'utente e' preservata), `main.dart` (`SeaForecastApp.historyApi` inoltrato).
- Granularita: si tiene la scelta dell'utente (`_chosen`, default day); quella effettiva e' `month` se l'intervallo supera 366 giorni, altrimenti torna alla scelta dell'utente. Contatore `_requestId` (incrementato anche in `dispose`) scarta risposte/errori superati.
- Test del picker: i `CircularProgressIndicator` impediscono `pumpAndSettle`, quindi helper `settle`; il selettore si usa in modalita' testo (mm/dd/yyyy). L'app non ha localizzazioni Material: i pulsanti del picker sono in inglese (OK/Cancel); fuori scope (non in AC), segnalato.
- Fix da review E03-S01: R-1 (istanti di transizione 2026-03-29T22:30Z -> 30/03, 2026-10-25T22:30Z -> 25/10 + bordi in `rome_date_test.dart`), R-2 (`slug.trim()` in `HistoryApi` + test), R-3 (confronto esatto del messaggio per il 500).
- Verifica: `flutter test` 87 verdi, `flutter analyze` pulito.



## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
<!-- Reviewer: date, verdict, findings R-1… (blocker/should/nit) with file:line. -->

### 2026-10-20 — verdict: done
Verify: `flutter test` 87 verdi, `flutter analyze` nessun problema. AC-1..AC-9 coperti; `forecast_screen.dart` cambia solo import, `historyApi`, `_openHistory` e il pulsante "Storico" condizionato (rimozione "Notifiche" preservata); `catalog_widgets_test.dart` e gli altri test esistenti senza diff. Contatore di richiesta e `mounted` verificati dai test AC-7 (fallirebbero senza). Fix E03-S01: R-2 significativo (senza `trim()` la query decodificata vale `"  torre-dei-corsari \n"` e il test fallisce), R-1/R-3 con asserzioni esatte.
- R-1 (should) `app/lib/screens/history_screen.dart:128` — `showDateRangePicker` senza localizzazioni Material: "OK"/"Cancel", formato mm/dd/yyyy e mesi in inglese, in contrasto con NFR-10. Fix: follow-up per aggiungere `flutter_localizations` (SDK, da approvare) con `locale: it_IT` in `main.dart`; aggiornare l'helper `pickRange` dei test.
- R-2 (nit) `app/test/history_screen_test.dart:288` — il test AC-8 non verifica davvero "anche con la lista scorrevole" (il segnaposto non scorre). Fix: in E03-S03 aggiungere un test che scorre la tabella e verifica che `history-note` resti visibile.

