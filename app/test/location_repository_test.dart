import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sardegna_mare_app/models/location_catalog.dart';
import 'package:sardegna_mare_app/services/location_cache_store.dart';
import 'package:sardegna_mare_app/services/location_catalog_api.dart';
import 'package:sardegna_mare_app/services/location_repository.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/catalog_fakes.dart';

LocationRepository build({
  required MockClient client,
  MemoryCacheStore? cache,
  List<Map<String, dynamic>>? snapshot,
}) => LocationRepository(
  api: LocationCatalogApi(baseUrl: 'http://api.test/', client: client),
  cacheStore: cache ?? MemoryCacheStore(),
  snapshot: FakeSnapshot(snapshot ?? sampleLocations.take(2).toList()),
);

MockClient offline() =>
    MockClient((_) async => throw http.ClientException('offline'));

void main() {
  group('loadCached (mai rete)', () {
    test('senza copia locale pubblica lo snapshot', () async {
      var calls = 0;
      final repository = build(
        client: MockClient((_) async {
          calls++;
          return http.Response('', 500);
        }),
      );

      final catalog = await repository.loadCached();

      expect(catalog.origin, CatalogOrigin.snapshot);
      expect(catalog.locations, hasLength(2));
      expect(repository.catalog.value, same(catalog));
      expect(calls, 0);
    });

    test(
      'con copia locale valida pubblica la copia locale con il suo ETag',
      () async {
        final cache = MemoryCacheStore(
          StoredCatalog(body: envelopeBody(sampleLocations), etag: '"v1"'),
        );
        final repository = build(client: offline(), cache: cache);

        final catalog = await repository.loadCached();

        expect(catalog.origin, CatalogOrigin.local);
        expect(catalog.locations, hasLength(sampleLocations.length));
        expect(catalog.etag, '"v1"');
      },
    );

    test('copia locale illeggibile -> snapshot', () async {
      final cache = MemoryCacheStore(
        const StoredCatalog(body: '{rotto', etag: '"v1"'),
      );
      final repository = build(client: offline(), cache: cache);

      expect((await repository.loadCached()).origin, CatalogOrigin.snapshot);
    });

    test('archivio che lancia -> snapshot, nessuna eccezione', () async {
      final cache = MemoryCacheStore()..failOnLoad = true;
      final repository = build(client: offline(), cache: cache);

      expect((await repository.loadCached()).origin, CatalogOrigin.snapshot);
    });
  });

  group('refresh', () {
    test('200: sostituisce il catalogo in uso e salva copia ed ETag', () async {
      final cache = MemoryCacheStore();
      final repository = build(
        client: MockClient((request) async {
          expect(request.url.toString(), 'http://api.test/locations');
          expect(request.headers.containsKey('If-None-Match'), isFalse);
          return http.Response(
            envelopeBody(sampleLocations),
            200,
            headers: {'etag': '"v2"'},
          );
        }),
        cache: cache,
      );
      await repository.loadCached();
      final seen = <CatalogOrigin>[];
      repository.catalog.addListener(
        () => seen.add(repository.catalog.value.origin),
      );

      await repository.refresh();

      expect(repository.catalog.value.origin, CatalogOrigin.network);
      expect(
        repository.catalog.value.locations,
        hasLength(sampleLocations.length),
      );
      expect(repository.catalog.value.etag, '"v2"');
      expect(seen, [CatalogOrigin.network]);
      expect(cache.stored?.etag, '"v2"');
      expect(cache.stored?.body, envelopeBody(sampleLocations));
    });

    test(
      'invia If-None-Match con l\'ETag della copia locale e su 304 non cambia nulla',
      () async {
        final cache = MemoryCacheStore(
          StoredCatalog(body: envelopeBody(sampleLocations), etag: '"v1"'),
        );
        String? sent;
        final repository = build(
          client: MockClient((request) async {
            sent = request.headers['If-None-Match'];
            return http.Response('', 304, headers: {'etag': '"v1"'});
          }),
          cache: cache,
        );
        final before = await repository.loadCached();

        await repository.refresh();

        expect(sent, '"v1"');
        expect(repository.catalog.value, same(before));
        expect(cache.saves, 0);
      },
    );

    test('non invia If-None-Match se la copia locale non e\' valida', () async {
      final cache = MemoryCacheStore(
        const StoredCatalog(body: 'x', etag: '"v1"'),
      );
      Map<String, String>? headers;
      final repository = build(
        client: MockClient((request) async {
          headers = request.headers;
          return http.Response(
            envelopeBody(sampleLocations),
            200,
            headers: {'etag': '"v2"'},
          );
        }),
        cache: cache,
      );
      await repository.loadCached();

      await repository.refresh();

      expect(headers!.containsKey('If-None-Match'), isFalse);
      expect(repository.catalog.value.origin, CatalogOrigin.network);
    });

    test('non invia If-None-Match se si usa lo snapshot', () async {
      Map<String, String>? headers;
      final repository = build(
        client: MockClient((request) async {
          headers = request.headers;
          return http.Response('', 304);
        }),
      );
      await repository.loadCached();

      await repository.refresh();

      expect(headers!.containsKey('If-None-Match'), isFalse);
      expect(repository.catalog.value.origin, CatalogOrigin.snapshot);
    });

    test('errore di rete: nessun cambio e nessuna eccezione', () async {
      final cache = MemoryCacheStore();
      final repository = build(client: offline(), cache: cache);
      final before = await repository.loadCached();

      await repository.refresh();

      expect(repository.catalog.value, same(before));
      expect(cache.saves, 0);
    });

    test(
      'risposta 500, corpo non interpretabile o catalogo vuoto: nessun cambio, copia intatta',
      () async {
        final original = StoredCatalog(
          body: envelopeBody(sampleLocations),
          etag: '"v1"',
        );
        for (final response in [
          http.Response('boom', 500),
          http.Response('non json', 200, headers: {'etag': '"x"'}),
          http.Response('{"locations": [{"slug": "a"}]}', 200),
          http.Response('{"locations": []}', 200),
        ]) {
          final cache = MemoryCacheStore(original);
          final repository = build(
            client: MockClient((_) async => response),
            cache: cache,
          );
          final before = await repository.loadCached();

          await repository.refresh();

          expect(repository.catalog.value, same(before), reason: response.body);
          expect(cache.stored, same(original), reason: response.body);
        }
      },
    );

    test('timeout: nessun cambio e nessuna eccezione', () async {
      final repository = LocationRepository(
        api: LocationCatalogApi(
          baseUrl: 'http://api.test',
          client: MockClient((_) => Completer<http.Response>().future),
          timeout: const Duration(milliseconds: 20),
        ),
        cacheStore: MemoryCacheStore(),
        snapshot: FakeSnapshot(sampleLocations),
      );
      final before = await repository.loadCached();

      await repository.refresh();

      expect(repository.catalog.value, same(before));
    });

    test(
      'errore nel salvataggio: il catalogo di rete resta comunque in uso',
      () async {
        final cache = _ThrowingSaveStore();
        final repository = build(
          client: MockClient(
            (_) async => http.Response(
              envelopeBody(sampleLocations),
              200,
              headers: {'etag': '"v2"'},
            ),
          ),
          cache: cache,
        );
        await repository.loadCached();

        await repository.refresh();

        expect(repository.catalog.value.origin, CatalogOrigin.network);
      },
    );

    test(
      'accetta anche un corpo array (stesso formato dello snapshot)',
      () async {
        final repository = build(
          client: MockClient(
            (_) async => http.Response(arrayBody(sampleLocations), 200),
          ),
        );
        await repository.loadCached();

        await repository.refresh();

        expect(repository.catalog.value.origin, CatalogOrigin.network);
        expect(repository.catalog.value.etag, isNull);
      },
    );
  });

  group('SharedPreferencesLocationCacheStore', () {
    test('salva e ricarica corpo ed ETag, assente = null', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      SharedPreferences.setMockInitialValues({});
      const store = SharedPreferencesLocationCacheStore();

      expect(await store.load(), isNull);

      await store.save(const StoredCatalog(body: '[]', etag: '"e"'));
      final loaded = await store.load();

      expect(loaded?.body, '[]');
      expect(loaded?.etag, '"e"');
    });
  });
}

class _ThrowingSaveStore extends MemoryCacheStore {
  @override
  Future<void> save(StoredCatalog value) async =>
      throw StateError('disco pieno');
}
