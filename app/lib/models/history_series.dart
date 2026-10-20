import 'package:fl_chart/fl_chart.dart';

import '../models/history.dart';

const _monthNames = [
  'gen',
  'feb',
  'mar',
  'apr',
  'mag',
  'giu',
  'lug',
  'ago',
  'set',
  'ott',
  'nov',
  'dic',
];

/// Nome breve del mese in italiano (1..12).
String shortMonthIt(int month) => _monthNames[month - 1];

/// Serie del grafico, precalcolate alla ricezione dei dati (NFR-26).
///
/// Asse x = indice del giorno (o del mese) a partire da `from`. Giorni/mesi
/// assenti e valori `null` sono [FlSpot.nullSpot]: nessun valore inventato
/// (FR-87). La banda ha punti solo dove min e max sono entrambi non nulli.
class HistorySeries {
  HistorySeries._({
    required this.granularity,
    required this.start,
    required this.length,
    required this.airMean,
    required this.seaMean,
    required this.bandMin,
    required this.bandMax,
    required this.states,
    required this.minY,
    required this.maxY,
  });

  factory HistorySeries.fromResult(HistoryResult r) {
    final isDay = r.granularity == HistoryGranularity.day;
    final from = _parseDay(r.from);
    final to = _parseDay(r.to);
    final start = isDay ? from : DateTime.utc(from.year, from.month);

    int indexOf(String key) {
      if (isDay) return _parseDay(key).difference(start).inDays;
      final y = int.parse(key.substring(0, 4));
      final m = int.parse(key.substring(5, 7));
      return (y - start.year) * 12 + (m - start.month);
    }

    final values = <(int, HistoryValues)>[
      if (isDay)
        for (final d in r.days) (indexOf(d.date), d)
      else
        for (final m in r.months) (indexOf(m.month), m),
    ].where((e) => e.$1 >= 0).toList();

    var length = isDay
        ? to.difference(from).inDays + 1
        : (to.year - start.year) * 12 + (to.month - start.month) + 1;
    for (final e in values) {
      if (e.$1 + 1 > length) length = e.$1 + 1;
    }
    if (length < 1) length = 1;

    List<FlSpot> blank() => List.filled(length, FlSpot.nullSpot);
    final airMean = blank();
    final seaMean = blank();
    final bandMin = blank();
    final bandMax = blank();
    final states = List<String?>.filled(length, null);
    var lo = double.infinity;
    var hi = double.negativeInfinity;
    void track(double? v) {
      if (v == null) return;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }

    for (final (i, v) in values) {
      final x = i.toDouble();
      if (v.airTemperatureMeanC != null) {
        airMean[i] = FlSpot(x, v.airTemperatureMeanC!);
      }
      if (v.waterTemperatureMeanC != null) {
        seaMean[i] = FlSpot(x, v.waterTemperatureMeanC!);
      }
      if (v.airTemperatureMinC != null && v.airTemperatureMaxC != null) {
        bandMin[i] = FlSpot(x, v.airTemperatureMinC!);
        bandMax[i] = FlSpot(x, v.airTemperatureMaxC!);
      }
      states[i] = v.state;
      track(v.airTemperatureMeanC);
      track(v.airTemperatureMinC);
      track(v.airTemperatureMaxC);
      track(v.waterTemperatureMeanC);
    }

    double minY;
    double maxY;
    if (lo.isFinite && hi.isFinite) {
      final margin = (hi - lo) * 0.1 < 1 ? 1.0 : (hi - lo) * 0.1;
      minY = lo - margin;
      maxY = hi + margin;
    } else {
      minY = 0;
      maxY = 30;
    }
    return HistorySeries._(
      granularity: r.granularity,
      start: start,
      length: length,
      airMean: List.unmodifiable(airMean),
      seaMean: List.unmodifiable(seaMean),
      bandMin: List.unmodifiable(bandMin),
      bandMax: List.unmodifiable(bandMax),
      states: List.unmodifiable(states),
      minY: minY,
      maxY: maxY,
    );
  }

  final HistoryGranularity granularity;
  final DateTime start;
  final int length;
  final List<FlSpot> airMean;
  final List<FlSpot> seaMean;
  final List<FlSpot> bandMin;
  final List<FlSpot> bandMax;

  /// Stato del mare per indice (`null` se assente o non disponibile).
  final List<String?> states;
  final double minY;
  final double maxY;

  double get minX => 0;

  /// Ultimo indice (almeno 1, per avere un asse x non degenere).
  double get maxX => length > 1 ? (length - 1).toDouble() : 1;

  /// Etichetta dell'asse x: `dd/MM` per i giorni, `MMM yy` per i mesi.
  String labelAt(int index) {
    if (granularity == HistoryGranularity.day) {
      final d = start.add(Duration(days: index));
      return '${d.day.toString().padLeft(2, '0')}/'
          '${d.month.toString().padLeft(2, '0')}';
    }
    final d = DateTime.utc(start.year, start.month + index);
    return '${shortMonthIt(d.month)} '
        '${(d.year % 100).toString().padLeft(2, '0')}';
  }

  /// Indici delle etichette dell'asse x: al piu' 6, a passo costante.
  static List<int> labelIndexes(int length) {
    if (length <= 6) return [for (var i = 0; i < length; i++) i];
    final step = ((length - 1) / 5).ceil();
    return [for (var i = 0; i < length; i += step) i];
  }
}

DateTime _parseDay(String iso) => DateTime.utc(
  int.parse(iso.substring(0, 4)),
  int.parse(iso.substring(5, 7)),
  int.parse(iso.substring(8, 10)),
);
