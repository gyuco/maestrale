/// Intervallo di date (solo anno/mese/giorno, UTC) con estremi inclusi.
typedef DateRange = ({DateTime from, DateTime to});

DateTime _lastSundayUtc(int year, int month, int hour) {
  final last = DateTime.utc(year, month + 1, 0);
  return DateTime.utc(year, month, last.day - last.weekday % 7, hour);
}

/// Data corrente in Europe/Rome (regola UE dell'ora legale: dall'ultima
/// domenica di marzo 01:00 UTC all'ultima domenica di ottobre 01:00 UTC +2,
/// altrimenti +1). Restituisce una data UTC a mezzanotte.
DateTime romeToday(DateTime utcNow) {
  final utc = utcNow.toUtc();
  final start = _lastSundayUtc(utc.year, 3, 1);
  final end = _lastSundayUtc(utc.year, 10, 1);
  final summer = !utc.isBefore(start) && utc.isBefore(end);
  final local = utc.add(Duration(hours: summer ? 2 : 1));
  return DateTime.utc(local.year, local.month, local.day);
}

DateTime _day(DateTime d) => DateTime.utc(d.year, d.month, d.day);

DateRange last7Days(DateTime today) =>
    (from: _day(today).subtract(const Duration(days: 6)), to: _day(today));

DateRange last30Days(DateTime today) =>
    (from: _day(today).subtract(const Duration(days: 29)), to: _day(today));

/// Dal giorno successivo alla stessa data di 12 mesi prima fino a oggi.
DateRange last12Months(DateTime today) {
  final t = _day(today);
  final lastDay = DateTime.utc(t.year - 1, t.month + 1, 0).day;
  final sameDay = DateTime.utc(
    t.year - 1,
    t.month,
    t.day > lastDay ? lastDay : t.day,
  );
  return (from: sameDay.add(const Duration(days: 1)), to: t);
}

/// Primo giorno del mese di 119 mesi prima del mese corrente (FR-85).
DateTime firstPickerDate(DateTime today) =>
    DateTime.utc(today.year, today.month - 119, 1);

int daysInclusive(DateTime from, DateTime to) =>
    _day(to).difference(_day(from)).inDays + 1;

String formatIsoDate(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-'
    '${d.month.toString().padLeft(2, '0')}-'
    '${d.day.toString().padLeft(2, '0')}';
