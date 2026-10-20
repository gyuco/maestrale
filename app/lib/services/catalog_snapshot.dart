import 'package:flutter/services.dart' show rootBundle;

import '../models/location_catalog.dart';

/// Snapshot del catalogo incluso nell'app (ADR-0005 B.1), generato da
/// `locations.json` con `scripts/sync_app_catalog.mjs`.
abstract interface class CatalogSnapshot {
  Future<LocationCatalog> load();
}

class AssetCatalogSnapshot implements CatalogSnapshot {
  const AssetCatalogSnapshot();

  static const assetPath = 'assets/locations.json';

  @override
  Future<LocationCatalog> load() async => LocationCatalog.parse(
    await rootBundle.loadString(assetPath),
    origin: CatalogOrigin.snapshot,
  );
}
