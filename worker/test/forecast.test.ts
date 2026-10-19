import { describe, expect, it } from "vitest";

import golden from "../../tests/fixtures/golden_forecast_torre-dei-corsari.json";
import marineResponse from "../../tests/fixtures/open_meteo_marine_torre-dei-corsari.json";
import weatherResponse from "../../tests/fixtures/open_meteo_weather_torre-dei-corsari.json";
import { MARINE_SOURCE, WEATHER_SOURCE } from "../src/data_sources";
import { buildForecast } from "../src/forecast";
import type { FetchImpl } from "../src/open_meteo";

const FIXED_TIMESTAMP = "2026-10-19T09:00:00+00:00";
const TORRE = {
  name: "Torre dei Corsari",
  latitude: 39.688153,
  longitude: 8.450613,
  days: 7,
  timezone: "Europe/Rome" as const,
};

// `fetch_json` viene sostituito dalle fixture grezze committate: nessuna rete.
function fixtureFetch(): FetchImpl {
  return async (input) => {
    const url = String(input);
    if (url.startsWith(`${MARINE_SOURCE.endpoint}?`)) {
      return new Response(JSON.stringify(marineResponse));
    }
    if (url.startsWith(`${WEATHER_SOURCE.endpoint}?`)) {
      return new Response(JSON.stringify(weatherResponse));
    }
    throw new Error(`Endpoint inatteso: ${url}`);
  };
}

function expectSameKeyOrder(received: unknown, expected: unknown, path = "$"): void {
  if (Array.isArray(expected)) {
    expect(Array.isArray(received), `${path}: atteso array`).toBe(true);
    const items = received as unknown[];
    expect(items.length, `${path}: lunghezza array`).toBe(expected.length);
    expected.forEach((item, index) => {
      expectSameKeyOrder(items[index], item, `${path}[${index}]`);
    });
    return;
  }
  if (expected !== null && typeof expected === "object") {
    expect(received !== null && typeof received === "object", `${path}: atteso oggetto`).toBe(true);
    const actual = received as Record<string, unknown>;
    const expectedObject = expected as Record<string, unknown>;
    expect(Object.keys(actual), `${path}: ordine delle chiavi`).toEqual(
      Object.keys(expectedObject),
    );
    for (const [key, value] of Object.entries(expectedObject)) {
      expectSameKeyOrder(actual[key], value, `${path}.${key}`);
    }
    return;
  }
  expect(received, path).toEqual(expected);
}

describe("buildForecast — port di previsioni_mare.build_forecast (FR-6..FR-13, FR-51)", () => {
  it("riproduce il golden di torre-dei-corsari", async () => {
    const forecast = await buildForecast(
      TORRE.name,
      TORRE.latitude,
      TORRE.longitude,
      TORRE.days,
      TORRE.timezone,
      { fetchImpl: fixtureFetch(), now: () => FIXED_TIMESTAMP },
    );

    // Il job aggiunge lo slug dopo la chiamata (update_forecasts.py): qui lo si
    // fa per confrontare col golden di `GET /forecast`.
    const withSlug = {
      ...forecast,
      location: { ...forecast.location, slug: "torre-dei-corsari" },
    };

    expect(withSlug).toEqual(golden);
    expectSameKeyOrder(withSlug, golden);
  });

  it("non aggiunge lo slug alla località (lo fa il job)", async () => {
    const forecast = await buildForecast(
      TORRE.name,
      TORRE.latitude,
      TORRE.longitude,
      TORRE.days,
      TORRE.timezone,
      { fetchImpl: fixtureFetch(), now: () => FIXED_TIMESTAMP },
    );

    expect(Object.keys(forecast.location)).toEqual(["name", "latitude", "longitude"]);
    expect(Object.keys(forecast)).toEqual([
      "location",
      "cells",
      "timezone",
      "generated_at",
      "sources",
      "daily",
    ]);
  });

  it("usa i valori giornalieri ufficiali del provider, non ricalcolati", async () => {
    const forecast = await buildForecast(
      TORRE.name,
      TORRE.latitude,
      TORRE.longitude,
      TORRE.days,
      TORRE.timezone,
      { fetchImpl: fixtureFetch(), now: () => FIXED_TIMESTAMP },
    );

    const day = forecast.daily[0]!;
    const officialMin = weatherResponse.daily.temperature_2m_min[0];
    const officialMax = weatherResponse.daily.temperature_2m_max[0];

    expect(day.weather.air_temperature_min_c).toBe(officialMin);
    expect(day.weather.air_temperature_max_c).toBe(officialMax);
    // La cella meteo risolta è quella del provider, non la località richiesta.
    expect(forecast.cells.weather.latitude).toBe(weatherResponse.latitude);
    expect(forecast.cells.marine.longitude).toBe(marineResponse.longitude);
  });

  it("limita le voci a `days` e le ordina per data crescente", async () => {
    const forecast = await buildForecast(
      TORRE.name,
      TORRE.latitude,
      TORRE.longitude,
      2,
      TORRE.timezone,
      { fetchImpl: fixtureFetch(), now: () => FIXED_TIMESTAMP },
    );

    expect(forecast.daily.map((day) => day.date)).toEqual(["2026-10-19", "2026-10-20"]);
    expect(forecast.generated_at).toBe(FIXED_TIMESTAMP);
    expect(forecast.sources.sea.fetched_at).toBe(FIXED_TIMESTAMP);
    expect(forecast.sources.weather.fetched_at).toBe(FIXED_TIMESTAMP);
  });

  describe("daily incompleto (AC-9, S03 R-4)", () => {
    type Weather = typeof weatherResponse;
    const run = (weather: unknown) =>
      buildForecast(TORRE.name, TORRE.latitude, TORRE.longitude, TORRE.days, TORRE.timezone, {
        fetchImpl: async (input) =>
          String(input).startsWith(`${MARINE_SOURCE.endpoint}?`)
            ? new Response(JSON.stringify(marineResponse))
            : new Response(JSON.stringify(weather)),
        now: () => FIXED_TIMESTAMP,
      });
    const clone = (): Weather => structuredClone(weatherResponse);

    it("lancia se manca la chiave daily richiesta", async () => {
      const weather: Record<string, unknown> = clone().daily;
      delete weather["temperature_2m_max"];
      await expect(run({ ...clone(), daily: weather })).rejects.toThrow();
    });

    it("lancia se la serie è più corta di time", async () => {
      const weather = clone();
      weather.daily.weather_code = weather.daily.weather_code.slice(0, 2);
      await expect(run(weather)).rejects.toThrow();
    });

    it("un null presente resta null", async () => {
      const weather = clone();
      (weather.daily.temperature_2m_min as Array<number | null>)[0] = null;
      const forecast = await run(weather);
      expect(forecast.daily[0]!.weather.air_temperature_min_c).toBeNull();
    });
  });
});
