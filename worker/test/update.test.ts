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
import worker from "../src/index";
import {
  BREAKER_MESSAGE,
  runUpdate,
  type UpdateDeps,
} from "../src/update";
import { clearKv, forecastKeys, readJson } from "./helpers/kv";
import { fakeProvider, type FakeProviderOptions } from "./helpers/provider";

const NOW = "2026-10-19T09:00:00+00:00";
const CAGLIARI = locations.find((item) => item.slug === "cagliari")!;
const ALL_SLUGS = locations.map((item) => item.slug).sort();
const LEGACY_KEY = "latest";

const noSleep = async (): Promise<void> => {};

function deps(options: FakeProviderOptions = {}): UpdateDeps {
  return { fetchImpl: fakeProvider(options).fetchImpl, sleep: noSleep, now: () => NOW };
}

beforeEach(clearKv);
afterEach(() => {
  vi.restoreAllMocks();
});

describe("runUpdate: successo con KV vuota (FR-55, FR-59)", () => {
  it("scrive un record per località e meta, mai latest; il record torre = golden", async () => {
    await runUpdate(env.FORECASTS, locations, deps());

    expect(await forecastKeys()).toEqual(ALL_SLUGS.map((slug) => `forecast:${slug}`));
    expect(await env.FORECASTS.get(LEGACY_KEY)).toBeNull();

    const meta = (await readJson("meta"))!;
    expect(Object.keys(meta)).toEqual([
      "schema_version",
      "generated_at",
      "updated_locations",
      "errors",
      "locations",
      "slugs",
    ]);
    expect(meta["schema_version"]).toBe(1);
    expect(meta["generated_at"]).toBe(NOW);
    expect(meta["updated_locations"]).toEqual(ALL_SLUGS);
    expect(meta["errors"]).toEqual({});
    expect(meta["locations"]).toBe(13);
    expect(meta["slugs"]).toEqual(ALL_SLUGS);

    for (const entry of locations) {
      const record = (await readJson(`forecast:${entry.slug}`))!;
      expect(Object.keys(record["location"])).toEqual(["name", "latitude", "longitude", "slug"]);
      expect(record["location"].slug).toBe(entry.slug);
    }
    const raw = await env.FORECASTS.get("forecast:torre-dei-corsari");
    expect(JSON.parse(raw!)).toEqual(golden);
    expect(raw).toBe(JSON.stringify(golden));
  });

  it("13 località: 1 blocco per provider (2 richieste), 14 put con meta per ultima, JSON compatto", async () => {
    const provider = fakeProvider();
    const put = vi.spyOn(env.FORECASTS, "put");
    const result = await runUpdate(env.FORECASTS, locations, {
      fetchImpl: provider.fetchImpl,
      sleep: noSleep,
      now: () => NOW,
    });

    expect(provider.requests).toHaveLength(2);
    expect(provider.requests.every((request) => request.lats.length === 13)).toBe(true);
    expect(result.metrics.blocks).toBe(1);
    expect(result.metrics.block_requests).toBe(2);
    expect(put).toHaveBeenCalledTimes(14);
    const keys = put.mock.calls.map((call) => call[0]);
    expect(keys[13]).toBe("meta");
    expect(keys.slice(0, 13).every((key) => key.startsWith("forecast:"))).toBe(true);
    for (const call of put.mock.calls) {
      const body = call[1] as string;
      expect(body).toBe(JSON.stringify(JSON.parse(body)));
    }
  });

  it("caso nominale a 13 località: 17 subrequest, mai troncato dal tetto 45; prima esecuzione 18", async () => {
    const first = await runUpdate(env.FORECASTS, locations, deps());
    expect(first.metrics.subrequests).toBe(18); // + 1 get latest (migrazione)
    expect(first.errors).toEqual({});

    const result = await runUpdate(env.FORECASTS, locations, deps());
    expect(result.metrics.subrequests).toBe(17); // 1 get meta + 2 provider + 13 put + 1 put meta
    expect(result.metrics.kv_writes).toBe(14);
    expect(result.metrics.budget_exhausted).toBe("none");
    expect(result.errors).toEqual({});
    expect(result.metrics.paid_alerts).toEqual([]);
  });

  it("generated_at è calcolato dopo aver costruito tutte le località", async () => {
    let calls = 0;
    const now = () => {
      calls += 1;
      return calls <= 13 + 2 ? "T-build" : "T-end";
    };
    const result = await runUpdate(env.FORECASTS, locations, { ...deps(), now });
    expect(result.generated_at).toBe("T-end");
  });
});

describe("runUpdate: fallimento parziale (FR-18, FR-54)", () => {
  async function seedPrevious(): Promise<void> {
    await env.FORECASTS.put(
      "forecast:cagliari",
      JSON.stringify(goldenForecasts.locations.cagliari),
    );
    await env.FORECASTS.put(
      "meta",
      JSON.stringify({
        schema_version: 1,
        generated_at: "2026-10-18T09:00:00+00:00",
        updated_locations: [],
        errors: {},
        locations: 1,
        slugs: ["cagliari"],
      }),
    );
  }

  it("blocco Marine fallito (50%): fallback singolo, la località che fallisce conserva il record", async () => {
    await seedPrevious();
    const provider = fakeProvider({
      fail: (request) =>
        request.provider === "marine" && request.isBlock
          ? "network"
          : request.provider === "marine" && request.lats[0] === CAGLIARI.latitude
            ? "network"
            : undefined,
    });
    const result = await runUpdate(env.FORECASTS, locations, {
      fetchImpl: provider.fetchImpl,
      sleep: noSleep,
      now: () => NOW,
    });

    expect(result.fallback_breaker).toBe(false);
    expect(result.written).toBe(true);
    expect(await readJson("forecast:cagliari")).toEqual(goldenForecasts.locations.cagliari);
    expect(result.errors["cagliari"]).toMatch(/^Impossibile consultare/);
    expect(result.updated_locations).toHaveLength(12);
    expect(result.updated_locations).not.toContain("cagliari");
    const meta = (await readJson("meta"))!;
    expect(meta["generated_at"]).toBe(NOW);
    expect(meta["errors"]).toEqual(result.errors);
    expect(meta["slugs"]).toEqual(ALL_SLUGS);
    expect((await readJson("forecast:alghero"))!["generated_at"]).toBe(NOW);
    // Fallback solo per il provider mancante: 13 richieste singole Marine, nessuna Weather.
    const singles = provider.requests.filter((request) => !request.isBlock);
    expect(singles.filter((request) => request.provider === "weather")).toHaveLength(0);
    expect(singles.filter((request) => request.provider === "marine").length).toBeGreaterThanOrEqual(13);
  });

  it("errore API del provider: il messaggio del provider arriva in errors", async () => {
    const provider = fakeProvider({
      fail: (request) =>
        request.provider === "weather" && request.lats[0] === CAGLIARI.latitude && !request.isBlock
          ? "apiError"
          : request.provider === "weather" && request.isBlock
            ? "network"
            : undefined,
    });
    const result = await runUpdate(env.FORECASTS, locations, {
      fetchImpl: provider.fetchImpl,
      sleep: noSleep,
      now: () => NOW,
    });
    expect(result.errors["cagliari"]).toBe("provider KO");
  });

  it.each([
    ["meta assente", null],
    ["testo non JSON", "non è json"],
    ["JSON null", "null"],
    ["senza slugs", JSON.stringify({ schema_version: 1 })],
  ])("parte da zero senza record né slugs con meta: %s", async (_label, stored) => {
    if (stored !== null) {
      await env.FORECASTS.put("meta", stored);
    }
    const provider = fakeProvider({
      fail: (request) =>
        request.provider === "marine" && request.lats.includes(CAGLIARI.latitude)
          ? "network"
          : undefined,
    });
    const result = await runUpdate(env.FORECASTS, locations, {
      fetchImpl: provider.fetchImpl,
      sleep: noSleep,
      now: () => NOW,
    });
    // Blocco Marine fallito (50%) + singola Cagliari fallita: 12 aggiornate.
    expect(await env.FORECASTS.get("forecast:cagliari")).toBeNull();
    expect(result.errors["cagliari"]).toBeTypeOf("string");
    expect((await readJson("meta"))!["slugs"]).toHaveLength(12);
  });

  it("uno slug già in meta e non aggiornato resta in meta.slugs; le uscite dal catalogo sono cancellate", async () => {
    await env.FORECASTS.put("forecast:vecchia", JSON.stringify({ location: { name: "Vecchia" } }));
    await env.FORECASTS.put(
      "meta",
      JSON.stringify({
        schema_version: 1,
        generated_at: NOW,
        updated_locations: [],
        errors: {},
        locations: 1,
        slugs: ["vecchia"],
      }),
    );
    const delRes = vi.spyOn(env.FORECASTS, "delete");
    const result = await runUpdate(env.FORECASTS, locations, deps());

    expect(delRes).toHaveBeenCalledWith("forecast:vecchia");
    expect(await env.FORECASTS.get("forecast:vecchia")).toBeNull();
    expect((await readJson("meta"))!["slugs"]).toEqual(ALL_SLUGS);
    expect(result.metrics.kv_deletes).toBe(1);
  });
});

describe("runUpdate: tutte le località falliscono", () => {
  it("non scrive nulla (nessuna put, nessun meta) e riporta ogni slug", async () => {
    const put = vi.spyOn(env.FORECASTS, "put");
    const result = await runUpdate(env.FORECASTS, locations, deps({ fail: () => "network" }));

    expect(put).not.toHaveBeenCalled();
    expect(await env.FORECASTS.get("meta")).toBeNull();
    expect(result.written).toBe(false);
    expect(result.updated_locations).toEqual([]);
    expect(Object.keys(result.errors).sort()).toEqual(ALL_SLUGS);
    // 100% dei blocchi falliti: interruttore, nessuna richiesta singola.
    expect(result.fallback_breaker).toBe(true);
    expect(Object.values(result.errors).every((message) => message === BREAKER_MESSAGE)).toBe(true);
  });

  it("il meta preesistente resta byte-identico", async () => {
    const stored = JSON.stringify({ schema_version: 1, generated_at: NOW, slugs: [] });
    await env.FORECASTS.put("meta", stored);
    await runUpdate(env.FORECASTS, locations, deps({ fail: () => "network" }));
    expect(await env.FORECASTS.get("meta")).toBe(stored);
  });
});

describe("runUpdate: catalogo invalido (FR-2)", () => {
  it.each(["slug", "name", "latitude", "longitude"])(
    "rifiuta se manca %s, senza fetch né modifica a KV",
    async (field) => {
      const stored = JSON.stringify({ schema_version: 1, generated_at: NOW, slugs: [] });
      await env.FORECASTS.put("meta", stored);
      const fetchImpl = vi.fn(fakeProvider().fetchImpl);
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
      expect(await env.FORECASTS.get("meta")).toBe(stored);
    },
  );

  it("elenca i campi mancanti in ordine alfabetico", async () => {
    await expect(runUpdate(env.FORECASTS, [{ slug: "x" }], deps())).rejects.toThrow(
      "Localita non valida, campi mancanti: ['latitude', 'longitude', 'name']",
    );
  });
});

describe("runUpdate: concorrenza (NFR-17)", () => {
  it("con blocchi da 1 località: 26 richieste, picco in volo entro UPDATE_CONCURRENCY", async () => {
    const stats = { total: 0, inFlight: 0, peak: 0 };
    const provider = fakeProvider({ stats, delayMs: 1 });
    await runUpdate(env.FORECASTS, locations, {
      fetchImpl: provider.fetchImpl,
      sleep: noSleep,
      now: () => NOW,
      config: { blockSize: 1, maxSubrequests: 1000 },
    });
    expect(stats.total).toBe(26);
    expect(stats.peak).toBeGreaterThan(1);
    expect(stats.peak).toBeLessThanOrEqual(4);
  });

  it("UPDATE_CONCURRENCY è limitato a 6", async () => {
    const stats = { total: 0, inFlight: 0, peak: 0 };
    const provider = fakeProvider({ stats, delayMs: 1 });
    await runUpdate(env.FORECASTS, locations, {
      fetchImpl: provider.fetchImpl,
      sleep: noSleep,
      now: () => NOW,
      config: { blockSize: 1, concurrency: 50, maxSubrequests: 1000 },
    });
    expect(stats.peak).toBeLessThanOrEqual(6);
  });
});

describe("scheduled", () => {
  async function trigger(): Promise<void> {
    const ctx = createExecutionContext();
    await worker.scheduled!(createScheduledController({ cron: "30 0,6,12,18 * * *" }), env, ctx);
    await waitOnExecutionContext(ctx);
  }

  function mockProvider(options: FakeProviderOptions = {}): void {
    vi.spyOn(globalThis, "fetch").mockImplementation(fakeProvider(options).fetchImpl);
  }

  function summaries(log: { mock: { calls: unknown[][] } }): Record<string, any>[] {
    return log.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes("forecast_update"))
      .map((line) => JSON.parse(line) as Record<string, any>);
  }

  it("scrive meta e 13 record, mai latest, e logga l'esito esteso (NFR-21)", async () => {
    mockProvider();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await trigger();

    const meta = (await readJson("meta"))!;
    expect(meta["slugs"]).toHaveLength(13);
    expect(await env.FORECASTS.get(LEGACY_KEY)).toBeNull();
    const lines = summaries(log);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      event: "forecast_update",
      updated: 13,
      failed: 0,
      generated_at: meta["generated_at"],
      blocks: 1,
      block_requests: 2,
      block_failures: 0,
      fallback_breaker: false,
      fallbacks: 0,
      subrequests: 18,
      kv_writes: 14,
      kv_deletes: 0,
      budget_exhausted: "none",
      paid_alerts: [],
    });
    expect(lines[0]!["duration_ms"]).toBeTypeOf("number");
    expect(lines[0]!["weight_used"]).toBe(26);
  });

  it("per ogni località fallita emette console.error con slug e messaggio", async () => {
    mockProvider({
      fail: (request) =>
        request.provider === "weather"
          ? request.isBlock || request.lats[0] === CAGLIARI.latitude
            ? "apiError"
            : undefined
          : undefined,
    });
    // Il blocco Weather fallisce (50%): fallback singolo; Cagliari fallisce anche da sola.
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await trigger();

    const lines = error.mock.calls.map((call) => call.map(String).join(" "));
    expect(lines.some((line) => line.includes("cagliari") && line.includes("provider KO"))).toBe(
      true,
    );
    expect((await readJson("meta"))!["errors"]["cagliari"]).toBe("provider KO");
  });

  it("tutte falliscono: risolve, non scrive, logga errori, interruttore e riepilogo", async () => {
    mockProvider({ fail: () => "apiError" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await trigger();

    expect(await env.FORECASTS.get("meta")).toBeNull();
    expect(error).toHaveBeenCalled();
    const [line] = summaries(log);
    expect(line).toMatchObject({
      updated: 0,
      failed: 13,
      fallback_breaker: true,
      block_failures: 2,
    });
  });

  it("rigetta se KV.put fallisce", async () => {
    mockProvider();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(env.FORECASTS, "put").mockRejectedValue(new Error("KV down"));
    await expect(trigger()).rejects.toThrow("KV down");
  });

  it("le variabili d'ambiente configurano il job (blocco da 5 località)", async () => {
    const provider = fakeProvider();
    vi.spyOn(globalThis, "fetch").mockImplementation(provider.fetchImpl);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const ctx = createExecutionContext();
    await worker.scheduled!(
      createScheduledController({ cron: "30 0,6,12,18 * * *" }),
      { ...env, OPEN_METEO_BLOCK_SIZE: "5" },
      ctx,
    );
    await waitOnExecutionContext(ctx);
    // ceil(13/5) = 3 blocchi per provider.
    expect(provider.requests).toHaveLength(6);
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

describe("wrangler.jsonc e README", () => {
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
