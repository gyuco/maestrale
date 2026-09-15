import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../models/coastal_location.dart';
import '../models/forecast.dart';
import '../services/forecast_api.dart';
import '../services/home_location_store.dart';
import '../services/location_service.dart';
import 'coastal_map_screen.dart';

const _navy = Color(0xFF123B56);
const _ocean = Color(0xFF008FAA);
const _sun = Color(0xFFFFC247);
const _coral = Color(0xFFFF7557);

class ForecastScreen extends StatefulWidget {
  const ForecastScreen({
    super.key,
    required this.api,
    required this.homeLocationStore,
    this.locationService,
  });

  final ForecastApi api;
  final HomeLocationStore homeLocationStore;
  final LocationService? locationService;

  @override
  State<ForecastScreen> createState() => _ForecastScreenState();
}

class _ForecastScreenState extends State<ForecastScreen>
    with SingleTickerProviderStateMixin {
  final _locationController = TextEditingController(text: 'Torre dei Corsari');
  final _searchFocusNode = FocusNode();
  late final AnimationController _weatherAnimation;
  Forecast? _forecast;
  String? _homeLocation;
  String? _error;
  bool _loading = false;
  bool _savingHomeLocation = false;

  @override
  void initState() {
    super.initState();
    _weatherAnimation = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 5),
    )..forward();
    _restoreHomeLocation();
  }

  @override
  void dispose() {
    _weatherAnimation.dispose();
    _searchFocusNode.dispose();
    _locationController.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    final location = _locationController.text.trim();
    if (location.isEmpty) return;
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final forecast = await widget.api.fetchForecast(location);
      if (!mounted) return;
      setState(() => _forecast = forecast);
      _weatherAnimation.forward(from: 0);
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _restoreHomeLocation() async {
    try {
      final savedLocation = (await widget.homeLocationStore.load())?.trim();
      if (!mounted || savedLocation == null || savedLocation.isEmpty) return;
      setState(() {
        _homeLocation = savedLocation;
        _locationController.text = savedLocation;
      });
      await _search();
    } on Object {
      // Una preferenza non disponibile non deve impedire l'uso dell'app.
    }
  }

  Future<void> _setCurrentLocationAsHome() async {
    final location = _forecast?.location.name.trim();
    if (location == null || location.isEmpty || _savingHomeLocation) return;
    setState(() => _savingHomeLocation = true);
    try {
      await widget.homeLocationStore.save(location);
      if (!mounted) return;
      setState(() => _homeLocation = location);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          behavior: SnackBarBehavior.floating,
          content: Text('$location sarà mostrata all’avvio.'),
        ),
      );
    } on Object {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          behavior: SnackBarBehavior.floating,
          content: Text('Impossibile salvare la località. Riprova.'),
        ),
      );
    } finally {
      if (mounted) setState(() => _savingHomeLocation = false);
    }
  }

  bool _isHomeLocation(String location) =>
      _homeLocation?.trim().toLowerCase() == location.trim().toLowerCase();

  void _selectLocation(CoastalLocation location) {
    _locationController.value = TextEditingValue(
      text: location.name,
      selection: TextSelection.collapsed(offset: location.name.length),
    );
    _search();
  }

  Future<void> _openMap() async {
    FocusManager.instance.primaryFocus?.unfocus();
    final location = await Navigator.of(context).push<CoastalLocation>(
      MaterialPageRoute(
        builder: (context) => CoastalMapScreen(
          initialLocationName: _locationController.text.trim(),
          locationService: widget.locationService,
        ),
      ),
    );
    if (!mounted || location == null) return;
    _selectLocation(location);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          const Positioned.fill(child: _SummerBackground()),
          SafeArea(
            child: CustomScrollView(
              physics: const BouncingScrollPhysics(),
              slivers: [
                SliverToBoxAdapter(child: _topBar()),
                SliverToBoxAdapter(child: _searchBar()),
                if (_loading)
                  const SliverToBoxAdapter(
                    child: Padding(
                      padding: EdgeInsets.symmetric(horizontal: 24),
                      child: LinearProgressIndicator(
                        minHeight: 4,
                        borderRadius: BorderRadius.all(Radius.circular(4)),
                        color: _sun,
                        backgroundColor: Color(0x33007F96),
                      ),
                    ),
                  ),
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(20, 18, 20, 30),
                  sliver: SliverToBoxAdapter(child: _body()),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _topBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(22, 18, 22, 10),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x1A07536A),
                  blurRadius: 18,
                  offset: Offset(0, 7),
                ),
              ],
            ),
            child: const Icon(Icons.air_rounded, color: _ocean, size: 28),
          ),
          const SizedBox(width: 12),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'MAESTRALE',
                  style: TextStyle(
                    color: _navy,
                    fontSize: 21,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.8,
                  ),
                ),
                Text(
                  'Il mare, a colpo d’occhio',
                  style: TextStyle(
                    color: Color(0xFF628393),
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
          _RoundButton(
            key: const Key('open-map-button'),
            icon: Icons.map_outlined,
            tooltip: 'Apri mappa',
            onPressed: _openMap,
          ),
          const SizedBox(width: 8),
          _RoundButton(
            icon: Icons.notifications_none_rounded,
            tooltip: 'Notifiche',
            onPressed: () {},
          ),
        ],
      ),
    );
  }

  Widget _searchBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 4),
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: Colors.white, width: 2),
          boxShadow: const [
            BoxShadow(
              color: Color(0x1F07536A),
              blurRadius: 24,
              offset: Offset(0, 10),
            ),
          ],
        ),
        child: RawAutocomplete<CoastalLocation>(
          textEditingController: _locationController,
          focusNode: _searchFocusNode,
          optionsViewOpenDirection: OptionsViewOpenDirection.down,
          displayStringForOption: (location) => location.name,
          optionsBuilder: (textEditingValue) {
            final query = textEditingValue.text.trim().toLowerCase();
            if (query.isEmpty) {
              return const Iterable<CoastalLocation>.empty();
            }
            return coastalLocations.where(
              (location) => location.name.toLowerCase().contains(query),
            );
          },
          onSelected: _selectLocation,
          fieldViewBuilder: (context, controller, focusNode, onFieldSubmitted) {
            return TextField(
              key: const Key('location-search-field'),
              controller: controller,
              focusNode: focusNode,
              textInputAction: TextInputAction.search,
              onSubmitted: (_) {
                final query = controller.text.trim().toLowerCase();
                final hasSuggestions = coastalLocations.any(
                  (location) => location.name.toLowerCase().contains(query),
                );
                if (hasSuggestions) {
                  onFieldSubmitted();
                } else {
                  _search();
                }
              },
              decoration: InputDecoration(
                hintText: 'Cerca una località sul mare',
                prefixIcon: const Padding(
                  padding: EdgeInsets.only(left: 6),
                  child: Icon(Icons.location_on_rounded, color: _coral),
                ),
                suffixIcon: Padding(
                  padding: const EdgeInsets.all(5),
                  child: IconButton.filled(
                    key: const Key('search-button'),
                    onPressed: _loading ? null : _search,
                    tooltip: 'Cerca',
                    style: IconButton.styleFrom(
                      backgroundColor: _ocean,
                      foregroundColor: Colors.white,
                      disabledBackgroundColor: const Color(0xFF9BBEC4),
                    ),
                    icon: const Icon(Icons.arrow_forward_rounded),
                  ),
                ),
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 18,
                  vertical: 18,
                ),
              ),
            );
          },
          optionsViewBuilder: (context, onSelected, options) {
            final suggestions = options.toList(growable: false);
            return Align(
              alignment: Alignment.topLeft,
              child: Material(
                color: Colors.transparent,
                child: Container(
                  width: MediaQuery.sizeOf(context).width - 40,
                  constraints: const BoxConstraints(maxHeight: 280),
                  margin: const EdgeInsets.only(top: 8),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(22),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x2907536A),
                        blurRadius: 24,
                        offset: Offset(0, 10),
                      ),
                    ],
                  ),
                  child: ListView.separated(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    shrinkWrap: true,
                    itemCount: suggestions.length,
                    separatorBuilder: (context, index) => const Divider(
                      height: 1,
                      indent: 52,
                      color: Color(0xFFE7F1F3),
                    ),
                    itemBuilder: (context, index) {
                      final location = suggestions[index];
                      return ListTile(
                        leading: const Icon(
                          Icons.beach_access_rounded,
                          color: _ocean,
                        ),
                        title: Text(
                          location.name,
                          style: const TextStyle(
                            color: _navy,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        trailing: const Icon(
                          Icons.north_west_rounded,
                          color: Color(0xFF88A8B5),
                          size: 18,
                        ),
                        onTap: () => onSelected(location),
                      );
                    },
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _body() {
    if (_error != null) {
      return _MessageCard(
        icon: Icons.cloud_off_rounded,
        title: 'Previsioni non disponibili',
        message: _error!,
        action: TextButton.icon(
          onPressed: _search,
          icon: const Icon(Icons.refresh_rounded),
          label: const Text('Riprova'),
        ),
      );
    }

    final forecast = _forecast;
    if (forecast == null) {
      return _WelcomeCard(animation: _weatherAnimation, onExplore: _search);
    }

    return RefreshIndicator(
      onRefresh: _search,
      color: _ocean,
      child: _ForecastContent(
        forecast: forecast,
        animation: _weatherAnimation,
        showSetHomeButton: !_isHomeLocation(forecast.location.name),
        savingHomeLocation: _savingHomeLocation,
        onSetHome: _setCurrentLocationAsHome,
      ),
    );
  }
}

class _ForecastContent extends StatefulWidget {
  const _ForecastContent({
    required this.forecast,
    required this.animation,
    required this.showSetHomeButton,
    required this.savingHomeLocation,
    required this.onSetHome,
  });

  final Forecast forecast;
  final Animation<double> animation;
  final bool showSetHomeButton;
  final bool savingHomeLocation;
  final VoidCallback onSetHome;

  @override
  State<_ForecastContent> createState() => _ForecastContentState();
}

class _ForecastContentState extends State<_ForecastContent> {
  late final PageController _mainCarouselController;
  late final ScrollController _miniCarouselController;
  int _selectedDay = 0;

  @override
  void initState() {
    super.initState();
    _mainCarouselController = PageController(viewportFraction: 0.96);
    _miniCarouselController = ScrollController();
  }

  @override
  void didUpdateWidget(covariant _ForecastContent oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.forecast.location.slug != widget.forecast.location.slug ||
        oldWidget.forecast.daily.length != widget.forecast.daily.length) {
      _selectedDay = 0;
      if (_mainCarouselController.hasClients) {
        _mainCarouselController.jumpToPage(0);
      }
      if (_miniCarouselController.hasClients) {
        _miniCarouselController.jumpTo(0);
      }
    }
  }

  @override
  void dispose() {
    _mainCarouselController.dispose();
    _miniCarouselController.dispose();
    super.dispose();
  }

  void _selectDay(int index) {
    _mainCarouselController.animateToPage(
      index,
      duration: const Duration(milliseconds: 380),
      curve: Curves.easeOutCubic,
    );
    if (_miniCarouselController.hasClients) {
      final target = (index * 232.0).clamp(
        0.0,
        _miniCarouselController.position.maxScrollExtent,
      );
      _miniCarouselController.animateTo(
        target,
        duration: const Duration(milliseconds: 380),
        curve: Curves.easeOutCubic,
      );
    }
  }

  void _onMainPageChanged(int index) {
    setState(() => _selectedDay = index);
    if (_miniCarouselController.hasClients) {
      final target = (index * 232.0).clamp(
        0.0,
        _miniCarouselController.position.maxScrollExtent,
      );
      _miniCarouselController.animateTo(
        target,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOut,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final days = widget.forecast.daily;
    if (days.isEmpty) {
      return const _MessageCard(
        icon: Icons.event_busy_rounded,
        title: 'Nessuna previsione',
        message: 'Non ci sono ancora dati per questa località.',
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'IL TUO METEO MARINO',
                    style: TextStyle(
                      color: _ocean,
                      fontSize: 11,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 1.5,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    widget.forecast.location.name,
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.78),
                borderRadius: BorderRadius.circular(14),
              ),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.circle, color: Color(0xFF41BE87), size: 8),
                  SizedBox(width: 6),
                  Text(
                    'Live',
                    style: TextStyle(
                      color: _navy,
                      fontWeight: FontWeight.w800,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        if (widget.showSetHomeButton) ...[
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              key: const Key('set-home-location-button'),
              onPressed: widget.savingHomeLocation ? null : widget.onSetHome,
              icon: widget.savingHomeLocation
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.home_outlined),
              label: const Text('Stabilisci come pagina iniziale'),
              style: OutlinedButton.styleFrom(
                foregroundColor: _ocean,
                backgroundColor: Colors.white.withValues(alpha: 0.72),
                side: const BorderSide(color: Color(0x52008FAA)),
                padding: const EdgeInsets.symmetric(vertical: 13),
                textStyle: const TextStyle(fontWeight: FontWeight.w800),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(18),
                ),
              ),
            ),
          ),
          const SizedBox(height: 14),
        ],
        SizedBox(
          key: const Key('weather-main-carousel'),
          height: 350,
          child: PageView.builder(
            key: const Key('weather-main-page-view'),
            controller: _mainCarouselController,
            physics: const BouncingScrollPhysics(),
            itemCount: days.length,
            onPageChanged: _onMainPageChanged,
            itemBuilder: (context, index) => Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: _TodayCard(
                key: Key('forecast-main-card-$index'),
                day: days[index],
                animation: widget.animation,
                isToday: index == 0,
              ),
            ),
          ),
        ),
        if (days.length > 1) ...[
          const SizedBox(height: 14),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(
              days.length,
              (index) => AnimatedContainer(
                duration: const Duration(milliseconds: 250),
                width: _selectedDay == index ? 24 : 8,
                height: 8,
                margin: const EdgeInsets.symmetric(horizontal: 3),
                decoration: BoxDecoration(
                  color: _selectedDay == index
                      ? _ocean
                      : const Color(0xFFB8DADD),
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
            ),
          ),
        ],
        const SizedBox(height: 24),
        Row(
          children: [
            Text(
              'Scegli il giorno',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const Spacer(),
            const Icon(Icons.swipe_rounded, color: _ocean),
          ],
        ),
        const SizedBox(height: 12),
        SizedBox(
          key: const Key('weather-mini-carousel'),
          height: 104,
          child: ListView.separated(
            controller: _miniCarouselController,
            scrollDirection: Axis.horizontal,
            physics: const BouncingScrollPhysics(),
            itemCount: days.length,
            separatorBuilder: (context, index) => const SizedBox(width: 12),
            itemBuilder: (context, index) => SizedBox(
              width: 220,
              child: _DailyCard(
                key: Key('forecast-mini-card-$index'),
                day: days[index],
                animation: widget.animation,
                selected: index == _selectedDay,
                onTap: () => _selectDay(index),
              ),
            ),
          ),
        ),
        const SizedBox(height: 16),
        Center(
          child: Text(
            'Aggiornato ${_dateTime(widget.forecast.generatedAt.toLocal())}',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
      ],
    );
  }
}

class _TodayCard extends StatelessWidget {
  const _TodayCard({
    super.key,
    required this.day,
    required this.animation,
    required this.isToday,
  });

  final DailyForecast day;
  final Animation<double> animation;
  final bool isToday;

  @override
  Widget build(BuildContext context) {
    final sea = day.sea;
    final weather = day.weather;

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF00A9BC), Color(0xFF087DA6)],
        ),
        borderRadius: BorderRadius.circular(32),
        boxShadow: const [
          BoxShadow(
            color: Color(0x3D007F96),
            blurRadius: 28,
            offset: Offset(0, 14),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned.fill(
            child: AnimatedBuilder(
              animation: animation,
              builder: (context, child) =>
                  CustomPaint(painter: _WavePainter(animation.value)),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(22),
            child: Column(
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 11,
                        vertical: 7,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Text(
                        '${isToday ? 'OGGI · ' : ''}${_date(day.date).toUpperCase()}',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 11,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 0.8,
                        ),
                      ),
                    ),
                    const Spacer(),
                    _AnimatedWeatherIcon(
                      code: weather.weatherCode,
                      animation: animation,
                      size: 67,
                    ),
                  ],
                ),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${weather.airTemperatureMeanC.toStringAsFixed(0)}°',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 66,
                              height: 0.95,
                              fontWeight: FontWeight.w900,
                              letterSpacing: -3,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            sea.state,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 19,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          Text(
                            'Min ${weather.airTemperatureMinC.toStringAsFixed(0)}°  ·  Max ${weather.airTemperatureMaxC.toStringAsFixed(0)}°',
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.82),
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                    AnimatedBuilder(
                      animation: animation,
                      builder: (_, child) => Transform.rotate(
                        angle: math.sin(animation.value * math.pi * 2) * 0.08,
                        child: child,
                      ),
                      child: const Icon(
                        Icons.air_rounded,
                        color: Colors.white,
                        size: 54,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                Container(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(22),
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.17),
                    ),
                  ),
                  child: Row(
                    children: [
                      _HeroMetric(
                        icon: Icons.waves_rounded,
                        label: 'ONDE',
                        value: '${sea.waveHeightMeanM.toStringAsFixed(1)} m',
                      ),
                      _divider(),
                      _HeroMetric(
                        icon: Icons.water_drop_rounded,
                        label: 'ACQUA',
                        value:
                            '${sea.waterTemperatureMeanC.toStringAsFixed(0)}°',
                      ),
                      _divider(),
                      _HeroMetric(
                        icon: Icons.air_rounded,
                        label: weather.windName,
                        value:
                            '${weather.windSpeedMeanKmh.toStringAsFixed(0)} km/h',
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _divider() => Container(
    height: 42,
    width: 1,
    color: Colors.white.withValues(alpha: 0.22),
  );
}

class _HeroMetric extends StatelessWidget {
  const _HeroMetric({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Icon(icon, color: const Color(0xFFD9FFFF), size: 20),
          const SizedBox(height: 5),
          Text(
            value,
            maxLines: 1,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 14,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.7),
              fontSize: 8,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.6,
            ),
          ),
        ],
      ),
    );
  }
}

class _DailyCard extends StatelessWidget {
  const _DailyCard({
    super.key,
    required this.day,
    required this.animation,
    required this.selected,
    required this.onTap,
  });

  final DailyForecast day;
  final Animation<double> animation;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final sea = day.sea;
    final weather = day.weather;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(25),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 250),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: selected
                ? const Color(0xFFE0FAF7)
                : Colors.white.withValues(alpha: 0.92),
            borderRadius: BorderRadius.circular(25),
            border: Border.all(
              color: selected ? _ocean : Colors.transparent,
              width: 2,
            ),
            boxShadow: const [
              BoxShadow(
                color: Color(0x1407536A),
                blurRadius: 20,
                offset: Offset(0, 8),
              ),
            ],
          ),
          child: Row(
            children: [
              _AnimatedWeatherIcon(
                code: weather.weatherCode,
                animation: animation,
                size: 44,
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _date(day.date),
                      maxLines: 1,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 3),
                    Text(
                      'Onde ${sea.waveHeightMeanM.toStringAsFixed(1)} m',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 6),
              Text(
                '${weather.airTemperatureMaxC.toStringAsFixed(0)}°',
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _WelcomeCard extends StatelessWidget {
  const _WelcomeCard({required this.animation, required this.onExplore});

  final Animation<double> animation;
  final VoidCallback onExplore;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minHeight: 430),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFFF6D9), Color(0xFFD7FAF7)],
        ),
        borderRadius: BorderRadius.circular(34),
        boxShadow: const [
          BoxShadow(
            color: Color(0x1C07536A),
            blurRadius: 28,
            offset: Offset(0, 13),
          ),
        ],
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          const Positioned(right: -40, top: -40, child: _Bubble(size: 150)),
          const Positioned(left: -25, bottom: 45, child: _Bubble(size: 95)),
          Padding(
            padding: const EdgeInsets.fromLTRB(25, 22, 25, 28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                AnimatedBuilder(
                  animation: animation,
                  builder: (_, child) => Transform.translate(
                    offset: Offset(
                      0,
                      math.sin(animation.value * math.pi * 2) * 7,
                    ),
                    child: child,
                  ),
                  child: Image.asset(
                    'assets/images/maestrale_mascot.png',
                    width: 180,
                    height: 180,
                    fit: BoxFit.contain,
                    semanticLabel: 'Sole, vento e onda di Maestrale',
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Come sarà il mare?',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.displaySmall,
                ),
                const SizedBox(height: 10),
                const Text(
                  'Onde, vento e temperature in una previsione semplice e colorata.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Color(0xFF537788),
                    fontSize: 15,
                    height: 1.45,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 20),
                FilledButton.icon(
                  onPressed: onExplore,
                  icon: const Icon(Icons.sunny_snowing),
                  label: const Text('Scopri le previsioni'),
                  style: FilledButton.styleFrom(
                    backgroundColor: _coral,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 22,
                      vertical: 15,
                    ),
                    textStyle: const TextStyle(fontWeight: FontWeight.w900),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(18),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MessageCard extends StatelessWidget {
  const _MessageCard({
    required this.icon,
    required this.title,
    required this.message,
    this.action,
  });

  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.9),
        borderRadius: BorderRadius.circular(30),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 58, color: _ocean),
          const SizedBox(height: 16),
          Text(title, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          Text(message, textAlign: TextAlign.center),
          if (action != null) ...[const SizedBox(height: 12), action!],
        ],
      ),
    );
  }
}

class _AnimatedWeatherIcon extends StatelessWidget {
  const _AnimatedWeatherIcon({
    required this.code,
    required this.animation,
    required this.size,
  });

  final int code;
  final Animation<double> animation;
  final double size;

  @override
  Widget build(BuildContext context) {
    final isRain = code >= 51 && code <= 82;
    final isCloudy = code >= 2 && code <= 48;

    return AnimatedBuilder(
      animation: animation,
      builder: (context, child) {
        final phase = animation.value * math.pi * 2;
        return Transform.translate(
          offset: Offset(
            isCloudy ? math.sin(phase) * 3 : 0,
            math.sin(phase) * 2,
          ),
          child: Transform.rotate(
            angle: isCloudy || isRain ? 0 : animation.value * math.pi * 2,
            child: Container(
              width: size,
              height: size,
              decoration: BoxDecoration(
                color: isRain
                    ? const Color(0xFFDCF5FF)
                    : isCloudy
                    ? Colors.white
                    : _sun,
                shape: BoxShape.circle,
                boxShadow: const [
                  BoxShadow(color: Color(0x26FFFFFF), blurRadius: 16),
                ],
              ),
              child: Transform.rotate(
                angle: isCloudy || isRain ? 0 : -animation.value * math.pi * 2,
                child: Icon(
                  isRain
                      ? Icons.thunderstorm_rounded
                      : isCloudy
                      ? Icons.cloud_rounded
                      : Icons.sunny,
                  color: isRain
                      ? const Color(0xFF397EA0)
                      : isCloudy
                      ? const Color(0xFF72BFD2)
                      : Colors.white,
                  size: size * 0.58,
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _SummerBackground extends StatelessWidget {
  const _SummerBackground();

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFFD8F7F4), Color(0xFFF5FCFA)],
          stops: [0, 0.62],
        ),
      ),
      child: Stack(
        children: const [
          Positioned(right: -65, top: 75, child: _Bubble(size: 180)),
          Positioned(left: -55, top: 310, child: _Bubble(size: 120)),
          Positioned(right: 25, bottom: 55, child: _Bubble(size: 50)),
        ],
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.25),
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white.withValues(alpha: 0.33)),
      ),
    );
  }
}

class _RoundButton extends StatelessWidget {
  const _RoundButton({
    super.key,
    required this.icon,
    required this.tooltip,
    required this.onPressed,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: onPressed,
      tooltip: tooltip,
      icon: Icon(icon),
      color: _navy,
      style: IconButton.styleFrom(
        backgroundColor: Colors.white.withValues(alpha: 0.72),
        minimumSize: const Size(46, 46),
      ),
    );
  }
}

class _WavePainter extends CustomPainter {
  _WavePainter(this.progress);

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    for (var layer = 0; layer < 3; layer++) {
      final path = Path();
      final base = size.height * (0.74 + layer * 0.08);
      path.moveTo(0, base);
      for (double x = 0; x <= size.width; x += 8) {
        final y =
            base +
            math.sin(
                  (x / size.width * math.pi * 2) +
                      (progress * math.pi * 2) +
                      layer,
                ) *
                (8 + layer * 2);
        path.lineTo(x, y);
      }
      path.lineTo(size.width, size.height);
      path.lineTo(0, size.height);
      path.close();
      canvas.drawPath(
        path,
        Paint()..color = Colors.white.withValues(alpha: 0.07 + layer * 0.035),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _WavePainter oldDelegate) =>
      oldDelegate.progress != progress;
}

String _date(DateTime value) {
  const weekdays = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
  const months = [
    'gen',
    'feb',
    'mar',
    'apr',
    'mag',
    'giu',
    'lug',
    'ago',
    'set',
    'ott',
    'nov',
    'dic',
  ];
  return '${weekdays[value.weekday - 1]} ${value.day} ${months[value.month - 1]}';
}

String _dateTime(DateTime value) =>
    '${_date(value)} · '
    '${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';
