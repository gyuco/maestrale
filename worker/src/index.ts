import { Hono } from "hono";
import { cors } from "hono/cors";

import locations from "../../locations.json";
import type { Bindings, CorsEnv } from "./env";
import { forecastRoutes } from "./routes/forecast";
import { healthRoutes } from "./routes/health";
import { runUpdate } from "./update";

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

/**
 * Cron Trigger ogni 6 h (FR-49). Attende il job (nessun `waitUntil` non atteso).
 * Rigetta solo per catalogo invalido o `KV.put` fallita; se tutte le località
 * falliscono risolve dopo aver loggato (un rigetto farebbe ritentare il cron
 * inutilmente) e il cache non viene toccato.
 */
async function scheduled(
  _controller: ScheduledController,
  env: Bindings,
  _ctx: ExecutionContext,
): Promise<void> {
  const started = Date.now();
  const result = await runUpdate(env.FORECASTS, locations);
  for (const [slug, message] of Object.entries(result.errors)) {
    console.error(`Aggiornamento fallito per ${slug}: ${message}`);
  }
  const failed = Object.keys(result.errors).length;
  const line = JSON.stringify({
    event: "forecast_update",
    updated: result.updated_locations.length,
    failed,
    generated_at: result.generated_at,
    duration_ms: Date.now() - started,
  });
  if (result.written) {
    console.log(line);
  } else {
    console.error("Nessuna località aggiornata: cache KV non modificato");
    console.log(line);
  }
}

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Bindings>;
