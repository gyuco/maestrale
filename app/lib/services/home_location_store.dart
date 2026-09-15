import 'package:shared_preferences/shared_preferences.dart';

abstract interface class HomeLocationStore {
  Future<String?> load();

  Future<void> save(String location);
}

class SharedPreferencesHomeLocationStore implements HomeLocationStore {
  const SharedPreferencesHomeLocationStore();

  static const _key = 'maestrale_home_location';

  @override
  Future<String?> load() async {
    final preferences = await SharedPreferences.getInstance();
    return preferences.getString(_key);
  }

  @override
  Future<void> save(String location) async {
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString(_key, location.trim());
  }
}
