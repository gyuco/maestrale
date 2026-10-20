import 'package:flutter/foundation.dart';

import '../models/location_catalog.dart';
import 'catalog_snapshot.dart';
import 'location_cache_store.dart';
import 'location_catalog_api.dart';

/// Unico punto da cui le schermate ottengono il catalogo (FR-65, FR-67).
///
/// `loadCached()` pubblica subito copia locale o snapshot (mai la rete);
/// `refresh()` chiede `GET /locations` e, se risponde 200, sostituisce copia
/// locale e catalogo in uso. Nessun errore di rete è bloccante.
class LocationRepository {
  LocationRepository({
    required LocationCatalogApi api,
    required LocationCacheStore cacheStore,
    required CatalogSnapshot snapshot,
  }) : _api = api,
       _cacheStore = cacheStore,
       _snapshot = snapshot;

  final LocationCatalogApi _api;
  final LocationCacheStore _cacheStore;
  final CatalogSnapshot _snapshot;
  final ValueNotifier<LocationCatalog> _catalog = ValueNotifier(
    LocationCatalog.empty(),
  );

  /// Catalogo in uso, per le schermate.
  ValueListenable<LocationCatalog> get catalog => _catalog;

  /// ETag della copia locale valida (solo se [catalog] viene da lì o dalla rete).
  String? get _validEtag {
    final current = _catalog.value;
    return current.origin == CatalogOrigin.snapshot ? null : current.etag;
  }

  Future<LocationCatalog> loadCached() async {
    LocationCatalog? local;
    try {
      final stored = await _cacheStore.load();
      if (stored != null) {
        local = LocationCatalog.parse(
          stored.body,
          origin: CatalogOrigin.local,
          etag: stored.etag,
        );
      }
    } on Object {
      local = null; // copia assente o illeggibile: si ripiega sullo snapshot
    }
    final catalog = local ?? await _snapshot.load();
    _catalog.value = catalog;
    return catalog;
  }

  Future<void> refresh() async {
    try {
      final result = await _api.fetch(etag: _validEtag);
      switch (result) {
        case CatalogNotModified():
          return;
        case CatalogFresh(:final catalog, :final body):
          _catalog.value = catalog;
          try {
            await _cacheStore.save(
              StoredCatalog(body: body, etag: catalog.etag),
            );
          } on Object {
            // La copia locale non si è salvata: il catalogo di rete resta in uso.
          }
      }
    } on Object {
      // Rete o risposta non valida: si continua con copia locale o snapshot.
    }
  }
}
