import 'package:flutter/rendering.dart';

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sardegna_mare_app/models/history.dart';
import 'package:sardegna_mare_app/models/history_series.dart';
import 'package:sardegna_mare_app/widgets/history_chart.dart';

HistoryDay d(int day, {double? lo, double? hi, double? mean, double? sea}) =>
    HistoryDay(
      date: '2026-10-${day.toString().padLeft(2, '0')}',
      airTemperatureMeanC: mean,
      airTemperatureMinC: lo,
      airTemperatureMaxC: hi,
      waterTemperatureMeanC: sea,
    );

HistorySeries series(List<HistoryDay> items, {int count = 8}) =>
    HistorySeries.fromResult(
      HistoryResult(
        slug: 's',
        name: 'S',
        granularity: HistoryGranularity.day,
        from: '2026-10-01',
        to: '2026-10-${count.toString().padLeft(2, '0')}',
        days: items,
      ),
    );

void main() {
  semanticsTests();
  testWidgets('AC-2 LineChart con serie, limiti espliciti, nessuna curva', (
    tester,
  ) async {
    final s = series([
      d(1, lo: 10, hi: 20, mean: 15, sea: 18),
      d(2, lo: 11, hi: 21, mean: 16),
      // 3 mancante
      d(4, lo: 12, hi: null, mean: 17, sea: 19),
      d(5, lo: 12, hi: 22, mean: null, sea: 19),
      d(6),
      d(8, lo: 13, hi: 23, mean: 18, sea: 20),
    ]);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: HistoryChart(series: s)),
      ),
    );
    await tester.pump();
    expect(tester.takeException(), isNull);
    final chart = tester.widget<LineChart>(find.byType(LineChart));
    final data = chart.data;
    expect(data.minX, 0);
    expect(data.maxX, 7);
    expect(data.minY, s.minY);
    expect(data.maxY, s.maxY);
    expect(data.lineBarsData.length, 4);
    expect(data.lineBarsData.every((b) => !b.isCurved), isTrue);
    expect(data.lineBarsData[0].spots, s.airMean);
    expect(data.lineBarsData[1].spots, s.seaMean);
    expect(data.lineBarsData[0].spots.any((p) => p.isNull()), isTrue);
    expect(data.lineBarsData[0].color, airColor);
    expect(data.lineBarsData[1].color, seaColor);
    expect(data.lineBarsData[2].color, Colors.transparent);
    expect(data.lineBarsData[3].color, Colors.transparent);
    expect(data.betweenBarsData.length, 1);
    expect(data.betweenBarsData.single.fromIndex, 2);
    expect(data.betweenBarsData.single.toIndex, 3);
    expect(find.byKey(const Key('chart-legend')), findsOneWidget);
    expect(find.text('Aria media'), findsOneWidget);
    expect(find.text('Mare medio'), findsOneWidget);
    // Etichette dell'asse x in italiano, formato dd/MM.
    expect(find.text('01/10'), findsOneWidget);
  });

  testWidgets('AC-3 etichette dei mesi in italiano', (tester) async {
    final s = HistorySeries.fromResult(
      HistoryResult(
        slug: 's',
        name: 'S',
        granularity: HistoryGranularity.month,
        from: '2026-01-01',
        to: '2026-05-20',
        months: const [
          HistoryMonth(month: '2026-01', days: 31, airTemperatureMeanC: 8),
          HistoryMonth(month: '2026-05', days: 20, airTemperatureMeanC: 18),
        ],
      ),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: HistoryChart(series: s)),
      ),
    );
    await tester.pump();
    expect(find.text('gen 26'), findsOneWidget);
    expect(find.text('mag 26'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  // Rischio architettura §9: resa di BetweenBarsData con nullSpot. Si
  // disegna il grafico "nudo" (area = widget) e si campionano i pixel: la
  // banda deve esserci dove min e max sono entrambi presenti e non deve
  // attraversare le interruzioni.
  testWidgets('BetweenBarsData con nullSpot: banda spezzata, nessun crash', (
    tester,
  ) async {
    // indici 0..9; banda presente su 0-2 e 6-9; interrotta su 3-5.
    final s = series([
      for (var i = 1; i <= 3; i++) d(i, lo: 10, hi: 20),
      d(4, lo: 10, hi: null),
      // 5 mancante, 6 tutto null
      d(6),
      for (var i = 7; i <= 10; i++) d(i, lo: 10, hi: 20),
    ], count: 10);
    const band = Color(0xFF00FF00);
    const size = Size(400, 200);
    final key = GlobalKey();
    await tester.pumpWidget(
      Directionality(
        textDirection: TextDirection.ltr,
        child: Center(
          child: RepaintBoundary(
            key: key,
            child: Container(
              color: Colors.white,
              width: size.width,
              height: size.height,
              child: LineChart(
                buildHistoryChartData(s, bare: true, band: band),
                duration: Duration.zero,
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump();
    expect(tester.takeException(), isNull);

    final rgba = await tester.runAsync(() async {
      final boundary =
          key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      final image = await boundary.toImage();
      final bytes = (await image.toByteData())!;
      return (w: image.width, h: image.height, data: bytes);
    });
    final img = rgba!;
    Color at(double x, double y) {
      final px = (x * img.w / size.width).round().clamp(0, img.w - 1);
      final py = (y * img.h / size.height).round().clamp(0, img.h - 1);
      final o = (py * img.w + px) * 4;
      return Color.fromARGB(
        img.data.getUint8(o + 3),
        img.data.getUint8(o),
        img.data.getUint8(o + 1),
        img.data.getUint8(o + 2),
      );
    }

    double xOf(int i) => i / s.maxX * size.width;
    // y di meta' banda (15 gradi).
    final yMid = (s.maxY - 15) / (s.maxY - s.minY) * size.height;
    // Dentro il primo segmento (fra gli indici 0 e 2) e nel secondo (6..9).
    expect(at(xOf(1), yMid), band);
    expect(at(xOf(8), yMid), band);
    // Dentro l'interruzione (indici 3..5) niente riempimento.
    expect(at(xOf(4), yMid), isNot(band));
    expect(at(xOf(5), yMid), isNot(band));
  });
}

void semanticsTests() {
  testWidgets('R-1 grafico: etichetta semantica italiana con periodo e valori',
      (tester) async {
    final handle = tester.ensureSemantics();
    final s = series([
      d(1, lo: 10, hi: 20, mean: 14, sea: 18),
      d(2, lo: 11, hi: 21, mean: 16),
      d(8, lo: 13, hi: 23, mean: 18, sea: 20),
    ]);
    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: HistoryChart(series: s))),
    );
    final label = tester
        .getSemantics(find.bySemanticsLabel(RegExp('^Grafico')))
        .label;
    expect(label, contains('dal 01/10 al 08/10'));
    expect(label, contains('Aria media: min 14,0, max 18,0, media 16,0'));
    expect(label, contains('Aria min-max: da 10,0 a 23,0'));
    expect(label, contains('Mare medio: min 18,0, max 20,0, media 19,0'));
    handle.dispose();
  });

  testWidgets('R-1 grafico: n.d. quando non ci sono valori', (tester) async {
    final handle = tester.ensureSemantics();
    final s = series([d(1), d(2)], count: 2);
    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: HistoryChart(series: s))),
    );
    final label = tester
        .getSemantics(find.bySemanticsLabel(RegExp('^Grafico')))
        .label;
    expect(label, contains('Aria media: n.d.'));
    expect(label, contains('Aria min-max: n.d.'));
    expect(label, contains('Mare medio: n.d.'));
    handle.dispose();
  });
}
