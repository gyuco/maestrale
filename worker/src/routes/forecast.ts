import { Hono } from "hono";

import type { Bindings } from "../env";
import { slugify } from "../slugify";
import { readForecastCache } from "../store";

export const forecastRoutes = new Hono<{ Bindings: Bindings }>();

// GET /forecast?localita=X — 200 con l'oggetto località così com'è in cache,
// 404/503 con `detail`, 422 sui parametri invalidi (FR-22..FR-25).
forecastRoutes.get("/", async (c) => {
  const localita = c.req.query("localita");

  if (localita === undefined || localita === "") {
    return c.json({ detail: "Il parametro 'localita' è obbligatorio" }, 422);
  }

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
    const available = Object.entries(locations)
      .map(([slug, item]) => item.location?.name ?? slug)
      .sort();
    return c.json(
      { detail: { message: `Localita '${localita}' non trovata`, available } },
      404,
    );
  }

  return c.json(forecast);
});
