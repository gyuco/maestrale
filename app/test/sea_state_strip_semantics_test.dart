import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sardegna_mare_app/widgets/sea_state_strip.dart';

void main() {
  testWidgets('R-1 fascia: etichetta semantica con conteggi e n.d.', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: SeaStateStrip(
            states: ['Mosso', 'Poco mosso', 'Mosso', null, 'Poco mosso', 'Mosso'],
          ),
        ),
      ),
    );
    final label = tester
        .getSemantics(find.bySemanticsLabel(RegExp('^Stato del mare')))
        .label;
    expect(label, 'Stato del mare: Poco mosso 2, Mosso 3, n.d. 1');
    handle.dispose();
  });

  testWidgets('R-1 fascia: tutto n.d.', (tester) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: SeaStateStrip(states: [null, null])),
      ),
    );
    expect(
      tester
          .getSemantics(find.bySemanticsLabel(RegExp('^Stato del mare')))
          .label,
      'Stato del mare: n.d. 2',
    );
    handle.dispose();
  });
}
