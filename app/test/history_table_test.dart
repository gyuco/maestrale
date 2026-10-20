import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sardegna_mare_app/models/history.dart';
import 'package:sardegna_mare_app/widgets/history_table.dart';
import 'package:sardegna_mare_app/widgets/sea_state_strip.dart';

Widget host(HistoryResult r) => MaterialApp(
  home: Scaffold(
    body: Builder(
      builder: (context) =>
          CustomScrollView(slivers: historyTableSlivers(context, r)),
    ),
  ),
);

HistoryResult dayRes(List<HistoryDay> days) => HistoryResult(
  slug: 's',
  name: 'S',
  granularity: HistoryGranularity.day,
  from: '2026-10-14',
  to: '2026-10-16',
  days: days,
);

void main() {
  testWidgets('AC-5 una riga per elemento, ordine, valori e n.d.', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      host(
        dayRes(const [
          HistoryDay(
            date: '2026-10-14',
            airTemperatureMeanC: 22,
            airTemperatureMinC: 18.5,
            airTemperatureMaxC: 0,
            waterTemperatureMeanC: 20.14,
            state: 'Poco mosso',
            waveHeightMeanM: 0.4,
            waveHeightMaxM: 1,
          ),
          HistoryDay(date: '2026-10-16'),
        ]),
      ),
    );
    expect(tester.takeException(), isNull);
    final rows = find.byKey(const Key('history-row'));
    expect(rows, findsNWidgets(2)); // 15/10 senza record: nessuna riga
    expect(
      tester.getTopLeft(find.text('14/10/2026')).dy,
      lessThan(tester.getTopLeft(find.text('16/10/2026')).dy),
    );
    final first = find.descendant(of: rows.at(0), matching: find.byType(Text));
    final texts = [for (final t in first.evaluate()) (t.widget as Text).data];
    expect(texts, [
      '14/10/2026',
      'Poco mosso',
      '22,0°',
      '18,5°',
      '0,0°',
      '20,1°',
      '0,40 m',
      '1,00 m',
    ]);
    final second = find.descendant(of: rows.at(1), matching: find.byType(Text));
    final t2 = [for (final t in second.evaluate()) (t.widget as Text).data];
    expect(t2, ['16/10/2026', 'n.d.', ...List.filled(6, 'n.d.')]);
    // Nessuno scorrimento orizzontale.
    final horizontal = tester
        .widgetList<Scrollable>(find.byType(Scrollable))
        .where((s) => s.axis == Axis.horizontal);
    expect(horizontal, isEmpty);
    expect(find.byType(SingleChildScrollView), findsNothing);
    // Intestazioni fisse.
    expect(find.byKey(const Key('history-table-header')), findsOneWidget);
    expect(find.text('Aria\nmedia'), findsOneWidget);
  });

  testWidgets('AC-5 mesi: nome del mese e days', (tester) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      host(
        HistoryResult(
          slug: 's',
          name: 'S',
          granularity: HistoryGranularity.month,
          from: '2026-09-01',
          to: '2026-10-20',
          months: const [
            HistoryMonth(month: '2026-09', days: 30, state: 'Mosso'),
            HistoryMonth(month: '2026-10', days: 3),
          ],
        ),
      ),
    );
    expect(find.text('set 2026 · 30 gg'), findsOneWidget);
    expect(find.text('ott 2026 · 3 gg'), findsOneWidget);
    expect(find.text('Mosso'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('formatHistoryValue', () {
    expect(formatHistoryValue(null, 1, '°'), 'n.d.');
    expect(formatHistoryValue(1.25, 1), '1,3');
    expect(formatHistoryValue(-0.5, 2, ' m'), '-0,50 m');
  });

  test('AC-4 mappa etichetta -> rango/colore e legenda', () {
    expect(seaStateLabels.length, 10);
    expect(seaStateRank('Calmo'), 0);
    expect(seaStateRank('Tempestoso'), 9);
    expect(seaStateRank(null), isNull);
    expect(seaStateRank('boh'), isNull);
    expect(seaStateColor(null), seaStateUnknownColor);
    expect(seaStateColor('boh'), seaStateUnknownColor);
    final colors = {for (final l in seaStateLabels) seaStateColor(l)};
    expect(colors.length, 10);
    expect(colors.contains(seaStateUnknownColor), isFalse);
    expect(presentSeaStates(['Mosso', null, 'Calmo', 'Mosso', 'x']), [
      'Calmo',
      'Mosso',
    ]);
  });

  testWidgets('AC-4 fascia: un solo CustomPainter, legenda solo presenti', (
    tester,
  ) async {
    final states = <String?>['Calmo', null, 'Mosso', 'Mosso'];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Column(
            children: [
              SeaStateStrip(states: states),
              SeaStateLegend(states: states),
            ],
          ),
        ),
      ),
    );
    final strip = find.byKey(const Key('sea-state-strip'));
    expect(tester.widget<CustomPaint>(strip).painter, isA<SeaStatePainter>());
    expect(
      find.descendant(
        of: find.byType(SeaStateStrip),
        matching: find.byType(CustomPaint),
      ),
      findsOneWidget,
    );
    final legend = find.byKey(const Key('sea-state-legend'));
    expect(
      find.descendant(of: legend, matching: find.text('Calmo')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: legend, matching: find.text('Mosso')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: legend, matching: find.text('Agitato')),
      findsNothing,
    );
    expect(
      SeaStatePainter(states).shouldRepaint(SeaStatePainter(states)),
      isFalse,
    );
  });

  test('AC-4 la fascia colora ogni cella con il colore del rango', () async {
    final states = <String?>['Calmo', null, 'Mosso'];
    final recorder = ui.PictureRecorder();
    SeaStatePainter(states).paint(Canvas(recorder), const Size(200, 10));
    final image = await recorder.endRecording().toImage(200, 10);
    final data = (await image.toByteData())!;
    Color at(int x) => Color.fromARGB(
      data.getUint8((5 * 200 + x) * 4 + 3),
      data.getUint8((5 * 200 + x) * 4),
      data.getUint8((5 * 200 + x) * 4 + 1),
      data.getUint8((5 * 200 + x) * 4 + 2),
    );
    // Celle centrate su x = 0, 100, 200 (le estreme tagliate a meta').
    expect(at(10), seaStateColor('Calmo'));
    expect(at(100), seaStateUnknownColor);
    expect(at(190), seaStateColor('Mosso'));
  });
}
