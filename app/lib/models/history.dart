enum HistoryGranularity {
  day('day'),
  month('month');

  const HistoryGranularity(this.wire);

  /// Valore usato dal backend (`granularity`).
  final String wire;
}

double? _num(Map<String, dynamic> json, String key) {
  final v = json[key];
  if (v == null) return null;
  if (v is num) return v.toDouble();
  throw FormatException('Valore non numerico per $key');
}

String? _str(Map<String, dynamic> json, String key) {
  final v = json[key];
  if (v == null) return null;
  if (v is String) return v;
  throw FormatException('Valore non testuale per $key');
}

String _reqStr(Map<String, dynamic> json, String key) {
  final v = json[key];
  if (v is String) return v;
  throw FormatException('Campo $key mancante o non valido');
}

Map<String, dynamic> _map(Object? v, String what) {
  if (v is Map<String, dynamic>) return v;
  throw FormatException('$what non è un oggetto');
}

/// Valori comuni a giorno e mese; `null` ammesso (FR-91).
abstract class HistoryValues {
  const HistoryValues({
    this.airTemperatureMeanC,
    this.airTemperatureMinC,
    this.airTemperatureMaxC,
    this.waterTemperatureMeanC,
    this.state,
    this.waveHeightMeanM,
    this.waveHeightMaxM,
  });

  final double? airTemperatureMeanC;
  final double? airTemperatureMinC;
  final double? airTemperatureMaxC;
  final double? waterTemperatureMeanC;
  final String? state;
  final double? waveHeightMeanM;
  final double? waveHeightMaxM;
}

class HistoryDay extends HistoryValues {
  const HistoryDay({
    required this.date,
    super.airTemperatureMeanC,
    super.airTemperatureMinC,
    super.airTemperatureMaxC,
    super.waterTemperatureMeanC,
    super.state,
    super.waveHeightMeanM,
    super.waveHeightMaxM,
  });

  factory HistoryDay.fromJson(Map<String, dynamic> json) => HistoryDay(
    date: _reqStr(json, 'date'),
    airTemperatureMeanC: _num(json, 'air_temperature_mean_c'),
    airTemperatureMinC: _num(json, 'air_temperature_min_c'),
    airTemperatureMaxC: _num(json, 'air_temperature_max_c'),
    waterTemperatureMeanC: _num(json, 'water_temperature_mean_c'),
    state: _str(json, 'state'),
    waveHeightMeanM: _num(json, 'wave_height_mean_m'),
    waveHeightMaxM: _num(json, 'wave_height_max_m'),
  );

  /// `YYYY-MM-DD`
  final String date;
}

class HistoryMonth extends HistoryValues {
  const HistoryMonth({
    required this.month,
    required this.days,
    super.airTemperatureMeanC,
    super.airTemperatureMinC,
    super.airTemperatureMaxC,
    super.waterTemperatureMeanC,
    super.state,
    super.waveHeightMeanM,
    super.waveHeightMaxM,
  });

  factory HistoryMonth.fromJson(Map<String, dynamic> json) {
    final days = json['days'];
    if (days is! int) throw const FormatException('Campo days non valido');
    return HistoryMonth(
      month: _reqStr(json, 'month'),
      days: days,
      airTemperatureMeanC: _num(json, 'air_temperature_mean_c'),
      airTemperatureMinC: _num(json, 'air_temperature_min_c'),
      airTemperatureMaxC: _num(json, 'air_temperature_max_c'),
      waterTemperatureMeanC: _num(json, 'water_temperature_mean_c'),
      state: _str(json, 'state'),
      waveHeightMeanM: _num(json, 'wave_height_mean_m'),
      waveHeightMaxM: _num(json, 'wave_height_max_m'),
    );
  }

  /// `YYYY-MM`
  final String month;

  /// Giorni con dati nel mese (può essere parziale agli estremi).
  final int days;
}

class HistoryResult {
  const HistoryResult({
    required this.slug,
    required this.name,
    required this.granularity,
    required this.from,
    required this.to,
    this.days = const [],
    this.months = const [],
  });

  /// Lancia [FormatException] se la struttura non è valida.
  factory HistoryResult.fromJson(Map<String, dynamic> json) {
    final location = _map(json['location'], 'location');
    final granularity = switch (json['granularity']) {
      'day' => HistoryGranularity.day,
      'month' => HistoryGranularity.month,
      _ => throw const FormatException('Granularità non valida'),
    };
    final items = json['items'];
    if (items is! List) throw const FormatException('items non è una lista');
    final objects = [for (final i in items) _map(i, 'elemento')];
    return HistoryResult(
      slug: _reqStr(location, 'slug'),
      name: _reqStr(location, 'name'),
      granularity: granularity,
      from: _reqStr(json, 'from'),
      to: _reqStr(json, 'to'),
      days: granularity == HistoryGranularity.day
          ? List.unmodifiable(objects.map(HistoryDay.fromJson))
          : const [],
      months: granularity == HistoryGranularity.month
          ? List.unmodifiable(objects.map(HistoryMonth.fromJson))
          : const [],
    );
  }

  final String slug;
  final String name;
  final HistoryGranularity granularity;
  final String from;
  final String to;
  final List<HistoryDay> days;
  final List<HistoryMonth> months;
}
