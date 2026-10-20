import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sardegna_mare_app/models/history.dart';
import 'package:sardegna_mare_app/screens/history_screen.dart';

import 'support/history_fakes.dart';

DateTime fixedNow() => DateTime.utc(2026, 10, 20, 12);

String iso(DateTime d) =>
    '${d.year}-${d.month.toString().padLeft(2, '0')}-'
    '${d.day.toString().padLeft(2, '0')}';

HistoryResult bigDays(int n) {
  final from = DateTime.utc(2026, 10, 20).subtract(Duration(days: n - 1));
  return HistoryResult(
    slug: 'torre-dei-corsari',
    name: 'Torre dei Corsari',
    granularity: HistoryGranularity.day,
    from: iso(from),
    to: '2026-10-20',
    days: [
      for (var i = 0; i < n; i++)
        HistoryDay(
          date: iso(from.add(Duration(days: i))),
          airTemperatureMeanC: 15 + (i % 10).toDouble(),
          airTemperatureMinC: 10 + (i % 10).toDouble(),
          airTemperatureMaxC: 20 + (i % 10).toDouble(),
          waterTemperatureMeanC: 18,
          state: i % 7 == 0 ? null : 'Poco mosso',
          waveHeightMeanM: 0.4,
          waveHeightMaxM: 0.9,
        ),
    ],
  );
}

HistoryResult bigMonths(int n) => HistoryResult(
  slug: 'torre-dei-corsari',
  name: 'Torre dei Corsari',
  granularity: HistoryGranularity.month,
  from: '2016-11-01',
  to: '2026-10-20',
  months: [
    for (var i = 0; i < n; i++)
      HistoryMonth(
        month: iso(DateTime.utc(2016, 11 + i)).substring(0, 7),
        days: 30,
        airTemperatureMeanC: 15,
        airTemperatureMinC: 10,
        airTemperatureMaxC: 20,
        waterTemperatureMeanC: 18,
        state: 'Mosso',
      ),
  ],
);

Future<FakeHistoryApi> open(WidgetTester tester) async {
  tester.view.physicalSize = const Size(360, 740);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
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

void main() {
  testWidgets('AC-6 366 giorni: nessun overflow, righe pigre, <= 366 punti', (
    tester,
  ) async {
    final api = await open(tester);
    api.calls[0].completer.complete(bigDays(366));
    await tester.pump();
    await tester.pump();
    expect(tester.takeException(), isNull);
    expect(find.byType(LineChart), findsOneWidget);
    final data = tester.widget<LineChart>(find.byType(LineChart)).data;
    for (final bar in data.lineBarsData) {
      expect(bar.spots.length, lessThanOrEqualTo(366));
    }
    expect(find.text('366 elementi'), findsOneWidget);
    expect(find.byKey(const Key('sea-state-strip')), findsOneWidget);
    // Lista pigra: solo le righe visibili (o poco piu') sono costruite.
    final built = find.byKey(const Key('history-row')).evaluate().length;
    expect(built, lessThan(30));
    // Scorrendo fino in fondo l'ultima riga viene costruita.
    await tester.fling(
      find.byType(CustomScrollView),
      const Offset(0, -100000),
      20000,
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('20/10/2026'), findsOneWidget);
  });

  testWidgets('AC-6 120 mesi: nessun overflow, righe pigre', (tester) async {
    final api = await open(tester);
    await tester.tap(find.byKey(const Key('preset-months12')));
    await tester.pump();
    await tester.tap(find.text('Mese'));
    await tester.pump();
    api.calls.last.completer.complete(bigMonths(120));
    await tester.pump();
    await tester.pump();
    expect(tester.takeException(), isNull);
    expect(find.byType(LineChart), findsOneWidget);
    final data = tester.widget<LineChart>(find.byType(LineChart)).data;
    expect(data.lineBarsData.first.spots.length, 120);
    expect(
      find.byKey(const Key('history-row')).evaluate().length,
      lessThan(30),
    );
    expect(find.text('nov 16'), findsOneWidget);
  });

  testWidgets('AC-7 con errore o elenco vuoto nessun grafico', (tester) async {
    final api = await open(tester);
    api.calls[0].completer.complete(dayResult(0));
    await tester.pump();
    await tester.pump();
    expect(find.text(historyEmptyMessage), findsOneWidget);
    expect(find.byType(LineChart), findsNothing);
    expect(find.byKey(const Key('history-note')), findsNothing);
  });

  testWidgets(
    'AC-7 nota FR-90 sopra il grafico e fissa durante lo scorrimento',
    (tester) async {
      final api = await open(tester);
      api.calls[0].completer.complete(bigDays(366));
      await tester.pump();
      await tester.pump();
      final note = find.byKey(const Key('history-note'));
      expect(note, findsOneWidget);
      expect(
        tester.getBottomLeft(note).dy,
        lessThanOrEqualTo(tester.getTopLeft(find.byType(LineChart)).dy),
      );
      final before = tester.getTopLeft(note);
      await tester.drag(find.byType(CustomScrollView), const Offset(0, -600));
      await tester.pump();
      // Il grafico e' uscito dall'area visibile (scorrimento avvenuto)...
      expect(
        tester.getTopLeft(find.byType(LineChart, skipOffstage: false)).dy,
        lessThan(0),
      );
      // ...ma la nota e' ancora li', nella stessa posizione.
      expect(note, findsOneWidget);
      expect(tester.getTopLeft(note), before);
      // La nota sta fuori dall'area scorrevole.
      expect(
        tester.getRect(note).bottom,
        lessThanOrEqualTo(tester.getTopLeft(find.byType(CustomScrollView)).dy),
      );
    },
  );
}
