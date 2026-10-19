import { describe, expect, it } from "vitest";

import goldenCache from "../../tests/fixtures/golden_forecasts.json";
import goldenForecast from "../../tests/fixtures/golden_forecast_torre-dei-corsari.json";
import type {
  Forecast,
  ForecastCache,
  SeaAggregate,
  WeatherAggregate,
  WeatherCell,
} from "../src/types";

// I tipi sono derivati da `tests/fixtures/forecast.schema.json`: qui il golden
// del contratto viene *assegnato* ai tipi. Il controllo vero lo fa
// `npm run typecheck`; gli assert sotto danno il segnale a runtime.
//
// I moduli JSON hanno tipi allargati (`timezone: string`, `schema_version:
// number`), quindi per confrontare il golden col contratto si allarga allo
// stesso modo il tipo atteso: nomi di campo, struttura, opzionalità e
// nullabilità restano verificati dal compilatore, mentre i campi `const` dello
// schema sono controllati dai test a runtime.
type Widened<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends readonly (infer Item)[]
        ? Widened<Item>[]
        : T extends object
          ? { [Key in keyof T]: Widened<T[Key]> }
          : T;

describe("tipi del payload congelato (forecast.schema.json)", () => {
  it("il golden di /forecast è assegnabile a Forecast", () => {
    const forecast: Widened<Forecast> = goldenForecast;
    const days: Widened<Forecast["daily"]> = goldenForecast.daily;
    const sea: Widened<SeaAggregate> = goldenForecast.daily[0]!.sea;
    const weather: Widened<WeatherAggregate> = goldenForecast.daily[0]!.weather;

    // Le costanti dello schema, verificate sul valore grezzo (non allargato).
    expect(goldenForecast.timezone).toBe("Europe/Rome");
    expect(forecast.location.slug).toBe("torre-dei-corsari");
    expect(days).toHaveLength(7);
    expect(days[0]?.date).toBe("2026-10-19");
    expect(sea.wave_height_mean_m).toBeTypeOf("number");
    expect(weather.weather_code).toBe(3);
    expect(forecast.sources.sea.id).toBe("open_meteo_marine");
    expect(forecast.sources.weather.id).toBe("open_meteo_weather");
    expect(forecast.cells.weather.elevation_m).toBe(0);
  });

  it("il golden del cache è assegnabile a ForecastCache", () => {
    const cache: Widened<ForecastCache> = goldenCache;
    const forecast: Widened<Forecast> = cache.locations["torre-dei-corsari"]!;

    expect(goldenCache.schema_version).toBe(1);
    expect(cache.updated_locations).toEqual(["cagliari", "torre-dei-corsari"]);
    expect(Object.keys(cache.locations)).toEqual(["cagliari", "torre-dei-corsari"]);
    expect(cache.errors).toEqual({});
    expect(forecast.generated_at).toBe(cache.generated_at);
  });

  it("accetta null dove lo schema lo ammette", () => {
    const sea: SeaAggregate = {
      state: null,
      wave_height_mean_m: null,
      wave_height_max_m: null,
      wave_period_mean_s: null,
      wave_direction_mean_deg: null,
      wave_direction_name: null,
      water_temperature_mean_c: null,
    };
    const weather: WeatherAggregate = {
      air_temperature_mean_c: null,
      air_temperature_min_c: null,
      air_temperature_max_c: null,
      weather_code: null,
      wind_speed_mean_kmh: null,
      wind_speed_max_kmh: null,
      wind_gust_mean_kmh: null,
      wind_gust_max_kmh: null,
      wind_direction_mean_deg: null,
      wind_name: null,
    };
    const cell: WeatherCell = { latitude: 39.7, longitude: 8.47, elevation_m: null };

    expect([sea.state, weather.weather_code, weather.wind_name]).toEqual([null, null, null]);
    expect(cell.elevation_m).toBeNull();
  });

  it("rifiuta i valori fuori contratto (asserzioni di compilazione)", () => {
    // Literal puro (non uno spread di tipi allargati): il solo errore atteso è
    // `schema_version: 2`, così la costante è davvero vincolata.
    const wrongVersion: ForecastCache = {
      // @ts-expect-error — `schema_version` è la costante 1.
      schema_version: 2,
      generated_at: "",
      updated_locations: [],
      errors: {},
      locations: {},
    };
    // @ts-expect-error — `timezone` è la costante "Europe/Rome".
    const wrongTimezone: Forecast = { ...goldenForecast, timezone: "Europe/London" };
    // @ts-expect-error — la cella meteo richiede `elevation_m` (number | null).
    const missingElevation: WeatherCell = { latitude: 1, longitude: 2 };
    // @ts-expect-error — `weather_code` è `number | null`, non `undefined`.
    const undefinedWeatherCode: WeatherAggregate = { ...goldenForecast.daily[0]!.weather, weather_code: undefined };
    // @ts-expect-error — i numeri aggregati non accettano stringhe.
    const wrongType: SeaAggregate = { ...goldenForecast.daily[0]!.sea, wave_height_mean_m: "0.74" };

    expect([wrongVersion, wrongTimezone, missingElevation, undefinedWeatherCode, wrongType]).toHaveLength(5);
  });
});
