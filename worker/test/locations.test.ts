import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import locations from "../../locations.json";
import { createApp } from "../src/index";
import { syntheticCatalog } from "./helpers/provider";

interface LocationsBody {
  schema_version: number;
  version: string;
  count: number;
  locations: { slug: string; name: string; latitude: number; longitude: number }[];
}

const URL_LOCATIONS = "https://example.com/locations";

describe("GET /locations (FR-62..FR-64, ADR-0004)", () => {
  it("risponde 200 con tutte le località e i quattro campi, ordinate per name", async () => {
    const response = await SELF.fetch(URL_LOCATIONS);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as LocationsBody;
    expect(body.schema_version).toBe(1);
    expect(body.count).toBe(locations.length);
    expect(body.locations).toHaveLength(locations.length);
    const names = body.locations.map((item) => item.name);
    expect(names).toEqual([...names].sort());
    for (const item of body.locations) {
      expect(Object.keys(item).sort()).toEqual(["latitude", "longitude", "name", "slug"]);
    }
    const alghero = body.locations.find((item) => item.slug === "alghero");
    expect(alghero).toEqual({ slug: "alghero", name: "Alghero", latitude: 40.56, longitude: 8.26 });
    expect(response.headers.get("etag")).toBe(`"${body.version}"`);
  });

  it("emette Cache-Control pubblico di 24 h per default", async () => {
    const response = await SELF.fetch(URL_LOCATIONS);

    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
  });

  it("usa LOCATIONS_MAX_AGE_SECONDS se valido, altrimenti il default", async () => {
    const app = createApp();
    const custom = await app.request(URL_LOCATIONS, {}, { LOCATIONS_MAX_AGE_SECONDS: "600" });
    const invalid = await app.request(URL_LOCATIONS, {}, { LOCATIONS_MAX_AGE_SECONDS: "abc" });

    expect(custom.headers.get("cache-control")).toBe("public, max-age=600");
    expect(invalid.headers.get("cache-control")).toBe("public, max-age=86400");
  });

  it("applica CORS come le altre route e espone ETag", async () => {
    const response = await SELF.fetch(URL_LOCATIONS, { headers: { Origin: "https://app.example" } });

    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-expose-headers")).toBe("ETag");
  });

  it("rispetta CORS_ORIGINS", async () => {
    const app = createApp();
    const env = { CORS_ORIGINS: "https://ok.example" };
    const allowed = await app.request(URL_LOCATIONS, { headers: { Origin: "https://ok.example" } }, env);
    const denied = await app.request(URL_LOCATIONS, { headers: { Origin: "https://no.example" } }, env);

    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://ok.example");
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("risponde alla preflight OPTIONS", async () => {
    const response = await SELF.fetch(URL_LOCATIONS, {
      method: "OPTIONS",
      headers: { Origin: "https://app.example", "Access-Control-Request-Method": "GET" },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("risponde 304 senza corpo a If-None-Match uguale all'ETag, con ETag e Cache-Control", async () => {
    const first = await SELF.fetch(URL_LOCATIONS);
    const etag = first.headers.get("etag") as string;

    const second = await SELF.fetch(URL_LOCATIONS, { headers: { "If-None-Match": etag } });

    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    expect(second.headers.get("etag")).toBe(etag);
    expect(second.headers.get("cache-control")).toBe("public, max-age=86400");
  });

  it("accetta If-None-Match in lista, con prefisso W/ e con *", async () => {
    const etag = (await SELF.fetch(URL_LOCATIONS)).headers.get("etag") as string;
    for (const header of [`"zzz", ${etag}`, `W/${etag}`, "*"]) {
      const response = await SELF.fetch(URL_LOCATIONS, { headers: { "If-None-Match": header } });
      expect(response.status, header).toBe(304);
    }
  });

  it("risponde 200 con un If-None-Match diverso", async () => {
    const response = await SELF.fetch(URL_LOCATIONS, { headers: { "If-None-Match": '"altro"' } });

    expect(response.status).toBe(200);
  });

  it("HEAD ha gli stessi header del GET e nessun corpo", async () => {
    const get = await SELF.fetch(URL_LOCATIONS);
    const head = await SELF.fetch(URL_LOCATIONS, { method: "HEAD" });

    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(get.headers.get("etag"));
    expect(head.headers.get("cache-control")).toBe(get.headers.get("cache-control"));
  });

  it("non ammette metodi di scrittura (NFR-11)", async () => {
    const response = await SELF.fetch(URL_LOCATIONS, { method: "POST", body: "{}" });

    expect(response.status).toBe(404);
  });

  it("con 500 località sintetiche risponde 200 sotto 100 KB", async () => {
    const response = await createApp(syntheticCatalog(500)).request(URL_LOCATIONS, {}, {});

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(new TextEncoder().encode(text).length).toBeLessThan(100_000);
    expect((JSON.parse(text) as LocationsBody).count).toBe(500);
  });

  it("con catalogo invalido risponde 500 con detail", async () => {
    const response = await createApp([{ slug: "a", name: "A" }] as never).request(URL_LOCATIONS, {}, {});

    expect(response.status).toBe(500);
    const body = (await response.json()) as { detail: string };
    expect(body.detail).toContain("campi mancanti");
  });

  it("non tocca /forecast e /health: restano 200/404 come prima", async () => {
    const health = await SELF.fetch("https://example.com/health");
    const forecast = await SELF.fetch("https://example.com/forecast");

    expect(health.status).toBe(200);
    expect(forecast.status).toBe(422);
  });
});
