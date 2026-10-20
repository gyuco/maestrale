import 'dart:convert';

import 'package:sardegna_mare_app/services/api_errors.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

void main() {
  test('detail testuale', () {
    final r = http.Response(
      jsonEncode({'detail': 'Intervallo non valido'}),
      422,
    );
    expect(apiErrorMessage(r), 'Intervallo non valido');
  });
  test('detail.message', () {
    final r = http.Response(
      jsonEncode({
        'detail': {
          'message': 'Località sconosciuta',
          'available': ['a'],
        },
      }),
      404,
    );
    expect(apiErrorMessage(r), 'Località sconosciuta');
  });
  test('detail.message assente: errore con codice', () {
    final r = http.Response(jsonEncode({'detail': <String, dynamic>{}}), 404);
    expect(apiErrorMessage(r), 'Errore 404');
  });
  test('senza detail o corpo non JSON: messaggio generico con codice', () {
    expect(
      apiErrorMessage(http.Response('{}', 500)),
      'Il server ha risposto con errore 500',
    );
    expect(
      apiErrorMessage(http.Response('<html>', 502)),
      'Il server ha risposto con errore 502',
    );
  });
}
