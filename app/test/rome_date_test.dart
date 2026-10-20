import 'package:flutter_test/flutter_test.dart';
import 'package:sardegna_mare_app/services/rome_date.dart';

DateTime d(int y, int m, int day) => DateTime.utc(y, m, day);

void main() {
  group('romeToday', () {
    test('casi di cambio ora', () {
      expect(romeToday(DateTime.utc(2026, 10, 24, 22, 30)), d(2026, 10, 25));
      expect(romeToday(DateTime.utc(2026, 10, 25, 0, 30)), d(2026, 10, 25));
      expect(romeToday(DateTime.utc(2026, 10, 25, 1, 0)), d(2026, 10, 25));
      expect(romeToday(DateTime.utc(2026, 3, 28, 23, 30)), d(2026, 3, 29));
      expect(romeToday(DateTime.utc(2026, 3, 29, 1, 0)), d(2026, 3, 29));
    });
    test('confini della mezzanotte locale', () {
      // CEST: 21:59Z = 23:59 locale, 22:00Z = 00:00 del giorno dopo.
      expect(romeToday(DateTime.utc(2026, 7, 1, 21, 59)), d(2026, 7, 1));
      expect(romeToday(DateTime.utc(2026, 7, 1, 22, 0)), d(2026, 7, 2));
      // CET: 22:59Z = 23:59 locale, 23:00Z = 00:00.
      expect(romeToday(DateTime.utc(2026, 1, 1, 22, 59)), d(2026, 1, 1));
      expect(romeToday(DateTime.utc(2026, 1, 1, 23, 0)), d(2026, 1, 2));
      // Subito prima del cambio d'autunno (00:59Z ancora +2) e di primavera.
      expect(romeToday(DateTime.utc(2026, 10, 24, 22, 0)), d(2026, 10, 25));
      expect(romeToday(DateTime.utc(2026, 3, 29, 0, 59)), d(2026, 3, 29));
      // Cambio d'anno.
      expect(romeToday(DateTime.utc(2026, 12, 31, 23, 0)), d(2027, 1, 1));
    });
    test('istanti di transizione: la data dipende dall\'offset', () {
      // Primavera: dopo il cambio (CEST) 22:30Z e\' gia\' il giorno dopo.
      expect(romeToday(DateTime.utc(2026, 3, 28, 22, 30)), d(2026, 3, 28));
      expect(romeToday(DateTime.utc(2026, 3, 29, 21, 59)), d(2026, 3, 29));
      expect(romeToday(DateTime.utc(2026, 3, 29, 22, 0)), d(2026, 3, 30));
      expect(romeToday(DateTime.utc(2026, 3, 29, 22, 30)), d(2026, 3, 30));
      // Autunno: dopo il cambio (CET) 22:30Z e\' ancora 25 ottobre.
      expect(romeToday(DateTime.utc(2026, 10, 24, 21, 59)), d(2026, 10, 24));
      expect(romeToday(DateTime.utc(2026, 10, 24, 22, 0)), d(2026, 10, 25));
      expect(romeToday(DateTime.utc(2026, 10, 25, 22, 30)), d(2026, 10, 25));
      expect(romeToday(DateTime.utc(2026, 10, 25, 22, 59)), d(2026, 10, 25));
      expect(romeToday(DateTime.utc(2026, 10, 25, 23, 0)), d(2026, 10, 26));
    });
    test('accetta anche DateTime non UTC', () {
      expect(
        romeToday(DateTime.parse('2026-10-24T22:30:00Z').toLocal()),
        d(2026, 10, 25),
      );
    });
  });

  group('preset', () {
    test('oggi = 2026-10-20', () {
      final t = d(2026, 10, 20);
      expect(last7Days(t), (from: d(2026, 10, 14), to: t));
      expect(last30Days(t), (from: d(2026, 9, 21), to: t));
      expect(last12Months(t), (from: d(2025, 10, 21), to: t));
    });
    test('oggi = 2026-02-28', () {
      final t = d(2026, 2, 28);
      expect(last7Days(t).from, d(2026, 2, 22));
      expect(last30Days(t).from, d(2026, 1, 30));
      expect(last12Months(t).from, d(2025, 3, 1));
    });
    test('oggi = 2028-02-29 (bisestile)', () {
      final t = d(2028, 2, 29);
      expect(last12Months(t), (from: d(2027, 3, 1), to: t));
    });
    test('daysInclusive', () {
      final t = d(2026, 10, 20);
      final r7 = last7Days(t);
      final r30 = last30Days(t);
      final r12 = last12Months(t);
      expect(daysInclusive(r7.from, r7.to), 7);
      expect(daysInclusive(r30.from, r30.to), 30);
      expect(daysInclusive(r12.from, r12.to), 365);
      expect(daysInclusive(t, t), 1);
    });
    test('firstPickerDate', () {
      expect(firstPickerDate(d(2026, 10, 20)), d(2016, 11, 1));
      expect(firstPickerDate(d(2026, 1, 5)), d(2016, 2, 1));
    });
    test('formatIsoDate', () {
      expect(formatIsoDate(d(2026, 3, 5)), '2026-03-05');
      expect(formatIsoDate(DateTime(2026, 12, 31)), '2026-12-31');
    });
  });
}
