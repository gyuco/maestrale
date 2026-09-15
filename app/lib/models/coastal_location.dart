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
}

const coastalLocations = <CoastalLocation>[
  CoastalLocation(
    slug: 'alghero',
    name: 'Alghero',
    latitude: 40.56,
    longitude: 8.26,
  ),
  CoastalLocation(
    slug: 'arbatax',
    name: 'Arbatax',
    latitude: 39.92,
    longitude: 9.72,
  ),
  CoastalLocation(
    slug: 'cagliari',
    name: 'Cagliari',
    latitude: 39.17,
    longitude: 9.15,
  ),
  CoastalLocation(
    slug: 'carloforte',
    name: 'Carloforte',
    latitude: 39.10,
    longitude: 8.28,
  ),
  CoastalLocation(slug: 'chia', name: 'Chia', latitude: 38.87, longitude: 8.84),
  CoastalLocation(
    slug: 'la-maddalena',
    name: 'La Maddalena',
    latitude: 41.22,
    longitude: 9.40,
  ),
  CoastalLocation(
    slug: 'olbia',
    name: 'Olbia',
    latitude: 40.92,
    longitude: 9.58,
  ),
  CoastalLocation(
    slug: 'oristano',
    name: 'Oristano',
    latitude: 39.87,
    longitude: 8.45,
  ),
  CoastalLocation(
    slug: 'porto-torres',
    name: 'Porto Torres',
    latitude: 40.87,
    longitude: 8.37,
  ),
  CoastalLocation(
    slug: 'santa-teresa-gallura',
    name: 'Santa Teresa Gallura',
    latitude: 41.24,
    longitude: 9.18,
  ),
  CoastalLocation(
    slug: 'siniscola',
    name: 'Siniscola',
    latitude: 40.60,
    longitude: 9.78,
  ),
  CoastalLocation(
    slug: 'torre-dei-corsari',
    name: 'Torre dei Corsari',
    latitude: 39.688153,
    longitude: 8.450613,
  ),
  CoastalLocation(
    slug: 'villasimius',
    name: 'Villasimius',
    latitude: 39.10,
    longitude: 9.52,
  ),
];
