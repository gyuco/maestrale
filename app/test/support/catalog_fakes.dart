import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sardegna_mare_app/models/coastal_location.dart';
import 'package:sardegna_mare_app/models/location_catalog.dart';
import 'package:sardegna_mare_app/services/catalog_snapshot.dart';
import 'package:sardegna_mare_app/services/location_cache_store.dart';
import 'package:sardegna_mare_app/services/location_catalog_api.dart';
import 'package:sardegna_mare_app/services/location_repository.dart';
import 'package:sardegna_mare_app/services/location_service.dart';

/// Le 13 localita del catalogo reale, ma scritte nel TEST (non nel codice app).
const sampleLocations = <Map<String, dynamic>>[
  {'slug': 'alghero', 'name': 'Alghero', 'latitude': 40.56, 'longitude': 8.26},
  {'slug': 'arbatax', 'name': 'Arbatax', 'latitude': 39.92, 'longitude': 9.72},
  {
    'slug': 'cagliari',
    'name': 'Cagliari',
    'latitude': 39.17,
    'longitude': 9.15,
  },
  {
    'slug': 'la-maddalena',
    'name': 'La Maddalena',
    'latitude': 41.22,
    'longitude': 9.40,
  },
  {
    'slug': 'torre-dei-corsari',
    'name': 'Torre dei Corsari',
    'latitude': 39.688153,
    'longitude': 8.450613,
  },
];

String arrayBody(List<Map<String, dynamic>> locations) => jsonEncode(locations);

String envelopeBody(
  List<Map<String, dynamic>> locations, {
  String version = 'abc',
}) => jsonEncode({
  'schema_version': 1,
  'version': version,
  'count': locations.length,
  'locations': locations,
});

List<Map<String, dynamic>> syntheticLocations(int count) => List.generate(
  count,
  (i) => {
    'slug': 'loc-${i.toString().padLeft(3, '0')}',
    'name': 'Località ${i.toString().padLeft(3, '0')}',
    'latitude': 36.5 + (i % 25) * 0.2,
    'longitude': 7.8 + (i ~/ 25) * 0.2,
  },
);

LocationCatalog catalogOf(
  List<Map<String, dynamic>> locations, {
  CatalogOrigin origin = CatalogOrigin.snapshot,
}) => LocationCatalog.parse(arrayBody(locations), origin: origin);

class MemoryCacheStore implements LocationCacheStore {
  MemoryCacheStore([this.stored]);
  StoredCatalog? stored;
  bool failOnLoad = false;
  int saves = 0;

  @override
  Future<StoredCatalog?> load() async {
    if (failOnLoad) throw StateError('storage non disponibile');
    return stored;
  }

  @override
  Future<void> save(StoredCatalog value) async {
    saves++;
    stored = value;
  }
}

class FakeSnapshot implements CatalogSnapshot {
  FakeSnapshot(this.locations);
  final List<Map<String, dynamic>> locations;

  @override
  Future<LocationCatalog> load() async => catalogOf(locations);
}

/// Repository di test con catalogo gia' pubblicato (nessuna rete).
Future<LocationRepository> repositoryWith(
  List<Map<String, dynamic>> locations, {
  http.Client? client,
}) async {
  final repository = LocationRepository(
    api: LocationCatalogApi(
      baseUrl: 'http://api.test',
      client:
          client ??
          MockClient((_) async => throw http.ClientException('offline')),
    ),
    cacheStore: MemoryCacheStore(),
    snapshot: FakeSnapshot(locations),
  );
  await repository.loadCached();
  return repository;
}

CoastalLocation locationNamed(LocationCatalog catalog, String slug) =>
    catalog.locations.firstWhere((l) => l.slug == slug);

/// Servizio di posizione che non fa nulla (servizi disattivati).
class NoLocationService implements LocationService {
  const NoLocationService();

  @override
  Future<AppLocationPermission> checkPermission() async =>
      AppLocationPermission.denied;

  @override
  Future<AppPosition> getCurrentPosition() async => throw StateError('no');

  @override
  Future<bool> isServiceEnabled() async => false;

  @override
  Future<bool> openAppSettings() async => false;

  @override
  Future<AppLocationPermission> requestPermission() async =>
      AppLocationPermission.denied;
}
