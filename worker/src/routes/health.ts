import { Hono } from "hono";

import type { Bindings } from "../env";
import { readForecastCache } from "../store";

/**
 * Identificativo del cache in `/health` (OQ-19). In v0.1 era il percorso del
 * file (`cache_path`); su Workers non esiste filesystem e il campo è sostituito
 * da una costante che indica il KV. Il **nome** del campo resta `cache_path`
 * per non cambiare il contratto (FR-50 ammette questa unica eccezione;
 * l'app Flutter non usa il campo, PRD OQ-19).
 */
export const CACHE_IDENTIFIER = "kv:FORECASTS";

const DEFAULT_MAX_AGE_HOURS = 12;

function maxAgeHours(env: { FORECAST_MAX_AGE_HOURS?: string }): number {
  const configured = Number(env.FORECAST_MAX_AGE_HOURS ?? DEFAULT_MAX_AGE_HOURS);
  return Number.isFinite(configured) ? configured : DEFAULT_MAX_AGE_HOURS;
}

/** Millisecondi epoch da un istante ISO, o `null` se assente/non interpretabile. */
function parseUtc(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds) ? null : milliseconds;
}

/**
 * Arrotondamento a 2 decimali. Coincide con `round(x, 2)` di Python per i valori
 * non di frontiera; le differenze possibili sono solo sui tie binari (R-5), non
 * rilevanti per un'età in ore.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export const healthRoutes = new Hono<{ Bindings: Bindings }>();

// GET /health — sempre 200 (FR-26): nessun caso d'errore della cache diventa un
// codice HTTP d'errore, è il campo `status` a degradarsi.
healthRoutes.get("/", async (c) => {
  const result = await readForecastCache(c.env.FORECASTS);

  if (result.status === "unreadable") {
    return c.json({
      status: "degraded",
      error: result.error,
      cache_path: CACHE_IDENTIFIER,
    });
  }

  if (result.status === "missing") {
    return c.json({
      status: "degraded",
      error: "Cache forecast non ancora generato",
      cache_path: CACHE_IDENTIFIER,
      locations: 0,
    });
  }

  const payload = result.payload;
  const generatedAt = typeof payload.generated_at === "string" ? payload.generated_at : null;
  const generatedMs = parseUtc(generatedAt);
  const ageHours = generatedMs === null ? null : (Date.now() - generatedMs) / 3_600_000;
  const stale = ageHours === null || ageHours > maxAgeHours(c.env);
  const errors = payload.errors ?? {};

  return c.json({
    status: stale || Object.keys(errors).length > 0 ? "degraded" : "ok",
    generated_at: generatedAt,
    age_hours: ageHours === null ? null : round2(ageHours),
    stale,
    locations: Object.keys(payload.locations ?? {}).length,
    update_errors: errors,
  });
});
