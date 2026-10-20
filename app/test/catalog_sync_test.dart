import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sardegna_mare_app/models/location_catalog.dart';

// ADR-0004/0005: lo snapshot dell'app e' generato da ../locations.json con
// `node scripts/sync_app_catalog.mjs`; questo test fallisce se non e' allineato.
void main() {
  final source = File('../locations.json');
  final snapshot = File('assets/locations.json');

  test('lo snapshot incluso nell\'app esiste', () {
    expect(
      snapshot.existsSync(),
      isTrue,
      reason: 'eseguire node scripts/sync_app_catalog.mjs',
    );
  });

  test(
    'lo snapshot coincide con locations.json (stessa fonte, FR-61/FR-65)',
    () {
      final expected = jsonDecode(source.readAsStringSync());
      final actual = jsonDecode(snapshot.readAsStringSync());
      expect(
        actual,
        equals(expected),
        reason:
            'snapshot non allineato: eseguire node scripts/sync_app_catalog.mjs',
      );
    },
  );

  test(
    'lo snapshot e\' un catalogo valido con slug univoci e coordinate nei limiti',
    () {
      final catalog = LocationCatalog.parse(
        snapshot.readAsStringSync(),
        origin: CatalogOrigin.snapshot,
      );
      expect(catalog.locations, isNotEmpty);
      expect(
        catalog.locations.map((l) => l.slug).toSet(),
        hasLength(catalog.locations.length),
      );
      for (final location in catalog.locations) {
        expect(location.name, isNotEmpty);
        expect(location.latitude, inInclusiveRange(-90, 90));
        expect(location.longitude, inInclusiveRange(-180, 180));
      }
    },
  );
}
