import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_marker_cluster/flutter_map_marker_cluster.dart';
import 'package:latlong2/latlong.dart' show LatLng;

import '../models/coastal_location.dart';
import '../models/location_catalog.dart';
import '../services/location_repository.dart';
import '../services/location_service.dart';

const _navy = Color(0xFF123B56);
const _ocean = Color(0xFF008FAA);
const _coral = Color(0xFFFF7557);

class CoastalMapScreen extends StatefulWidget {
  const CoastalMapScreen({
    super.key,
    required this.locationRepository,
    this.initialLocationName,
    this.locationService,
  });

  /// Unica fonte del catalogo (FR-67).
  final LocationRepository locationRepository;
  final String? initialLocationName;
  final LocationService? locationService;

  @override
  State<CoastalMapScreen> createState() => _CoastalMapScreenState();
}

class _CoastalMapScreenState extends State<CoastalMapScreen> {
  final _mapController = MapController();
  final _searchController = TextEditingController();
  final _searchFocusNode = FocusNode();
  late final NetworkTileProvider _tileProvider = NetworkTileProvider(
    cachingProvider: const DisabledMapCachingProvider(),
    silenceExceptions: true,
  );
  late final LocationService _locationService;
  LocationCatalog? _markersCatalog;
  List<Marker> _markers = const [];
  CoastalLocation? _selectedLocation;
  AppPosition? _userPosition;
  bool _mapReady = false;
  bool _locatingUser = false;
  bool _permissionPermanentlyDenied = false;
  String? _locationMessage;

  @override
  void initState() {
    super.initState();
    _locationService = widget.locationService ?? const DeviceLocationService();
    widget.locationRepository.catalog.addListener(_onCatalogChanged);
    final initialName = widget.initialLocationName?.trim();
    if (initialName != null && initialName.isNotEmpty) {
      _searchController.text = initialName;
      _selectedLocation = _findExact(initialName);
    }
    WidgetsBinding.instance.addPostFrameCallback((_) => _locateUser());
  }

  LocationCatalog get _catalog => widget.locationRepository.catalog.value;

  // Il catalogo può cambiare durante l'uso (copia di rete): si mantiene la
  // selezione corrente (ADR-0005) e si ricostruiscono i marker.
  void _onCatalogChanged() {
    if (mounted) setState(() {});
  }

  /// I marker (anche 500) si costruiscono una volta per catalogo, non a ogni
  /// `setState`: la selezione è disegnata in un livello separato.
  List<Marker> _markersFor(LocationCatalog catalog) {
    if (!identical(_markersCatalog, catalog)) {
      _markersCatalog = catalog;
      _markers = catalog.locations.map(_marker).toList(growable: false);
    }
    return _markers;
  }

  @override
  void dispose() {
    widget.locationRepository.catalog.removeListener(_onCatalogChanged);
    _searchFocusNode.dispose();
    _searchController.dispose();
    _mapController.dispose();
    super.dispose();
  }

  CoastalLocation? _findExact(String query) => _catalog.findExact(query);

  void _highlightLocation(CoastalLocation location) {
    _searchController.value = TextEditingValue(
      text: location.name,
      selection: TextSelection.collapsed(offset: location.name.length),
    );
    setState(() => _selectedLocation = location);
    _searchFocusNode.unfocus();
    if (_mapReady) {
      _mapController.move(LatLng(location.latitude, location.longitude), 10);
    }
  }

  void _searchFromInput() {
    final query = _searchController.text.trim();
    if (query.isEmpty) return;
    final match = _catalog.findExact(query) ?? _catalog.firstContaining(query);
    if (match != null) {
      _highlightLocation(match);
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        behavior: SnackBarBehavior.floating,
        content: Text('Località non trovata tra quelle disponibili.'),
      ),
    );
  }

  List<LatLng> _coordinates() => _catalog.locations
      .map((location) => LatLng(location.latitude, location.longitude))
      .toList(growable: false);

  void _showAllLocations() {
    if (!_mapReady) return;
    _mapController.fitCamera(
      CameraFit.coordinates(
        coordinates: _coordinates(),
        padding: const EdgeInsets.all(42),
        maxZoom: 8.2,
      ),
    );
  }

  Future<void> _locateUser() async {
    if (_locatingUser) return;
    setState(() {
      _locatingUser = true;
      _locationMessage = null;
      _permissionPermanentlyDenied = false;
    });
    try {
      if (!await _locationService.isServiceEnabled()) {
        _setLocationError(
          'Attiva i servizi di localizzazione per vedere la tua zona.',
        );
        return;
      }

      var permission = await _locationService.checkPermission();
      if (permission == AppLocationPermission.denied) {
        permission = await _locationService.requestPermission();
      }
      if (permission == AppLocationPermission.deniedForever) {
        if (!mounted) return;
        setState(() {
          _permissionPermanentlyDenied = true;
          _locationMessage =
              'Permesso posizione bloccato. Abilitalo nelle impostazioni.';
        });
        return;
      }
      if (permission == AppLocationPermission.denied) {
        _setLocationError(
          'Permesso posizione non concesso. La mappa mostra tutta la costa.',
        );
        return;
      }

      final position = await _locationService.getCurrentPosition();
      if (!mounted) return;
      setState(() {
        _userPosition = position;
        _locationMessage = null;
      });
      _focusUserPosition(position);
    } on Object {
      _setLocationError(
        'Posizione non disponibile. Puoi comunque esplorare le località.',
      );
    } finally {
      if (mounted) setState(() => _locatingUser = false);
    }
  }

  void _setLocationError(String message) {
    if (!mounted) return;
    setState(() => _locationMessage = message);
  }

  void _focusUserPosition(AppPosition position) {
    if (!_mapReady) return;
    _mapController.move(LatLng(position.latitude, position.longitude), 12.5);
  }

  void _confirmSelection() {
    final location = _selectedLocation;
    if (location != null) Navigator.of(context).pop(location);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFEAF9FA),
      body: SafeArea(
        child: Column(
          children: [
            _header(),
            _searchBar(),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(28),
                  child: Stack(
                    children: [
                      Positioned.fill(child: _map()),
                      Positioned(
                        top: 12,
                        right: 12,
                        child: Column(
                          children: [
                            FloatingActionButton.small(
                              key: const Key('locate-user-button'),
                              heroTag: 'locate-user',
                              onPressed: _locatingUser ? null : _locateUser,
                              tooltip: 'La mia posizione',
                              backgroundColor: Colors.white,
                              foregroundColor: _ocean,
                              child: _locatingUser
                                  ? const SizedBox.square(
                                      dimension: 20,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2.5,
                                      ),
                                    )
                                  : const Icon(Icons.my_location_rounded),
                            ),
                            const SizedBox(height: 8),
                            FloatingActionButton.small(
                              key: const Key('show-all-map-locations-button'),
                              heroTag: 'show-all-map-locations',
                              onPressed: _showAllLocations,
                              tooltip: 'Mostra tutte le località',
                              backgroundColor: Colors.white,
                              foregroundColor: _ocean,
                              child: const Icon(Icons.zoom_out_map_rounded),
                            ),
                          ],
                        ),
                      ),
                      if (_locationMessage case final message?)
                        Positioned(
                          top: 12,
                          left: 12,
                          right: 70,
                          child: _locationStatus(message),
                        ),
                      if (_selectedLocation case final location?)
                        Positioned(
                          left: 14,
                          right: 14,
                          bottom: 26,
                          child: _selectionCard(location),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _header() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 12, 20, 8),
      child: Row(
        children: [
          IconButton(
            key: const Key('close-map-button'),
            onPressed: () => Navigator.of(context).pop(),
            tooltip: 'Torna alle previsioni',
            icon: const Icon(Icons.arrow_back_rounded),
          ),
          const SizedBox(width: 4),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'MAPPA DELLA COSTA',
                  style: TextStyle(
                    color: _ocean,
                    fontSize: 11,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.4,
                  ),
                ),
                SizedBox(height: 2),
                Text(
                  'Scegli una località',
                  style: TextStyle(
                    color: _navy,
                    fontSize: 24,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _searchBar() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: RawAutocomplete<CoastalLocation>(
        textEditingController: _searchController,
        focusNode: _searchFocusNode,
        displayStringForOption: (location) => location.name,
        optionsBuilder: (value) {
          return _catalog.suggest(value.text);
        },
        onSelected: _highlightLocation,
        fieldViewBuilder: (context, controller, focusNode, onSubmitted) {
          return TextField(
            key: const Key('map-location-search-field'),
            controller: controller,
            focusNode: focusNode,
            textInputAction: TextInputAction.search,
            onSubmitted: (_) => _searchFromInput(),
            decoration: InputDecoration(
              hintText: 'Cerca sulla mappa',
              prefixIcon: const Icon(Icons.search_rounded, color: _ocean),
              suffixIcon: IconButton(
                key: const Key('map-search-button'),
                onPressed: _searchFromInput,
                tooltip: 'Cerca sulla mappa',
                icon: const Icon(Icons.arrow_forward_rounded),
              ),
            ),
          );
        },
        optionsViewBuilder: (context, onSelected, options) {
          final suggestions = options.toList(growable: false);
          return Align(
            alignment: Alignment.topLeft,
            child: Material(
              elevation: 10,
              borderRadius: BorderRadius.circular(18),
              clipBehavior: Clip.antiAlias,
              child: SizedBox(
                width: MediaQuery.sizeOf(context).width - 32,
                child: ListView.builder(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  shrinkWrap: true,
                  itemCount: suggestions.length,
                  itemBuilder: (context, index) {
                    final location = suggestions[index];
                    return ListTile(
                      leading: const Icon(
                        Icons.location_on_rounded,
                        color: _coral,
                      ),
                      title: Text(location.name),
                      onTap: () => onSelected(location),
                    );
                  },
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Marker _marker(CoastalLocation location, {bool selected = false}) {
    return Marker(
      key: Key(
        selected
            ? 'map-selected-pin-${location.slug}'
            : 'map-pin-${location.slug}',
      ),
      point: LatLng(location.latitude, location.longitude),
      width: selected ? 60 : 44,
      height: selected ? 60 : 44,
      alignment: Alignment.topCenter,
      child: Semantics(
        button: true,
        label: 'Seleziona ${location.name}',
        child: Tooltip(
          message: location.name,
          child: GestureDetector(
            onTap: () => _highlightLocation(location),
            child: Container(
              decoration: BoxDecoration(
                color: selected ? _coral : _ocean,
                shape: BoxShape.circle,
                border: Border.all(color: Colors.white, width: 3),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x5507536A),
                    blurRadius: 8,
                    offset: Offset(0, 3),
                  ),
                ],
              ),
              child: Icon(
                selected
                    ? Icons.location_on_rounded
                    : Icons.beach_access_rounded,
                color: Colors.white,
                size: selected ? 33 : 23,
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _clusterBubble(int count) {
    return Container(
      key: const Key('map-cluster'),
      decoration: BoxDecoration(
        color: _navy,
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 3),
        boxShadow: const [
          BoxShadow(
            color: Color(0x5507536A),
            blurRadius: 8,
            offset: Offset(0, 3),
          ),
        ],
      ),
      alignment: Alignment.center,
      child: Text(
        '$count',
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w900,
          fontSize: 14,
        ),
      ),
    );
  }

  Widget _map() {
    final catalog = _catalog;
    return FlutterMap(
      key: const Key('locations-map'),
      mapController: _mapController,
      options: MapOptions(
        initialCameraFit: CameraFit.coordinates(
          coordinates: _coordinates(),
          padding: const EdgeInsets.all(38),
          maxZoom: 8.2,
        ),
        minZoom: 6,
        maxZoom: 14,
        onMapReady: () {
          _mapReady = true;
          final position = _userPosition;
          if (position != null) _focusUserPosition(position);
        },
      ),
      children: [
        TileLayer(
          urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          tileProvider: _tileProvider,
          userAgentPackageName: 'it.sardegnamare.sardegna_mare_app',
          maxNativeZoom: 19,
        ),
        MarkerClusterLayerWidget(
          key: ValueKey(catalog),
          options: MarkerClusterLayerOptions(
            markers: _markersFor(catalog),
            maxClusterRadius: 60,
            size: const Size(46, 46),
            alignment: Alignment.center,
            padding: const EdgeInsets.all(48),
            maxZoom: 14,
            builder: (context, markers) => _clusterBubble(markers.length),
          ),
        ),
        if (_selectedLocation case final location?)
          MarkerLayer(markers: [_marker(location, selected: true)]),
        if (_userPosition case final position?)
          MarkerLayer(
            markers: [
              Marker(
                key: const Key('user-location-pin'),
                point: LatLng(position.latitude, position.longitude),
                width: 48,
                height: 48,
                child: Semantics(
                  label: 'La tua posizione',
                  child: Container(
                    decoration: BoxDecoration(
                      color: const Color(0xFF1976D2),
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 4),
                      boxShadow: const [
                        BoxShadow(
                          color: Color(0x551976D2),
                          blurRadius: 12,
                          spreadRadius: 3,
                        ),
                      ],
                    ),
                    child: const Icon(
                      Icons.person_pin_circle_rounded,
                      color: Colors.white,
                      size: 28,
                    ),
                  ),
                ),
              ),
            ],
          ),
        const SimpleAttributionWidget(
          source: Text('OpenStreetMap contributors'),
        ),
      ],
    );
  }

  Widget _locationStatus(String message) {
    return Material(
      color: Colors.white.withValues(alpha: 0.94),
      elevation: 4,
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 9, 8, 9),
        child: Row(
          children: [
            const Icon(Icons.location_disabled_rounded, color: _coral),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                message,
                style: const TextStyle(
                  color: _navy,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            if (_permissionPermanentlyDenied)
              TextButton(
                onPressed: _locationService.openAppSettings,
                child: const Text('Impostazioni'),
              ),
          ],
        ),
      ),
    );
  }

  Widget _selectionCard(CoastalLocation location) {
    return Material(
      color: Colors.white,
      elevation: 8,
      borderRadius: BorderRadius.circular(20),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 10, 12),
        child: Row(
          children: [
            const Icon(Icons.location_on_rounded, color: _coral),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                location.name,
                style: const TextStyle(
                  color: _navy,
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            FilledButton(
              key: const Key('choose-map-location-button'),
              onPressed: _confirmSelection,
              style: FilledButton.styleFrom(backgroundColor: _ocean),
              child: const Text('Vedi meteo'),
            ),
          ],
        ),
      ),
    );
  }
}
