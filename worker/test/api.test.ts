import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import goldenTorre from "../../tests/fixtures/golden_forecast_torre-dei-corsari.json";
import goldenForecasts from "../../tests/fixtures/golden_forecasts.json";
import { createApp } from "../src/index";
import { CACHE_KEY } from "../src/store";

const HOUR_MS = 3_600_000;

/** Copia del golden con un `generated_at` scelto dal test (evita di dipendere dall'orologio). */
function goldenAt(iso: string): unknown {
  return { ...goldenForecasts, generated_at: iso };
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR_MS).toISOString();
}

async function seed(payload: unknown): Promise<void> {
  await env.FORECASTS.put(CACHE_KEY, JSON.stringify(payload));
}

interface HealthBody {
  status: string;
  error?: string;
  cache_path?: string;
  generated_at?: string | null;
  age_hours?: number | null;
  stale?: boolean;
  locations?: number;
  update_errors?: Record<string, string>;
}

interface ForecastErrorBody {
  detail: string | { message: string; available: string[] };
}

async function getHealth(): Promise<HealthBody> {
  const response = await SELF.fetch("https://example.com/health");
  expect(response.status).toBe(200);
  return (await response.json()) as HealthBody;
}

beforeEach(async () => {
  await env.FORECASTS.delete(CACHE_KEY);
});

describe("GET /health (FR-26, FR-28)", () => {
  it("con cache valida e fresca risponde ok e conta le località", async () => {
    await seed(goldenAt(hoursAgo(1)));

    const body = await getHealth();

    expect(body.status).toBe("ok");
    expect(body.locations).toBe(2);
    expect(body.stale).toBe(false);
    expect(body.age_hours).toBe(1);
    expect(body.update_errors).toEqual({});
  });

  it("il golden esatto è leggibile e riporta i campi del cache", async () => {
    await seed(goldenForecasts);

    const body = await getHealth();

    expect(body.locations).toBe(2);
    expect(body.generated_at).toBe(goldenForecasts.generated_at);
    expect(body.update_errors).toEqual({});
  });

  it("oltre la soglia (13 h) è degraded, stale e arrotonda age_hours", async () => {
    await seed(goldenAt(hoursAgo(13)));

    const body = await getHealth();

    expect(body.status).toBe("degraded");
    expect(body.stale).toBe(true);
    expect(body.age_hours).toBe(13);
  });

  it("rispetta una soglia configurabile via env (FORECAST_MAX_AGE_HOURS)", async () => {
    await seed(goldenAt(hoursAgo(3)));

    const response = await createApp().request(
      "/health",
      {},
      { FORECASTS: env.FORECASTS, FORECAST_MAX_AGE_HOURS: "2" },
    );
    const body = (await response.json()) as HealthBody;

    expect(body.status).toBe("degraded");
    expect(body.stale).toBe(true);
  });

  it("con errors non vuoto è degraded e li riporta in update_errors", async () => {
    await seed({ ...goldenForecasts, generated_at: hoursAgo(0), errors: { cagliari: "boom" } });

    const body = await getHealth();

    expect(body.status).toBe("degraded");
    expect(body.update_errors).toEqual({ cagliari: "boom" });
  });

  it("se generated_at manca è degraded con age_hours null", async () => {
    await seed({ ...goldenForecasts, generated_at: null });

    const body = await getHealth();

    expect(body.status).toBe("degraded");
    expect(body.stale).toBe(true);
    expect(body.age_hours).toBeNull();
  });

  it("con cache assente è degraded con errore e locations 0", async () => {
    const body = await getHealth();

    expect(body.status).toBe("degraded");
    expect(body.error).toBe("Cache forecast non ancora generato");
    expect(body.locations).toBe(0);
    expect(body.cache_path).toBe("kv:FORECASTS");
  });

  it("con cache illeggibile è degraded con descrizione dell'errore", async () => {
    await env.FORECASTS.put(CACHE_KEY, "{ non è JSON");

    const body = await getHealth();

    expect(body.status).toBe("degraded");
    expect(body.error).toMatch(/^Cache forecast non leggibile: /);
    expect(body.cache_path).toBe("kv:FORECASTS");
  });
});

describe("GET /forecast (FR-22, FR-23, FR-24, FR-25)", () => {
  it("per nome restituisce il corpo esatto del backend Python", async () => {
    await seed(goldenForecasts);

    const response = await SELF.fetch(
      `https://example.com/forecast?localita=${encodeURIComponent("Torre dei Corsari")}`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(goldenTorre);
  });

  it("per slug esatto restituisce la stessa previsione", async () => {
    await seed(goldenForecasts);

    const response = await SELF.fetch("https://example.com/forecast?localita=torre-dei-corsari");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(goldenTorre);
  });

  it("il nome è normalizzato (maiuscole e spazi) prima della ricerca", async () => {
    await seed(goldenForecasts);

    const response = await SELF.fetch("https://example.com/forecast?localita=CAGLIARI");
    const body = (await response.json()) as { location: { slug: string } };

    expect(response.status).toBe(200);
    expect(body.location.slug).toBe("cagliari");
  });

  it("trova la località confrontando lo slug del nome quando la chiave differisce", async () => {
    await seed({
      schema_version: 1,
      generated_at: hoursAgo(0),
      errors: {},
      locations: {
        "sant-antioco": { location: { name: "Sant'Antioco" } },
      },
    });

    const response = await SELF.fetch(
      `https://example.com/forecast?localita=${encodeURIComponent("Sant'Antioco")}`,
    );

    expect(response.status).toBe(200);
  });

  it("località inesistente: 404 con available ordinato", async () => {
    await seed({
      schema_version: 1,
      generated_at: hoursAgo(0),
      errors: {},
      locations: {
        zeta: { location: { name: "Zeta" } },
        alfa: { location: { name: "Alfa" } },
        mare: { location: { name: "Mare" } },
      },
    });

    const response = await SELF.fetch("https://example.com/forecast?localita=Atlantide");
    const body = (await response.json()) as ForecastErrorBody;

    expect(response.status).toBe(404);
    expect(body.detail).toEqual({
      message: "Localita 'Atlantide' non trovata",
      available: ["Alfa", "Mare", "Zeta"],
    });
  });

  it("cache assente: 503 con dettaglio di previsioni non disponibili", async () => {
    const response = await SELF.fetch("https://example.com/forecast?localita=Cagliari");
    const body = (await response.json()) as ForecastErrorBody;

    expect(response.status).toBe(503);
    expect(body.detail).toBe("Previsioni non ancora disponibili");
  });

  it("cache invalida: 503 con descrizione dell'errore", async () => {
    await env.FORECASTS.put(CACHE_KEY, "non-json");

    const response = await SELF.fetch("https://example.com/forecast?localita=Cagliari");
    const body = (await response.json()) as ForecastErrorBody;

    expect(response.status).toBe(503);
    expect(body.detail).toMatch(/^Cache forecast non leggibile: /);
  });

  it("localita assente o vuoto: 422 con detail (FR-25)", async () => {
    const missing = await SELF.fetch("https://example.com/forecast");
    const empty = await SELF.fetch("https://example.com/forecast?localita=");

    expect(missing.status).toBe(422);
    expect(empty.status).toBe(422);
    expect((await missing.json()) as ForecastErrorBody).toHaveProperty("detail");
    expect((await empty.json()) as ForecastErrorBody).toHaveProperty("detail");
  });
});

describe("CORS (FR-28)", () => {
  it("con CORS_ORIGINS di default consente ogni origine", async () => {
    const response = await SELF.fetch("https://example.com/health", {
      headers: { origin: "https://qualsiasi.example" },
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("riflette l'origine consentita configurata via env", async () => {
    const response = await createApp().request(
      "/health",
      { headers: { origin: "https://app.example" } },
      { FORECASTS: env.FORECASTS, CORS_ORIGINS: "https://app.example, https://admin.example" },
    );

    expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example");
  });

  it("non consente un'origine fuori lista", async () => {
    const response = await createApp().request(
      "/health",
      { headers: { origin: "https://altro.example" } },
      { FORECASTS: env.FORECASTS, CORS_ORIGINS: "https://app.example" },
    );

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});
