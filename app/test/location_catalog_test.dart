import 'package:flutter_test/flutter_test.dart';
import 'package:sardegna_mare_app/models/coastal_location.dart';
import 'package:sardegna_mare_app/models/location_catalog.dart';

import 'support/catalog_fakes.dart';

void main() {
  test(
    'CoastalLocation.fromJson legge i quattro campi (anche coordinate intere)',
    () {
      final location = CoastalLocation.fromJson({
        'slug': 'a',
        'name': 'A',
        'latitude': 40,
        'longitude': 8.5,
      });

      expect(location.slug, 'a');
      expect(location.latitude, 40.0);
      expect(location.longitude, 8.5);
    },
  );

  group('LocationCatalog.parse', () {
    test('accetta array e involucro del Worker', () {
      final a = LocationCatalog.parse(
        arrayBody(sampleLocations),
        origin: CatalogOrigin.snapshot,
      );
      final b = LocationCatalog.parse(
        envelopeBody(sampleLocations),
        origin: CatalogOrigin.network,
        etag: '"x"',
      );

      expect(a.locations, hasLength(sampleLocations.length));
      expect(b.locations.map((l) => l.slug), a.locations.map((l) => l.slug));
      expect(b.etag, '"x"');
      expect(b.origin, CatalogOrigin.network);
    });

    test('rifiuta corpi non validi con FormatException', () {
      for (final body in [
        'non json',
        '42',
        '[]',
        '{"locations": []}',
        '[{"slug": "a", "name": "A", "latitude": 1}]',
        '[{"slug": "a", "name": "A", "latitude": "x", "longitude": 1}]',
        '[{"slug": "a", "name": "A", "latitude": 91, "longitude": 1}]',
        '[{"slug": "", "name": "A", "latitude": 1, "longitude": 1}]',
      ]) {
        expect(
          () => LocationCatalog.parse(body, origin: CatalogOrigin.network),
          throwsFormatException,
          reason: body,
        );
      }
    });
  });

  group('ricerca', () {
    final catalog = catalogOf([
      ...sampleLocations,
      {
        'slug': 'sant-antioco',
        'name': 'Sant’Antìoco',
        'latitude': 39.0,
        'longitude': 8.4,
      },
    ]);

    test('suggest: contains senza maiuscole/minuscole e senza accenti', () {
      expect(catalog.suggest('ALGH').map((l) => l.slug), ['alghero']);
      expect(catalog.suggest('antioco').map((l) => l.slug), ['sant-antioco']);
      expect(catalog.suggest('  '), isEmpty);
      expect(catalog.suggest('zzz'), isEmpty);
    });

    test('suggest: al piu 20 voci', () {
      final big = catalogOf(syntheticLocations(500));

      expect(big.suggest('local'), hasLength(LocationCatalog.maxSuggestions));
      expect(LocationCatalog.maxSuggestions, 20);
    });

    test('findExact: nome o slug, senza maiuscole', () {
      expect(catalog.findExact('LA MADDALENA')?.slug, 'la-maddalena');
      expect(catalog.findExact('torre-dei-corsari')?.name, 'Torre dei Corsari');
      expect(catalog.findExact('torre'), isNull);
    });

    test('firstContaining: prima voce il cui nome contiene il testo', () {
      expect(catalog.firstContaining('torre')?.slug, 'torre-dei-corsari');
      expect(catalog.firstContaining('nulla'), isNull);
    });

    test('nearest: la localita piu vicina alla posizione', () {
      expect(catalog.nearest(40.5, 8.3)?.slug, 'alghero');
      expect(catalog.nearest(39.2, 9.1)?.slug, 'cagliari');
    });

    test('con 500 voci i suggerimenti restano ben sotto i 100 ms', () {
      final big = catalogOf(syntheticLocations(500));
      final watch = Stopwatch()..start();
      for (final query in ['l', 'lo', 'loc', 'local', 'localit']) {
        big.suggest(query);
      }
      watch.stop();

      expect(watch.elapsedMilliseconds / 5, lessThan(100));
    });
  });
}
