import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/api_config.dart';
import '../models/history.dart';
import 'api_errors.dart';
import 'rome_date.dart';

class HistoryApiException implements Exception {
  const HistoryApiException(this.message);
  final String message;
  @override
  String toString() => message;
}

class HistoryApi {
  HistoryApi({
    String? baseUrl,
    http.Client? client,
    this.timeout = defaultTimeout,
  }) : baseUrl = (baseUrl ?? ApiConfig.baseUrl).replaceFirst(RegExp(r'/$'), ''),
       _client = client ?? http.Client();

  /// Timeout app -> backend (NFR-6).
  static const defaultTimeout = Duration(seconds: 15);

  final String baseUrl;
  final Duration timeout;
  final http.Client _client;

  Future<HistoryResult> fetchDays(String slug, DateTime from, DateTime to) =>
      _fetch(slug, from, to, HistoryGranularity.day);

  Future<HistoryResult> fetchMonths(String slug, DateTime from, DateTime to) =>
      _fetch(slug, from, to, HistoryGranularity.month);

  Future<HistoryResult> _fetch(
    String slug,
    DateTime from,
    DateTime to,
    HistoryGranularity granularity,
  ) async {
    final uri = Uri.parse('$baseUrl/history').replace(
      queryParameters: {
        'localita': slug.trim(),
        'from': formatIsoDate(from),
        'to': formatIsoDate(to),
        'granularity': granularity.wire,
      },
    );
    final http.Response response;
    try {
      response = await _client.get(uri).timeout(timeout);
    } on TimeoutException {
      throw const HistoryApiException(
        'Il server ha impiegato troppo tempo a rispondere',
      );
    } on Object {
      throw const HistoryApiException(
        'Impossibile contattare il server: controlla la connessione',
      );
    }
    if (response.statusCode != 200) {
      throw HistoryApiException(apiErrorMessage(response));
    }
    try {
      final result = HistoryResult.fromJson(
        jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>,
      );
      if (result.granularity != granularity) {
        throw const FormatException('Granularità incoerente');
      }
      return result;
    } on Object {
      throw const HistoryApiException('Risposta del server non valida');
    }
  }
}
