import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import locations from "../../locations.json";
import golden from "../../tests/fixtures/golden_forecast_torre-dei-corsari.json";
import goldenForecasts from "../../tests/fixtures/golden_forecasts.json";
import marineResponse from "../../tests/fixtures/open_meteo_marine_torre-dei-corsari.json";
import weatherResponse from "../../tests/fixtures/open_meteo_weather_torre-dei-corsari.json";
import { MARINE_SOURCE, WEATHER_SOURCE } from "../src/data_sources";
import worker from "../src/index";
import type { FetchImpl } from "../src/open_meteo";
import { CACHE_KEY } from "../src/store";
import { runUpdate } from "../src/update";

const NOW = "2026-10-19T09:00:00+00:00";
const CAGLIARI = locations.find((item) => item.slug === "cagliari")!;
const ALL_SLUGS = locations.map((item) => item.slug).sort();

interface FakeOptions {
  /** Latitudini (come appaiono nell'URL) per cui il provider fallisce sempre. */
  failLatitudes?: number[];
  failAll?: boolean;
  /** Se impostato, tiene traccia di chiamate totali e picco di chiamate in volo. */
  stats?: { total: number; inFlight: number; peak: number };
  /** Risposta 200 con `{error: true}`: fallimento senza retry. */
  apiError?: boolean;
}

function fakeFetch(options: FakeOptions = {}): FetchImpl {
  return async (input) => {
    const url = String(input);
    const stats = options.stats;
    if (stats) {
      stats.total += 1;
      stats.inFlight += 1;
      stats.peak = Math.max(stats.peak, stats.inFlight);
    }
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      const failing =
        options.failAll === true ||
        (options.failLatitudes ?? []).some((lat) => url.includes(`latitude=${lat}&`));
      if (failing) {
        if (options.apiError === true) {
          return new Response(JSON.stringify({ error: true, reason: "provider KO" }));
        }
        throw new Error("rete assente");
      }
      if (url.startsWith(`${MARINE_SOURCE.endpoint}?`)) {
        return new Response(JSON.stringify(marineResponse));
      }
      if (url.startsWith(`${WEATHER_SOURCE.endpoint}?`)) {
        return new Response(JSON.stringify(weatherResponse));
      }
      throw new Error(`Endpoint inatteso: ${url}`);
    } finally {
      if (stats) {
        stats.inFlight -= 1;
      }
    }
  };
}

const noSleep = async (): Promise<void> => {};

function deps(options: FakeOptions = {}) {
  return { fetchImpl: fakeFetch(options), sleep: noSleep, now: () => NOW };
}

async function readLatest(): Promise<Record<string, any>> {
  const raw = await env.FORECASTS.get(CACHE_KEY);
  expect(raw).not.toBeNull();
  return JSON.parse(raw!) as Record<string, any>;
}

beforeEach(async () => {
  await env.FORECASTS.delete(CACHE_KEY);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runUpdate — successo con KV vuota (AC-1)", () => {
  it("scrive latest con chiavi nell'ordine, 13 località e blocco torre = golden", async () => {
    await runUpdate(env.FORECASTS, locations, deps());
    const payload = await readLatest();

    expect(Object.keys(payload)).toEqual([
      "schema_version",
      "generated_at",
      "updated_locations",
      "errors",
      "locations",
    ]);
    expect(payload.schema_version).toBe(1);
    expect(payload.generated_at).toBe(NOW);
    expect(payload.updated_locations).toEqual(ALL_SLUGS);
    expect(payload.errors).toEqual({});
    expect(Object.keys(payload.locations)).toHaveLength(13);
    for (const entry of locations) {
      const location = payload.locations[entry.slug].location;
      expect(Object.keys(location)).toEqual(["name", "latitude", "longitude", "slug"]);
      expect(location.slug).toBe(entry.slug);
    }
    expect(payload.locations["torre-dei-corsari"]).toEqual(golden);
    expect(JSON.stringify(payload.locations["torre-dei-corsari"])).toBe(JSON.stringify(golden));
  });

  it("scrive una sola volta con JSON compatto", async () => {
    const put = vi.spyOn(env.FORECASTS, "put");
    await runUpdate(env.FORECASTS, locations, deps());
    expect(put).toHaveBeenCalledTimes(1);
    const body = put.mock.calls[0]![1] as string;
    expect(body).toBe(JSON.stringify(JSON.parse(body)));
  });

  it("generated_at è calcolato dopo aver atteso tutte le località", async () => {
    const times = ["T-build", "T-end"];
    let calls = 0;
    const now = () => {
      calls += 1;
      return calls <= 13 * 3 ? times[0]! : times[1]!;
    };
    const result = await runUpdate(env.FORECASTS, locations, { ...deps(), now });
    expect(result.generated_at).toBe("T-end");
  });
});

describe("runUpdate — fallimento parziale (AC-2, AC-3)", () => {
  it("conserva la previsione precedente e registra l'errore", async () => {
    await env.FORECASTS.put(CACHE_KEY, JSON.stringify(goldenForecasts));
    const result = await runUpdate(
      env.FORECASTS,
      locations,
      deps({ failLatitudes: [CAGLIARI.latitude] }),
    );
    const payload = await readLatest();

    expect(result.written).toBe(true);
    expect(payload.locations.cagliari).toEqual(goldenForecasts.locations.cagliari);
    expect(payload.errors.cagliari).toMatch(/^Impossibile consultare/);
    expect(payload.updated_locations).toHaveLength(12);
    expect(payload.updated_locations).not.toContain("cagliari");
    expect(payload.generated_at).toBe(NOW);
    expect(payload.locations.alghero.generated_at).toBe(NOW);
  });

  it.each([
    ["KV vuota", null],
    ["testo non JSON", "non è json"],
    ["senza locations oggetto", JSON.stringify({ schema_version: 1, locations: [] })],
    ["JSON null", "null"],
  ])("parte da locations vuote con cache precedente: %s", async (_label, stored) => {
    if (stored !== null) {
      await env.FORECASTS.put(CACHE_KEY, stored);
    }
    await runUpdate(env.FORECASTS, locations, deps({ failLatitudes: [CAGLIARI.latitude] }));
    const payload = await readLatest();

    expect(payload.locations.cagliari).toBeUndefined();
    expect(payload.errors.cagliari).toBeTypeOf("string");
    expect(Object.keys(payload.locations)).toHaveLength(12);
  });

  it("uno slug già presente mantiene la posizione, i nuovi sono accodati", async () => {
    await env.FORECASTS.put(CACHE_KEY, JSON.stringify(goldenForecasts));
    await runUpdate(env.FORECASTS, locations, deps());
    const keys = Object.keys((await readLatest()).locations);
    const previousKeys = Object.keys(goldenForecasts.locations);
    expect(keys.slice(0, previousKeys.length)).toEqual(previousKeys);
  });
});

describe("runUpdate — tutte le località falliscono (AC-4, decisione PO)", () => {
  it("non scrive in KV e lascia il latest preesistente byte-identico", async () => {
    const stored = JSON.stringify(goldenForecasts);
    await env.FORECASTS.put(CACHE_KEY, stored);
    const put = vi.spyOn(env.FORECASTS, "put");

    const result = await runUpdate(env.FORECASTS, locations, deps({ failAll: true }));

    expect(put).not.toHaveBeenCalled();
    expect(await env.FORECASTS.get(CACHE_KEY)).toBe(stored);
    expect(result.written).toBe(false);
    expect(result.updated_locations).toEqual([]);
    expect(Object.keys(result.errors).sort()).toEqual(ALL_SLUGS);
  });

  it("con KV vuota la chiave resta assente", async () => {
    await runUpdate(env.FORECASTS, locations, deps({ failAll: true }));
    expect(await env.FORECASTS.get(CACHE_KEY)).toBeNull();
  });
});

describe("runUpdate — catalogo invalido (AC-5, FR-2)", () => {
  it.each(["slug", "name", "latitude", "longitude"])(
    "rifiuta se manca %s, senza fetch né modifica a KV",
    async (field) => {
      const stored = JSON.stringify(goldenForecasts);
      await env.FORECASTS.put(CACHE_KEY, stored);
      const fetchImpl = vi.fn(fakeFetch());
      const broken = locations.map((item, index) => {
        if (index !== 3) {
          return item;
        }
        const copy: Record<string, unknown> = { ...item };
        delete copy[field];
        return copy;
      });

      await expect(
        runUpdate(env.FORECASTS, broken, { fetchImpl, sleep: noSleep, now: () => NOW }),
      ).rejects.toThrow(`Localita non valida, campi mancanti: ['${field}']`);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(await env.FORECASTS.get(CACHE_KEY)).toBe(stored);
    },
  );

  it("elenca i campi mancanti in ordine alfabetico", async () => {
    await expect(
      runUpdate(env.FORECASTS, [{ slug: "x" }], deps()),
    ).rejects.toThrow("Localita non valida, campi mancanti: ['latitude', 'longitude', 'name']");
  });
});

describe("runUpdate — concorrenza e subrequest (AC-6)", () => {
  it("al massimo 6 chiamate in volo e 26 totali", async () => {
    const stats = { total: 0, inFlight: 0, peak: 0 };
    await runUpdate(env.FORECASTS, locations, deps({ stats }));
    expect(stats.total).toBe(26);
    expect(stats.peak).toBeGreaterThan(1);
    expect(stats.peak).toBeLessThanOrEqual(6);
  });
});

describe("scheduled (AC-7)", () => {
  async function trigger(): Promise<void> {
    const ctx = createExecutionContext();
    await worker.scheduled!(createScheduledController({ cron: "30 0,6,12,18 * * *" }), env, ctx);
    await waitOnExecutionContext(ctx);
  }

  it("scrive latest con 13 località e logga l'esito", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(fakeFetch());
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await trigger();

    const payload = await readLatest();
    expect(Object.keys(payload.locations)).toHaveLength(13);
    const summaries = log.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes("forecast_update"))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      event: "forecast_update",
      updated: 13,
      failed: 0,
      generated_at: payload.generated_at,
    });
    expect(summaries[0]!.duration_ms).toBeTypeOf("number");
  });

  it("per ogni località fallita emette console.error con slug e messaggio", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fakeFetch({ failLatitudes: [CAGLIARI.latitude], apiError: true }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await trigger();

    const lines = error.mock.calls.map((call) => call.map(String).join(" "));
    expect(lines.some((line) => line.includes("cagliari") && line.includes("provider KO"))).toBe(
      true,
    );
    expect((await readLatest()).errors.cagliari).toBe("provider KO");
  });

  it("tutte falliscono: risolve, non scrive, logga errori e riepilogo", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fakeFetch({ failAll: true, apiError: true }),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await trigger();

    expect(await env.FORECASTS.get(CACHE_KEY)).toBeNull();
    expect(error).toHaveBeenCalled();
    const summary = log.mock.calls
      .map((call) => String(call[0]))
      .find((line) => line.includes("forecast_update"));
    expect(JSON.parse(summary!)).toMatchObject({ updated: 0, failed: 13 });
  });

  it("rigetta se KV.put fallisce", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(fakeFetch());
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(env.FORECASTS, "put").mockRejectedValue(new Error("KV down"));
    await expect(trigger()).rejects.toThrow("KV down");
  });

  it("le route HTTP continuano a funzionare", async () => {
    const response = await worker.fetch!(
      new Request("https://example.com/") as Request<unknown, IncomingRequestCfProperties>,
      env,
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
  });
});

describe("wrangler.jsonc e README (AC-8)", () => {
  it("triggers.crons è ogni 6 h UTC con commento sull'ora legale", async () => {
    const raw = (await import("../wrangler.jsonc?raw")).default as string;
    const stripped = raw
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    const config = JSON.parse(stripped) as { triggers?: { crons?: string[] } };
    expect(config.triggers?.crons).toEqual(["30 0,6,12,18 * * *"]);
    expect(raw).toMatch(/\/\/.*ora legale/i);
  });

  it("README documenta Paid, avviso Free e prova in locale", async () => {
    const readme = (await import("../README.md?raw")).default as string;
    expect(readme).toContain("Aggiornamento programmato");
    expect(readme).toContain("30 0,6,12,18 * * *");
    expect(readme).toContain("Workers Paid");
    expect(readme).toMatch(/piano Free/);
    expect(readme).toContain("wrangler dev --test-scheduled");
    expect(readme).toContain("__scheduled");
  });
});
