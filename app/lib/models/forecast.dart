class Forecast {
  const Forecast({
    required this.location,
    required this.timezone,
    required this.generatedAt,
    required this.daily,
  });

  final ForecastLocation location;
  final String timezone;
  final DateTime generatedAt;
  final List<DailyForecast> daily;

  factory Forecast.fromJson(Map<String, dynamic> json) => Forecast(
    location: ForecastLocation.fromJson(_map(json, 'location')),
    timezone: json['timezone'] as String? ?? 'Europe/Rome',
    generatedAt: DateTime.parse(json['generated_at'] as String),
    daily: _list(json, 'daily')
        .map((item) => DailyForecast.fromJson(item as Map<String, dynamic>))
        .toList(growable: false),
  );
}

class ForecastLocation {
  const ForecastLocation({
    required this.name,
    required this.latitude,
    required this.longitude,
    required this.slug,
  });

  final String name;
  final double latitude;
  final double longitude;
  final String slug;

  factory ForecastLocation.fromJson(Map<String, dynamic> json) =>
      ForecastLocation(
        name: json['name'] as String,
        latitude: _number(json, 'latitude'),
        longitude: _number(json, 'longitude'),
        slug: json['slug'] as String,
      );
}

class DailyForecast {
  const DailyForecast({
    required this.date,
    required this.sea,
    required this.weather,
  });

  final DateTime date;
  final SeaForecast sea;
  final WeatherForecast weather;

  factory DailyForecast.fromJson(Map<String, dynamic> json) => DailyForecast(
    date: DateTime.parse(json['date'] as String),
    sea: SeaForecast.fromJson(_map(json, 'sea')),
    weather: WeatherForecast.fromJson(_map(json, 'weather')),
  );
}

class SeaForecast {
  const SeaForecast({
    required this.state,
    required this.waveHeightMeanM,
    required this.waveHeightMaxM,
    required this.wavePeriodMeanS,
    required this.waveDirectionMeanDeg,
    required this.waveDirectionName,
    required this.waterTemperatureMeanC,
  });

  final String state;
  final double waveHeightMeanM;
  final double waveHeightMaxM;
  final double wavePeriodMeanS;
  final double waveDirectionMeanDeg;
  final String waveDirectionName;
  final double waterTemperatureMeanC;

  factory SeaForecast.fromJson(Map<String, dynamic> json) => SeaForecast(
    state: json['state'] as String,
    waveHeightMeanM: _number(json, 'wave_height_mean_m'),
    waveHeightMaxM: _number(json, 'wave_height_max_m'),
    wavePeriodMeanS: _number(json, 'wave_period_mean_s'),
    waveDirectionMeanDeg: _number(json, 'wave_direction_mean_deg'),
    waveDirectionName: json['wave_direction_name'] as String,
    waterTemperatureMeanC: _number(json, 'water_temperature_mean_c'),
  );
}

class WeatherForecast {
  const WeatherForecast({
    required this.airTemperatureMeanC,
    required this.airTemperatureMinC,
    required this.airTemperatureMaxC,
    required this.weatherCode,
    required this.windSpeedMeanKmh,
    required this.windSpeedMaxKmh,
    required this.windGustMeanKmh,
    required this.windGustMaxKmh,
    required this.windDirectionMeanDeg,
    required this.windName,
  });

  final double airTemperatureMeanC;
  final double airTemperatureMinC;
  final double airTemperatureMaxC;
  final int weatherCode;
  final double windSpeedMeanKmh;
  final double windSpeedMaxKmh;
  final double windGustMeanKmh;
  final double windGustMaxKmh;
  final double windDirectionMeanDeg;
  final String windName;

  factory WeatherForecast.fromJson(Map<String, dynamic> json) =>
      WeatherForecast(
        airTemperatureMeanC: _number(json, 'air_temperature_mean_c'),
        airTemperatureMinC: _number(json, 'air_temperature_min_c'),
        airTemperatureMaxC: _number(json, 'air_temperature_max_c'),
        weatherCode: (json['weather_code'] as num).toInt(),
        windSpeedMeanKmh: _number(json, 'wind_speed_mean_kmh'),
        windSpeedMaxKmh: _number(json, 'wind_speed_max_kmh'),
        windGustMeanKmh: _number(json, 'wind_gust_mean_kmh'),
        windGustMaxKmh: _number(json, 'wind_gust_max_kmh'),
        windDirectionMeanDeg: _number(json, 'wind_direction_mean_deg'),
        windName: json['wind_name'] as String,
      );
}

Map<String, dynamic> _map(Map<String, dynamic> json, String key) =>
    json[key] as Map<String, dynamic>;
List<dynamic> _list(Map<String, dynamic> json, String key) =>
    json[key] as List<dynamic>;
double _number(Map<String, dynamic> json, String key) =>
    (json[key] as num).toDouble();
