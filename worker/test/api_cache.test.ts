/**
 * Percorsi di lettura sul cache per località (FR-55..FR-59, ADR-0003 §2-3).
 * `api.test.ts` resta invariato: copre la modalità legacy (solo `latest`).
 */
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import locations from "../../locations.json";
import goldenTorre from "../../tests/fixtures/golden_forecast_torre-dei-corsari.json";
import goldenForecasts from "../../tests/fixtures/golden_forecasts.json";
import { createApp } from "../src/index";
import { runUpdate } from "../src/update";
import { clearKv } from "./helpers/kv";
import { fakeProvider, syntheticCatalog } from "./helpers/provider";

const HOUR_MS = 3_600_000;

const hoursAgo = (hours: number): string => new Date(Date.now() - hours * HOUR_MS).toISOString();

/** KV che registra le chiavi lette (get singolo, bulk e list). */
function spyKv(): { kv: KVNamespace; reads: string[][] } {
  const reads: string[][] = [];
  const kv = new Proxy(env.FORECASTS, {
    get(target, property) {
      if (property === "get") {
        return (keys: string | string[], ...rest: unknown[]) => {
          reads.push(Array.isArray(keys) ? keys : [keys]);
          return (target.get as (...args: unknown[]) => unknown)(keys, ...rest);
        };
      }
      const value = Reflect.get(target, property) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { kv, reads };
}

async function request(
  path: string,
  options: { catalog?: Parameters<typeof createApp>[0]; kv?: KVNamespace; extraEnv?: object } = {},
): Promise<Response> {
  const app = createApp(options.catalog);
  return app.request(path, {}, { FORECASTS: options.kv ?? env.FORECASTS, ...options.extraEnv });
}

async function putMeta(extra: Record<string, unknown> = {}): Promise<void> {
  await env.FORECASTS.put(
    "meta",
    JSON.stringify({
      schema_version: 1,
      generated_at: hoursAgo(1),
      updated_locations: [],
      errors: {},
      locations: 0,
      slugs: [],
      ...extra,
    }),
  );
}

async function putRecord(slug: string, body: unknown): Promise<void> {
  await env.FORECASTS.put(`forecast:${slug}`, JSON.stringify(body));
}

beforeEach(clearKv);
afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /forecast con cache per località (FR-57)", () => {
  it("per nome e per slug legge solo forecast:<slug> e meta (1 lettura) e risponde con il record", async () => {
    await putRecord("torre-dei-corsari", goldenTorre);
    await putRecord("cagliari", goldenForecasts.locations.cagliari);
    await putMeta({ slugs: ["cagliari", "torre-dei-corsari"], locations: 2 });

    for (const query of [encodeURIComponent("Torre dei Corsari"), "torre-dei-corsari", "TORRE-DEI-CORSARI"]) {
      const { kv, reads } = spyKv();
      const response = await request(`/forecast?localita=${query}`, { kv });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(goldenTorre);
      const keys = reads.flat();
      expect(keys.sort()).toEqual(["forecast:torre-dei-corsari", "meta"]);
      expect(reads.length).toBeLessThanOrEqual(2);
      expect(keys).not.toContain("latest");
    }
  });

  it("usa una sola lettura bulk (1 operazione KV) nel caso nominale", async () => {
    await putRecord("cagliari", goldenForecasts.locations.cagliari);
    await putMeta({ slugs: ["cagliari"], locations: 1 });
    const { kv, reads } = spyKv();
    const response = await request("/forecast?localita=Cagliari", { kv });
    expect(response.status).toBe(200);
    expect(reads).toEqual([["forecast:cagliari", "meta"]]);
  });

  it("senza lettura bulk ripiega su 2 letture parallele (ancora <= 2, NFR-19)", async () => {
    await putRecord("cagliari", goldenForecasts.locations.cagliari);
    await putMeta({ slugs: ["cagliari"], locations: 1 });
    const reads: string[] = [];
    const kv = {
      get: async (key: string | string[]) => {
        if (Array.isArray(key)) {
          throw new TypeError("bulk non supportato");
        }
        reads.push(key);
        return env.FORECASTS.get(key);
      },
    } as unknown as KVNamespace;
    const response = await request("/forecast?localita=Cagliari", { kv });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(goldenForecasts.locations.cagliari);
    expect(reads.sort()).toEqual(["forecast:cagliari", "meta"]);
  });

  it("il numero di letture non cresce con il catalogo (500 località)", async () => {
    const catalog = syntheticCatalog(500);
    const slugs = catalog.map((entry) => entry.slug);
    await putRecord("loc-250", { location: { name: "Localita 250", slug: "loc-250" } });
    await putMeta({ slugs, locations: 500 });
    const { kv, reads } = spyKv();

    const response = await request("/forecast?localita=Localita%20250", { catalog, kv });

    expect(response.status).toBe(200);
    expect(reads.flat().sort()).toEqual(["forecast:loc-250", "meta"]);
  });

  it("record illeggibile: 503 con descrizione dell'errore", async () => {
    await env.FORECASTS.put("forecast:cagliari", "non-json");
    await putMeta({ slugs: ["cagliari"], locations: 1 });
    const response = await request("/forecast?localita=Cagliari");
    expect(response.status).toBe(503);
    expect(((await response.json()) as { detail: string }).detail).toMatch(
      /^Cache forecast non leggibile: /,
    );
  });

  it("meta illeggibile: 503", async () => {
    await env.FORECASTS.put("meta", "{ rotto");
    const response = await request("/forecast?localita=Cagliari");
    expect(response.status).toBe(503);
  });

  it("località del catalogo senza record e senza latest: 404", async () => {
    await putMeta({ slugs: [], locations: 0 });
    const response = await request("/forecast?localita=Cagliari");
    expect(response.status).toBe(404);
  });

  it("località fuori catalogo con meta: 404 leggendo solo meta", async () => {
    await putMeta();
    const { kv, reads } = spyKv();
    const response = await request("/forecast?localita=Atlantide", { kv });
    expect(response.status).toBe(404);
    expect(reads.flat()).toEqual(["meta"]);
  });

  it("422 invariato", async () => {
    expect((await request("/forecast")).status).toBe(422);
    expect((await request("/forecast?localita=")).status).toBe(422);
  });
});

describe("404 di /forecast: detail.available (FR-58)", () => {
  it("con 500 località: primi 50 nomi ordinati, stesso formato, solo array di stringhe", async () => {
    const catalog = syntheticCatalog(500);
    // Slug in ordine inverso: l'ordinamento deve essere sui nomi, non sull'ordine di meta.
    const slugs = catalog.map((entry) => entry.slug).reverse();
    await putMeta({ slugs, locations: 500 });
    const { kv, reads } = spyKv();

    const response = await request("/forecast?localita=Atlantide", { catalog, kv });
    const body = (await response.json()) as { detail: { message: string; available: string[] } };

    expect(response.status).toBe(404);
    expect(Object.keys(body.detail)).toEqual(["message", "available"]);
    expect(body.detail.message).toBe("Localita 'Atlantide' non trovata");
    expect(body.detail.available).toHaveLength(50);
    expect(body.detail.available).toEqual(
      catalog.map((entry) => entry.name).sort().slice(0, 50),
    );
    expect(reads.flat()).toEqual(["meta"]);
  });

  it("con <= 50 località la risposta è identica a FR-23 (tutti i nomi ordinati)", async () => {
    await putMeta({ slugs: ["zeta", "alfa", "mare"], locations: 3 });
    const catalog = [
      { slug: "zeta", name: "Zeta", latitude: 1, longitude: 1 },
      { slug: "alfa", name: "Alfa", latitude: 1, longitude: 1 },
      { slug: "mare", name: "Mare", latitude: 1, longitude: 1 },
    ];
    const response = await request("/forecast?localita=Atlantide", { catalog });
    expect(((await response.json()) as { detail: unknown }).detail).toEqual({
      message: "Localita 'Atlantide' non trovata",
      available: ["Alfa", "Mare", "Zeta"],
    });
  });

  it("elenca solo le località con un record (meta.slugs)", async () => {
    await putMeta({ slugs: ["cagliari"], locations: 1 });
    const response = await request("/forecast?localita=Atlantide");
    expect(((await response.json()) as { detail: { available: string[] } }).detail.available).toEqual([
      "Cagliari",
    ]);
  });

  it("in modalità legacy è troncato a 50 anche da latest", async () => {
    const many: Record<string, unknown> = {};
    for (const entry of syntheticCatalog(80)) {
      many[entry.slug] = { location: { name: entry.name } };
    }
    await env.FORECASTS.put(
      "latest",
      JSON.stringify({ schema_version: 1, generated_at: hoursAgo(0), errors: {}, locations: many }),
    );
    const response = await request("/forecast?localita=Atlantide");
    const body = (await response.json()) as { detail: { available: string[] } };
    expect(body.detail.available).toHaveLength(50);
  });
});

describe("GET /health dal solo meta (FR-56)", () => {
  it("risponde da meta senza leggere i record e con il contratto FR-26", async () => {
    await putMeta({ locations: 13, errors: {}, generated_at: hoursAgo(1) });
    const { kv, reads } = spyKv();

    const response = await request("/health", { kv });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body["status"]).toBe("ok");
    expect(body["locations"]).toBe(13);
    expect(body["stale"]).toBe(false);
    expect(body["age_hours"]).toBe(1);
    expect(body["update_errors"]).toEqual({});
    expect(reads.flat()).toEqual(["meta"]);
  });

  it("errors in meta -> degraded; età oltre soglia -> stale", async () => {
    await putMeta({ errors: { cagliari: "boom" }, generated_at: hoursAgo(13), locations: 1 });
    const body = (await (await request("/health")).json()) as Record<string, unknown>;
    expect(body["status"]).toBe("degraded");
    expect(body["stale"]).toBe(true);
    expect(body["update_errors"]).toEqual({ cagliari: "boom" });
  });

  it("meta illeggibile: degraded con errore e cache_path", async () => {
    await env.FORECASTS.put("meta", "{ rotto");
    const body = (await (await request("/health")).json()) as Record<string, unknown>;
    expect(body["status"]).toBe("degraded");
    expect(body["error"]).toMatch(/^Cache forecast non leggibile: /);
    expect(body["cache_path"]).toBe("kv:FORECASTS");
  });

  it("i record non sono letti anche con 500 località", async () => {
    await putMeta({ locations: 500, slugs: syntheticCatalog(500).map((entry) => entry.slug) });
    const { kv, reads } = spyKv();
    await request("/health", { kv });
    expect(reads.flat()).toEqual(["meta"]);
  });
});

describe("migrazione da latest (FR-59, FR-60)", () => {
  const latest = (): string => JSON.stringify({ ...goldenForecasts, generated_at: hoursAgo(2) });

  it("finché meta manca serve da latest con la logica attuale (/forecast e /health)", async () => {
    await env.FORECASTS.put("latest", latest());
    const forecast = await request("/forecast?localita=Cagliari");
    expect(forecast.status).toBe(200);
    expect(await forecast.json()).toEqual(goldenForecasts.locations.cagliari);
    const health = (await (await request("/health")).json()) as Record<string, unknown>;
    expect(health["locations"]).toBe(2);
    expect(health["status"]).toBe("ok");
  });

  it("meta presente, record assente, latest contiene la località: 200 dal ripiego", async () => {
    await env.FORECASTS.put("latest", latest());
    await putMeta({ slugs: [], locations: 0 });
    const response = await request("/forecast?localita=Cagliari");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(goldenForecasts.locations.cagliari);
  });

  it("il ripiego si disattiva con LEGACY_LATEST_FALLBACK=false", async () => {
    await env.FORECASTS.put("latest", latest());
    await putMeta({ slugs: [], locations: 0 });
    const response = await request("/forecast?localita=Cagliari", {
      extraEnv: { LEGACY_LATEST_FALLBACK: "false" },
    });
    expect(response.status).toBe(404);
  });

  it("prima esecuzione: copia da latest le località non aggiornabili, nessuna 404/503, latest intatto", async () => {
    const stored = latest();
    await env.FORECASTS.put("latest", stored);
    const cagliari = locations.find((entry) => entry.slug === "cagliari")!;
    const torre = locations.find((entry) => entry.slug === "torre-dei-corsari")!;
    const provider = fakeProvider({
      // Blocco Marine KO (50%): fallback singolo; Cagliari e Torre falliscono anche da sole.
      fail: (req) =>
        req.provider === "marine" &&
        (req.isBlock || req.lats[0] === cagliari.latitude || req.lats[0] === torre.latitude)
          ? "network"
          : undefined,
    });

    // Prima dell'esecuzione: legacy.
    expect((await request("/forecast?localita=Cagliari")).status).toBe(200);

    const result = await runUpdate(env.FORECASTS, locations, {
      fetchImpl: provider.fetchImpl,
      sleep: async () => {},
      now: () => new Date().toISOString(),
    });

    expect(result.errors["cagliari"]).toBeTypeOf("string");
    expect(await env.FORECASTS.get("latest")).toBe(stored);
    expect(await env.FORECASTS.get("forecast:cagliari")).toBe(
      JSON.stringify(goldenForecasts.locations.cagliari),
    );
    expect(await env.FORECASTS.get("forecast:torre-dei-corsari")).toBe(
      JSON.stringify(goldenForecasts.locations["torre-dei-corsari"]),
    );
    const meta = JSON.parse((await env.FORECASTS.get("meta"))!) as { slugs: string[] };
    expect(meta.slugs).toHaveLength(13);

    for (const query of ["Cagliari", "Torre dei Corsari", "Alghero"]) {
      const response = await request(`/forecast?localita=${encodeURIComponent(query)}`);
      expect(response.status).toBe(200);
    }
    expect(await (await request("/forecast?localita=Cagliari")).json()).toEqual(
      goldenForecasts.locations.cagliari,
    );
  });

  it("migrazione con tutte le località non aggiornabili: nessuna scrittura, resta in legacy (200)", async () => {
    await env.FORECASTS.put("latest", latest());
    const provider = fakeProvider({ fail: () => "network" });
    const result = await runUpdate(env.FORECASTS, locations, {
      fetchImpl: provider.fetchImpl,
      sleep: async () => {},
      now: () => new Date().toISOString(),
    });
    expect(result.written).toBe(false);
    expect(await env.FORECASTS.get("meta")).toBeNull();
    expect((await request("/forecast?localita=Cagliari")).status).toBe(200);
  });

  it("latest si legge solo se meta manca: con meta presente il job non lo legge", async () => {
    await env.FORECASTS.put("latest", latest());
    await putMeta({ slugs: [], locations: 0 });
    const { kv, reads } = spyKv();
    const provider = fakeProvider();
    await runUpdate(kv, locations, {
      fetchImpl: provider.fetchImpl,
      sleep: async () => {},
      now: () => new Date().toISOString(),
    });
    expect(reads.flat()).toEqual(["meta"]);
  });
});
