import 'package:http/http.dart' as http;

import '../models/location_catalog.dart';

/// Esito di `GET /locations`.
sealed class CatalogFetchResult {
  const CatalogFetchResult();
}

class CatalogFresh extends CatalogFetchResult {
  const CatalogFresh({required this.catalog, required this.body});
  final LocationCatalog catalog;

  /// Corpo grezzo, da salvare come copia locale.
  final String body;
}

class CatalogNotModified extends CatalogFetchResult {
  const CatalogNotModified();
}

class LocationCatalogException implements Exception {
  const LocationCatalogException(this.message);
  final String message;
  @override
  String toString() => message;
}

class LocationCatalogApi {
  LocationCatalogApi({
    required String baseUrl,
    http.Client? client,
    this.timeout = const Duration(seconds: 15),
  }) : baseUrl = baseUrl.replaceFirst(RegExp(r'/$'), ''),
       _client = client ?? http.Client();

  final String baseUrl;
  final Duration timeout;
  final http.Client _client;

  /// `GET /locations` con `If-None-Match` se [etag] è presente (FR-66).
  /// Lancia [LocationCatalogException] per qualsiasi errore.
  Future<CatalogFetchResult> fetch({String? etag}) async {
    try {
      final response = await _client
          .get(
            Uri.parse('$baseUrl/locations'),
            headers: {'If-None-Match': ?etag},
          )
          .timeout(timeout);
      if (response.statusCode == 304) return const CatalogNotModified();
      if (response.statusCode != 200) {
        throw LocationCatalogException(
          'Il server ha risposto con errore ${response.statusCode}',
        );
      }
      final catalog = LocationCatalog.parse(
        response.body,
        origin: CatalogOrigin.network,
        etag: response.headers['etag'],
      );
      return CatalogFresh(catalog: catalog, body: response.body);
    } on LocationCatalogException {
      rethrow;
    } on Object catch (error) {
      throw LocationCatalogException('Catalogo non disponibile: $error');
    }
  }
}
