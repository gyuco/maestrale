import 'package:flutter_test/flutter_test.dart';
import 'package:sardegna_mare_app/models/coastal_location.dart';

void main() {
  test('espone tutte le località supportate con coordinate valide', () {
    expect(coastalLocations, hasLength(13));
    expect(
      coastalLocations.map((location) => location.slug).toSet(),
      hasLength(coastalLocations.length),
    );

    for (final location in coastalLocations) {
      expect(location.name, isNotEmpty);
      expect(location.latitude, inInclusiveRange(-90, 90));
      expect(location.longitude, inInclusiveRange(-180, 180));
    }
  });
}
