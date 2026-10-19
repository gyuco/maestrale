import { describe, expect, it } from "vitest";

import goldenForecast from "../../tests/fixtures/golden_forecast_torre-dei-corsari.json";
import marineResponse from "../../tests/fixtures/open_meteo_marine_torre-dei-corsari.json";
import weatherResponse from "../../tests/fixtures/open_meteo_weather_torre-dei-corsari.json";
import requestParamsFixture from "../../tests/fixtures/request_params.json";
import { MARINE_SOURCE, WEATHER_SOURCE } from "../src/data_sources";

// Confronto ricorsivo di struttura **e ordine di chiavi**: `toEqual` ignora
// l'ordine dei campi, ma il port deve emettere gli stessi oggetti, chiave e
// ordine, del codice Python (JSON serializzato identico).
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

const { latitude, longitude, days, timezone } = requestParamsFixture.case;

// Coordinate richieste della località di riferimento, come sono registrate nel golden.
const requestedCoordinates = {
  latitude: goldenForecast.location.latitude,
  longitude: goldenForecast.location.longitude,
};

describe("data_sources — port di data_sources.py", () => {
  describe("request_params (FR-3, FR-4)", () => {
    it("i parametri marine coincidono con quelli di data_sources.py", () => {
      const params = MARINE_SOURCE.requestParams(latitude, longitude, days, timezone);

      expect(params).toEqual(requestParamsFixture.marine);
      expectSameKeyOrder(params, requestParamsFixture.marine);
    });

    it("i parametri weather coincidono con quelli di data_sources.py", () => {
      const params = WEATHER_SOURCE.requestParams(latitude, longitude, days, timezone);

      expect(params).toEqual(requestParamsFixture.weather);
      expectSameKeyOrder(params, requestParamsFixture.weather);
    });

    it("le variabili orarie e giornaliere derivano dal catalogo sorgenti", () => {
      const marine = MARINE_SOURCE.requestParams(latitude, longitude, days, timezone);
      const weather = WEATHER_SOURCE.requestParams(latitude, longitude, days, timezone);

      expect(marine.hourly).toBe(MARINE_SOURCE.hourlyVariables.join(","));
      expect(marine.cell_selection).toBe("sea");
      expect(marine.daily).toBeUndefined();
      expect(weather.hourly).toBe(WEATHER_SOURCE.hourlyVariables.join(","));
      expect(weather.daily).toBe(WEATHER_SOURCE.dailyVariables.join(","));
      expect(weather.cell_selection).toBe("land");
      expect(marine.models).toBe("best_match");
      expect(weather.models).toBe("best_match");
    });
  });

  describe("provenance (FR-12)", () => {
    it("il blocco sea è deep-equal a sources.sea del golden", () => {
      const { requested_coordinates: requested, fetched_at: fetchedAt } = goldenForecast.sources.sea;
      const provenance = MARINE_SOURCE.provenance(
        marineResponse,
        requested.latitude,
        requested.longitude,
        fetchedAt,
      );

      expect(provenance).toEqual(goldenForecast.sources.sea);
      expectSameKeyOrder(provenance, goldenForecast.sources.sea);
      // Le coordinate richieste sono quelle della località, non quelle risolte.
      expect(provenance.requested_coordinates).toEqual(requestedCoordinates);
      expect(provenance.resolved_cell).not.toEqual(provenance.requested_coordinates);
    });

    it("il blocco weather è deep-equal a sources.weather del golden", () => {
      const { requested_coordinates: requested, fetched_at: fetchedAt } =
        goldenForecast.sources.weather;
      const provenance = WEATHER_SOURCE.provenance(
        weatherResponse,
        requested.latitude,
        requested.longitude,
        fetchedAt,
      );

      expect(provenance).toEqual(goldenForecast.sources.weather);
      expectSameKeyOrder(provenance, goldenForecast.sources.weather);
      expect(provenance.requested_coordinates).toEqual(requestedCoordinates);
      expect(provenance.resolved_cell).not.toEqual(provenance.requested_coordinates);
    });

    it("omette elevation_m quando la risposta non la fornisce e la mantiene se 0", () => {
      const withoutElevation = MARINE_SOURCE.provenance(
        { latitude: 39.7, longitude: 8.46 },
        39.68,
        8.45,
        "2026-10-19T09:00:00+00:00",
      );
      expect(withoutElevation.resolved_cell).toEqual({ latitude: 39.7, longitude: 8.46 });

      const withZero = MARINE_SOURCE.provenance(
        { latitude: 39.7, longitude: 8.46, elevation: 0 },
        39.68,
        8.45,
        "2026-10-19T09:00:00+00:00",
      );
      expect(withZero.resolved_cell).toEqual({ latitude: 39.7, longitude: 8.46, elevation_m: 0 });
    });

    it("usa il catalogo come unico punto delle variabili e delle licenze (FR-5)", () => {
      const provenance = MARINE_SOURCE.provenance(marineResponse, latitude, longitude, "t");

      expect(provenance.id).toBe("open_meteo_marine");
      expect(provenance.variables.hourly).toEqual([...MARINE_SOURCE.hourlyVariables]);
      expect(provenance.variables.daily).toEqual([]);
      expect(provenance.endpoint).toContain("marine-api.open-meteo.com");
      expect(provenance.license_url).toBe("https://open-meteo.com/en/terms");
      expect(provenance.attribution).toContain("Open-Meteo");
    });
  });
});
