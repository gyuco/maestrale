import 'package:shared_preferences/shared_preferences.dart';

/// Copia locale del catalogo: corpo JSON ricevuto ed ETag (ADR-0005 A.1).
class StoredCatalog {
  const StoredCatalog({required this.body, this.etag});
  final String body;
  final String? etag;
}

abstract interface class LocationCacheStore {
  Future<StoredCatalog?> load();

  Future<void> save(StoredCatalog value);
}

class SharedPreferencesLocationCacheStore implements LocationCacheStore {
  const SharedPreferencesLocationCacheStore();

  static const _bodyKey = 'maestrale_catalog_json';
  static const _etagKey = 'maestrale_catalog_etag';

  @override
  Future<StoredCatalog?> load() async {
    final preferences = await SharedPreferences.getInstance();
    final body = preferences.getString(_bodyKey);
    if (body == null) return null;
    return StoredCatalog(body: body, etag: preferences.getString(_etagKey));
  }

  @override
  Future<void> save(StoredCatalog value) async {
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString(_bodyKey, value.body);
    final etag = value.etag;
    if (etag == null) {
      await preferences.remove(_etagKey);
    } else {
      await preferences.setString(_etagKey, etag);
    }
  }
}
