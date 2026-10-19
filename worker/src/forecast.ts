/**
 * Port di `previsioni_mare.build_forecast`: costruisce la previsione giornaliera
 * di una località dai due provider Open-Meteo.
 *
 * Riusa il catalogo sorgenti (`data_sources.ts`) per i parametri delle richieste
 * (FR-3, FR-4) e per il blocco di provenienza (FR-12); le aggregazioni orarie →
 * giornaliere stanno in `aggregate.ts` (FR-6..FR-11).
 *
 * La struttura restituita è **identica** a quella di `build_forecast`, con una
 * sola differenza voluta: `location.slug` **non** è aggiunto qui (lo fa il job,
 * come `update_forecasts.py`), quindi il tipo `BuiltForecast` non ha `slug`.
 *
 * `fetchImpl` e `now` sono iniettabili per test deterministici e offline
 * (NFR-13).
 */

import {
  circularMean,
  dailyLookup,
  directionName,
  hourlyByDate,
  maxOfValidNumbers,
  mean,
  rounded,
  seaState,
  type MaybeNumber,
} from "./aggregate";
import { MARINE_SOURCE, WEATHER_SOURCE, type OpenMeteoResponse } from "./data_sources";
import { fetchJson, type FetchImpl, type SleepFn } from "./open_meteo";
import type {
  Forecast,
  ForecastCells,
  SeaAggregate,
  Timezone,
  WeatherAggregate,
} from "./types";

/** Coordinate della località richiesta, senza slug (aggiunto dal job). */
export interface ForecastLocationInput {
  name: string;
  latitude: number;
  longitude: number;
}

/** Output di `buildForecast`: il payload della località prima dell'aggiunta dello slug. */
export type BuiltForecast = Omit<Forecast, "location"> & { location: ForecastLocationInput };

/** Dipendenze iniettabili di `buildForecast`. */
export interface ForecastDeps {
  readonly fetchImpl?: FetchImpl;
  readonly sleep?: SleepFn;
  readonly now?: () => string;
  readonly retries?: number;
  readonly timeoutMs?: number;
}

/**
 * `generated_at`/`fetched_at` di default. Il Python usa
 * `datetime.now(timezone.utc).isoformat()` (`+00:00`, microsecondi); qui
 * `toISOString()` (`Z`, millisecondi). Entrambi validi per `format: date-time`
 * dello schema: i test iniettano `now` per un confronto deterministico.
 */
function defaultNow(): string {
  return new Date().toISOString();
}

function requireEntry<T>(entries: Record<string, T>, date: string, kind: string): T {
  const entry = entries[date];
  if (entry === undefined) {
    throw new Error(`Data mancante nel blocco ${kind}: ${date}`);
  }
  return entry;
}

function requireSeries(byField: Record<string, MaybeNumber[]>, field: string): MaybeNumber[] {
  const series = byField[field];
  if (series === undefined) {
    throw new Error(`Serie oraria mancante: ${field}`);
  }
  return series;
}

function requireNumber(payload: Record<string, unknown>, field: string): number {
  const value = payload[field];
  if (typeof value !== "number") {
    throw new TypeError(`Campo non numerico '${field}'`);
  }
  return value;
}

function optionalNumber(payload: Record<string, unknown>, field: string): number | null {
  const value = payload[field];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "number") {
    return value;
  }
  throw new TypeError(`Campo non numerico '${field}'`);
}

function dailyNumber(daily: Record<string, unknown>, field: string): number | null {
  const value = daily[field];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "number") {
    return value;
  }
  throw new TypeError(`Valore giornaliero non numerico '${field}'`);
}

function resolvedResponse(payload: Record<string, unknown>): OpenMeteoResponse {
  return {
    latitude: requireNumber(payload, "latitude"),
    longitude: requireNumber(payload, "longitude"),
    elevation: optionalNumber(payload, "elevation"),
  };
}

/** Costruisce la previsione di una località (stessa struttura di `build_forecast`). */
export async function buildForecast(
  name: string,
  latitude: number,
  longitude: number,
  days: number,
  timezoneName: Timezone,
  deps: ForecastDeps = {},
): Promise<BuiltForecast> {
  const now = deps.now ?? defaultNow;
  const fetchOptions = {
    fetchImpl: deps.fetchImpl,
    sleep: deps.sleep,
    retries: deps.retries,
    timeoutMs: deps.timeoutMs,
  };
  const marineFields = [...MARINE_SOURCE.hourlyVariables];
  const weatherFields = [...WEATHER_SOURCE.hourlyVariables];

  const marine = await fetchJson(
    MARINE_SOURCE.endpoint,
    MARINE_SOURCE.requestParams(latitude, longitude, days, timezoneName),
    fetchOptions,
  );
  const marineFetchedAt = now();
  const weather = await fetchJson(
    WEATHER_SOURCE.endpoint,
    WEATHER_SOURCE.requestParams(latitude, longitude, days, timezoneName),
    fetchOptions,
  );
  const weatherFetchedAt = now();

  const marineDays = hourlyByDate(marine, marineFields);
  const weatherDays = hourlyByDate(weather, weatherFields);
  const officialDaily = dailyLookup(weather);
  const weatherDates = new Set(Object.keys(weatherDays));
  const dailyDates = new Set(Object.keys(officialDaily));
  const commonDates = Object.keys(marineDays)
    .filter((date) => weatherDates.has(date) && dailyDates.has(date))
    .sort();

  const daily: BuiltForecast["daily"] = [];
  for (const date of commonDates.slice(0, days)) {
    const sea = requireEntry(marineDays, date, "marine");
    const air = requireEntry(weatherDays, date, "weather");
    const official = requireEntry(officialDaily, date, "daily");

    const waveHeightMean = mean(requireSeries(sea, "wave_height"));
    const waveDirectionMean = circularMean(requireSeries(sea, "wave_direction"));
    const windDirectionMean = circularMean(requireSeries(air, "wind_direction_10m"));

    const seaAggregate: SeaAggregate = {
      state: seaState(waveHeightMean),
      wave_height_mean_m: rounded(waveHeightMean),
      wave_height_max_m: rounded(maxOfValidNumbers(requireSeries(sea, "wave_height"))),
      wave_period_mean_s: rounded(mean(requireSeries(sea, "wave_period"))),
      wave_direction_mean_deg: rounded(waveDirectionMean, 0),
      wave_direction_name: directionName(waveDirectionMean),
      water_temperature_mean_c: rounded(mean(requireSeries(sea, "sea_surface_temperature")), 1),
    };
    const weatherAggregate: WeatherAggregate = {
      air_temperature_mean_c: rounded(mean(requireSeries(air, "temperature_2m")), 1),
      air_temperature_min_c: dailyNumber(official, "temperature_2m_min"),
      air_temperature_max_c: dailyNumber(official, "temperature_2m_max"),
      weather_code: dailyNumber(official, "weather_code"),
      wind_speed_mean_kmh: rounded(mean(requireSeries(air, "wind_speed_10m")), 1),
      wind_speed_max_kmh: dailyNumber(official, "wind_speed_10m_max"),
      wind_gust_mean_kmh: rounded(mean(requireSeries(air, "wind_gusts_10m")), 1),
      wind_gust_max_kmh: dailyNumber(official, "wind_gusts_10m_max"),
      wind_direction_mean_deg: rounded(windDirectionMean, 0),
      wind_name: directionName(windDirectionMean),
    };

    daily.push({ date, sea: seaAggregate, weather: weatherAggregate });
  }

  const marineResponse = resolvedResponse(marine);
  const weatherResponse = resolvedResponse(weather);
  const cells: ForecastCells = {
    marine: { latitude: marineResponse.latitude, longitude: marineResponse.longitude },
    weather: {
      latitude: weatherResponse.latitude,
      longitude: weatherResponse.longitude,
      elevation_m: weatherResponse.elevation ?? null,
    },
  };

  return {
    location: { name, latitude, longitude },
    cells,
    timezone: timezoneName,
    generated_at: now(),
    sources: {
      sea: MARINE_SOURCE.provenance(marineResponse, latitude, longitude, marineFetchedAt),
      weather: WEATHER_SOURCE.provenance(weatherResponse, latitude, longitude, weatherFetchedAt),
    },
    daily,
  };
}
