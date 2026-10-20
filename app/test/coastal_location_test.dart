import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sardegna_mare_app/models/coastal_location.dart';

void main() {
  test(
    'lo snapshot espone le 13 località del catalogo con coordinate valide (FR-1)',
    () {
      final raw =
          jsonDecode(File('assets/locations.json').readAsStringSync())
              as List<dynamic>;
      final locations = raw.map(CoastalLocation.fromJson).toList();

      expect(locations, hasLength(13));
      expect(locations.map((l) => l.slug).toSet(), hasLength(locations.length));
      for (final location in locations) {
        expect(location.name, isNotEmpty);
        expect(location.latitude, inInclusiveRange(-90, 90));
        expect(location.longitude, inInclusiveRange(-180, 180));
      }
    },
  );

  test('nessun elenco di località nel codice dell\'app (FR-67)', () {
    final sources = Directory('lib')
        .listSync(recursive: true)
        .whereType<File>()
        .where((f) => f.path.endsWith('.dart'));
    for (final file in sources) {
      final text = file.readAsStringSync();
      expect(text.contains('coastalLocations'), isFalse, reason: file.path);
      expect(text.contains("slug: 'alghero'"), isFalse, reason: file.path);
    }
  });
}
