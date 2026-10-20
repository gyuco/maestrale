import type { Context } from "hono";
import { Hono } from "hono";

import { loadCatalog, resolve } from "../catalog";
import type { AppEnv, CatalogEntry } from "../env";
import { slugify } from "../slugify";
import {
  readForecastCache,
  readMeta,
  readRecordAndMeta,
  type ForecastMeta,
} from "../store";
import type { Forecast } from "../types";

export const forecastRoutes = new Hono<AppEnv>();

/** Numero massimo di nomi in `detail.available` del 404 (FR-58): costante del contratto. */
export const AVAILABLE_LIMIT = 50;

/** Primi `AVAILABLE_LIMIT` nomi, ordinati, nello stesso formato di FR-23. */
function availableNames(names: string[]): string[] {
  return names.sort().slice(0, AVAILABLE_LIMIT);
}

function notFound(c: Context<AppEnv>, localita: string, names: string[]): Response {
  return c.json(
    {
      detail: {
        message: `Localita '${localita}' non trovata`,
        available: availableNames(names),
      },
    },
    404,
  );
}

function legacyFallbackEnabled(value: string | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized !== "false" && normalized !== "0";
}

/**
 * Modalità legacy (FR-59, ADR-0003 §2): finché `meta` non esiste si serve da
 * `latest` con la logica della v0.1/v0.2 (200/404/503 invariati, salvo il
 * troncamento di `available`, FR-58).
 */
async function serveLegacy(c: Context<AppEnv>, localita: string): Promise<Response> {
  const result = await readForecastCache(c.env.FORECASTS);

  if (result.status === "unreadable") {
    return c.json({ detail: result.error }, 503);
  }
  if (result.status === "missing") {
    return c.json({ detail: "Previsioni non ancora disponibili" }, 503);
  }

  const locations = result.payload.locations ?? {};
  const key = slugify(localita);

  // Prima corrispondenza esatta sulla chiave (slug del catalogo), poi — come in
  // Python — confronto dello slug del nome di ogni località.
  let forecast = locations[key];
  if (forecast === undefined) {
    for (const candidate of Object.values(locations)) {
      if (slugify(candidate.location?.name ?? "") === key) {
        forecast = candidate;
        break;
      }
    }
  }

  if (forecast === undefined) {
    return notFound(
      c,
      localita,
      Object.entries(locations).map(([slug, item]) => item.location?.name ?? slug),
    );
  }

  return c.json(forecast);
}

function namesFromMeta(meta: ForecastMeta, catalog: readonly CatalogEntry[]): string[] {
  const byslug = new Map(catalog.map((entry) => [entry.slug, entry.name]));
  const slugs = Array.isArray(meta.slugs) ? meta.slugs : [];
  return slugs.map((slug) => byslug.get(slug) ?? slug);
}

// GET /forecast?localita=X — 200 con l'oggetto località così com'è in cache,
// 404/503 con `detail`, 422 sui parametri invalidi (FR-22..FR-25). Con il cache
// per località legge solo `forecast:<slug>` e `meta` (FR-57, 1 operazione KV).
forecastRoutes.get("/", async (c) => {
  const localita = c.req.query("localita");

  if (localita === undefined || localita === "") {
    return c.json({ detail: "Il parametro 'localita' è obbligatorio" }, 422);
  }

  const catalog = loadCatalog(c.get("catalog"));
  const entry = resolve(catalog, localita);

  if (entry === null) {
    // Fuori catalogo: basta `meta` per distinguere 404 da modalità legacy.
    const meta = await readMeta(c.env.FORECASTS);
    if (meta.status === "unreadable") {
      return c.json({ detail: meta.error }, 503);
    }
    if (meta.status === "missing") {
      return serveLegacy(c, localita);
    }
    return notFound(c, localita, namesFromMeta(meta.value, catalog));
  }

  const read = await readRecordAndMeta<Forecast>(c.env.FORECASTS, entry.slug);
  if ("error" in read) {
    return c.json({ detail: read.error }, 503);
  }
  const { record, meta } = read;

  if (record.status === "unreadable") {
    return c.json({ detail: record.error }, 503);
  }
  if (meta.status === "unreadable") {
    return c.json({ detail: meta.error }, 503);
  }
  if (meta.status === "missing") {
    return serveLegacy(c, localita);
  }
  if (record.status === "ok") {
    return c.json(record.value);
  }

  // Record assente con `meta` presente: ripiego di migrazione su `latest` (FR-59),
  // che copre la cache negativa al bordo e l'intervallo prima del seed.
  if (legacyFallbackEnabled(c.env.LEGACY_LATEST_FALLBACK)) {
    const legacy = await readForecastCache(c.env.FORECASTS);
    if (legacy.status === "ok") {
      const forecast = legacy.payload.locations?.[entry.slug];
      if (forecast !== undefined) {
        return c.json(forecast);
      }
    }
  }
  return notFound(c, localita, namesFromMeta(meta.value, catalog));
});
