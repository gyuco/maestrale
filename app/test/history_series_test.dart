import 'package:fl_chart/fl_chart.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sardegna_mare_app/models/history.dart';
import 'package:sardegna_mare_app/models/history_series.dart';

HistoryResult mk(List<HistoryDay> items, {String from = '2026-10-14'}) =>
    HistoryResult(
      slug: 's',
      name: 'S',
      granularity: HistoryGranularity.day,
      from: from,
      to: '2026-10-20',
      days: items,
    );

void main() {
  test('AC-1 giorni mancanti e null sono nullSpot, indice da from', () {
    final s = HistorySeries.fromResult(
      mk([
        const HistoryDay(
          date: '2026-10-14',
          airTemperatureMeanC: 20,
          airTemperatureMinC: 15,
          airTemperatureMaxC: 25,
          waterTemperatureMeanC: 19,
          state: 'Calmo',
        ),
        // 15 e 16 mancanti
        const HistoryDay(
          date: '2026-10-17',
          airTemperatureMeanC: 0,
          airTemperatureMinC: 10,
          airTemperatureMaxC: null, // banda interrotta
        ),
        const HistoryDay(date: '2026-10-18'), // tutto null
        const HistoryDay(
          date: '2026-10-20',
          airTemperatureMeanC: 21,
          airTemperatureMinC: 16,
          airTemperatureMaxC: 26,
          waterTemperatureMeanC: 18,
        ),
      ]),
    );
    expect(s.length, 7);
    expect(s.maxX, 6);
    expect(s.airMean.length, 7);
    expect(s.airMean[0], const FlSpot(0, 20));
    expect(s.airMean[1].isNull(), isTrue);
    expect(s.airMean[2].isNull(), isTrue);
    expect(s.airMean[3], const FlSpot(3, 0)); // 0 e' un valore reale
    expect(s.airMean[4].isNull(), isTrue);
    expect(s.airMean[5].isNull(), isTrue);
    expect(s.airMean[6], const FlSpot(6, 21));
    expect(s.seaMean[0], const FlSpot(0, 19));
    expect(s.seaMean[3].isNull(), isTrue);
    expect(s.seaMean[6], const FlSpot(6, 18));
    // banda: solo dove min e max sono entrambi non null
    expect(s.bandMin[0], const FlSpot(0, 15));
    expect(s.bandMax[0], const FlSpot(0, 25));
    expect(s.bandMin[3].isNull(), isTrue);
    expect(s.bandMax[3].isNull(), isTrue);
    expect(s.bandMin[1].isNull(), isTrue);
    expect(s.bandMax[6], const FlSpot(6, 26));
    expect(s.states, ['Calmo', null, null, null, null, null, null]);
    expect(s.labelAt(0), '14/10');
    expect(s.labelAt(6), '20/10');
    expect(s.minY, lessThan(10));
    expect(s.maxY, greaterThan(26));
  });

  test('AC-1 Y con margine e fallback senza valori', () {
    final empty = HistorySeries.fromResult(
      mk([const HistoryDay(date: '2026-10-14')]),
    );
    expect(empty.minY, lessThan(empty.maxY));
    final flat = HistorySeries.fromResult(
      mk([
        const HistoryDay(date: '2026-10-14', airTemperatureMeanC: 20),
        const HistoryDay(date: '2026-10-15', airTemperatureMeanC: 20),
      ]),
    );
    expect(flat.minY, lessThan(20));
    expect(flat.maxY, greaterThan(20));
  });

  test('un solo giorno: maxX almeno 1', () {
    final s = HistorySeries.fromResult(
      mk([
        const HistoryDay(date: '2026-10-14', airTemperatureMeanC: 20),
      ]).copyForTest(to: '2026-10-14'),
    );
    expect(s.length, 1);
    expect(s.maxX, 1);
  });

  test('AC-3 mesi: indice del mese da from, etichette italiane, null', () {
    final r = HistoryResult(
      slug: 's',
      name: 'S',
      granularity: HistoryGranularity.month,
      from: '2025-11-15',
      to: '2026-02-10',
      months: const [
        HistoryMonth(
          month: '2025-11',
          days: 16,
          airTemperatureMeanC: 12,
          airTemperatureMinC: 8,
          airTemperatureMaxC: 16,
          waterTemperatureMeanC: 17,
          state: 'Mosso',
        ),
        // 2025-12 mancante
        HistoryMonth(month: '2026-01', days: 31),
        HistoryMonth(
          month: '2026-02',
          days: 10,
          airTemperatureMeanC: 9,
          airTemperatureMinC: 5,
          airTemperatureMaxC: 13,
        ),
      ],
    );
    final s = HistorySeries.fromResult(r);
    expect(s.length, 4);
    expect(s.airMean[0], const FlSpot(0, 12));
    expect(s.airMean[1].isNull(), isTrue);
    expect(s.airMean[2].isNull(), isTrue);
    expect(s.airMean[3], const FlSpot(3, 9));
    expect(s.seaMean[3].isNull(), isTrue);
    expect(s.bandMin[3], const FlSpot(3, 5));
    expect(s.labelAt(0), 'nov 25');
    expect(s.labelAt(1), 'dic 25');
    expect(s.labelAt(3), 'feb 26');
    expect(s.states, ['Mosso', null, null, null]);
  });

  test('366 giorni e 120 mesi: al piu\' 366 punti per serie', () {
    final d = HistoryResult(
      slug: 's',
      name: 'S',
      granularity: HistoryGranularity.day,
      from: '2025-10-20',
      to: '2026-10-20',
      days: [
        for (var i = 0; i < 366; i++)
          HistoryDay(
            date: formatDay(DateTime.utc(2025, 10, 20 + i)),
            airTemperatureMeanC: i.toDouble(),
          ),
      ],
    );
    final s = HistorySeries.fromResult(d);
    expect(s.length, 366);
    expect(s.airMean.length, 366);
    expect(s.airMean.last, const FlSpot(365, 365));
  });

  test('etichette asse x: al piu\' 6, includono il primo indice', () {
    for (final n in [1, 2, 7, 30, 120, 366]) {
      final idx = HistorySeries.labelIndexes(n);
      expect(idx.length, lessThanOrEqualTo(6));
      expect(idx.first, 0);
      expect(idx.every((i) => i < n), isTrue);
    }
  });
}

String formatDay(DateTime d) =>
    '${d.year}-${d.month.toString().padLeft(2, '0')}-'
    '${d.day.toString().padLeft(2, '0')}';

extension on HistoryResult {
  HistoryResult copyForTest({required String to}) => HistoryResult(
    slug: slug,
    name: name,
    granularity: granularity,
    from: from,
    to: to,
    days: days,
    months: months,
  );
}
