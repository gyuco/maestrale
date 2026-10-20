import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BREAKER_MESSAGE,
  BUDGET_DURATION_MESSAGE,
  BUDGET_SUBREQUESTS_MESSAGE,
  runUpdate,
  type UpdateDeps,
} from "../src/update";
import { clearKv, forecastKeys, readJson } from "./helpers/kv";
import {
  fakeClock,
  fakeProvider,
  syntheticCatalog,
  type FakeProviderOptions,
  type ProviderRequest,
} from "./helpers/provider";

const NOW = "2026-10-20T09:00:00+00:00";
const BIG = { maxSubrequests: 9000 };

function setup(options: FakeProviderOptions = {}, config: UpdateDeps["config"] = BIG) {
  const clock = fakeClock();
  const provider = fakeProvider({ nowMs: clock.nowMs, ...options });
  const deps: UpdateDeps = {
    fetchImpl: provider.fetchImpl,
    sleep: clock.sleep,
    nowMs: clock.nowMs,
    now: () => NOW,
    config,
  };
  return { clock, provider, deps };
}

const blocks = (requests: ProviderRequest[]) => requests.filter((request) => request.isBlock);
const singles = (requests: ProviderRequest[]) => requests.filter((request) => !request.isBlock);

/** Peso massimo (somma delle lunghezze delle richieste) in una finestra di 60 s. */
function maxWeightPerMinute(requests: ProviderRequest[]): number {
  let max = 0;
  for (const anchor of requests) {
    const sum = requests
      .filter((request) => request.atMs >= anchor.atMs && request.atMs < anchor.atMs + 60_000)
      .reduce((total, request) => total + request.lats.length, 0);
    max = Math.max(max, sum);
  }
  return max;
}

beforeEach(clearKv);
afterEach(() => {
  vi.restoreAllMocks();
});

describe("500 località sintetiche: blocchi (FR-53)", () => {
  const catalog = syntheticCatalog(500);

  it("blocchi da 50 di default: 10 per provider, ordine del catalogo, mappatura elemento -> località", async () => {
    const { provider, deps } = setup({ deriveCoordinates: true });
    const result = await runUpdate(env.FORECASTS, catalog, deps);

    expect(result.errors).toEqual({});
    expect(result.updated_locations).toHaveLength(500);
    expect(result.metrics.blocks).toBe(10);
    expect(result.metrics.block_requests).toBe(20);
    expect(provider.requests).toHaveLength(20);
    for (const request of provider.requests) {
      expect(request.lats).toHaveLength(50);
    }
    const marine = provider.requests.filter((request) => request.provider === "marine");
    expect(marine.map((request) => request.lats[0])).toEqual(
      Array.from({ length: 10 }, (_, block) => catalog[block * 50]!.latitude),
    );

    expect(await forecastKeys()).toHaveLength(500);
    const meta = (await readJson("meta"))!;
    expect(meta["locations"]).toBe(500);
    expect(meta["slugs"]).toHaveLength(500);
    // Ogni record riporta le coordinate della *propria* località (nessuno scambio).
    for (const index of [0, 1, 49, 50, 51, 249, 499]) {
      const entry = catalog[index]!;
      const record = (await readJson(`forecast:${entry.slug}`))!;
      expect(record["location"]).toEqual({
        name: entry.name,
        latitude: entry.latitude,
        longitude: entry.longitude,
        slug: entry.slug,
      });
      expect(record["cells"].marine).toEqual({
        latitude: entry.latitude,
        longitude: entry.longitude,
      });
      expect(record["cells"].weather.latitude).toBe(entry.latitude);
      expect(record["sources"].sea.requested_coordinates).toEqual({
        latitude: entry.latitude,
        longitude: entry.longitude,
      });
      expect(record["sources"].weather.resolved_cell.longitude).toBe(entry.longitude);
    }
  });

  it.each([
    [25, 20],
    [100, 5],
    [500, 5], // oltre 100 è limitato a 100 (1..100)
  ])("blocco da %i: %i blocchi per provider", async (blockSize, expectedBlocks) => {
    const { provider, deps } = setup({}, { ...BIG, blockSize });
    const result = await runUpdate(env.FORECASTS, catalog, deps);
    expect(result.metrics.blocks).toBe(expectedBlocks);
    expect(provider.requests).toHaveLength(expectedBlocks * 2);
    expect(Math.max(...provider.requests.map((request) => request.lats.length))).toBeLessThanOrEqual(100);
  });

  it("limita a 300 chiamate pesate/min, retry inclusi, e non attende tempo reale", async () => {
    const { clock, provider, deps } = setup({
      // Un blocco Marine fallisce 2 volte e riesce al terzo tentativo: i retry pesano.
      fail: (() => {
        let failures = 0;
        return (request: ProviderRequest) => {
          if (request.provider === "marine" && request.isBlock && request.lats[0] === catalog[100]!.latitude) {
            failures += 1;
            return failures <= 2 ? ("network" as const) : undefined;
          }
          return undefined;
        };
      })(),
    });
    const started = clock.nowMs();
    const result = await runUpdate(env.FORECASTS, catalog, deps);

    expect(result.errors).toEqual({});
    expect(provider.requests).toHaveLength(22);
    expect(maxWeightPerMinute(provider.requests)).toBeLessThanOrEqual(300);
    expect(result.metrics.weight_used).toBe(1100);
    // 1.100 / 300 al minuto: almeno ~2,6 minuti simulati, ben entro il budget da 12.
    const elapsed = clock.nowMs() - started;
    expect(elapsed).toBeGreaterThan(2 * 60_000);
    expect(elapsed).toBeLessThan(12 * 60_000);
    expect(result.metrics.budget_exhausted).toBe("none");
  });

  it("scrive 500 record + meta (501 put) con meta per ultima", async () => {
    const { deps } = setup();
    const put = vi.spyOn(env.FORECASTS, "put");
    const result = await runUpdate(env.FORECASTS, catalog, deps);
    expect(put).toHaveBeenCalledTimes(501);
    expect(put.mock.calls[500]![0]).toBe("meta");
    expect(result.metrics.kv_writes).toBe(501);
    // Paid alert: 501 scritture x 4 esecuzioni/giorno > 700; subrequest > 40.
    expect(result.metrics.paid_alerts).toEqual(["subrequests", "kv_writes_per_day"]);
  });
});

describe("un blocco fallisce (FR-54)", () => {
  const catalog = syntheticCatalog(500);

  it("retry 3 volte del blocco, poi fallback solo per le 50 località interessate", async () => {
    const failingFirst = catalog[150]!.latitude; // blocco Marine n. 3
    const { provider, deps } = setup({
      fail: (request) =>
        request.provider === "marine" && request.isBlock && request.lats[0] === failingFirst
          ? "network"
          : undefined,
    });
    const result = await runUpdate(env.FORECASTS, catalog, deps);

    expect(result.errors).toEqual({});
    expect(result.updated_locations).toHaveLength(500);
    expect(result.fallback_breaker).toBe(false);
    const failingBlock = blocks(provider.requests).filter(
      (request) => request.provider === "marine" && request.lats[0] === failingFirst,
    );
    expect(failingBlock).toHaveLength(3);
    expect(result.metrics.block_failures).toBe(1);
    expect(result.metrics.block_requests).toBe(20);
    const single = singles(provider.requests);
    expect(single).toHaveLength(50);
    expect(single.every((request) => request.provider === "marine")).toBe(true);
    expect(single.map((request) => request.lats[0])).toEqual(
      expect.arrayContaining(catalog.slice(150, 200).map((entry) => entry.latitude)),
    );
    expect(result.metrics.fallbacks).toBe(50);
    expect((await readJson("meta"))!["slugs"]).toHaveLength(500);
  });
});

describe("interruttore del fallback (FR-54, OQ-28)", () => {
  // 100 località, blocchi da 10: 10 richieste Marine + 10 Weather = 20 richieste di blocco.
  const catalog = syntheticCatalog(100);
  const config = { ...BIG, blockSize: 10 };
  const marineBlock = (request: ProviderRequest, index: number) =>
    request.provider === "marine" && request.isBlock && request.lats[0] === catalog[index * 10]!.latitude;
  const weatherBlock = (request: ProviderRequest, index: number) =>
    request.provider === "weather" && request.isBlock && request.lats[0] === catalog[index * 10]!.latitude;

  it("sotto la soglia (9/20 = 45%): fallback eseguito", async () => {
    const { provider, deps } = setup(
      {
        fail: (request) =>
          Array.from({ length: 9 }, (_, index) => marineBlock(request, index)).some(Boolean)
            ? "network"
            : undefined,
      },
      config,
    );
    const result = await runUpdate(env.FORECASTS, catalog, deps);
    expect(result.metrics.block_failures).toBe(9);
    expect(result.fallback_breaker).toBe(false);
    expect(singles(provider.requests)).toHaveLength(90);
    expect(result.errors).toEqual({});
  });

  it("esattamente 50% (10/20, Marine e Forecast separate): fallback eseguito", async () => {
    const { provider, deps } = setup(
      {
        fail: (request) => {
          const marineFailed = Array.from({ length: 5 }, (_, index) => marineBlock(request, index));
          const weatherFailed = Array.from({ length: 5 }, (_, index) => weatherBlock(request, index + 5));
          return [...marineFailed, ...weatherFailed].some(Boolean) ? "network" : undefined;
        },
      },
      config,
    );
    const result = await runUpdate(env.FORECASTS, catalog, deps);
    expect(result.metrics.block_failures).toBe(10);
    expect(result.metrics.block_requests).toBe(20);
    expect(result.fallback_breaker).toBe(false);
    expect(singles(provider.requests)).toHaveLength(100);
    expect(result.errors).toEqual({});
    expect(result.updated_locations).toHaveLength(100);
  });

  it("tutte le Marine fallite e nessuna Forecast = 50%: fallback eseguito (pool unico)", async () => {
    const { provider, deps } = setup(
      { fail: (request) => (request.provider === "marine" && request.isBlock ? "network" : undefined) },
      config,
    );
    const result = await runUpdate(env.FORECASTS, catalog, deps);
    expect(result.fallback_breaker).toBe(false);
    expect(singles(provider.requests)).toHaveLength(100);
    expect(result.updated_locations).toHaveLength(100);
  });

  it("sopra (11/20): nessuna richiesta singola, errore dell'interruttore, blocchi riusciti scritti", async () => {
    // Marine blocchi 0-5 e Weather blocchi 0-4 falliti: 11 su 20. Blocchi 6-9 riusciti.
    const { provider, deps } = setup(
      {
        // Nel blocco riuscito 9 la località 95 ha un elemento non valido (non conta come blocco fallito).
        invalidLats: [catalog[95]!.latitude],
        fail: (request) => {
          const marineFailed = Array.from({ length: 6 }, (_, index) => marineBlock(request, index));
          const weatherFailed = Array.from({ length: 5 }, (_, index) => weatherBlock(request, index));
          return [...marineFailed, ...weatherFailed].some(Boolean) ? "network" : undefined;
        },
      },
      config,
    );
    const result = await runUpdate(env.FORECASTS, catalog, deps);

    expect(result.metrics.block_failures).toBe(11);
    expect(result.fallback_breaker).toBe(true);
    expect(result.metrics.fallbacks).toBe(0);
    expect(singles(provider.requests)).toHaveLength(0);
    const affected = catalog.slice(0, 60).map((entry) => entry.slug);
    for (const slug of affected) {
      expect(result.errors[slug]).toBe(BREAKER_MESSAGE);
    }
    // Elemento non valido in blocco riuscito: riceve anch'esso il messaggio dell'interruttore.
    expect(result.errors[catalog[95]!.slug]).toBe(BREAKER_MESSAGE);
    expect(Object.keys(result.errors)).toHaveLength(61);
    expect(result.updated_locations).toHaveLength(39);
    expect(result.updated_locations).toContain(catalog[60]!.slug);
    expect(await forecastKeys()).toHaveLength(39);
    expect((await readJson("meta"))!["errors"][catalog[0]!.slug]).toBe(BREAKER_MESSAGE);
    expect(BREAKER_MESSAGE).toBe(
      "Aggiornamento non tentato: interruttore del fallback attivo (guasto diffuso del provider)",
    );
  });

  it("sopra, località precedente conservata (FR-18): il suo record non è riscritto", async () => {
    const stale = JSON.stringify({ location: { name: "Localita 000", slug: "loc-000" }, old: true });
    await env.FORECASTS.put("forecast:loc-000", stale);
    await env.FORECASTS.put(
      "meta",
      JSON.stringify({ schema_version: 1, generated_at: NOW, slugs: ["loc-000"] }),
    );
    const { deps } = setup({ fail: () => "network" }, config);
    const put = vi.spyOn(env.FORECASTS, "put");
    await runUpdate(env.FORECASTS, catalog, deps);
    expect(put).not.toHaveBeenCalled();
    expect(await env.FORECASTS.get("forecast:loc-000")).toBe(stale);
  });

  it("la soglia è configurabile (FALLBACK_BREAKER_THRESHOLD)", async () => {
    // 9/20 = 45% > 0.4: l'interruttore scatta con soglia 0.4.
    const { provider, deps } = setup(
      {
        fail: (request) =>
          Array.from({ length: 9 }, (_, index) => marineBlock(request, index)).some(Boolean)
            ? "network"
            : undefined,
      },
      { ...config, breakerThreshold: 0.4 },
    );
    const result = await runUpdate(env.FORECASTS, catalog, deps);
    expect(result.fallback_breaker).toBe(true);
    expect(singles(provider.requests)).toHaveLength(0);
  });

  it("risposta a blocco di lunghezza errata = blocco fallito", async () => {
    const { deps } = setup({ shortList: "marine" }, config);
    const result = await runUpdate(env.FORECASTS, catalog, deps);
    // 10 Marine non mappabili su 20 = 50%: fallback; tutte recuperate con richieste singole.
    expect(result.metrics.block_failures).toBe(10);
    expect(result.fallback_breaker).toBe(false);
    expect(result.updated_locations).toHaveLength(100);
  });

  it("elemento non valido in blocco riuscito (sotto soglia): fallback singolo per entrambi i provider, il blocco non è fallito", async () => {
    const { provider, deps } = setup({ invalidLats: [catalog[7]!.latitude] }, config);
    const result = await runUpdate(env.FORECASTS, catalog, deps);
    expect(result.metrics.block_failures).toBe(0);
    expect(result.fallback_breaker).toBe(false);
    expect(singles(provider.requests).map((request) => request.provider).sort()).toEqual([
      "marine",
      "weather",
    ]);
    expect(result.updated_locations).toHaveLength(100);
  });

  it("blocco da una sola località: la risposta oggetto è trattata come lista di un elemento", async () => {
    const small = syntheticCatalog(3);
    const { deps } = setup({}, { ...BIG, blockSize: 1 });
    const result = await runUpdate(env.FORECASTS, small, deps);
    expect(result.updated_locations).toHaveLength(3);
    expect(result.metrics.block_failures).toBe(0);
  });
});

describe("tetto di subrequest (UPDATE_MAX_SUBREQUESTS, NFR-15)", () => {
  it("500 località con tetto Free 45: nessuna richiesta, errori espliciti, nessun superamento", async () => {
    const catalog = syntheticCatalog(500);
    const { provider, deps } = setup({}, { maxSubrequests: 45 });
    const put = vi.spyOn(env.FORECASTS, "put");
    const result = await runUpdate(env.FORECASTS, catalog, deps);

    expect(Object.keys(result.errors)).toHaveLength(500);
    expect(new Set(Object.values(result.errors))).toEqual(new Set([BUDGET_SUBREQUESTS_MESSAGE]));
    expect(BUDGET_SUBREQUESTS_MESSAGE).toBe("Aggiornamento non tentato: budget di subrequest esaurito");
    expect(result.metrics.budget_exhausted).toBe("subrequests");
    expect(result.metrics.subrequests).toBeLessThanOrEqual(45);
    expect(provider.requests.length).toBeLessThanOrEqual(45);
    expect(put).not.toHaveBeenCalled();
  });

  it("tetto 30 con 13 località a blocchi da 1: le prime sono aggiornate, le altre in errors", async () => {
    const small = syntheticCatalog(13);
    const { provider, deps } = setup({}, { maxSubrequests: 30, blockSize: 1, concurrency: 1 });
    const result = await runUpdate(env.FORECASTS, small, deps);

    // 30 - 2 (get meta + get latest: prima esecuzione) - 14 (13 put + put meta riservate)
    // = 14 richieste provider (blocchi da 1: Marine e Weather delle prime 7 località).
    expect(provider.requests).toHaveLength(14);
    expect(result.metrics.subrequests).toBeLessThanOrEqual(30);
    expect(result.metrics.budget_exhausted).toBe("subrequests");
    const failed = Object.keys(result.errors);
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.length + result.updated_locations.length).toBe(13);
    expect(Object.values(result.errors).every((m) => m === BUDGET_SUBREQUESTS_MESSAGE)).toBe(true);
    expect(result.updated_locations).toEqual(small.slice(0, 7).map((entry) => entry.slug));
    expect(result.metrics.paid_alerts).toContain("budget_subrequests");
  });

  it("i retry contano come subrequest", async () => {
    const small = syntheticCatalog(13);
    const { provider, deps } = setup(
      { fail: () => "network" },
      { maxSubrequests: 45 },
    );
    const result = await runUpdate(env.FORECASTS, small, deps);
    // Marine e Forecast: 3 tentativi ciascuno, poi interruttore (100%).
    expect(provider.requests).toHaveLength(6);
    expect(result.metrics.subrequests).toBe(2 + 6); // get meta + get latest + 6 tentativi
    expect(result.fallback_breaker).toBe(true);
  });
});

describe("budget di durata (UPDATE_BUDGET_SECONDS, NFR-5)", () => {
  it("con budget breve le località non tentate sono in errors con messaggio esplicito", async () => {
    const catalog = syntheticCatalog(500);
    const { clock, provider, deps } = setup({}, { ...BIG, budgetSeconds: 100 });
    const started = clock.nowMs();
    const result = await runUpdate(env.FORECASTS, catalog, deps);

    expect(BUDGET_DURATION_MESSAGE).toBe("Aggiornamento non tentato: budget di durata esaurito");
    expect(result.metrics.budget_exhausted).toBe("duration");
    const failed = Object.values(result.errors);
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every((message) => message === BUDGET_DURATION_MESSAGE)).toBe(true);
    expect(result.updated_locations.length).toBeGreaterThan(0);
    expect(result.updated_locations.length + failed.length).toBe(500);
    // Nessuna richiesta parte oltre (scadenza - 30 s di timeout).
    for (const request of provider.requests) {
      expect(request.atMs - started).toBeLessThanOrEqual(100_000 - 30_000);
    }
  });
});

describe("avvisi Paid (NFR-15 b, c)", () => {
  it("scritture/giorno: soglia configurabile PAID_ALERT_KV_WRITES_PER_DAY", async () => {
    const small = syntheticCatalog(13);
    const low = setup({}, { ...BIG, paidAlertKvWritesPerDay: 50 });
    const resultLow = await runUpdate(env.FORECASTS, small, low.deps);
    // 14 scritture x 4 = 56 > 50, subrequest 17 <= 40.
    expect(resultLow.metrics.paid_alerts).toEqual(["kv_writes_per_day"]);

    await clearKv();
    const high = setup({}, BIG);
    const resultHigh = await runUpdate(env.FORECASTS, small, high.deps);
    expect(resultHigh.metrics.paid_alerts).toEqual([]);
  });

  it("subrequest > 40 segnalate", async () => {
    const mid = syntheticCatalog(40);
    const { deps } = setup({}, BIG);
    const result = await runUpdate(env.FORECASTS, mid, deps);
    // 2 get (prima esecuzione) + 2 provider + 40 put + 1 put meta = 45 > 40; 41 x 4 = 164 < 700.
    expect(result.metrics.subrequests).toBe(45);
    expect(result.metrics.paid_alerts).toEqual(["subrequests"]);
  });
});
