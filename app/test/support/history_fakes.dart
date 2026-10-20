import 'dart:async';

import 'package:sardegna_mare_app/models/history.dart';
import 'package:sardegna_mare_app/services/history_api.dart';
import 'package:sardegna_mare_app/services/rome_date.dart';

typedef HistoryCall = ({
  HistoryGranularity granularity,
  String slug,
  String from,
  String to,
  Completer<HistoryResult> completer,
});

HistoryResult dayResult(int count) => HistoryResult(
  slug: 'torre-dei-corsari',
  name: 'Torre dei Corsari',
  granularity: HistoryGranularity.day,
  from: '2026-10-14',
  to: '2026-10-20',
  days: [
    for (var i = 0; i < count; i++)
      HistoryDay(date: '2026-10-${(14 + i).toString().padLeft(2, '0')}'),
  ],
);

HistoryResult monthResult(int count) => HistoryResult(
  slug: 'torre-dei-corsari',
  name: 'Torre dei Corsari',
  granularity: HistoryGranularity.month,
  from: '2025-01-01',
  to: '2026-10-20',
  months: [
    for (var i = 0; i < count; i++)
      HistoryMonth(
        month: '2026-${(i + 1).toString().padLeft(2, '0')}',
        days: 30,
      ),
  ],
);

/// HistoryApi finta: ogni chiamata resta in sospeso finche' il test non la
/// completa.
class FakeHistoryApi extends HistoryApi {
  FakeHistoryApi() : super(baseUrl: 'http://fake');

  final calls = <HistoryCall>[];

  Future<HistoryResult> _record(
    HistoryGranularity g,
    String slug,
    DateTime from,
    DateTime to,
  ) {
    final c = Completer<HistoryResult>();
    calls.add((
      granularity: g,
      slug: slug,
      from: formatIsoDate(from),
      to: formatIsoDate(to),
      completer: c,
    ));
    return c.future;
  }

  @override
  Future<HistoryResult> fetchDays(String slug, DateTime from, DateTime to) =>
      _record(HistoryGranularity.day, slug, from, to);

  @override
  Future<HistoryResult> fetchMonths(String slug, DateTime from, DateTime to) =>
      _record(HistoryGranularity.month, slug, from, to);
}
