import 'dart:async';

import 'package:flutter/material.dart';

import 'config/api_config.dart';
import 'screens/forecast_screen.dart';
import 'services/forecast_api.dart';
import 'services/history_api.dart';
import 'services/catalog_snapshot.dart';
import 'services/home_location_store.dart';
import 'services/location_cache_store.dart';
import 'services/location_catalog_api.dart';
import 'services/location_repository.dart';
import 'services/location_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final repository = LocationRepository(
    api: LocationCatalogApi(baseUrl: ApiConfig.baseUrl),
    cacheStore: const SharedPreferencesLocationCacheStore(),
    snapshot: const AssetCatalogSnapshot(),
  );
  // Copia locale o snapshot subito (nessuna attesa di rete, FR-65/NFR-22),
  // poi la rete in parallelo.
  await repository.loadCached();
  unawaited(repository.refresh());
  runApp(SeaForecastApp(locationRepository: repository));
}

class SeaForecastApp extends StatelessWidget {
  const SeaForecastApp({
    super.key,
    required this.locationRepository,
    this.api,
    this.homeLocationStore,
    this.locationService,
    this.historyApi,
  });

  final LocationRepository locationRepository;
  final ForecastApi? api;
  final HomeLocationStore? homeLocationStore;
  final LocationService? locationService;
  final HistoryApi? historyApi;

  @override
  Widget build(BuildContext context) {
    final forecastApi = api ?? ForecastApi(baseUrl: ApiConfig.baseUrl);
    final locationStore =
        homeLocationStore ?? const SharedPreferencesHomeLocationStore();
    const ink = Color(0xFF123B56);
    const turquoise = Color(0xFF00AFC1);

    return MaterialApp(
      title: 'Maestrale',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        fontFamily: 'sans-serif',
        colorScheme: ColorScheme.fromSeed(
          seedColor: turquoise,
          primary: const Color(0xFF007F96),
          secondary: const Color(0xFFFFB43A),
          surface: Colors.white,
          onSurface: ink,
        ),
        scaffoldBackgroundColor: const Color(0xFFEAF9FA),
        textTheme: const TextTheme(
          displaySmall: TextStyle(
            color: ink,
            fontSize: 38,
            fontWeight: FontWeight.w900,
            height: 1.05,
            letterSpacing: -1.2,
          ),
          headlineMedium: TextStyle(
            color: ink,
            fontSize: 27,
            fontWeight: FontWeight.w900,
            letterSpacing: -0.6,
          ),
          titleLarge: TextStyle(
            color: ink,
            fontSize: 20,
            fontWeight: FontWeight.w800,
          ),
          titleMedium: TextStyle(
            color: ink,
            fontSize: 16,
            fontWeight: FontWeight.w800,
          ),
          bodyMedium: TextStyle(color: Color(0xFF486C80), height: 1.4),
          bodySmall: TextStyle(color: Color(0xFF648495), height: 1.35),
          labelMedium: TextStyle(
            color: Color(0xFF648495),
            fontWeight: FontWeight.w700,
          ),
        ),
        cardTheme: CardThemeData(
          elevation: 0,
          color: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(28),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: Colors.white,
          hintStyle: const TextStyle(color: Color(0xFF7893A2)),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(22),
            borderSide: BorderSide.none,
          ),
        ),
      ),
      home: ForecastScreen(
        api: forecastApi,
        homeLocationStore: locationStore,
        locationRepository: locationRepository,
        locationService: locationService,
        historyApi: historyApi,
      ),
    );
  }
}
