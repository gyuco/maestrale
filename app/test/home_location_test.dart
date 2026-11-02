import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:sardegna_mare_app/models/location_catalog.dart';
import 'package:sardegna_mare_app/services/home_location.dart';

LocationCatalog catalog() => LocationCatalog.parse(
  jsonEncode({
    'locations': [
      {'slug': 'alghero', 'name': 'Alghero', 'latitude': 40.56, 'longitude': 8.26},
      {'slug': 'chia', 'name': 'Chía', 'latitude': 38.89, 'longitude': 8.88},
      {
        'slug': 'torre-dei-corsari',
        'name': 'Torre dei Corsari',
        'latitude': 39.68,
        'longitude': 8.43,
      },
    ],
  }),
  origin: CatalogOrigin.snapshot,
);

void main() {
  test('uno slug salvato resta invariato', () {
    expect(resolveSavedHomeLocation('chia', catalog()), 'chia');
    expect(resolveSavedHomeLocation('  chia  ', catalog()), 'chia');
  });

  test('un nome salvato viene convertito nello slug', () {
    expect(
      resolveSavedHomeLocation('Torre dei Corsari', catalog()),
      'torre-dei-corsari',
    );
    expect(resolveSavedHomeLocation('alghero', catalog()), 'alghero');
  });

  test('la conversione usa la forma normalizzata (maiuscole e accenti)', () {
    expect(resolveSavedHomeLocation('CHÍA', catalog()), 'chia');
    expect(resolveSavedHomeLocation('torre dei corsari', catalog()), 'torre-dei-corsari');
  });

  test('una preferenza senza corrispondenza resta invariata', () {
    expect(resolveSavedHomeLocation('Atlantide', catalog()), isNull);
    expect(resolveSavedHomeLocation('', catalog()), isNull);
  });

  test('un catalogo vuoto non risolve nulla', () {
    final empty = LocationCatalog(const [], origin: CatalogOrigin.snapshot);
    expect(resolveSavedHomeLocation('Alghero', empty), isNull);
  });
}
