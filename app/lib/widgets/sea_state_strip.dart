import 'package:flutter/material.dart';

/// Etichette della scala Douglas (FR-10), dalla piu' calma alla piu' agitata.
const seaStateLabels = [
  'Calmo',
  'Quasi calmo',
  'Poco mosso',
  'Mosso',
  'Molto mosso',
  'Agitato',
  'Molto agitato',
  'Grosso',
  'Molto grosso',
  'Tempestoso',
];

const _seaStateColors = [
  Color(0xFFB3E5FC),
  Color(0xFF81D4FA),
  Color(0xFF4FC3F7),
  Color(0xFF29B6F6),
  Color(0xFF26C6DA),
  Color(0xFF66BB6A),
  Color(0xFFFFEE58),
  Color(0xFFFFA726),
  Color(0xFFEF5350),
  Color(0xFF8E24AA),
];

const seaStateUnknownColor = Color(0xFFBDBDBD);

/// Rango Douglas (0..9) dell'etichetta, `null` se assente o sconosciuta.
int? seaStateRank(String? label) {
  if (label == null) return null;
  final i = seaStateLabels.indexOf(label);
  return i < 0 ? null : i;
}

Color seaStateColor(String? label) {
  final r = seaStateRank(label);
  return r == null ? seaStateUnknownColor : _seaStateColors[r];
}

/// Etichette presenti, in ordine di rango, senza duplicati.
List<String> presentSeaStates(Iterable<String?> states) {
  final ranks = <int>{
    for (final s in states)
      if (seaStateRank(s) != null) seaStateRank(s)!,
  };
  return [for (final r in (ranks.toList()..sort())) seaStateLabels[r]];
}

/// Fascia dello stato del mare: una cella per giorno/mese, allineata
/// all'asse x del grafico (la cella i e' centrata su x = i), disegnata da un
/// solo [CustomPainter].
class SeaStateStrip extends StatelessWidget {
  const SeaStateStrip({super.key, required this.states, this.height = 18});

  final List<String?> states;
  final double height;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      width: double.infinity,
      child: CustomPaint(
        key: const Key('sea-state-strip'),
        painter: SeaStatePainter(states),
      ),
    );
  }
}

class SeaStatePainter extends CustomPainter {
  SeaStatePainter(this.states);

  final List<String?> states;

  @override
  void paint(Canvas canvas, Size size) {
    final n = states.length;
    if (n == 0) return;
    // Come l'asse del grafico: x va da 0 a max(n - 1, 1), la cella i e'
    // centrata sul punto i (le celle agli estremi sono tagliate a meta').
    final span = n > 1 ? (n - 1).toDouble() : 1.0;
    final unit = size.width / span;
    final paint = Paint();
    for (var i = 0; i < n; i++) {
      paint.color = seaStateColor(states[i]);
      final left = ((i - 0.5) * unit).clamp(0.0, size.width);
      final right = ((i + 0.5) * unit).clamp(0.0, size.width);
      canvas.drawRect(Rect.fromLTRB(left, 0, right, size.height), paint);
    }
  }

  @override
  bool shouldRepaint(SeaStatePainter old) => old.states != states;
}

/// Legenda con le sole etichette presenti.
class SeaStateLegend extends StatelessWidget {
  const SeaStateLegend({super.key, required this.states});

  final List<String?> states;

  @override
  Widget build(BuildContext context) {
    final labels = presentSeaStates(states);
    if (labels.isEmpty) return const SizedBox.shrink();
    return Wrap(
      key: const Key('sea-state-legend'),
      spacing: 12,
      runSpacing: 4,
      children: [
        for (final l in labels)
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(width: 12, height: 12, color: seaStateColor(l)),
              const SizedBox(width: 4),
              Text(l, style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
      ],
    );
  }
}
