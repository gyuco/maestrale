import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import locations from "../../locations.json";
import { createApp } from "../src/index";
import type { HistoryRow } from "../src/history";
import { writeHistory } from "../src/history_store";
import { syntheticCatalog } from "./helpers/provider";

const BASE = "https://example.com/history";
const Q = "from=2026-10-14&to=2026-10-20";

function row(slug: string, date: string, over: Partial<HistoryRow> = {}): HistoryRow {
  return {
    location_slug: slug,
    date,
    air_temperature_mean_c: 21.3,
    air_temperature_min_c: 17,
    air_temperature_max_c: 25.1,
    water_temperature_mean_c: 22.4,
    state: "Poco mosso",
    wave_height_mean_m: 0.42,
    wave_height_max_m: 0.61,
    ...over,
  };
}

const throwing = new Proxy(
  {},
  {
    get() {
      throw new Error("binding non ammesso");
    },
  },
);

beforeEach(async () => {
  await env.HISTORY.prepare("DELETE FROM daily_history").run();
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function get(url: string, bindings: Record<string, unknown> = env as never, init?: RequestInit) {
  return createApp().request(url, init, bindings);
}

describe("GET /history day", () => {
  it("AC-1: 200 con involucro, nome e slug equivalenti, ordine crescente", async () => {
    await writeHistory(
      env.HISTORY,
      [
        row("torre-dei-corsari", "2026-10-16", { air_temperature_mean_c: 20 }),
        row("torre-dei-corsari", "2026-10-14"),
      ],
      100,
    );
    const byName = await get(`${BASE}?localita=Torre%20dei%20Corsari&${Q}`);
    const bySlug = await get(`${BASE}?localita=torre-dei-corsari&${Q}&granularity=day`);
    expect(byName.status).toBe(200);
    const body = await byName.json();
    expect(body).toEqual({
      schema_version: 1,
      location: { slug: "torre-dei-corsari", name: "Torre dei Corsari" },
      granularity: "day",
      from: "2026-10-14",
      to: "2026-10-20",
      timezone: "Europe/Rome",
      items: [
        {
          date: "2026-10-14",
          air_temperature_mean_c: 21.3,
          air_temperature_min_c: 17,
          air_temperature_max_c: 25.1,
          water_temperature_mean_c: 22.4,
          state: "Poco mosso",
          wave_height_mean_m: 0.42,
          wave_height_max_m: 0.61,
        },
        {
          date: "2026-10-16",
          air_temperature_mean_c: 20,
          air_temperature_min_c: 17,
          air_temperature_max_c: 25.1,
          water_temperature_mean_c: 22.4,
          state: "Poco mosso",
          wave_height_mean_m: 0.42,
          wave_height_max_m: 0.61,
        },
      ],
    });
    expect(await bySlug.json()).toEqual(body);
  });

  it("AC-1: Cagliari per nome", async () => {
    const response = await get(`${BASE}?localita=Cagliari&${Q}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ location: { slug: "cagliari", name: "Cagliari" } });
  });

  it("AC-2: estremi inclusi, nessun riempimento, altre località e date fuori escluse", async () => {
    await writeHistory(
      env.HISTORY,
      [
        row("cagliari", "2026-10-14"),
        row("cagliari", "2026-10-20"),
        row("cagliari", "2026-10-13"),
        row("cagliari", "2026-10-21"),
        row("alghero", "2026-10-15"),
      ],
      100,
    );
    const body = (await (await get(`${BASE}?localita=cagliari&${Q}`)).json()) as { items: { date: string }[] };
    expect(body.items.map((item) => item.date)).toEqual(["2026-10-14", "2026-10-20"]);
  });

  it("AC-3: nessun record -> 200 con items vuoto", async () => {
    const response = await get(`${BASE}?localita=cagliari&${Q}`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { items: unknown[] }).items).toEqual([]);
  });

  it("AC-4: null restano null", async () => {
    await writeHistory(
      env.HISTORY,
      [row("cagliari", "2026-10-14", { state: null, wave_height_max_m: null, air_temperature_min_c: null })],
      100,
    );
    const body = (await (await get(`${BASE}?localita=cagliari&${Q}`)).json()) as { items: Record<string, unknown>[] };
    expect(body.items[0]).toMatchObject({ state: null, wave_height_max_m: null, air_temperature_min_c: null });
    expect(Object.keys(body.items[0]!)).toHaveLength(8);
  });
});

describe("GET /history errori", () => {
  it.each([
    ["localita assente", `${BASE}?${Q}`],
    ["localita vuota", `${BASE}?localita=&${Q}`],
    ["granularity=week", `${BASE}?localita=cagliari&${Q}&granularity=week`],
    ["from assente", `${BASE}?localita=cagliari&to=2026-10-20`],
    ["to assente", `${BASE}?localita=cagliari&from=2026-10-14`],
    ["from=2026-13-01", `${BASE}?localita=cagliari&from=2026-13-01&to=2026-10-20`],
    ["from=2026-02-30", `${BASE}?localita=cagliari&from=2026-02-30&to=2026-10-20`],
    ["from=26-10-14", `${BASE}?localita=cagliari&from=26-10-14&to=2026-10-20`],
    ["from>to", `${BASE}?localita=cagliari&from=2026-10-21&to=2026-10-20`],
    ["367 giorni", `${BASE}?localita=cagliari&from=2027-12-31&to=2028-12-31`],
    ["121 mesi", `${BASE}?localita=cagliari&granularity=month&from=2016-12-31&to=2026-12-01`],
  ])("AC-5: 422 %s", async (_name, url) => {
    const response = await get(url);
    expect(response.status).toBe(422);
    const body = (await response.json()) as { detail: unknown };
    expect(typeof body.detail).toBe("string");
    expect((body.detail as string).length).toBeGreaterThan(0);
  });

  it("AC-5: 366 giorni e to nel futuro sono accettati", async () => {
    expect((await get(`${BASE}?localita=cagliari&from=2027-12-31&to=2028-12-30`)).status).toBe(200);
    expect((await get(`${BASE}?localita=cagliari&from=2999-01-01&to=2999-01-31`)).status).toBe(200);
  });

  it("AC-6: 404 con elenco (primi 50 nomi ordinati), senza toccare KV né D1", async () => {
    const bindings = { FORECASTS: throwing, HISTORY: throwing };
    const response = await get(`${BASE}?localita=Atlantide&${Q}`, bindings);
    expect(response.status).toBe(404);
    const names = locations.map((item) => item.name).sort().slice(0, 50);
    expect(await response.json()).toEqual({
      detail: { message: "Localita 'Atlantide' non trovata", available: names },
    });
  });

  it("AC-6: catalogo di 3 voci -> elenco completo", async () => {
    const catalog = syntheticCatalog(3);
    const response = await createApp(catalog).request(`${BASE}?localita=Atlantide&${Q}`, undefined, {
      FORECASTS: throwing,
      HISTORY: throwing,
    } as never);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { detail: { available: string[] } }).detail.available).toEqual(
      catalog.map((item) => item.name),
    );
  });

  it("AC-7: 503 con binding assente, tabella inesistente o query fallita; errore solo in console.error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const url = `${BASE}?localita=cagliari&${Q}`;
    const failing = {
      prepare: () => {
        throw new Error("SELECT secret FROM daily_history boom");
      },
    };
    const noTable = {
      prepare: () => ({
        bind: () => ({
          all: async () => {
            throw new Error("D1_ERROR: no such table: daily_history");
          },
        }),
      }),
    };
    const expected = ["Binding D1 HISTORY", "boom", "no such table"];
    let index = 0;
    for (const history of [undefined, failing, noTable]) {
      const response = await get(url, { FORECASTS: throwing, HISTORY: history });
      expect(response.status).toBe(503);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({ detail: "Storico temporaneamente non disponibile" });
      expect(text).not.toMatch(/SELECT|daily_history|boom/);
      expect(String(error.mock.calls[index]![0])).toContain(expected[index]);
      index += 1;
    }
    expect(error).toHaveBeenCalledTimes(3);
  });

  it("S04 AC-8/R-2: month valido con HISTORY che lancia -> 503 (non più 501), niente Cache-Control", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await get(`${BASE}?localita=cagliari&${Q}&granularity=month`, {
      FORECASTS: throwing,
      HISTORY: throwing,
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ detail: "Storico temporaneamente non disponibile" });
    expect(response.headers.get("cache-control")).toBeNull();
  });

  it("R-2: ordine delle fasi, 422 prima di 404 prima di D1", async () => {
    const bindings = { FORECASTS: throwing, HISTORY: throwing };
    const invalid = await get(`${BASE}?localita=Atlantide&from=2026-13-01&to=2026-10-20`, bindings);
    expect(invalid.status).toBe(422);
    expect(invalid.headers.get("cache-control")).toBeNull();
    const month = await get(`${BASE}?localita=Atlantide&${Q}&granularity=month`, bindings);
    expect(month.status).toBe(404);
    expect(month.headers.get("cache-control")).toBeNull();
    const day = await get(`${BASE}?localita=Atlantide&${Q}`, bindings);
    expect(day.status).toBe(404);
    expect(day.headers.get("cache-control")).toBeNull();
  });
});

describe("GET /history metodi, CORS, isolamento", () => {
  it("AC-8: HEAD ha stessi status e header di GET, senza corpo", async () => {
    const url = `${BASE}?localita=cagliari&${Q}`;
    const getResponse = await get(url);
    const head = await get(url, env as never, { method: "HEAD" });
    expect(head.status).toBe(getResponse.status);
    expect(head.headers.get("content-type")).toBe(getResponse.headers.get("content-type"));
    expect(await head.text()).toBe("");
  });

  it("AC-8: CORS e preflight come le altre route", async () => {
    const url = `${BASE}?localita=cagliari&${Q}`;
    const response = await get(url, env as never, { headers: { Origin: "https://app.example" } });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const restricted = await get(url, { ...env, CORS_ORIGINS: "https://ok.example" } as never, {
      headers: { Origin: "https://evil.example" },
    });
    expect(restricted.headers.get("access-control-allow-origin")).toBeNull();
    const preflight = await get(url, env as never, {
      method: "OPTIONS",
      headers: { Origin: "https://app.example", "Access-Control-Request-Method": "GET" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toBe("GET");
  });

  it("AC-8: POST/PUT/DELETE non esistono e non scrivono", async () => {
    await writeHistory(env.HISTORY, [row("cagliari", "2026-10-14")], 100);
    for (const method of ["POST", "PUT", "DELETE"]) {
      const response = await get(`${BASE}?localita=cagliari&${Q}`, env as never, { method });
      expect([404, 405]).toContain(response.status);
    }
    const count = await env.HISTORY.prepare("SELECT COUNT(*) AS n FROM daily_history").first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("FR-80: nessuna lettura KV né chiamata fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await get(`${BASE}?localita=cagliari&${Q}`, { HISTORY: env.HISTORY, FORECASTS: throwing });
    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("GET /history Cache-Control (S04 AC-7, AC-8)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function at(iso: string): void {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
  }

  it.each([
    ["oggi", "2026-10-20", "public, max-age=900"],
    ["domani", "2026-10-21", "public, max-age=900"],
    ["ieri", "2026-10-19", "public, max-age=86400"],
  ])("to = %s (day e month)", async (_name, to, expected) => {
    at("2026-10-20T10:00:00Z");
    for (const granularity of ["day", "month"]) {
      const response = await get(`${BASE}?localita=cagliari&from=2026-10-01&to=${to}&granularity=${granularity}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe(expected);
    }
  });

  it("a cavallo della mezzanotte locale: 22:30 UTC con ora legale, oggi Roma è già il giorno dopo", async () => {
    at("2026-07-15T22:30:00Z"); // 00:30 del 2026-07-16 a Roma (CEST)
    const today = await get(`${BASE}?localita=cagliari&from=2026-07-01&to=2026-07-16`);
    expect(today.headers.get("cache-control")).toBe("public, max-age=900");
    const yesterday = await get(`${BASE}?localita=cagliari&from=2026-07-01&to=2026-07-15`);
    expect(yesterday.headers.get("cache-control")).toBe("public, max-age=86400");
  });

  it("durate configurabili da variabili d'ambiente; non valide -> default", async () => {
    at("2026-10-20T10:00:00Z");
    const custom = { ...env, HISTORY_MAX_AGE_SHORT_SECONDS: "60", HISTORY_MAX_AGE_LONG_SECONDS: "3600" };
    const shortR = await get(`${BASE}?localita=cagliari&from=2026-10-01&to=2026-10-20`, custom as never);
    const longR = await get(`${BASE}?localita=cagliari&from=2026-10-01&to=2026-10-19`, custom as never);
    expect(shortR.headers.get("cache-control")).toBe("public, max-age=60");
    expect(longR.headers.get("cache-control")).toBe("public, max-age=3600");
    const bad = { ...env, HISTORY_MAX_AGE_SHORT_SECONDS: "abc", HISTORY_MAX_AGE_LONG_SECONDS: "-5" };
    const badShort = await get(`${BASE}?localita=cagliari&from=2026-10-01&to=2026-10-20`, bad as never);
    const badLong = await get(`${BASE}?localita=cagliari&from=2026-10-01&to=2026-10-19`, bad as never);
    expect(badShort.headers.get("cache-control")).toBe("public, max-age=900");
    expect(badLong.headers.get("cache-control")).toBe("public, max-age=86400");
  });

  it("HEAD 200 ha lo stesso Cache-Control di GET; errori 404/422/503 senza Cache-Control", async () => {
    at("2026-10-20T10:00:00Z");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const url = `${BASE}?localita=cagliari&from=2026-10-01&to=2026-10-19&granularity=month`;
    const getResponse = await get(url);
    const head = await get(url, env as never, { method: "HEAD" });
    expect(head.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(head.headers.get("cache-control")).toBe(getResponse.headers.get("cache-control"));
    for (const target of [
      `${BASE}?localita=Atlantide&${Q}`,
      `${BASE}?localita=cagliari&from=bad&to=2026-10-20`,
    ]) {
      expect((await get(target)).headers.get("cache-control")).toBeNull();
    }
    const unavailable = await get(url, { HISTORY: undefined, FORECASTS: throwing });
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("cache-control")).toBeNull();
  });
});
