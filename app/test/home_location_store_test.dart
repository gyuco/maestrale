import 'package:flutter_test/flutter_test.dart';
import 'package:sardegna_mare_app/services/home_location_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('salva e ricarica la localita iniziale', () async {
    SharedPreferences.setMockInitialValues({});
    const store = SharedPreferencesHomeLocationStore();

    expect(await store.load(), isNull);

    await store.save('  Alghero  ');

    expect(await store.load(), 'Alghero');
  });
}
