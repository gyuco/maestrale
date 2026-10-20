import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../models/history_series.dart';

const airColor = Color(0xFFE65100);
const seaColor = Color(0xFF0277BD);
const bandColor = Color(0x33E65100);

/// Larghezza riservata alle etichette dell'asse y (la fascia stato del mare
/// usa lo stesso margine per allinearsi all'asse x).
const chartLeftInset = 40.0;

/// Costruisce i dati di `LineChart`. Con [bare] niente titoli, griglia e
/// bordo: l'area di tracciamento coincide con il widget (usato nei test).
LineChartData buildHistoryChartData(
  HistorySeries s, {
  bool bare = false,
  Color band = bandColor,
}) {
  const hidden = AxisTitles(sideTitles: SideTitles(showTitles: false));
  final labels = HistorySeries.labelIndexes(s.length).toSet();
  return LineChartData(
    minX: s.minX,
    maxX: s.maxX,
    minY: s.minY,
    maxY: s.maxY,
    clipData: const FlClipData.all(),
    lineTouchData: const LineTouchData(enabled: false),
    gridData: FlGridData(show: !bare),
    borderData: FlBorderData(show: false),
    titlesData: bare
        ? const FlTitlesData(
            leftTitles: hidden,
            rightTitles: hidden,
            topTitles: hidden,
            bottomTitles: hidden,
          )
        : FlTitlesData(
            topTitles: hidden,
            rightTitles: hidden,
            leftTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: chartLeftInset,
                getTitlesWidget: (v, meta) =>
                    Text('${v.round()}°', style: const TextStyle(fontSize: 10)),
              ),
            ),
            bottomTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 24,
                interval: 1,
                getTitlesWidget: (v, meta) {
                  final i = v.round();
                  if (v != i.toDouble() || !labels.contains(i)) {
                    return const SizedBox.shrink();
                  }
                  return Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      s.labelAt(i),
                      style: const TextStyle(fontSize: 10),
                    ),
                  );
                },
              ),
            ),
          ),
    lineBarsData: [
      _line(s.airMean, airColor, 2),
      _line(s.seaMean, seaColor, 2),
      // Linee della banda min/max: trasparenti, servono a BetweenBarsData.
      _line(s.bandMin, Colors.transparent, 0),
      _line(s.bandMax, Colors.transparent, 0),
    ],
    betweenBarsData: [BetweenBarsData(fromIndex: 2, toIndex: 3, color: band)],
  );
}

LineChartBarData _line(List<FlSpot> spots, Color color, double width) =>
    LineChartBarData(
      spots: spots,
      isCurved: false,
      color: color,
      barWidth: width,
      dotData: FlDotData(show: spots.length <= 31 && width > 0),
    );

/// Grafico a linee: aria media, banda min/max dell'aria, mare medio.
class HistoryChart extends StatelessWidget {
  const HistoryChart({super.key, required this.series, this.height = 220});

  final HistorySeries series;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          height: height,
          child: LineChart(
            buildHistoryChartData(series),
            duration: Duration.zero,
          ),
        ),
        const SizedBox(height: 8),
        const _ChartLegend(),
      ],
    );
  }
}

class _ChartLegend extends StatelessWidget {
  const _ChartLegend();

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodySmall;
    Widget item(Color c, String label, {bool band = false}) => Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(width: 16, height: band ? 10 : 3, color: c),
        const SizedBox(width: 4),
        Text(label, style: style),
      ],
    );
    return Wrap(
      key: const Key('chart-legend'),
      spacing: 12,
      runSpacing: 4,
      children: [
        item(airColor, 'Aria media'),
        item(bandColor, 'Aria min-max', band: true),
        item(seaColor, 'Mare medio'),
      ],
    );
  }
}
