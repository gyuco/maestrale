/**
 * Job di aggiornamento delle previsioni: port di `update_forecasts.py:main`
 * (FR-1, FR-2, FR-14, FR-18, FR-19, FR-20, FR-52).
 *
 * Costruisce la previsione di ogni località del catalogo (concorrenza limitata,
 * NFR-17), fa merge con il cache precedente e scrive **una sola chiave KV**
 * (`latest`), così un lettore vede o il payload vecchio o il nuovo (FR-19, NFR-14).
 *
 * Differenza voluta dal Python (decisione del product owner, 2026-10-19): se
 * **nessuna** località è stata aggiornata il cache NON viene riscritto, così
 * `generated_at` invecchia e `/health` segnala `stale` onestamente.
 */

import { buildForecast, type ForecastDeps } from "./forecast";
import { mapWithConcurrency } from "./open_meteo";
import { CACHE_KEY, readForecastCache } from "./store";
import type { Forecast, ForecastCache } from "./types";

/** Giorni di previsione (FR-14; la configurabilità è OQ-18). */
const FORECAST_DAYS = 7;
const REQUIRED_FIELDS = ["slug", "name", "latitude", "longitude"] as const;

/** Voce valida del catalogo `locations.json`. */
export interface CatalogLocation {
  slug: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface UpdateDeps extends Pick<ForecastDeps, "fetchImpl" | "sleep" | "now"> {
  readonly days?: number;
}

/** Esito del job: il payload logico più `written` (false = KV non toccata). */
export interface UpdateResult {
  written: boolean;
  generated_at: string;
  updated_locations: string[];
  errors: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Come `load_locations`: rifiuta (FR-2) se una voce manca di un campo obbligatorio. */
export function validateLocations(raw: readonly unknown[]): CatalogLocation[] {
  const catalog: CatalogLocation[] = [];
  for (const item of raw) {
    const entry = isRecord(item) ? item : {};
    const missing = REQUIRED_FIELDS.filter((field) => !(field in entry)).sort();
    if (missing.length > 0) {
      const listed = missing.map((field) => `'${field}'`).join(", ");
      throw new Error(`Localita non valida, campi mancanti: [${listed}]`);
    }
    catalog.push({
      slug: String(entry["slug"]),
      name: String(entry["name"]),
      latitude: Number(entry["latitude"]),
      longitude: Number(entry["longitude"]),
    });
  }
  return catalog;
}

type LocationOutcome =
  | { slug: string; forecast: Forecast }
  | { slug: string; error: string };

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Esegue l'aggiornamento. Lancia solo per catalogo invalido (FR-2) o `KV.put` fallita. */
export async function runUpdate(
  kv: KVNamespace,
  rawLocations: readonly unknown[],
  deps: UpdateDeps = {},
): Promise<UpdateResult> {
  const catalog = validateLocations(rawLocations);
  const now = deps.now ?? ((): string => new Date().toISOString());
  const days = deps.days ?? FORECAST_DAYS;

  const previous = await readForecastCache(kv);
  // `payload` non è validato a runtime (store.ts): JSON `null` o senza `locations`
  // oggetto → insieme vuoto (FR-20).
  const previousPayload: unknown = previous.status === "ok" ? previous.payload : null;
  const previousLocations = isRecord(previousPayload) ? previousPayload["locations"] : null;
  const forecasts: Record<string, Forecast> = isRecord(previousLocations)
    ? { ...(previousLocations as Record<string, Forecast>) }
    : {};

  const outcomes = await mapWithConcurrency(
    catalog,
    async (entry): Promise<LocationOutcome> => {
      try {
        const built = await buildForecast(
          entry.name,
          entry.latitude,
          entry.longitude,
          days,
          "Europe/Rome",
          { fetchImpl: deps.fetchImpl, sleep: deps.sleep, now: deps.now },
        );
        const forecast: Forecast = {
          ...built,
          location: { ...built.location, slug: entry.slug },
        };
        return { slug: entry.slug, forecast };
      } catch (cause) {
        return { slug: entry.slug, error: describe(cause) };
      }
    },
  );

  const updated: string[] = [];
  const errors: Record<string, string> = {};
  for (const outcome of outcomes) {
    if ("forecast" in outcome) {
      forecasts[outcome.slug] = outcome.forecast;
      updated.push(outcome.slug);
    } else {
      errors[outcome.slug] = outcome.error;
    }
  }

  const payload: ForecastCache = {
    schema_version: 1,
    generated_at: now(),
    updated_locations: updated.sort(),
    errors,
    locations: forecasts,
  };

  if (payload.updated_locations.length === 0) {
    return { written: false, ...summary(payload) };
  }
  await kv.put(CACHE_KEY, JSON.stringify(payload));
  return { written: true, ...summary(payload) };
}

function summary(payload: ForecastCache) {
  return {
    generated_at: payload.generated_at,
    updated_locations: payload.updated_locations,
    errors: payload.errors,
  };
}
