import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/forecast.dart';
import 'api_errors.dart';

class ForecastApiException implements Exception {
  const ForecastApiException(this.message);
  final String message;
  @override
  String toString() => message;
}

class ForecastApi {
  ForecastApi({required String baseUrl, http.Client? client})
    : baseUrl = baseUrl.replaceFirst(RegExp(r'/$'), ''),
      _client = client ?? http.Client();

  final String baseUrl;
  final http.Client _client;

  Future<Forecast> fetchForecast(String location) async {
    final uri = Uri.parse(
      '$baseUrl/forecast',
    ).replace(queryParameters: {'localita': location.trim()});
    final response = await _client
        .get(uri)
        .timeout(const Duration(seconds: 15));
    if (response.statusCode != 200) {
      throw ForecastApiException(apiErrorMessage(response));
    }
    try {
      return Forecast.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>,
      );
    } on Object catch (error) {
      throw ForecastApiException('Risposta del server non valida: $error');
    }
  }
}
