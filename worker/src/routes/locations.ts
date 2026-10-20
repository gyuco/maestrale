import { Hono } from "hono";

import { CatalogError, locationsDocument } from "../catalog";
import type { AppEnv } from "../env";

export const DEFAULT_LOCATIONS_MAX_AGE_SECONDS = 86_400;

function maxAgeSeconds(value: string | undefined): number {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== "" && Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_LOCATIONS_MAX_AGE_SECONDS;
}

/** `If-None-Match` (lista, `W/`, `*`) soddisfatto dall'ETag corrente. */
function matches(header: string | undefined, etag: string): boolean {
  if (header === undefined) {
    return false;
  }
  return header
    .split(",")
    .map((item) => item.trim().replace(/^W\//, ""))
    .some((item) => item === "*" || item === etag);
}

export const locationsRoutes = new Hono<AppEnv>();

// GET|HEAD /locations — catalogo (FR-62), sola lettura, nessuna lettura KV né
// chiamata ai provider. HEAD è servito da Hono tramite questa route GET.
locationsRoutes.get("/", async (c) => {
  let document;
  try {
    document = await locationsDocument(c.get("catalog"));
  } catch (error) {
    if (error instanceof CatalogError) {
      return c.json({ detail: `Catalogo località non valido: ${error.message}` }, 500);
    }
    throw error;
  }

  const headers = {
    ETag: document.etag,
    "Cache-Control": `public, max-age=${maxAgeSeconds(c.env?.LOCATIONS_MAX_AGE_SECONDS)}`,
    "Access-Control-Expose-Headers": "ETag",
  };
  if (matches(c.req.header("If-None-Match"), document.etag)) {
    return c.body(null, 304, headers);
  }
  return c.body(document.body, 200, { ...headers, "Content-Type": "application/json" });
});
