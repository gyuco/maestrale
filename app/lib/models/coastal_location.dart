class CoastalLocation {
  const CoastalLocation({
    required this.slug,
    required this.name,
    required this.latitude,
    required this.longitude,
  });

  final String slug;
  final String name;
  final double latitude;
  final double longitude;

  /// Voce del catalogo (snapshot, copia locale o `GET /locations`); lancia
  /// [FormatException] se mancano campi o i valori non sono validi.
  factory CoastalLocation.fromJson(Object? json) {
    if (json is! Map) throw const FormatException('Località non valida');
    final slug = json['slug'];
    final name = json['name'];
    final latitude = json['latitude'];
    final longitude = json['longitude'];
    if (slug is! String ||
        slug.trim().isEmpty ||
        name is! String ||
        name.trim().isEmpty ||
        latitude is! num ||
        longitude is! num ||
        !latitude.isFinite ||
        !longitude.isFinite ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180) {
      throw FormatException('Località non valida: $json');
    }
    return CoastalLocation(
      slug: slug,
      name: name,
      latitude: latitude.toDouble(),
      longitude: longitude.toDouble(),
    );
  }
}
