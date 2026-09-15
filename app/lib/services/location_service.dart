import 'package:geolocator/geolocator.dart';

enum AppLocationPermission { denied, deniedForever, granted }

class AppPosition {
  const AppPosition({required this.latitude, required this.longitude});

  final double latitude;
  final double longitude;
}

abstract interface class LocationService {
  Future<bool> isServiceEnabled();

  Future<AppLocationPermission> checkPermission();

  Future<AppLocationPermission> requestPermission();

  Future<AppPosition> getCurrentPosition();

  Future<bool> openAppSettings();
}

class DeviceLocationService implements LocationService {
  const DeviceLocationService();

  @override
  Future<bool> isServiceEnabled() => Geolocator.isLocationServiceEnabled();

  @override
  Future<AppLocationPermission> checkPermission() async =>
      _convertPermission(await Geolocator.checkPermission());

  @override
  Future<AppLocationPermission> requestPermission() async =>
      _convertPermission(await Geolocator.requestPermission());

  @override
  Future<AppPosition> getCurrentPosition() async {
    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 15),
      ),
    );
    return AppPosition(
      latitude: position.latitude,
      longitude: position.longitude,
    );
  }

  @override
  Future<bool> openAppSettings() => Geolocator.openAppSettings();

  AppLocationPermission _convertPermission(LocationPermission permission) {
    return switch (permission) {
      LocationPermission.denied => AppLocationPermission.denied,
      LocationPermission.deniedForever => AppLocationPermission.deniedForever,
      LocationPermission.unableToDetermine => AppLocationPermission.denied,
      LocationPermission.whileInUse ||
      LocationPermission.always => AppLocationPermission.granted,
    };
  }
}
