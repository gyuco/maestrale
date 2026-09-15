import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sardegna_mare_app/models/forecast.dart';
import 'package:sardegna_mare_app/services/forecast_api.dart';

import 'fixtures.dart';

void main() {
  test('deserializza tutti i valori principali', () {
    final forecast = Forecast.fromJson(forecastFixture);

    expect(forecast.location.slug, 'torre-dei-corsari');
    expect(forecast.daily.single.sea.waveHeightMeanM, 0.3);
    expect(forecast.daily.single.sea.waterTemperatureMeanC, 26.4);
    expect(forecast.daily.single.weather.airTemperatureMaxC, 31.0);
    expect(forecast.daily.single.weather.windName, 'Maestrale');
  });

  test('codifica la localita nel query parameter', () async {
    final client = MockClient((request) async {
      expect(
        request.url.toString(),
        'http://api.test/forecast?localita=Torre+dei+Corsari',
      );
      return http.Response(jsonEncode(forecastFixture), 200);
    });

    await ForecastApi(
      baseUrl: 'http://api.test/',
      client: client,
    ).fetchForecast('Torre dei Corsari');
  });

  test('espone il messaggio di errore del backend', () async {
    final client = MockClient(
      (_) async => http.Response(
        jsonEncode({
          'detail': {'message': 'Località non trovata'},
        }),
        404,
      ),
    );

    expect(
      () => ForecastApi(
        baseUrl: 'http://api.test',
        client: client,
      ).fetchForecast('X'),
      throwsA(
        isA<ForecastApiException>().having(
          (error) => error.message,
          'message',
          'Località non trovata',
        ),
      ),
    );
  });
}
