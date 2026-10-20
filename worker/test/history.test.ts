import { describe, expect, it } from "vitest";

import golden from "../../tests/fixtures/golden_forecast_torre-dei-corsari.json";
import { dayZeroRow, romeDate } from "../src/history";
import type { Forecast } from "../src/types";

const forecast = golden as unknown as Forecast;

describe("dayZeroRow (AC-1, FR-69)", () => {
  it("copia i 7 valori di daily[d0] senza trasformazioni", () => {
    for (const day of forecast.daily) {
      const row = dayZeroRow("torre-dei-corsari", forecast, day.date)!;
      expect(row).toEqual({
        location_slug: "torre-dei-corsari",
        date: day.date,
        air_temperature_mean_c: day.weather.air_temperature_mean_c,
        air_temperature_min_c: day.weather.air_temperature_min_c,
        air_temperature_max_c: day.weather.air_temperature_max_c,
        water_temperature_mean_c: day.sea.water_temperature_mean_c,
        state: day.sea.state,
        wave_height_mean_m: day.sea.wave_height_mean_m,
        wave_height_max_m: day.sea.wave_height_max_m,
      });
    }
  });

  it("conserva i null", () => {
    const day = forecast.daily[0]!;
    const custom = {
      ...forecast,
      daily: [
        {
          ...day,
          sea: { ...day.sea, water_temperature_mean_c: null, wave_height_max_m: null },
          weather: { ...day.weather, air_temperature_min_c: null },
        },
      ],
    } as Forecast;
    const row = dayZeroRow("x", custom, day.date)!;
    expect(row.water_temperature_mean_c).toBeNull();
    expect(row.wave_height_max_m).toBeNull();
    expect(row.air_temperature_min_c).toBeNull();
  });

  it("restituisce null se la data non è in daily", () => {
    expect(dayZeroRow("x", forecast, "2020-01-01")).toBeNull();
  });
});

describe("romeDate (AC-2)", () => {
  it.each([
    ["2026-10-24T22:30:00Z", "2026-10-25"],
    ["2026-10-24T21:59:00Z", "2026-10-24"],
    ["2026-03-28T23:30:00Z", "2026-03-29"],
    ["2026-10-31T23:30:00Z", "2026-11-01"],
    ["2026-10-31T22:59:00Z", "2026-10-31"],
    ["2026-03-29T21:59:00Z", "2026-03-29"],
    ["2026-03-29T22:00:00Z", "2026-03-30"],
    ["2026-12-31T23:00:00Z", "2027-01-01"],
  ])("%s -> %s", (iso, expected) => {
    expect(romeDate(new Date(iso))).toBe(expected);
  });
});
