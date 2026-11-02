import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

// FR-65/ADR-0010: lo snapshot e' generato dal catalogo del database con
// `node scripts/sync_app_catalog.mjs --from <file>`; il seed `locations.json`
// coincide ancora con il catalogo iniziale, quindi il test confronta le voci.
void main() {
  final source = File('../locations.json');
  final snapshot = File('assets/locations.json');

  test('lo snapshot incluso nell app esiste', () {
    expect(snapshot.existsSync(), isTrue, reason: 'eseguire node scripts/sync_app_catalog.mjs');
  });

  test('lo snapshot ha l involucro di /locations', () {
    final decoded = jsonDecode(snapshot.readAsStringSync());
    expect(decoded, isA<Map<String, dynamic>>());
    final body = decoded as Map<String, dynamic>;
    expect(body['schema_version'], 1);
    expect(body['version'], isA<String>());
    expect(body['count'], (body['locations'] as List<dynamic>).length);
  });

  test('le località dello snapshot coincidono con locations.json', () {
    final expected = (jsonDecode(source.readAsStringSync()) as List<dynamic>)
        .cast<Map<String, dynamic>>()
        .map((item) => item['slug'])
        .toList()
      ..sort();
    final actual = ((jsonDecode(snapshot.readAsStringSync())
                as Map<String, dynamic>)['locations'] as List<dynamic>)
        .cast<Map<String, dynamic>>()
        .map((item) => item['slug'])
        .toList()
      ..sort();
    expect(actual, equals(expected));
  });

  test('lo snapshot non contiene slug duplicati', () {
    final locations = ((jsonDecode(snapshot.readAsStringSync())
            as Map<String, dynamic>)['locations'] as List<dynamic>)
        .cast<Map<String, dynamic>>();
    final slugs = locations.map((item) => item['slug']).toList();
    expect(slugs.toSet().length, slugs.length);
  });
}
