import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_marker_cluster/flutter_map_marker_cluster.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sardegna_mare_app/main.dart';
import 'package:sardegna_mare_app/screens/coastal_map_screen.dart';
import 'package:sardegna_mare_app/services/forecast_api.dart';
import 'package:sardegna_mare_app/services/home_location_store.dart';
import 'package:sardegna_mare_app/services/location_repository.dart';

import 'fixtures.dart';
import 'support/catalog_fakes.dart';

class _EmptyHomeStore implements HomeLocationStore {
  @override
  Future<String?> load() async => null;

  @override
  Future<void> save(String location) async {}
}

const _stintino = {
  'slug': 'stintino',
  'name': 'Stintino',
  'latitude': 40.93,
  'longitude': 8.22,
};

Widget _app(LocationRepository repository, {MockClient? client}) => SeaForecastApp(
  locationRepository: repository,
  api: ForecastApi(
    baseUrl: 'http://api.test',
    client:
        client ??
        MockClient((request) async {
          final payload = jsonDecode(jsonEncode(forecastFixture));
          (payload['location'] as Map<String, dynamic>)['name'] =
              request.url.queryParameters['localita'];
          return http.Response(jsonEncode(payload), 200);
        }),
  ),
  homeLocationStore: _EmptyHomeStore(),
  locationService: const NoLocationService(),
);

void main() {
  testWidgets(
    'la ricerca suggerisce solo le localita del repository (nessun elenco nel codice)',
    (tester) async {
      final repository = await repositoryWith([...sampleLocations, _stintino]);
      await tester.pumpWidget(_app(repository));

      await tester.enterText(
        find.byKey(const Key('location-search-field')),
        'stin',
      );
      await tester.pump();
      expect(find.text('Stintino'), findsOneWidget);

      // Una localita del vecchio elenco hardcoded, assente dal catalogo di test.
      await tester.enterText(
        find.byKey(const Key('location-search-field')),
        'olbia',
      );
      await tester.pump();
      expect(find.text('Olbia'), findsNothing);
    },
  );

  testWidgets(
    'quando il catalogo di rete sostituisce quello in uso la ricerca lo usa',
    (tester) async {
      final client = MockClient(
        (_) async => http.Response(
          envelopeBody([...sampleLocations, _stintino]),
          200,
          headers: {'etag': '"v2"'},
        ),
      );
      final repository = await repositoryWith(sampleLocations, client: client);
      await tester.pumpWidget(_app(repository));

      await tester.enterText(
        find.byKey(const Key('location-search-field')),
        'stin',
      );
      await tester.pump();
      expect(find.text('Stintino'), findsNothing);

      await tester.runAsync(repository.refresh);
      await tester.enterText(
        find.byKey(const Key('location-search-field')),
        'stint',
      );
      await tester.pump();

      expect(find.text('Stintino'), findsOneWidget);
    },
  );

  testWidgets(
    'la mappa mostra un pin per localita del repository e il messaggio se non trova',
    (tester) async {
      final repository = await repositoryWith([...sampleLocations, _stintino]);
      await tester.pumpWidget(
        MaterialApp(
          home: CoastalMapScreen(
            locationRepository: repository,
            locationService: const NoLocationService(),
          ),
        ),
      );
      await tester.pump();

      final layer = tester.widget<MarkerClusterLayerWidget>(
        find.byType(MarkerClusterLayerWidget),
      );
      expect(
        layer.options.markers.map((m) => m.key),
        contains(const Key('map-pin-stintino')),
      );
      expect(layer.options.markers, hasLength(sampleLocations.length + 1));

      await tester.enterText(
        find.byKey(const Key('map-location-search-field')),
        'zzz',
      );
      await tester.tap(find.byKey(const Key('map-search-button')));
      await tester.pump();
      expect(
        find.text('Località non trovata tra quelle disponibili.'),
        findsOneWidget,
      );

      await tester.enterText(
        find.byKey(const Key('map-location-search-field')),
        'stin',
      );
      await tester.tap(find.byKey(const Key('map-search-button')));
      await tester.pump();
      expect(
        find.byKey(const Key('choose-map-location-button')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('map-selected-pin-stintino')),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'con 500 localita la mappa raggruppa i pin in cluster con il conteggio',
    (tester) async {
      final repository = await repositoryWith(syntheticLocations(500));
      await tester.pumpWidget(
        MaterialApp(
          home: CoastalMapScreen(
            locationRepository: repository,
            locationService: const NoLocationService(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      final layer = tester.widget<MarkerClusterLayerWidget>(
        find.byType(MarkerClusterLayerWidget),
      );
      expect(layer.options.markers, hasLength(500));

      final clusters = find.byKey(const Key('map-cluster'));
      expect(clusters, findsWidgets);
      final counts = tester
          .widgetList<Container>(clusters)
          .map((c) => int.parse(((c.child! as Text)).data!));
      expect(counts.every((n) => n >= 2), isTrue);
      // I pin visibili (singoli + dentro i cluster) sono molti meno di 500 widget.
      expect(
        find.byKey(const Key('map-cluster')).evaluate().length +
            find
                .byWidgetPredicate((w) => w.key.toString().contains('map-pin-'))
                .evaluate()
                .length,
        lessThan(120),
      );

      // Toccando un cluster la mappa si avvicina.
      final context = tester.element(find.byType(MarkerClusterLayerWidget));
      final zoomBefore = MapCamera.of(context).zoom;
      await tester.tap(clusters.first, warnIfMissed: false);
      await tester.pumpAndSettle();
      expect(
        MapCamera.of(
          tester.element(find.byType(MarkerClusterLayerWidget)),
        ).zoom,
        greaterThan(zoomBefore),
      );
    },
  );
}
