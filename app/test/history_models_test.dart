import 'package:flutter_test/flutter_test.dart';
import 'package:sardegna_mare_app/models/history.dart';

import 'history_fixtures.dart';

void main() {
  test('wire value della granularità', () {
    expect(HistoryGranularity.day.wire, 'day');
    expect(HistoryGranularity.month.wire, 'month');
  });

  test('day: valori, null e interi diventano double', () {
    final r = HistoryResult.fromJson(historyDayFixture);
    expect(r.slug, 'torre-dei-corsari');
    expect(r.name, 'Torre dei Corsari');
    expect(r.granularity, HistoryGranularity.day);
    expect(r.from, '2026-10-14');
    expect(r.to, '2026-10-15');
    final d = r.days;
    expect(d, hasLength(2));
    expect(d[0].date, '2026-10-14');
    expect(d[0].airTemperatureMeanC, 22.0);
    expect(d[0].airTemperatureMeanC, isA<double>());
    expect(d[0].airTemperatureMinC, 18.5);
    expect(d[0].airTemperatureMaxC, 0.0);
    expect(d[0].airTemperatureMaxC, isA<double>());
    expect(d[0].waterTemperatureMeanC, 20.1);
    expect(d[0].state, 'Poco mosso');
    expect(d[0].waveHeightMeanM, 0.4);
    expect(d[0].waveHeightMaxM, 1.0);
    expect(d[1].date, '2026-10-15');
    expect(d[1].airTemperatureMeanC, isNull);
    expect(d[1].state, isNull);
    expect(d[1].waveHeightMaxM, isNull);
  });

  test('month: mese, days e valori nullable', () {
    final r = HistoryResult.fromJson(historyMonthFixture);
    expect(r.granularity, HistoryGranularity.month);
    final m = r.months;
    expect(m[0].month, '2026-09');
    expect(m[0].days, 30);
    expect(m[0].airTemperatureMinC, 15.0);
    expect(m[0].state, 'Mosso');
    expect(m[1].days, 3);
    expect(m[1].waterTemperatureMeanC, isNull);
  });

  Map<String, dynamic> withItems(Object? items, [String g = 'day']) => {
    ...historyDayFixture,
    'granularity': g,
    'items': items,
  };

  test('strutture non valide lanciano FormatException', () {
    final bad = <Object?>[
      withItems(null),
      withItems('x'),
      withItems([
        {'air_temperature_mean_c': 1},
      ]),
      withItems([
        {'date': '2026-10-14', 'air_temperature_mean_c': 'caldo'},
      ]),
      withItems([
        {'date': '2026-10-14', 'state': 3},
      ]),
      withItems([5]),
      withItems([
        {'month': '2026-10', 'days': 3},
      ]), // granularità day con elemento month
      withItems([
        {'date': '2026-10-14'},
      ], 'month'), // month senza month/days
      withItems([
        {'month': '2026-10', 'days': 'x'},
      ], 'month'),
      {...historyDayFixture, 'granularity': 'week'},
      {...historyDayFixture, 'location': null},
    ];
    for (final json in bad) {
      expect(
        () => HistoryResult.fromJson(json as Map<String, dynamic>),
        throwsFormatException,
        reason: '$json',
      );
    }
  });
}
