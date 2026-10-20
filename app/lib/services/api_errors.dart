import 'dart:convert';

import 'package:http/http.dart' as http;

/// Messaggio d'errore per una risposta HTTP diversa da 200 (FR-33): `detail`
/// testuale oppure `detail.message`, altrimenti un messaggio generico con il
/// codice HTTP.
String apiErrorMessage(http.Response response) {
  try {
    final payload = jsonDecode(response.body) as Map<String, dynamic>;
    final detail = payload['detail'];
    if (detail is String) {
      return detail;
    }
    if (detail is Map<String, dynamic>) {
      return detail['message'] as String? ?? 'Errore ${response.statusCode}';
    }
  } on Object {
    // Il backend potrebbe non avere restituito JSON.
  }
  return 'Il server ha risposto con errore ${response.statusCode}';
}
