import 'package:flutter/material.dart';

import '../models/history.dart';
import '../services/history_api.dart';
import '../models/history_series.dart';
import '../services/rome_date.dart';
import '../widgets/history_chart.dart';
import '../widgets/history_table.dart';
import '../widgets/sea_state_strip.dart';

/// Nota FR-90: i valori storici sono previsioni, non misure.
const historyNote =
    'Valori previsti per il giorno stesso, non misure osservate';
const historyEmptyMessage = 'Nessun dato storico per il periodo selezionato';

/// Oltre questo numero di giorni (estremi inclusi) è ammesso solo `month`.
const maxDayGranularityDays = 366;

enum HistoryPreset {
  days7('7 giorni'),
  days30('30 giorni'),
  months12('12 mesi'),
  custom('Personalizzato');

  const HistoryPreset(this.label);
  final String label;
}

enum _Status { loading, empty, error, data }

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({
    super.key,
    required this.slug,
    required this.name,
    this.api,
    this.now,
  });

  final String slug;
  final String name;
  final HistoryApi? api;

  /// Orologio iniettabile (NFR-13); default `DateTime.now`.
  final DateTime Function()? now;

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  late final HistoryApi _api = widget.api ?? HistoryApi();
  late DateRange _range;
  HistoryPreset _preset = HistoryPreset.days7;

  /// Granularità scelta dall'utente; quella effettiva è `month` se
  /// l'intervallo supera 366 giorni.
  HistoryGranularity _chosen = HistoryGranularity.day;
  int _requestId = 0;
  _Status _status = _Status.loading;
  HistoryResult? _result;
  String _error = '';

  DateTime get _today => romeToday((widget.now ?? DateTime.now)().toUtc());

  bool get _dayAllowed =>
      daysInclusive(_range.from, _range.to) <= maxDayGranularityDays;

  HistoryGranularity get _granularity =>
      _dayAllowed ? _chosen : HistoryGranularity.month;

  @override
  void initState() {
    super.initState();
    _range = last7Days(_today);
    _load();
  }

  @override
  void dispose() {
    _requestId++; // scarta eventuali risposte in volo
    super.dispose();
  }

  Future<void> _load() async {
    final id = ++_requestId;
    final range = _range;
    final granularity = _granularity;
    setState(() => _status = _Status.loading);
    try {
      final result = granularity == HistoryGranularity.day
          ? await _api.fetchDays(widget.slug, range.from, range.to)
          : await _api.fetchMonths(widget.slug, range.from, range.to);
      if (!mounted || id != _requestId) return;
      final empty = granularity == HistoryGranularity.day
          ? result.days.isEmpty
          : result.months.isEmpty;
      setState(() {
        _result = result;
        _status = empty ? _Status.empty : _Status.data;
      });
    } on Object catch (e) {
      if (!mounted || id != _requestId) return;
      setState(() {
        _error = e is HistoryApiException
            ? e.message
            : 'Impossibile caricare lo storico';
        _status = _Status.error;
      });
    }
  }

  void _selectPreset(HistoryPreset preset) {
    final today = _today;
    final range = switch (preset) {
      HistoryPreset.days7 => last7Days(today),
      HistoryPreset.days30 => last30Days(today),
      HistoryPreset.months12 => last12Months(today),
      HistoryPreset.custom => _range,
    };
    setState(() {
      _preset = preset;
      _range = range;
    });
    _load();
  }

  Future<void> _pickCustom() async {
    final today = _today;
    final first = firstPickerDate(today);
    DateTime local(DateTime d) => DateTime(d.year, d.month, d.day);
    final picked = await showDateRangePicker(
      context: context,
      firstDate: local(first),
      lastDate: local(today),
      initialDateRange: DateTimeRange(
        start: local(_range.from),
        end: local(_range.to),
      ),
      helpText: 'Seleziona il periodo',
      saveText: 'Conferma',
    );
    if (picked == null || !mounted) return;
    setState(() {
      _preset = HistoryPreset.custom;
      _range = (
        from: DateTime.utc(
          picked.start.year,
          picked.start.month,
          picked.start.day,
        ),
        to: DateTime.utc(picked.end.year, picked.end.month, picked.end.day),
      );
    });
    _load();
  }

  void _selectGranularity(HistoryGranularity g) {
    if (g == _granularity) return;
    setState(() => _chosen = g);
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.name)),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Wrap(
                spacing: 8,
                children: [
                  for (final p in HistoryPreset.values)
                    ChoiceChip(
                      key: Key('preset-${p.name}'),
                      label: Text(p.label),
                      selected: _preset == p,
                      onSelected: (_) => p == HistoryPreset.custom
                          ? _pickCustom()
                          : _selectPreset(p),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: SegmentedButton<HistoryGranularity>(
                key: const Key('granularity-selector'),
                showSelectedIcon: false,
                segments: [
                  ButtonSegment(
                    value: HistoryGranularity.day,
                    label: const Text('Giorno'),
                    enabled: _dayAllowed,
                  ),
                  const ButtonSegment(
                    value: HistoryGranularity.month,
                    label: Text('Mese'),
                  ),
                ],
                selected: {_granularity},
                onSelectionChanged: (s) => _selectGranularity(s.first),
              ),
            ),
            if (_status == _Status.data)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                child: Text(
                  historyNote,
                  key: const Key('history-note'),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    switch (_status) {
      case _Status.loading:
        return const Center(child: CircularProgressIndicator());
      case _Status.empty:
        return const Center(child: Text(historyEmptyMessage));
      case _Status.error:
        return Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_error, textAlign: TextAlign.center),
              const SizedBox(height: 8),
              TextButton.icon(
                key: const Key('history-retry'),
                onPressed: _load,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Riprova'),
              ),
            ],
          ),
        );
      case _Status.data:
        return HistoryContent(result: _result!);
    }
  }
}

/// Contenuto con dati: riepilogo, grafico, fascia dello stato del mare e
/// tabella in un'unica area scorrevole. Le serie sono precalcolate qui,
/// non nel `build` (NFR-26).
class HistoryContent extends StatefulWidget {
  const HistoryContent({super.key, required this.result});

  final HistoryResult result;

  @override
  State<HistoryContent> createState() => _HistoryContentState();
}

class _HistoryContentState extends State<HistoryContent> {
  late HistorySeries _series = HistorySeries.fromResult(widget.result);

  @override
  void didUpdateWidget(HistoryContent old) {
    super.didUpdateWidget(old);
    if (!identical(old.result, widget.result)) {
      _series = HistorySeries.fromResult(widget.result);
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.result;
    final n = r.granularity == HistoryGranularity.day
        ? r.days.length
        : r.months.length;
    return CustomScrollView(
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          sliver: SliverToBoxAdapter(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  n == 1 ? '1 elemento' : '$n elementi',
                  key: const Key('history-count'),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: 8),
                HistoryChart(series: _series),
                const SizedBox(height: 4),
                Padding(
                  padding: const EdgeInsets.only(left: chartLeftInset),
                  child: SeaStateStrip(states: _series.states),
                ),
                const SizedBox(height: 8),
                SeaStateLegend(states: _series.states),
              ],
            ),
          ),
        ),
        ...historyTableSlivers(context, r),
      ],
    );
  }
}
