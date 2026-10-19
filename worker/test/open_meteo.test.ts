import { describe, expect, it } from "vitest";

import requestParams from "../../tests/fixtures/request_params.json";
import requestUrls from "../../tests/fixtures/request_urls.json";
import { MARINE_SOURCE, WEATHER_SOURCE } from "../src/data_sources";
import {
  buildUrl,
  DEFAULT_RETRIES,
  fetchJson,
  mapWithConcurrency,
  MAX_CONCURRENCY,
  REQUEST_TIMEOUT_MS,
  USER_AGENT,
  type FetchImpl,
} from "../src/open_meteo";

const { latitude, longitude, days, timezone } = requestParams.case;
const marineParams = MARINE_SOURCE.requestParams(latitude, longitude, days, timezone);
const weatherParams = WEATHER_SOURCE.requestParams(latitude, longitude, days, timezone);

describe("buildUrl — query string come urlencode di Python", () => {
  it("riproduce gli URL generati da urlencode (request_urls.json)", () => {
    expect(buildUrl(MARINE_SOURCE.endpoint, marineParams)).toBe(requestUrls.marine);
    expect(buildUrl(WEATHER_SOURCE.endpoint, weatherParams)).toBe(requestUrls.weather);
  });

  it("codifica percento, virgola e spazio come quote_plus", () => {
    const url = buildUrl("https://example.test/x", {
      ...marineParams,
      hourly: "a b,c",
      models: "best_match",
    });
    expect(url).toContain("hourly=a+b%2Cc");
  });
});

describe("fetchJson — retry, errori e timeout (FR-17)", () => {
  it("ritenta con backoff esponenziale e riesce al secondo tentativo", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const fetchImpl: FetchImpl = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("boom", { status: 500 });
      }
      return new Response(JSON.stringify({ ok: true }));
    };

    const payload = await fetchJson(MARINE_SOURCE.endpoint, marineParams, {
      fetchImpl,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });

    expect(payload).toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(sleeps).toEqual([1000]);
  });

  it("esaurisce i tentativi e fallisce con l'endpoint nel messaggio", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const fetchImpl: FetchImpl = async () => {
      calls += 1;
      throw new Error("connessione rifiutata");
    };

    await expect(
      fetchJson(MARINE_SOURCE.endpoint, marineParams, {
        fetchImpl,
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      }),
    ).rejects.toThrow(/Impossibile consultare/);

    expect(calls).toBe(DEFAULT_RETRIES);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("una risposta con 'error' fallisce subito, senza retry", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const fetchImpl: FetchImpl = async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: true, reason: "Coordinate non valide" }));
    };

    await expect(
      fetchJson(MARINE_SOURCE.endpoint, marineParams, {
        fetchImpl,
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      }),
    ).rejects.toThrow("Coordinate non valide");

    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("invia lo User-Agent e un signal di timeout", async () => {
    let captured: RequestInit | undefined;
    const fetchImpl: FetchImpl = async (_input, init) => {
      captured = init;
      return new Response(JSON.stringify({}));
    };

    await fetchJson(MARINE_SOURCE.endpoint, marineParams, { fetchImpl });

    expect(new Headers(captured?.headers).get("User-Agent")).toBe(USER_AGENT);
    expect(captured?.signal).toBeInstanceOf(AbortSignal);
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);
  });

  it("interrompe una risposta che non arriva entro il timeout", async () => {
    const fetchImpl: FetchImpl = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "TimeoutError"));
        });
      });

    await expect(
      fetchJson(MARINE_SOURCE.endpoint, marineParams, { fetchImpl, timeoutMs: 5, retries: 1 }),
    ).rejects.toThrow();
  });
});

describe("mapWithConcurrency — limite di connessioni simultanee", () => {
  it("non supera mai MAX_CONCURRENCY e preserva l'ordine", async () => {
    expect(MAX_CONCURRENCY).toBe(6);
    const items = Array.from({ length: 30 }, (_value, index) => index);
    let active = 0;
    let peak = 0;

    const results = await mapWithConcurrency(items, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return item * 2;
    });

    expect(results).toEqual(items.map((item) => item * 2));
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENCY);
    expect(peak).toBe(MAX_CONCURRENCY);
  });
});
