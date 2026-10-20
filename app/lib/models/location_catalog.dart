import 'dart:convert';
import 'dart:math' as math;

import 'coastal_location.dart';

/// Da dove viene il catalogo in uso (FR-65).
enum CatalogOrigin { network, local, snapshot }

/// Catalogo delle località con i nomi normalizzati precalcolati (NFR-22).
class LocationCatalog {
  LocationCatalog(
    Iterable<CoastalLocation> locations, {
    this.etag,
    required this.origin,
  }) : locations = List.unmodifiable(locations),
       _normalized = List.unmodifiable(
         locations.map((location) => normalizeText(location.name)),
       );

  /// Catalogo vuoto: solo valore iniziale prima di `loadCached()`.
  LocationCatalog.empty()
    : locations = const [],
      etag = null,
      origin = CatalogOrigin.snapshot,
      _normalized = const [];

  static const maxSuggestions = 20;

  final List<CoastalLocation> locations;
  final String? etag;
  final CatalogOrigin origin;
  final List<String> _normalized;

  /// Interpreta l'array dello snapshot o l'involucro `{locations: [...]}` di
  /// `GET /locations`. Lancia [FormatException] se non valido o vuoto.
  factory LocationCatalog.parse(
    String body, {
    required CatalogOrigin origin,
    String? etag,
  }) {
    final decoded = jsonDecode(body);
    final list = switch (decoded) {
      List<dynamic>() => decoded,
      Map<String, dynamic>() when decoded['locations'] is List<dynamic> =>
        decoded['locations'] as List<dynamic>,
      _ => throw const FormatException('Catalogo non valido'),
    };
    if (list.isEmpty) throw const FormatException('Catalogo vuoto');
    return LocationCatalog(
      list.map(CoastalLocation.fromJson),
      etag: etag,
      origin: origin,
    );
  }

  bool get isEmpty => locations.isEmpty;

  /// Località il cui nome contiene [query] (senza maiuscole/accenti), al più
  /// [maxSuggestions].
  List<CoastalLocation> suggest(String query) {
    final needle = normalizeText(query.trim());
    if (needle.isEmpty) return const [];
    final result = <CoastalLocation>[];
    for (var i = 0; i < locations.length; i++) {
      if (_normalized[i].contains(needle)) {
        result.add(locations[i]);
        if (result.length == maxSuggestions) break;
      }
    }
    return result;
  }

  bool hasMatches(String query) {
    final needle = normalizeText(query.trim());
    return _normalized.any((name) => name.contains(needle));
  }

  /// Località con nome o slug esatto (senza distinzione di maiuscole).
  CoastalLocation? findExact(String query) {
    final needle = normalizeText(query.trim());
    for (var i = 0; i < locations.length; i++) {
      if (_normalized[i] == needle ||
          locations[i].slug == query.trim().toLowerCase()) {
        return locations[i];
      }
    }
    return null;
  }

  /// Prima località il cui nome contiene [query].
  CoastalLocation? firstContaining(String query) {
    final needle = normalizeText(query.trim());
    if (needle.isEmpty) return null;
    for (var i = 0; i < locations.length; i++) {
      if (_normalized[i].contains(needle)) return locations[i];
    }
    return null;
  }

  /// Località più vicina alla posizione (calcolo locale, NFR-9).
  CoastalLocation? nearest(double latitude, double longitude) {
    CoastalLocation? best;
    var bestDistance = double.infinity;
    final cosLat = math.cos(latitude * math.pi / 180);
    for (final location in locations) {
      final dLat = location.latitude - latitude;
      final dLon = (location.longitude - longitude) * cosLat;
      final distance = dLat * dLat + dLon * dLon;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = location;
      }
    }
    return best;
  }
}

const _accents = {
  'à': 'a',
  'á': 'a',
  'â': 'a',
  'ä': 'a',
  'ã': 'a',
  'å': 'a',
  'è': 'e',
  'é': 'e',
  'ê': 'e',
  'ë': 'e',
  'ì': 'i',
  'í': 'i',
  'î': 'i',
  'ï': 'i',
  'ò': 'o',
  'ó': 'o',
  'ô': 'o',
  'ö': 'o',
  'õ': 'o',
  'ù': 'u',
  'ú': 'u',
  'û': 'u',
  'ü': 'u',
  'ç': 'c',
  'ñ': 'n',
  '’': "'",
};

/// Minuscole e senza accenti (per confronti dei suggerimenti).
String normalizeText(String value) {
  final lower = value.toLowerCase();
  final buffer = StringBuffer();
  for (final rune in lower.runes) {
    final char = String.fromCharCode(rune);
    buffer.write(_accents[char] ?? char);
  }
  return buffer.toString();
}
