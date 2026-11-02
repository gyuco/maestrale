import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sardegna_mare_app/main.dart';
import 'package:sardegna_mare_app/screens/disclaimer_screen.dart';
import 'package:sardegna_mare_app/services/forecast_api.dart';
import 'package:sardegna_mare_app/services/home_location_store.dart';

import 'fixtures.dart';
import 'support/catalog_fakes.dart';

void main() {
  testWidgets('mostra fonti, licenze e uso responsabile', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: DisclaimerScreen()),
    );

    final scrollable = find.byType(Scrollable).first;

    expect(find.text('Informazioni'), findsOneWidget);
    expect(find.text('Le fonti dei dati'), findsOneWidget);
    expect(
      find.textContaining('Open-Meteo Marine Weather API'),
      findsOneWidget,
    );
    expect(
      find.textContaining('Open-Meteo Weather Forecast API'),
      findsOneWidget,
    );
    expect(
      find.textContaining('https://open-meteo.com/en/terms'),
      findsOneWidget,
    );

    await tester.scrollUntilVisible(
      find.text('Mappa e catalogo'),
      250,
      scrollable: scrollable,
    );
    expect(find.textContaining('OpenStreetMap'), findsOneWidget);
    expect(
      find.textContaining('https://www.openstreetmap.org/copyright'),
      findsOneWidget,
    );

    await tester.scrollUntilVisible(
      find.text('Previsioni, non misure'),
      250,
      scrollable: scrollable,
    );
    expect(find.textContaining('non misure osservate'), findsOneWidget);
    expect(find.textContaining('best_match'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('Uso responsabile'),
      250,
      scrollable: scrollable,
    );
    expect(find.textContaining('bollettini'), findsOneWidget);
    expect(find.textContaining('unica fonte'), findsOneWidget);
    expect(find.textContaining('112'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('Aggiornamento e disponibilità'),
      250,
      scrollable: scrollable,
    );
    expect(find.text('Aggiornamento e disponibilità'), findsOneWidget);
  });

  testWidgets('a 320 dp la pagina scorre senza overflow', (tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      const MaterialApp(home: DisclaimerScreen()),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    await tester.scrollUntilVisible(
      find.text('Aggiornamento e disponibilità'),
      250,
      scrollable: find.byType(Scrollable).first,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('dalla home si apre la pagina e si torna indietro', (
    tester,
  ) async {
    var requests = 0;
    final client = MockClient((request) async {
      requests++;
      return http.Response('{}', 500);
    });

    await tester.pumpWidget(
      SeaForecastApp(
        locationRepository: await repositoryWith(sampleLocations),
        api: ForecastApi(baseUrl: 'http://api.test', client: client),
        homeLocationStore: _MemoryHomeLocationStore(),
      ),
    );
    await tester.pumpAndSettle();

    final open = find.byKey(const Key('open-disclaimer-button'));
    await tester.scrollUntilVisible(
      open,
      250,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(find.text('Fonti dei dati e uso responsabile'), findsOneWidget);

    await tester.tap(open);
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('disclaimer-list')), findsOneWidget);
    expect(find.text('Le fonti dei dati'), findsOneWidget);
    expect(requests, 0);

    await tester.pageBack();
    await tester.pumpAndSettle();

    expect(find.text('Come sarà il mare?'), findsOneWidget);
  });

  testWidgets('la pagina si apre con una previsione caricata', (tester) async {
    final client = MockClient(
      (request) async => http.Response(jsonEncode(forecastFixture), 200),
    );

    await tester.pumpWidget(
      SeaForecastApp(
        locationRepository: await repositoryWith(sampleLocations),
        api: ForecastApi(baseUrl: 'http://api.test', client: client),
        homeLocationStore: _MemoryHomeLocationStore(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('location-search-field')),
      'Torre dei Corsari',
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('search-button')));
    await tester.pumpAndSettle();
    expect(find.text('Poco mosso'), findsOneWidget);

    final open = find.byKey(const Key('open-disclaimer-button'));
    await tester.scrollUntilVisible(
      open,
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(open);
    await tester.pumpAndSettle();
    await tester.tap(open);
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('disclaimer-list')), findsOneWidget);
  });

  testWidgets('la pagina si apre anche quando la ricerca fallisce', (
    tester,
  ) async {
    final client = MockClient(
      (request) async => http.Response(
        jsonEncode({
          'detail': {'message': 'Previsioni non disponibili'},
        }),
        503,
      ),
    );

    await tester.pumpWidget(
      SeaForecastApp(
        locationRepository: await repositoryWith(sampleLocations),
        api: ForecastApi(baseUrl: 'http://api.test', client: client),
        homeLocationStore: _MemoryHomeLocationStore(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('location-search-field')),
      'Torre dei Corsari',
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('search-button')));
    await tester.pumpAndSettle();
    expect(find.text('Riprova'), findsOneWidget);

    final open = find.byKey(const Key('open-disclaimer-button'));
    await tester.scrollUntilVisible(
      open,
      250,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(open);
    await tester.pumpAndSettle();
    await tester.tap(open);
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('disclaimer-list')), findsOneWidget);
  });
}

class _MemoryHomeLocationStore implements HomeLocationStore {
  String? value;

  @override
  Future<String?> load() async => value;

  @override
  Future<void> save(String slug) async => value = slug;
}
