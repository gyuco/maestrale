/**
 * Tipi del payload congelato del cache previsioni (schema_version 1).
 *
 * Derivati da `tests/fixtures/forecast.schema.json` (JSON Schema draft 2020-12),
 * che è il contratto usato dall'app Flutter: nomi di campo, tipi e struttura
 * non vanno cambiati (FR-19, FR-50, FR-51). I tipi ammettono `null` esattamente
 * dove lo schema lo ammette; le proprietà che lo schema NON elenca fra le
 * `required` sono opzionali (oggi solo `resolved_cell.elevation_m`).
 */

/** Versione del contratto del payload (FR-19). */
export type SchemaVersion = 1;

/** Istante UTC in ISO 8601, es. `2026-10-19T09:00:00+00:00` (`format: date-time`). */
export type IsoTimestamp = string;

/** Data locale `YYYY-MM-DD`. */
export type IsoDate = string;

/** Fuso del catalogo località; la pipeline operativa usa solo `Europe/Rome`. */
export type Timezone = "Europe/Rome";

/** Coordinata geografica richiesta a un provider (FR-13). */
export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * Cella risolta dal provider. `elevation_m` è opzionale: `data_sources.py` la
 * omette quando il provider non restituisce la quota.
 */
export interface ResolvedCell extends Coordinates {
  elevation_m?: number;
}

/** Variabili chieste al provider, come dichiarate nel catalogo sorgenti (FR-5). */
export interface SourceVariables {
  hourly: string[];
  daily: string[];
}

/** Provenienza dei dati di un provider (FR-12). */
export interface ForecastSource {
  id: string;
  provider: string;
  service: string;
  endpoint: string;
  model_selection: string;
  variables: SourceVariables;
  requested_coordinates: Coordinates;
  resolved_cell: ResolvedCell;
  fetched_at: IsoTimestamp;
  attribution: string;
  documentation_url: string;
  license_url: string;
}

/** Cella marina effettivamente usata dal provider (FR-13). */
export type MarineCell = Coordinates;

/** Cella meteo (terra) effettivamente usata dal provider; la quota può mancare (FR-13). */
export interface WeatherCell extends Coordinates {
  elevation_m: number | null;
}

/** Celle risolte dai due provider per una località (FR-13). */
export interface ForecastCells {
  marine: MarineCell;
  weather: WeatherCell;
}

/** Voce del catalogo località come esposta nella previsione (FR-1, FR-13). */
export interface ForecastLocation {
  name: string;
  latitude: number;
  longitude: number;
  /** Slug normalizzato, `^[a-z0-9]+(?:-[a-z0-9]+)*$` secondo lo schema. */
  slug: string;
}

/** Stato del mare Douglas/WMO derivato dall'altezza media (FR-10). */
export type SeaState = string | null;

/** Rosa dei venti a 8 settori (FR-11). */
export type WindRose = string | null;

/** Aggregato marino giornaliero (FR-7); ogni serie vuota diventa `null`. */
export interface SeaAggregate {
  state: SeaState;
  wave_height_mean_m: number | null;
  wave_height_max_m: number | null;
  wave_period_mean_s: number | null;
  /** Media circolare in gradi [0, 360) (FR-9). */
  wave_direction_mean_deg: number | null;
  wave_direction_name: WindRose;
  water_temperature_mean_c: number | null;
}

/** Aggregato meteo giornaliero (FR-8); ogni serie vuota diventa `null`. */
export interface WeatherAggregate {
  air_temperature_mean_c: number | null;
  air_temperature_min_c: number | null;
  air_temperature_max_c: number | null;
  /** Codice WMO orario/giornaliero del provider. */
  weather_code: number | null;
  wind_speed_mean_kmh: number | null;
  wind_speed_max_kmh: number | null;
  wind_gust_mean_kmh: number | null;
  wind_gust_max_kmh: number | null;
  /** Media circolare in gradi [0, 360) (FR-9). */
  wind_direction_mean_deg: number | null;
  wind_name: WindRose;
}

/** Un giorno aggregato (FR-6); `daily` è ordinato per data crescente. */
export interface DailyDay {
  date: IsoDate;
  sea: SeaAggregate;
  weather: WeatherAggregate;
}

/**
 * Previsione di una località: è esattamente ciò che `GET /forecast` restituisce
 * per quella località (FR-22, FR-50).
 */
export interface Forecast {
  location: ForecastLocation;
  cells: ForecastCells;
  timezone: Timezone;
  generated_at: IsoTimestamp;
  sources: {
    sea: ForecastSource;
    weather: ForecastSource;
  };
  /** Da 1 a 8 giorni (FR-6). */
  daily: DailyDay[];
}

/**
 * Payload del cache su Workers KV (FR-19): `locations[<slug>]` è la previsione
 * restituita da `GET /forecast` (FR-22).
 */
export interface ForecastCache {
  schema_version: SchemaVersion;
  /** Fine dell'esecuzione del job, UTC ISO 8601. */
  generated_at: IsoTimestamp;
  /** Slug aggiornati con successo nell'esecuzione, ordinati. */
  updated_locations: string[];
  /** Messaggi d'errore per gli slug falliti (FR-18). */
  errors: Record<string, string>;
  locations: Record<string, Forecast>;
}
