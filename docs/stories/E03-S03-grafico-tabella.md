---
id: E03-S03
epic: E03
title: "Grafico fl_chart, fascia stato del mare e tabella dello storico"
type: feature
status: done
requirements: [FR-87, FR-88, FR-90, NFR-26, NFR-10]
depends_on: [E03-S02]
verify:
  - cd app && flutter pub get
  - cd app && flutter analyze
  - cd app && flutter test
---

# E03-S03: Grafico `fl_chart`, fascia stato del mare e tabella

## Context

Sostituisce il segnaposto dei risultati di E03-S02 con il contenuto reale: grafico, fascia dello
stato del mare e tabella. Aggiunge la dipendenza **`fl_chart: ^1.2.0`** a `app/pubspec.yaml` (MIT,
verificata il 2026-10-20 su pub.dev: ultima versione 1.2.0, Dart SDK compatibile con `^3.11.5`;
dipendenze `equatable`, `vector_math`).

**Requisiti (testo esatto)**
- FR-87: «Con dati presenti, la schermata shall mostrare un grafico a linee con la temperatura media
  dell'aria, una banda fra minima e massima dell'aria e la temperatura media del mare, su un asse
  temporale per giorno o per mese; i valori `null` sono mostrati come interruzioni della linea,
  senza valori inventati. Shall mostrare inoltre lo stato del mare per ogni giorno o mese.»
- FR-88: «La schermata shall mostrare una tabella con una riga per giorno (o mese) e i valori di
  FR-69 (per i mesi anche `days`, FR-76), in ordine cronologico; i valori `null` sono mostrati come
  "n.d.".»
- FR-90: nota «Valori previsti per il giorno stesso, non misure osservate» sempre visibile con dati
  (già in E03-S02; resta sopra il grafico).
- NFR-26: con 366 giorni o 120 mesi grafico e tabella restano fluidi (< 1 s dopo la ricezione,
  scorrimento senza scatti).

**Decisioni architetturali (ADR-0002 §4, architettura §5)**
- **Grafico** (`app/lib/widgets/history_chart.dart`, `LineChart` di `fl_chart`): asse x = indice del
  giorno (o del mese) a partire da `from`; giorni/mesi **mancanti** (assenti da `items`) e valori
  `null` → `FlSpot.nullSpot` (interruzione della linea, nessun valore inventato). Serie: aria media
  (linea piena), mare medio (linea piena), banda min/max con `BetweenBarsData` fra le due serie min e
  max (linee trasparenti); un punto della banda esiste solo se min **e** max sono non nulli (se uno
  è `null`, entrambi diventano `nullSpot`). `isCurved: false` (una curva potrebbe uscire dalla
  banda). `minX/maxX/minY/maxY` **espliciti** (Y con un margine calcolato dai dati, X da 0 all'ultimo
  indice), al più ~6 etichette sull'asse x (date `dd/MM` o mesi `MMM yy`, in italiano), legenda delle
  serie. Le serie sono **precalcolate** alla ricezione dei dati, non nel `build` (NFR-26).
- **Fascia stato del mare** (`app/lib/widgets/sea_state_strip.dart`): una cella per giorno/mese
  allineata all'asse x del grafico, colore per rango Douglas (10 colori per le etichette FR-10:
  Calmo, Quasi calmo, Poco mosso, Mosso, Molto mosso, Agitato, Molto agitato, Grosso, Molto grosso,
  Tempestoso; grigio per `null`/assente), disegnata da **un solo `CustomPainter`**; legenda con le sole
  etichette presenti; l'etichetta testuale è anche nella tabella.
- **Tabella** (`app/lib/widgets/history_table.dart`): righe a due livelli ad **altezza fissa** in
  `SliverFixedExtentList` (costruzione pigra), nessuno scorrimento orizzontale, intestazioni delle
  colonne fisse in alto. Livello 1: data (o mese + `days`) e chip con lo stato del mare. Livello 2:
  aria media/min/max, mare medio, onde media/max. `null` → "n.d.". Ordine cronologico crescente. Una
  riga per elemento restituito (i giorni senza record non hanno riga).
- La schermata `history_screen.dart` (E03-S02) integra i tre widget con dati presenti, in una
  `CustomScrollView`/layout scorrevole con la nota FR-90 sempre visibile sopra il grafico.
- Italiano per tutte le stringhe (NFR-10).
- **Rischio da verificare con un test widget prima di consolidare**: la resa di `BetweenBarsData`
  con serie contenenti `nullSpot` (architettura §9). Se non rende come previsto (crash o banda che
  attraversa le interruzioni), annotarlo nelle Dev notes e, se necessario, spezzare la banda in
  segmenti contigui senza introdurre valori inventati.

**File probabili**: `app/pubspec.yaml` e `pubspec.lock`, `app/lib/widgets/history_chart.dart`,
`sea_state_strip.dart`, `history_table.dart`, funzioni pure di costruzione serie (es.
`app/lib/models/history_series.dart` o dentro `history_chart.dart`), `app/lib/screens/history_screen.dart`,
test `app/test/history_series_test.dart`, `history_chart_test.dart`, `history_table_test.dart`,
`history_screen_content_test.dart`.

## Acceptance criteria

- **AC-1** — Given `HistoryResult` `day` con alcuni giorni mancanti e valori `null`, when si
  costruiscono le serie, then: i giorni mancanti e i `null` sono `FlSpot.nullSpot` (nessun valore
  interpolato o 0), l'indice x è il numero di giorni da `from`, la banda ha punti solo dove min **e**
  max sono non nulli (FR-87).
- **AC-2** — Given i dati, when il grafico è renderizzato (widget test), then esiste un `LineChart`
  con 3 serie visibili (aria media, mare medio e linee della banda `BetweenBarsData`), `minX/maxX/
  minY/maxY` impostati esplicitamente, `isCurved: false`, e nessuna eccezione con serie contenenti
  `nullSpot` (rischio `BetweenBarsData`).
- **AC-3** — Given granularità `month`, then l'asse x è per mese (indice del mese da `from`), le
  etichette sono mesi in italiano e i valori seguono gli stessi criteri di `null`.
- **AC-4** — Given stati del mare diversi, when è disegnata la fascia, then una cella per
  giorno/mese con il colore del rango (grigio per `null`/assente), un solo `CustomPainter`; la
  legenda mostra solo le etichette presenti (verificabile con funzione pura che mappa etichetta →
  rango/colore e con il test widget della legenda).
- **AC-5** — Given N elementi, when la tabella è renderizzata, then ha una riga per elemento in
  ordine cronologico crescente, con data (o mese e `days`), stato e i 7 valori formattati; i `null`
  appaiono come "n.d."; nessuno scorrimento orizzontale (nessun `SingleChildScrollView` orizzontale,
  larghezza 360 dp senza overflow).
- **AC-6** — Given 366 elementi `day` (e 120 `month`), when la schermata è costruita, then nessun
  overflow né eccezione, la tabella costruisce solo le righe visibili (lista pigra ad altezza fissa)
  e il grafico ha ≤ 366 punti per serie (NFR-26).
- **AC-7** — Given dati presenti, then la nota FR-90 è visibile sopra il grafico e resta visibile
  durante lo scorrimento (non dentro l'area scorrevole della tabella); con `items` vuoto o errore
  restano gli stati di E03-S02 (nessun grafico).
- **AC-8** — `fl_chart: ^1.2.0` presente in `pubspec.yaml`; `flutter pub get`, `flutter analyze`
  senza problemi e tutti i test (E03-S01, E03-S02, preesistenti) verdi.

## Tasks

- [x] Aggiungere `fl_chart: ^1.2.0` a `app/pubspec.yaml` e `flutter pub get`
- [x] Scrivere i test falliti: `history_series_test.dart` (AC-1, AC-3), `history_chart_test.dart`
      (AC-2), widget test della fascia (AC-4), `history_table_test.dart` (AC-5),
      `history_screen_content_test.dart` con 366/120 elementi (AC-6, AC-7)
- [x] Implementare la costruzione pura delle serie (AC-1, AC-3)
- [x] Implementare `history_chart.dart` e verificare `BetweenBarsData` con `nullSpot` (AC-2)
- [x] Implementare `sea_state_strip.dart` con un solo `CustomPainter` e legenda (AC-4)
- [x] Implementare `history_table.dart` con `SliverFixedExtentList` (AC-5, AC-6)
- [x] Integrare i widget in `history_screen.dart` sostituendo il segnaposto (AC-7)
- [x] Eseguire i comandi di `verify` (AC-8)
- [x] Compilare Dev notes (esito della prova `BetweenBarsData`, scelte dei colori)

## Dev notes
- `fl_chart: ^1.2.0` risolto da pub.dev (`flutter pub add`), lock aggiornato. Nessun `intl`: etichette italiane (`gen`..`dic`) da tabella locale in `history_series.dart`.
- Nuovi: `lib/models/history_series.dart` (serie pure: nullSpot per mancanti/null, banda solo con min e max, Y con margine, <= 6 etichette), `lib/widgets/history_chart.dart` (`buildHistoryChartData`, 4 `LineChartBarData`: aria, mare, min/max trasparenti + `BetweenBarsData(2,3)`; `duration: zero`, touch disabilitato), `sea_state_strip.dart` (10 colori Douglas, grigio per null, un solo `CustomPainter`, cella i centrata su x=i come l'asse del grafico, margine sinistro = `chartLeftInset`; legenda solo etichette presenti), `history_table.dart` (`historyTableSlivers`: header pinned + `SliverFixedExtentList` righe 64 dp a due livelli; valori con virgola, temperature 1 decimale, onde 2).
- `history_screen.dart`: `HistoryContent` ora e' uno StatefulWidget che precalcola `HistorySeries` (non nel `build`) e usa una `CustomScrollView`; la nota FR-90 resta nella colonna fissa sopra l'area scorrevole. Mantenuto il riepilogo "N elementi" (`history-count`, ora "1 elemento" al singolare) per non toccare i test E03-S02.
- Esito prova `BetweenBarsData` con `nullSpot`: nessun crash e la banda NON attraversa le interruzioni (test a campionamento pixel in `history_chart_test.dart`: riempita sui segmenti contigui, vuota sui buchi, anche quando solo uno fra min e max e' null). Non serve spezzare la banda in segmenti.
- Deviazione: niente `SliverMainAxisGroup` con header pinned (geometria non valida in layout stretti); header e lista sono sliver fratelli. L'header usa `SizedBox` di altezza fissa (il child di un persistent header non e' stretto).
- R-2 di E03-S02: il test AC-8 in `history_screen_test.dart` ora scorre davvero la tabella e verifica che la nota resti ferma; stesso controllo con 366 elementi in `history_screen_content_test.dart`.
- Fuori scope (non fatto): date picker in italiano (R-1 E03-S02). `forecast_screen.dart` non toccato.
- Test: `history_series_test`, `history_chart_test`, `history_table_test` (tabella, fascia, colori), `history_screen_content_test`. Nota TDD: serie e test di AC-1 scritti nello stesso passo dell'implementazione. Verifica: `flutter analyze` pulito, `flutter test` 106 verdi.
- R-1 (review) risolto: `Semantics` in italiano su `HistoryChart` (`historyChartSemanticsLabel`: periodo, min/max/media aria e mare, banda, n.d.) e `SeaStateStrip` (`seaStateSemanticsLabel`: conteggi per stato, n.d.); test in `history_chart_test.dart` e `sea_state_strip_semantics_test.dart`.

## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
<!-- Reviewer: date, verdict, findings R-1… (blocker/should/nit) with file:line. -->

### 2026-10-20 — verdict: done
Verify: `flutter pub get`, `flutter analyze` (nessun problema), `flutter test` (106 verdi). AC-1..AC-8 coperti; `fl_chart 1.2.0` (+ `equatable` transitiva) unica dipendenza nuova; `forecast_screen.dart` con le sole modifiche di E03-S02, `catalog_widgets_test.dart` senza diff; nessun test saltato o indebolito. Eccezione test-first di AC-1 accettata: le asserzioni (nullSpot per mancanti/null, 0 reale, banda solo con min e max, indice da `from`) fallirebbero con un'implementazione errata; il test a pixel su `BetweenBarsData` chiude il rischio §9.
- R-1 (should) `app/lib/widgets/sea_state_strip.dart:68` e `app/lib/widgets/history_chart.dart:101` — grafico e fascia non hanno semantica per screen reader (il `CustomPaint` e il `LineChart` sono muti). Fix atteso: avvolgerli in `Semantics(label: ...)` in italiano (es. "Grafico temperature dal 14/10 al 20/10", "Stato del mare per giorno"); i valori restano accessibili dalla tabella. Follow-up, non bloccante.
- R-2 (nit) `app/lib/widgets/history_chart.dart:54` — `interval: 1` fa invocare `getTitlesWidget` per ognuno dei 366 indici; si può usare il passo di `labelIndexes` come `interval` per costruire solo le ~6 etichette.
- R-3 (nit) `app/lib/widgets/history_table.dart:44` — stessa `Key('history-row')` su tutte le righe; non è un errore (sliver gestito per indice), ma `ValueKey(data)` sarebbe più idiomatico se i test usassero un `find.byWidgetPredicate`/`byType(HistoryRow)`.
- R-4 (nit) `app/lib/widgets/history_table.dart:31` — l'ordine cronologico dipende dall'ordine restituito dal worker (garantito da E02-S03/S04); nessuna difesa lato app. Accettabile, annotare in `docs/conventions.md` se si vuole renderlo esplicito.
