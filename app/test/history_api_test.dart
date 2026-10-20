import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sardegna_mare_app/config/api_config.dart';
import 'package:sardegna_mare_app/models/history.dart';
import 'package:sardegna_mare_app/services/history_api.dart';

import 'history_fixtures.dart';

HistoryApi api(MockClientHandler h, {Duration? timeout}) => HistoryApi(
  baseUrl: 'http://api.test/',
  client: MockClient(h),
  timeout: timeout ?? const Duration(seconds: 15),
);

http.Response json(Object body, [int status = 200]) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

Future<Object?> errorOf(Future<Object?> Function() f) async {
  try {
    await f();
  } on Object catch (e) {
    return e;
  }
  return null;
}

final from = DateTime.utc(2026, 10, 14);
final to = DateTime.utc(2026, 10, 20);

void main() {
  test('AC-1 fetchDays', () async {
    final r = await api(
      (_) async => json(historyDayFixture),
    ).fetchDays('torre-dei-corsari', from, to);
    expect(r.granularity, HistoryGranularity.day);
    expect(r.days, hasLength(2));
    expect(r.days[0].airTemperatureMeanC, 22.0);
    expect(r.days[1].state, isNull);
  });

  test('AC-2 fetchMonths', () async {
    final r = await api(
      (_) async => json(historyMonthFixture),
    ).fetchMonths('torre-dei-corsari', from, to);
    expect(r.months[0].month, '2026-09');
    expect(r.months[0].days, 30);
  });

  test('AC-3 URL richiesto', () async {
    late http.Request req;
    final a = api((r) async {
      req = r;
      return json(
        r.url.queryParameters['granularity'] == 'day'
            ? historyDayFixture
            : historyMonthFixture,
      );
    });
    await a.fetchDays('torre-dei-corsari', from, to);
    expect(req.method, 'GET');
    expect(
      req.url.toString(),
      'http://api.test/history?localita=torre-dei-corsari&from=2026-10-14&to=2026-10-20&granularity=day',
    );
    await a.fetchMonths('torre-dei-corsari', from, to);
    expect(req.url.queryParameters['granularity'], 'month');
  });

  test('AC-3 slug codificato', () async {
    late http.Request req;
    await api((r) async {
      req = r;
      return json(historyDayFixture);
    }).fetchDays('a b&c=d', from, to);
    expect(req.url.queryParameters['localita'], 'a b&c=d');
    expect(req.url.queryParameters.length, 4);
  });

  test('slug con spazi ai bordi viene ripulito', () async {
    late http.Request req;
    await api((r) async {
      req = r;
      return json(historyDayFixture);
    }).fetchDays('  torre-dei-corsari \n', from, to);
    expect(req.url.queryParameters['localita'], 'torre-dei-corsari');
  });

  test('AC-3 baseUrl di default da ApiConfig', () async {
    late http.Request req;
    final a = HistoryApi(
      client: MockClient((r) async {
        req = r;
        return json(historyDayFixture);
      }),
    );
    await a.fetchDays('x', from, to);
    expect(req.url.toString(), startsWith('${ApiConfig.baseUrl}/history?'));
  });

  test('AC-4 errori HTTP', () async {
    Future<String> msg(http.Response r) async {
      final e = await errorOf(
        () => api((_) async => r).fetchDays('x', from, to),
      );
      expect(e, isA<HistoryApiException>());
      return e.toString();
    }

    expect(
      await msg(
        json({
          'detail': {'message': 'Località non trovata', 'available': []},
        }, 404),
      ),
      'Località non trovata',
    );
    expect(
      await msg(json({'detail': 'Intervallo troppo ampio'}, 422)),
      'Intervallo troppo ampio',
    );
    expect(
      await msg(json({'detail': 'Storico non disponibile'}, 503)),
      'Storico non disponibile',
    );
    expect(await msg(json({}, 500)), 'Il server ha risposto con errore 500');
    expect(
      await msg(http.Response('boom', 500)),
      'Il server ha risposto con errore 500',
    );
  });

  test('AC-5 risposte non valide', () async {
    final bodies = <String>[
      'non json',
      '[1,2]',
      '"x"',
      jsonEncode({...historyDayFixture}..remove('items')),
      jsonEncode({...historyDayFixture, 'items': 'x'}),
      jsonEncode({
        ...historyDayFixture,
        'items': [
          {'air_temperature_mean_c': 1},
        ],
      }),
      jsonEncode({
        ...historyDayFixture,
        'items': [
          {'date': '2026-10-14', 'air_temperature_mean_c': 'x'},
        ],
      }),
      jsonEncode({...historyMonthFixture}), // granularità incoerente
    ];
    for (final b in bodies) {
      final e = await errorOf(
        () => api((_) async => http.Response(b, 200)).fetchDays('x', from, to),
      );
      expect(e, isA<HistoryApiException>(), reason: b);
      expect(e.toString(), 'Risposta del server non valida', reason: b);
    }
  });

  test('AC-6 timeout', () async {
    final e = await errorOf(
      () => api(
        (_) => Completer<http.Response>().future,
        timeout: const Duration(milliseconds: 20),
      ).fetchDays('x', from, to),
    );
    expect(e, isA<HistoryApiException>());
    expect(e.toString(), contains('tempo'));
  });

  test('AC-6 timeout predefinito di 15 s', () {
    expect(HistoryApi.defaultTimeout, const Duration(seconds: 15));
  });

  test('AC-6 errore di rete', () async {
    final e = await errorOf(
      () => api(
        (_) async => throw http.ClientException('down'),
      ).fetchDays('x', from, to),
    );
    expect(e, isA<HistoryApiException>());
    expect(e.toString(), contains('connessione'));
  });
}
