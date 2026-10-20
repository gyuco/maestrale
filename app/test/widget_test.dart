import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_marker_cluster/flutter_map_marker_cluster.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sardegna_mare_app/main.dart';
import 'package:sardegna_mare_app/services/forecast_api.dart';
import 'package:sardegna_mare_app/services/home_location_store.dart';
import 'package:sardegna_mare_app/services/location_service.dart';

import 'fixtures.dart';
import 'support/catalog_fakes.dart';

void main() {
  testWidgets('cerca e mostra la previsione giornaliera', (tester) async {
    final homeLocationStore = _MemoryHomeLocationStore();
    final client = MockClient((request) async {
      expect(request.url.path, '/forecast');
      expect(request.url.queryParameters['localita'], 'Torre dei Corsari');
      return http.Response(jsonEncode(forecastFixture), 200);
    });

    await tester.pumpWidget(
      SeaForecastApp(
        locationRepository: await repositoryWith(sampleLocations),
        api: ForecastApi(baseUrl: 'http://api.test', client: client),
        homeLocationStore: homeLocationStore,
      ),
    );
    expect(find.byKey(const Key('locations-map')), findsNothing);
    expect(find.byKey(const Key('open-map-button')), findsOneWidget);
    expect(find.text('Come sarà il mare?'), findsOneWidget);

    await tester.tap(find.byKey(const Key('search-button')));
    await tester.pumpAndSettle();

    expect(find.text('Torre dei Corsari'), findsNWidgets(2));
    expect(find.text('Poco mosso'), findsOneWidget);
    expect(find.text('0.3 m'), findsOneWidget);
    expect(find.text('Maestrale'), findsOneWidget);
    expect(find.text('Stabilisci come pagina iniziale'), findsOneWidget);

    await tester.ensureVisible(
      find.byKey(const Key('set-home-location-button')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('set-home-location-button')));
    await tester.pumpAndSettle();

    expect(homeLocationStore.value, 'Torre dei Corsari');
    expect(find.text('Stabilisci come pagina iniziale'), findsNothing);
  });

  testWidgets('carica e cerca automaticamente la localita iniziale', (
    tester,
  ) async {
    final homeLocationStore = _MemoryHomeLocationStore('Alghero');
    final client = MockClient((request) async {
      expect(request.url.queryParameters['localita'], 'Alghero');
      final payload = jsonDecode(jsonEncode(forecastFixture));
      (payload['location'] as Map<String, dynamic>)['name'] = 'Alghero';
      return http.Response(jsonEncode(payload), 200);
    });

    await tester.pumpWidget(
      SeaForecastApp(
        locationRepository: await repositoryWith(sampleLocations),
        api: ForecastApi(baseUrl: 'http://api.test', client: client),
        homeLocationStore: homeLocationStore,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Alghero'), findsNWidgets(2));
    expect(find.text('Stabilisci come pagina iniziale'), findsNothing);
  });

  testWidgets('suggerisce le localita e cerca quella selezionata', (
    tester,
  ) async {
    final client = MockClient((request) async {
      expect(request.url.queryParameters['localita'], 'Alghero');
      final payload = jsonDecode(jsonEncode(forecastFixture));
      (payload['location'] as Map<String, dynamic>)['name'] = 'Alghero';
      return http.Response(jsonEncode(payload), 200);
    });

    await tester.pumpWidget(
      SeaForecastApp(
        locationRepository: await repositoryWith(sampleLocations),
        api: ForecastApi(baseUrl: 'http://api.test', client: client),
        homeLocationStore: _MemoryHomeLocationStore(),
      ),
    );

    await tester.enterText(
      find.byKey(const Key('location-search-field')),
      'algh',
    );
    await tester.pump();

    expect(find.text('Alghero'), findsOneWidget);

    await tester.tap(find.text('Alghero'));
    await tester.pumpAndSettle();

    expect(find.text('Alghero'), findsNWidgets(2));
    expect(find.text('Poco mosso'), findsOneWidget);
  });

  testWidgets('apre la mappa e cerca la località selezionata', (tester) async {
    final client = MockClient((request) async {
      expect(request.url.queryParameters['localita'], 'Alghero');
      final payload = jsonDecode(jsonEncode(forecastFixture));
      (payload['location'] as Map<String, dynamic>)
        ..['name'] = 'Alghero'
        ..['slug'] = 'alghero'
        ..['latitude'] = 40.56
        ..['longitude'] = 8.26;
      return http.Response(jsonEncode(payload), 200);
    });

    await tester.pumpWidget(
      SeaForecastApp(
        locationRepository: await repositoryWith(sampleLocations),
        api: ForecastApi(baseUrl: 'http://api.test', client: client),
        homeLocationStore: _MemoryHomeLocationStore(),
        locationService: const _FakeLocationService(),
      ),
    );

    await tester.tap(find.byKey(const Key('open-map-button')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('locations-map')), findsOneWidget);
    expect(find.byKey(const Key('map-location-search-field')), findsOneWidget);
    final clusterLayer = tester.widget<MarkerClusterLayerWidget>(
      find.byType(MarkerClusterLayerWidget),
    );
    expect(clusterLayer.options.markers, hasLength(sampleLocations.length));
    expect(find.byKey(const Key('user-location-pin')), findsOneWidget);
    expect(find.byKey(const Key('user-location-pin')), findsOneWidget);
    final tileLayer = tester.widget<TileLayer>(find.byType(TileLayer));
    final tileProvider = tileLayer.tileProvider as NetworkTileProvider;
    expect(tileProvider.cachingProvider, isA<DisabledMapCachingProvider>());

    await tester.enterText(
      find.byKey(const Key('map-location-search-field')),
      'algh',
    );
    await tester.pump();
    await tester.tap(find.text('Alghero'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('choose-map-location-button')));
    await tester.pumpAndSettle();

    expect(find.text('Alghero'), findsWidgets);
    expect(find.text('Poco mosso'), findsOneWidget);
  });

  testWidgets('sincronizza carousel principale e card giornaliere', (
    tester,
  ) async {
    final payload = jsonDecode(jsonEncode(forecastFixture));
    final firstDay = (payload['daily'] as List<dynamic>).first;
    final secondDay = jsonDecode(jsonEncode(firstDay));
    secondDay['date'] = '2026-08-25';
    secondDay['sea']['state'] = 'Mosso';
    secondDay['sea']['wave_height_mean_m'] = 1.2;
    secondDay['weather']['air_temperature_max_c'] = 29.0;
    (payload['daily'] as List<dynamic>).add(secondDay);
    final client = MockClient(
      (request) async => http.Response(jsonEncode(payload), 200),
    );

    await tester.pumpWidget(
      SeaForecastApp(
        locationRepository: await repositoryWith(sampleLocations),
        api: ForecastApi(baseUrl: 'http://api.test', client: client),
        homeLocationStore: _MemoryHomeLocationStore(),
      ),
    );
    await tester.tap(find.byKey(const Key('search-button')));
    await tester.pumpAndSettle();

    PageView carousel = tester.widget(
      find.byKey(const Key('weather-main-page-view')),
    );
    expect(carousel.controller!.page, 0);

    await tester.ensureVisible(find.byKey(const Key('weather-main-carousel')));
    await tester.pumpAndSettle();
    await tester.drag(
      find.byKey(const Key('weather-main-carousel')),
      const Offset(-500, 0),
    );
    await tester.pumpAndSettle();

    carousel = tester.widget(find.byKey(const Key('weather-main-page-view')));
    expect(carousel.controller!.page, 1);

    await tester.ensureVisible(find.byKey(const Key('forecast-mini-card-0')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('forecast-mini-card-0')));
    await tester.pumpAndSettle();

    carousel = tester.widget(find.byKey(const Key('weather-main-page-view')));
    expect(carousel.controller!.page, 0);
  });
}

class _MemoryHomeLocationStore implements HomeLocationStore {
  _MemoryHomeLocationStore([this.value]);

  String? value;

  @override
  Future<String?> load() async => value;

  @override
  Future<void> save(String location) async => value = location;
}

class _FakeLocationService implements LocationService {
  const _FakeLocationService();

  @override
  Future<AppLocationPermission> checkPermission() async =>
      AppLocationPermission.granted;

  @override
  Future<AppPosition> getCurrentPosition() async =>
      const AppPosition(latitude: 40.12, longitude: 9.0);

  @override
  Future<bool> isServiceEnabled() async => true;

  @override
  Future<bool> openAppSettings() async => true;

  @override
  Future<AppLocationPermission> requestPermission() async =>
      AppLocationPermission.granted;
}
