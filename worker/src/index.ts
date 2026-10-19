import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

// Route di prova dello scaffold. Le route API (`/forecast`, `/health`) arrivano
// nelle storie successive di E01.
app.get("/", (c) => c.json({ status: "ok", service: "maestrale" }));

export default {
  fetch: app.fetch,
  // E01-S04: handler `scheduled` per l'aggiornamento ogni 6 h (FR-49).
} satisfies ExportedHandler<Env>;
