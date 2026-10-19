import { Hono } from "hono";
import { cors } from "hono/cors";

import type { Bindings, CorsEnv } from "./env";
import { forecastRoutes } from "./routes/forecast";
import { healthRoutes } from "./routes/health";

/**
 * Origini CORS consentite, come in `backend/main.py`: valore di `CORS_ORIGINS`
 * (default `*`), lista separata da virgola, voci vuote ignorate (FR-28).
 */
function allowedOrigins(env: CorsEnv): string[] {
  return (env.CORS_ORIGINS ?? "*")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/** `Access-Control-Allow-Origin` da emettere, o `null` se l'origine non è consentita. */
function allowOrigin(origin: string, env: CorsEnv): string | null {
  const origins = allowedOrigins(env);
  if (origins.includes("*")) {
    return "*";
  }
  return origins.includes(origin) ? origin : null;
}

/**
 * App Hono con le API di lettura. `createApp` esiste per i test (permette di
 * iniettare un ambiente diverso da quello reale del Worker).
 */
export function createApp(): Hono<{ Bindings: Bindings }> {
  const app = new Hono<{ Bindings: Bindings }>();

  // Su Workers le origini arrivano dall'ambiente della richiesta, quindi vanno
  // risolte per-request (una funzione invece di una lista fissa).
  app.use(
    "*",
    cors({
      origin: (origin, c) => allowOrigin(origin, c.env),
      allowMethods: ["GET"],
      allowHeaders: ["*"],
    }),
  );

  // Route di prova dello scaffold (E01-S01): tenuta come sonda di liveness. Non
  // fa parte del contratto con l'app (che usa solo /health e /forecast) e il
  // backend Python non aveva una route `/`.
  app.get("/", (c) => c.json({ status: "ok", service: "maestrale" }));

  app.route("/health", healthRoutes);
  app.route("/forecast", forecastRoutes);

  return app;
}

const app = createApp();

export default {
  fetch: app.fetch,
  // E01-S04: handler `scheduled` per l'aggiornamento ogni 6 h (FR-49).
} satisfies ExportedHandler<Env>;
