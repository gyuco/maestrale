import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sardegna_mare_app/main.dart';
import 'package:sardegna_mare_app/screens/history_screen.dart';
import 'package:sardegna_mare_app/services/forecast_api.dart';
import 'package:sardegna_mare_app/services/home_location_store.dart';

import 'fixtures.dart';
import 'support/catalog_fakes.dart';
import 'support/history_fakes.dart';

class _Store implements HomeLocationStore {
  @override
  Future<String?> load() async => null;
  @override
  Future<void> save(String location) async {}
}

Future<FakeHistoryApi> _pump(
  WidgetTester tester,
  Future<http.Response> Function(http.Request) handler,
) async {
  final history = FakeHistoryApi();
  await tester.pumpWidget(
    SeaForecastApp(
      locationRepository: await repositoryWith(sampleLocations),
      api: ForecastApi(baseUrl: 'http://api.test', client: MockClient(handler)),
      homeLocationStore: _Store(),
      historyApi: history,
    ),
  );
  return history;
}

void main() {
  testWidgets('AC-1 comando Storico solo con previsione caricata', (
    tester,
  ) async {
    final history = await _pump(
      tester,
      (_) async => http.Response(jsonEncode(forecastFixture), 200),
    );
    // Benvenuto: nessun comando.
    expect(find.byKey(const Key('open-history-button')), findsNothing);
    expect(find.byTooltip('Storico'), findsNothing);

    await tester.tap(find.byKey(const Key('search-button')));
    await tester.pumpAndSettle();
    expect(find.byTooltip('Storico'), findsOneWidget);

    await tester.tap(find.byKey(const Key('open-history-button')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.byType(HistoryScreen), findsOneWidget);
    final screen = tester.widget<HistoryScreen>(find.byType(HistoryScreen));
    expect(screen.slug, 'torre-dei-corsari');
    expect(screen.name, 'Torre dei Corsari');
    expect(history.calls.single.slug, 'torre-dei-corsari');
  });

  testWidgets('AC-1 nessun comando in caricamento o errore', (tester) async {
    await _pump(tester, (_) async => http.Response('{"detail":"giu"}', 503));
    await tester.tap(find.byKey(const Key('search-button')));
    await tester.pump(); // caricamento in corso
    expect(find.byTooltip('Storico'), findsNothing);
    await tester.pumpAndSettle(); // errore
    expect(find.text('Riprova'), findsOneWidget);
    expect(find.byTooltip('Storico'), findsNothing);
  });
}
