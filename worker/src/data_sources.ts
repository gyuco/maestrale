/**
 * Port di `data_sources.py`: l'unico punto in cui sono dichiarati endpoint,
 * variabili, selezione del modello e della cella, attribuzione e condizioni
 * d'uso dei provider (FR-5). Da qui derivano sia i parametri delle richieste
 * (FR-3, FR-4) sia il blocco di provenienza salvato nella previsione (FR-12).
 *
 * Il port mantiene **nome, struttura e ordine delle chiavi** del codice Python,
 * così il JSON prodotto è identico a quello di `data_sources.py`.
 */

import type { Coordinates, ForecastSource, ResolvedCell } from "./types";

/** Risposta di Open-Meteo: le coordinate risolte sono sempre presenti; la quota no. */
export interface OpenMeteoResponse extends Coordinates {
  readonly elevation?: number | null;
  readonly [key: string]: unknown;
}

/**
 * Parametri di query per Open-Meteo: `daily` è presente solo per le sorgenti che
 * hanno variabili giornaliere (nel catalogo attuale solo il meteo).
 */
export interface RequestParams {
  latitude: number;
  longitude: number;
  hourly: string;
  timezone: string;
  forecast_days: number;
  cell_selection: string;
  models: "best_match";
  daily?: string;
}

/** Dichiarazione di una sorgente dati (l'equivalente del dataclass `DataSource`). */
export interface DataSourceSpec {
  readonly id: string;
  readonly provider: string;
  readonly service: string;
  readonly endpoint: string;
  readonly documentationUrl: string;
  readonly licenseUrl: string;
  readonly attribution: string;
  readonly modelSelection: string;
  readonly cellSelection: string;
  readonly hourlyVariables: readonly string[];
  readonly dailyVariables?: readonly string[];
}

/** Sorgente dati operativa: dichiarazione + costruzione di richieste e provenienza. */
export interface DataSource extends Omit<DataSourceSpec, "dailyVariables"> {
  readonly dailyVariables: readonly string[];
  requestParams(
    latitude: number,
    longitude: number,
    days: number,
    timezoneName: string,
  ): RequestParams;
  provenance(
    response: OpenMeteoResponse,
    requestedLatitude: number,
    requestedLongitude: number,
    fetchedAt: string,
  ): ForecastSource;
}

const BEST_MATCH = "best_match";

/** Crea una sorgente immutabile (come il `@dataclass(frozen=True)` di Python). */
function createDataSource(spec: DataSourceSpec): DataSource {
  const dailyVariables = spec.dailyVariables ?? [];

  return Object.freeze({
    ...spec,
    dailyVariables,
    requestParams(
      latitude: number,
      longitude: number,
      days: number,
      timezoneName: string,
    ): RequestParams {
      const params: RequestParams = {
        latitude,
        longitude,
        hourly: spec.hourlyVariables.join(","),
        timezone: timezoneName,
        forecast_days: days,
        cell_selection: spec.cellSelection,
        models: BEST_MATCH,
      };
      if (dailyVariables.length > 0) {
        params.daily = dailyVariables.join(",");
      }
      return params;
    },
    provenance(
      response: OpenMeteoResponse,
      requestedLatitude: number,
      requestedLongitude: number,
      fetchedAt: string,
    ): ForecastSource {
      const cell: ResolvedCell = {
        latitude: response.latitude,
        longitude: response.longitude,
      };
      // `elevation_m` compare solo se il provider ha restituito la quota: in
      // Python `response.get("elevation") is not None`, quindi 0 viene tenuto.
      if (response.elevation !== null && response.elevation !== undefined) {
        cell.elevation_m = response.elevation;
      }
      return {
        id: spec.id,
        provider: spec.provider,
        service: spec.service,
        endpoint: spec.endpoint,
        model_selection: spec.modelSelection,
        variables: {
          hourly: [...spec.hourlyVariables],
          daily: [...dailyVariables],
        },
        requested_coordinates: { latitude: requestedLatitude, longitude: requestedLongitude },
        resolved_cell: cell,
        fetched_at: fetchedAt,
        attribution: spec.attribution,
        documentation_url: spec.documentationUrl,
        license_url: spec.licenseUrl,
      };
    },
  });
}

export const MARINE_SOURCE: DataSource = createDataSource({
  id: "open_meteo_marine",
  provider: "Open-Meteo",
  service: "Marine Weather API",
  endpoint: "https://marine-api.open-meteo.com/v1/marine",
  documentationUrl: "https://open-meteo.com/en/docs/marine-weather-api",
  licenseUrl: "https://open-meteo.com/en/terms",
  attribution: "Marine data by Open-Meteo.com",
  modelSelection: "best_match, scelto dinamicamente dal provider",
  cellSelection: "sea",
  hourlyVariables: ["wave_height", "wave_direction", "wave_period", "sea_surface_temperature"],
});

export const WEATHER_SOURCE: DataSource = createDataSource({
  id: "open_meteo_weather",
  provider: "Open-Meteo",
  service: "Weather Forecast API",
  endpoint: "https://api.open-meteo.com/v1/forecast",
  documentationUrl: "https://open-meteo.com/en/docs",
  licenseUrl: "https://open-meteo.com/en/terms",
  attribution: "Weather data by Open-Meteo.com",
  modelSelection: "best_match, scelto dinamicamente dal provider",
  cellSelection: "land",
  hourlyVariables: ["temperature_2m", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m"],
  dailyVariables: [
    "weather_code",
    "temperature_2m_min",
    "temperature_2m_max",
    "wind_speed_10m_max",
    "wind_gusts_10m_max",
  ],
});

/** Le sorgenti del catalogo, nell'ordine di `data_sources.DATA_SOURCES`. */
export const DATA_SOURCES: readonly DataSource[] = [MARINE_SOURCE, WEATHER_SOURCE];
