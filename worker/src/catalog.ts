/**
 * Unico accesso al catalogo delle località nel Worker (FR-61, ADR-0004).
 *
 * `locations.json` alla radice del repository è la sola fonte modificata a mano
 * ed è incluso nel bundle. Il job (`update.ts`), la risoluzione di `/forecast`
 * (FR-22) e `GET /locations` passano tutti da qui. Validazione, corpo ed ETag
 * sono memoizzati per isolate (per riferimento alla lista in ingresso).
 */

import bundledLocations from "../../locations.json";
import type { CatalogEntry } from "./env";
import { slugify } from "./slugify";

export type { CatalogEntry };

/** Lista grezza inclusa nel bundle (non validata: la validazione è lazy, FR-2). */
export const rawLocations: readonly unknown[] = bundledLocations;

const REQUIRED_FIELDS = ["slug", "name", "latitude", "longitude"] as const;

/** Versione dell'involucro di `GET /locations`. */
export const LOCATIONS_SCHEMA_VERSION = 1;

/** Catalogo non valido (FR-2): il job rifiuta l'esecuzione, `/locations` risponde 500. */
export class CatalogError extends Error {
  override name = "CatalogError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Come `load_locations`: rifiuta (FR-2) se una voce manca di un campo obbligatorio.
 * In più rifiuta slug/nome vuoti e coordinate non numeriche.
 */
export function validateLocations(raw: readonly unknown[]): CatalogEntry[] {
  if (!Array.isArray(raw)) {
    throw new CatalogError("Catalogo non valido: atteso un elenco di località");
  }
  const catalog: CatalogEntry[] = [];
  for (const item of raw) {
    const entry = isRecord(item) ? item : {};
    const missing = REQUIRED_FIELDS.filter((field) => !(field in entry)).sort();
    if (missing.length > 0) {
      const listed = missing.map((field) => `'${field}'`).join(", ");
      throw new CatalogError(`Localita non valida, campi mancanti: [${listed}]`);
    }
    const slug = String(entry["slug"]);
    const name = String(entry["name"]);
    const latitude = Number(entry["latitude"]);
    const longitude = Number(entry["longitude"]);
    if (
      slug.trim() === "" ||
      name.trim() === "" ||
      typeof entry["latitude"] === "string" ||
      typeof entry["longitude"] === "string" ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      throw new CatalogError(`Localita non valida: valori inattesi per '${slug}'`);
    }
    catalog.push({ slug, name, latitude, longitude });
  }
  return catalog;
}

const validated = new WeakMap<object, CatalogEntry[]>();

/** Voci validate del catalogo (default: `locations.json`), memoizzate per isolate. */
export function loadCatalog(raw: readonly unknown[] = rawLocations): readonly CatalogEntry[] {
  if (!Array.isArray(raw)) {
    throw new CatalogError("Catalogo non valido: atteso un elenco di località");
  }
  let catalog = validated.get(raw);
  if (catalog === undefined) {
    catalog = validateLocations(raw);
    validated.set(raw, catalog);
  }
  return catalog;
}

/** Slug esatto, poi `slugify(name)` (FR-22): la voce del catalogo o `null`. */
export function resolve(catalog: readonly CatalogEntry[], localita: string): CatalogEntry | null {
  const key = slugify(localita);
  return (
    catalog.find((item) => item.slug === key) ??
    catalog.find((item) => slugify(item.name) === key) ??
    null
  );
}

/** Corpo serializzato di `GET /locations` e relativo ETag forte (con virgolette). */
export interface LocationsDocument {
  body: string;
  etag: string;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function buildDocument(raw: readonly unknown[]): Promise<LocationsDocument> {
  // Confronto per code unit (come `sorted()` di Python e `sort()` di default).
  const locations = loadCatalog(raw)
    .map(({ slug, name, latitude, longitude }) => ({ slug, name, latitude, longitude }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.slug < b.slug ? -1 : 1));
  // L'ETag è l'hash del contenuto (senza `version`, che lo ripete nel corpo).
  const content = { schema_version: LOCATIONS_SCHEMA_VERSION, count: locations.length, locations };
  const version = (await sha256Hex(JSON.stringify(content))).slice(0, 16);
  const body = JSON.stringify({
    schema_version: content.schema_version,
    version,
    count: content.count,
    locations,
  });
  return { body, etag: `"${version}"` };
}

const documents = new WeakMap<object, Promise<LocationsDocument>>();

/** Corpo ed ETag di `/locations`, calcolati una volta per isolate e per catalogo. */
export function locationsDocument(
  raw: readonly unknown[] = rawLocations,
): Promise<LocationsDocument> {
  let document = documents.get(raw);
  if (document === undefined) {
    document = buildDocument(raw);
    documents.set(raw, document);
  }
  return document;
}
