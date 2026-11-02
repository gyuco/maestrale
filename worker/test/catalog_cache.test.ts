import { describe, expect, it, beforeEach } from "vitest";

import {
  CATALOG_CACHE_KEY,
  getCatalog,
  LOCATIONS_SCHEMA_VERSION,
  resetCatalogMemo,
} from "../src/catalog";
import { createApp } from "../src/index";

const locations = [
  { slug: "alghero", name: "Alghero", latitude: 40.56, longitude: 8.26 },
  { slug: "chia", name: "Chia", latitude: 38.89, longitude: 8.88 },
];

function kv(value: string | null, options: { fail?: boolean } = {}) {
  const stats = { gets: 0, puts: 0 };
  const namespace = {
    get: async () => {
      stats.gets += 1;
      if (options.fail) throw new Error("KV non leggibile");
      return value;
    },
    put: async () => {
      stats.puts += 1;
    },
  } as unknown as KVNamespace;
  return { namespace, stats };
}

function db(options: { rows?: typeof locations; version?: number; fail?: boolean } = {}) {
  const stats = { queries: 0 };
  const database = {
    prepare: () => ({
      all: async () => {
        stats.queries += 1;
        if (options.fail) throw new Error("D1 non leggibile");
        return { results: options.rows ?? locations };
      },
      first: async () => {
        stats.queries += 1;
        if (options.fail) throw new Error("D1 non leggibile");
        return { version: options.version ?? 7 };
      },
    }),
  } as unknown as D1Database;
  return { database, stats };
}

function env(kvNamespace: KVNamespace, database: D1Database) {
  return { FORECASTS: kvNamespace, CORE: database } as never;
}

const cached = JSON.stringify({
  schema_version: LOCATIONS_SCHEMA_VERSION,
  catalog_version: 7,
  etag: "0123456789abcdef",
  locations,
});

beforeEach(() => resetCatalogMemo());

describe("getCatalog (ADR-0006, NFR-33, FR-120)", () => {
  it("legge dalla cache KV senza interrogare il database", async () => {
    const cache = kv(cached);
    const database = db({ fail: true });

    const result = await getCatalog(env(cache.namespace, database.database));

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.snapshot.locations).toEqual(locations);
    expect(result.snapshot.catalogVersion).toBe(7);
    expect(database.stats.queries).toBe(0);
  });

  it("su miss ricostruisce da D1 (solo attive) e scrive la cache", async () => {
    const cache = kv(null);
    const database = db();

    const result = await getCatalog(env(cache.namespace, database.database));

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.snapshot.locations).toHaveLength(2);
    expect(result.snapshot.catalogVersion).toBe(7);
    expect(cache.stats.puts).toBe(1);
  });

  it("usa D1 anche quando la KV è illeggibile (FR-120)", async () => {
    const cache = kv(null, { fail: true });
    const database = db();

    const result = await getCatalog(env(cache.namespace, database.database));

    expect(result.status).toBe("ok");
  });

  it("risponde unavailable se cache e database non sono leggibili (FR-120)", async () => {
    const cache = kv(null, { fail: true });
    const database = db({ fail: true });

    const result = await getCatalog(env(cache.namespace, database.database));

    expect(result.status).toBe("unavailable");
  });

  it("memoizza per isolate entro il TTL (NFR-19)", async () => {
    const cache = kv(cached);
    const database = db();
    let now = 1_000;

    await getCatalog(env(cache.namespace, database.database), () => now);
    await getCatalog(env(cache.namespace, database.database), () => now + 29_000);
    expect(cache.stats.gets).toBe(1);

    await getCatalog(env(cache.namespace, database.database), () => now + 31_000);
    expect(cache.stats.gets).toBe(2);
  });
});

describe("API con catalogo non disponibile (FR-120)", () => {
  const broken = { FORECASTS: kv(null, { fail: true }).namespace, CORE: db({ fail: true }).database };

  it("GET /locations risponde 503", async () => {
    resetCatalogMemo();
    const response = await createApp().request("https://example.com/locations", {}, broken as never);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ detail: "Catalogo temporaneamente non disponibile" });
  });

  it("GET /forecast risponde 503", async () => {
    resetCatalogMemo();
    const response = await createApp().request(
      "https://example.com/forecast?localita=alghero",
      {},
      broken as never,
    );
    expect(response.status).toBe(503);
  });

  it("GET /history risponde 503", async () => {
    resetCatalogMemo();
    const response = await createApp().request(
      "https://example.com/history?localita=alghero&from=2026-10-14&to=2026-10-20",
      {},
      broken as never,
    );
    expect(response.status).toBe(503);
  });
});
