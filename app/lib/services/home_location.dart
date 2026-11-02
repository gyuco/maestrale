import '../models/location_catalog.dart';

/// Risolve la preferenza salvata della località iniziale nello slug da usare
/// (ADR-0011, FR-117): slug esatto, altrimenti nome normalizzato univoco.
/// `null` = nessuna corrispondenza: la preferenza resta invariata.
String? resolveSavedHomeLocation(String saved, LocationCatalog catalog) {
  final value = saved.trim();
  if (value.isEmpty) return null;

  for (final location in catalog.locations) {
    if (location.slug == value) return location.slug;
  }

  final normalized = normalizeText(value);
  if (normalized.isEmpty) return null;

  final matches = catalog.locations
      .where((location) => normalizeText(location.name) == normalized)
      .toList();
  return matches.length == 1 ? matches.single.slug : null;
}
