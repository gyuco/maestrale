import 'package:flutter/material.dart';

import '../models/history.dart';
import '../models/history_series.dart';
import 'sea_state_strip.dart';

const historyRowHeight = 64.0;
const historyHeaderHeight = 44.0;

/// Valore con `decimals` decimali (virgola) o "n.d." se `null`.
String formatHistoryValue(double? v, int decimals, [String unit = '']) =>
    v == null
    ? 'n.d.'
    : '${v.toStringAsFixed(decimals).replaceAll('.', ',')}$unit';

String _dayTitle(String iso) =>
    '${iso.substring(8, 10)}/${iso.substring(5, 7)}/${iso.substring(0, 4)}';

String _monthTitle(HistoryMonth m) {
  final month = int.parse(m.month.substring(5, 7));
  return '${shortMonthIt(month)} ${m.month.substring(0, 4)} · ${m.days} gg';
}

/// Slivers della tabella dello storico: intestazione fissa (pinned) e righe a
/// due livelli ad altezza fissa, costruite in modo pigro (FR-88, NFR-26).
/// Da inserire in una `CustomScrollView`. (Niente `SliverMainAxisGroup`: con
/// l'intestazione pinned la geometria risulta non valida in layout stretti.)
List<Widget> historyTableSlivers(BuildContext context, HistoryResult result) {
  final isDay = result.granularity == HistoryGranularity.day;
  final List<HistoryValues> items = isDay ? result.days : result.months;
  return [
    SliverPersistentHeader(
      pinned: true,
      delegate: _HeaderDelegate(Theme.of(context).colorScheme.surface),
    ),
    SliverFixedExtentList(
      itemExtent: historyRowHeight,
      delegate: SliverChildBuilderDelegate(childCount: items.length, (
        context,
        i,
      ) {
        final v = items[i];
        final title = isDay
            ? _dayTitle((v as HistoryDay).date)
            : _monthTitle(v as HistoryMonth);
        return HistoryRow(
          key: const Key('history-row'),
          title: title,
          values: v,
        );
      }),
    ),
  ];
}

class _HeaderDelegate extends SliverPersistentHeaderDelegate {
  _HeaderDelegate(this.background);
  final Color background;

  @override
  double get minExtent => historyHeaderHeight;
  @override
  double get maxExtent => historyHeaderHeight;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlaps) {
    return ColoredBox(
      key: const Key('history-table-header'),
      color: background,
      child: const SizedBox(
        height: historyHeaderHeight,
        child: Padding(
          padding: EdgeInsets.symmetric(horizontal: 16),
          child: _Cells(
            labels: [
              'Aria\nmedia',
              'Aria\nmin',
              'Aria\nmax',
              'Mare\nmedio',
              'Onde\nmedia',
              'Onde\nmax',
            ],
            bold: true,
          ),
        ),
      ),
    );
  }

  @override
  bool shouldRebuild(_HeaderDelegate old) => old.background != background;
}

class _Cells extends StatelessWidget {
  const _Cells({required this.labels, this.bold = false});

  final List<String> labels;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(
      context,
    ).textTheme.bodySmall?.copyWith(fontWeight: bold ? FontWeight.w600 : null);
    return Row(
      children: [
        for (final l in labels)
          Expanded(
            child: FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(l, style: style),
            ),
          ),
      ],
    );
  }
}

class HistoryRow extends StatelessWidget {
  const HistoryRow({super.key, required this.title, required this.values});

  final String title;
  final HistoryValues values;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final state = values.state;
    final bg = seaStateColor(state);
    final fg = ThemeData.estimateBrightnessForColor(bg) == Brightness.dark
        ? Colors.white
        : Colors.black87;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: bg,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  state ?? 'n.d.',
                  style: theme.textTheme.bodySmall?.copyWith(color: fg),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          _Cells(
            labels: [
              formatHistoryValue(values.airTemperatureMeanC, 1, '°'),
              formatHistoryValue(values.airTemperatureMinC, 1, '°'),
              formatHistoryValue(values.airTemperatureMaxC, 1, '°'),
              formatHistoryValue(values.waterTemperatureMeanC, 1, '°'),
              formatHistoryValue(values.waveHeightMeanM, 2, ' m'),
              formatHistoryValue(values.waveHeightMaxM, 2, ' m'),
            ],
          ),
        ],
      ),
    );
  }
}
