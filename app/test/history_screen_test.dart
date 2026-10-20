import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sardegna_mare_app/models/history.dart';
import 'package:sardegna_mare_app/screens/history_screen.dart';
import 'package:sardegna_mare_app/services/history_api.dart';

import 'support/history_fakes.dart';

// 2026-10-20 12:00 UTC = 14:00 a Roma.
DateTime fixedNow() => DateTime.utc(2026, 10, 20, 12);

Future<FakeHistoryApi> open(WidgetTester tester) async {
  final api = FakeHistoryApi();
  await tester.pumpWidget(
    MaterialApp(
      home: HistoryScreen(
        slug: 'torre-dei-corsari',
        name: 'Torre dei Corsari',
        api: api,
        now: fixedNow,
      ),
    ),
  );
  return api;
}

/// Il CircularProgressIndicator anima in continuo: pumpAndSettle non termina.
Future<void> settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
}

String sig(HistoryCall c) => '${c.granularity.wire} ${c.from}..${c.to}';

Future<void> tapPreset(WidgetTester tester, String name) async {
  await tester.tap(find.byKey(Key('preset-$name')));
  await tester.pump();
}

bool chipSelected(WidgetTester tester, String name) =>
    tester.widget<ChoiceChip>(find.byKey(Key('preset-$name'))).selected;

bool dayEnabled(WidgetTester tester) {
  final b = tester.widget<SegmentedButton<HistoryGranularity>>(
    find.byKey(const Key('granularity-selector')),
  );
  return b.segments.first.enabled;
}

HistoryGranularity selectedGranularity(WidgetTester tester) => tester
    .widget<SegmentedButton<HistoryGranularity>>(
      find.byKey(const Key('granularity-selector')),
    )
    .selected
    .first;

/// Apre il selettore e inserisce l'intervallo con la tastiera (mm/dd/yyyy).
Future<void> pickRange(WidgetTester tester, String start, String end) async {
  await tester.tap(find.byKey(const Key('preset-custom')));
  await settle(tester);
  await tester.tap(find.byIcon(Icons.edit_outlined));
  await settle(tester);
  final fields = find.byType(TextField);
  await tester.enterText(fields.at(0), start);
  await tester.enterText(fields.at(1), end);
  await tester.pump();
}

Future<void> confirmPicker(WidgetTester tester) async {
  await tester.tap(find.text('OK'));
  await settle(tester);
}

void main() {
  testWidgets('AC-2 apertura: 7 giorni, day, prima richiesta', (tester) async {
    final api = await open(tester);
    expect(api.calls.map(sig), ['day 2026-10-14..2026-10-20']);
    expect(api.calls.single.slug, 'torre-dei-corsari');
    expect(chipSelected(tester, 'days7'), isTrue);
    expect(chipSelected(tester, 'days30'), isFalse);
    expect(selectedGranularity(tester), HistoryGranularity.day);
    expect(find.text('Torre dei Corsari'), findsOneWidget); // titolo
  });

  testWidgets('AC-3 preset', (tester) async {
    final api = await open(tester);
    await tapPreset(tester, 'days30');
    await tapPreset(tester, 'months12');
    expect(api.calls.map(sig), [
      'day 2026-10-14..2026-10-20',
      'day 2026-09-21..2026-10-20',
      'day 2025-10-21..2026-10-20',
    ]);
    expect(dayEnabled(tester), isTrue);
    expect(chipSelected(tester, 'months12'), isTrue);
    await tapPreset(tester, 'days7');
    expect(api.calls, hasLength(4));
  });

  testWidgets('AC-4 selettore: limiti e conferma', (tester) async {
    final api = await open(tester);
    await tester.tap(find.byKey(const Key('preset-custom')));
    await settle(tester);
    final dialog = tester.widget<DateRangePickerDialog>(
      find.byType(DateRangePickerDialog),
    );
    expect(dialog.lastDate, DateTime(2026, 10, 20));
    expect(dialog.firstDate, DateTime(2016, 11, 1));
    // Annulla: nessuna nuova richiesta.
    await tester.tap(find.byIcon(Icons.close));
    await settle(tester);
    expect(api.calls, hasLength(1));

    await pickRange(tester, '10/01/2026', '10/05/2026');
    await confirmPicker(tester);
    expect(api.calls.map(sig).last, 'day 2026-10-01..2026-10-05');
    expect(chipSelected(tester, 'custom'), isTrue);
  });

  testWidgets('AC-4 fine oltre oggi o inizio dopo fine: non confermabile', (
    tester,
  ) async {
    final api = await open(tester);
    await pickRange(tester, '10/01/2026', '10/21/2026');
    await tester.tap(find.text('OK'));
    await settle(tester);
    expect(find.byType(DateRangePickerDialog), findsOneWidget);
    await tester.enterText(find.byType(TextField).at(0), '10/10/2026');
    await tester.enterText(find.byType(TextField).at(1), '10/05/2026');
    await tester.tap(find.text('OK'));
    await settle(tester);
    expect(find.byType(DateRangePickerDialog), findsOneWidget);
    expect(api.calls, hasLength(1));
  });

  testWidgets('AC-5 oltre 366 giorni: solo mese', (tester) async {
    final api = await open(tester);
    await pickRange(tester, '01/01/2025', '10/20/2026');
    await confirmPicker(tester);
    expect(api.calls.map(sig).last, 'month 2025-01-01..2026-10-20');
    expect(dayEnabled(tester), isFalse);
    expect(selectedGranularity(tester), HistoryGranularity.month);
  });

  testWidgets('AC-5 366 giorni inclusi: giorno abilitato; 367 no', (
    tester,
  ) async {
    final api = await open(tester);
    // 2025-10-20..2026-10-20 = 366 giorni inclusi.
    await pickRange(tester, '10/20/2025', '10/20/2026');
    await confirmPicker(tester);
    expect(api.calls.map(sig).last, 'day 2025-10-20..2026-10-20');
    expect(dayEnabled(tester), isTrue);
    await pickRange(tester, '10/19/2025', '10/20/2026');
    await confirmPicker(tester);
    expect(api.calls.map(sig).last, 'month 2025-10-19..2026-10-20');
    expect(dayEnabled(tester), isFalse);
  });

  testWidgets('AC-5 cambio manuale della granularita invia richiesta', (
    tester,
  ) async {
    final api = await open(tester);
    await tester.tap(find.text('Mese'));
    await tester.pump();
    expect(api.calls.map(sig).last, 'month 2026-10-14..2026-10-20');
    // La scelta resta cambiando preset (ancora valida).
    await tapPreset(tester, 'days30');
    expect(api.calls.map(sig).last, 'month 2026-09-21..2026-10-20');
    await tester.tap(find.text('Giorno'));
    await tester.pump();
    expect(api.calls.map(sig).last, 'day 2026-09-21..2026-10-20');
    expect(api.calls, hasLength(4));
  });

  testWidgets('granularita: dopo intervallo lungo torna a quella scelta', (
    tester,
  ) async {
    final api = await open(tester);
    await pickRange(tester, '01/01/2025', '10/20/2026');
    await confirmPicker(tester);
    await tapPreset(tester, 'days7');
    expect(api.calls.map(sig).last, 'day 2026-10-14..2026-10-20');
    expect(selectedGranularity(tester), HistoryGranularity.day);
  });

  testWidgets('AC-6 caricamento, vuoto, dati e nota', (tester) async {
    final api = await open(tester);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.byKey(const Key('history-note')), findsNothing);
    api.calls[0].completer.complete(dayResult(0));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(
      find.text('Nessun dato storico per il periodo selezionato'),
      findsOneWidget,
    );
    expect(find.byKey(const Key('history-note')), findsNothing);

    await tapPreset(tester, 'days30');
    api.calls[1].completer.complete(dayResult(3));
    await tester.pump();
    expect(find.text('3 elementi'), findsOneWidget);
    expect(
      find.text('Valori previsti per il giorno stesso, non misure osservate'),
      findsOneWidget,
    );
    expect(
      find.text('Nessun dato storico per il periodo selezionato'),
      findsNothing,
    );
  });

  testWidgets('AC-6 errore e Riprova ripete la stessa richiesta', (
    tester,
  ) async {
    final api = await open(tester);
    api.calls[0].completer.completeError(
      const HistoryApiException('Intervallo troppo ampio'),
    );
    await tester.pump();
    expect(find.text('Intervallo troppo ampio'), findsOneWidget);
    expect(find.text('Riprova'), findsOneWidget);
    expect(find.byKey(const Key('history-note')), findsNothing);

    await tester.tap(find.text('Riprova'));
    await tester.pump();
    expect(api.calls, hasLength(2));
    expect(sig(api.calls[1]), sig(api.calls[0]));
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    api.calls[1].completer.completeError(
      const HistoryApiException('Risposta del server non valida'),
    );
    await tester.pump();
    expect(find.text('Risposta del server non valida'), findsOneWidget);
  });

  testWidgets('AC-6 errore generico (non HistoryApiException)', (tester) async {
    final api = await open(tester);
    api.calls[0].completer.completeError(StateError('x'));
    await tester.pump();
    expect(find.text('Impossibile caricare lo storico'), findsOneWidget);
    expect(find.text('Riprova'), findsOneWidget);
  });

  testWidgets('AC-7 risposte fuori ordine: vince l\'ultima selezione', (
    tester,
  ) async {
    final api = await open(tester);
    await tapPreset(tester, 'days30');
    // Risponde prima la seconda, poi la prima (superata).
    api.calls[1].completer.complete(dayResult(2));
    await tester.pump();
    api.calls[0].completer.complete(dayResult(5));
    await tester.pump();
    expect(find.text('2 elementi'), findsOneWidget);
    expect(find.text('5 elementi'), findsNothing);
  });

  testWidgets('AC-7 errore superato non sovrascrive i dati', (tester) async {
    final api = await open(tester);
    await tapPreset(tester, 'days30');
    api.calls[1].completer.complete(dayResult(2));
    await tester.pump();
    api.calls[0].completer.completeError(const HistoryApiException('vecchio'));
    await tester.pump();
    expect(find.text('vecchio'), findsNothing);
    expect(find.text('2 elementi'), findsOneWidget);
  });

  testWidgets('AC-7 dispose durante la richiesta: nessuna eccezione', (
    tester,
  ) async {
    final api = await open(tester);
    await tester.pumpWidget(const SizedBox());
    api.calls[0].completer.complete(dayResult(1));
    await tester.pump();
    expect(tester.takeException(), isNull);

    final api2 = await open(tester);
    await tester.pumpWidget(const SizedBox());
    api2.calls[0].completer.completeError(const HistoryApiException('x'));
    await tester.pump();
    expect(tester.takeException(), isNull);
  });

  testWidgets('AC-8 nota visibile anche scorrendo la tabella; mese', (
    tester,
  ) async {
    final api = await open(tester);
    api.calls[0].completer.complete(dayResult(7));
    await tester.pump();
    await tester.pump();
    final note = find.byKey(const Key('history-note'));
    expect(note, findsOneWidget);
    final noteBefore = tester.getTopLeft(note);
    final firstRow = find.byKey(const Key('history-row')).first;
    final rowBefore = tester.getTopLeft(firstRow);
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -300));
    await tester.pump();
    // La lista e' davvero scorsa (la prima riga si e' spostata)...
    expect(tester.getTopLeft(firstRow).dy, lessThan(rowBefore.dy));
    // ...e la nota e' rimasta visibile, ferma.
    expect(note, findsOneWidget);
    expect(tester.getTopLeft(note), noteBefore);

    await tester.tap(find.text('Mese'));
    await tester.pump();
    api.calls[1].completer.complete(monthResult(4));
    await tester.pump();
    await tester.pump();
    expect(find.text('4 elementi'), findsOneWidget);
    expect(find.byKey(const Key('history-note')), findsOneWidget);
  });
}
