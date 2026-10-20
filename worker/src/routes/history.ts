import { Hono } from "hono";

import { loadCatalog, resolve } from "../catalog";
import type { AppEnv } from "../env";
import { historyCacheConfigFromEnv } from "../config";
import { cacheControlFor, parseHistoryParams, romeDate } from "../history";
import { readDays, readMonths } from "../history_store";
import { notFound } from "./forecast";

export const historyRoutes = new Hono<AppEnv>();

// GET|HEAD /history — storico giornaliero (FR-74..FR-80), sola lettura: nessuna
// lettura KV, nessuna chiamata ai provider. HEAD è servito da Hono tramite GET.
historyRoutes.get("/", async (c) => {
  const parsed = parseHistoryParams({
    localita: c.req.query("localita"),
    from: c.req.query("from"),
    to: c.req.query("to"),
    granularity: c.req.query("granularity"),
  });
  if (!parsed.ok) {
    return c.json({ detail: parsed.detail }, 422);
  }
  const { localita, granularity, from, to } = parsed.value;

  const catalog = loadCatalog(c.get("catalog"));
  const entry = resolve(catalog, localita);
  if (entry === null) {
    return notFound(c, localita, catalog.map((item) => item.name));
  }

  const result =
    granularity === "month"
      ? await readMonths(c.env.HISTORY, entry.slug, from, to)
      : await readDays(c.env.HISTORY, entry.slug, from, to);
  if (!result.ok) {
    console.error(`Lettura storico fallita per ${entry.slug}: ${result.error}`);
    return c.json({ detail: "Storico temporaneamente non disponibile" }, 503);
  }
  // Cache-Control solo sulla 200 (FR-79); "oggi" Europe/Rome dall'orologio corrente.
  c.header("Cache-Control", cacheControlFor(to, romeDate(new Date()), historyCacheConfigFromEnv(c.env ?? {})));
  return c.json({
    schema_version: 1,
    location: { slug: entry.slug, name: entry.name },
    granularity,
    from,
    to,
    timezone: "Europe/Rome",
    items: result.items,
  });
});
