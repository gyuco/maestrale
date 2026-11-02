/**
 * Unico accesso al catalogo delle località nel Worker (FR-61, ADR-0006).
 *
 * Sorgente calda: KV `catalog:current`; sorgente fredda: D1 `CORE` (solo
 * località attive). La memo per isolate (default 30 s, `CATALOG_CACHE_TTL_SECONDS`)
 * tiene `/forecast`, `/locations` e `/history` a ≤ 2 letture storage per
 * richiesta (NFR-19, NFR-33). Se cache e database non sono leggibili il
 * catalogo è `unavailable` e le API rispondono 503 (FR-120).
 */

import type { Bindings, CatalogEntry } from "./env";
import { slugify } from "./slugify";

export type { CatalogEntry };

/** Versione dell'involucro di `GET /locations`. */
export const LOCATIONS_SCHEMA_VERSION = 1;

/** Chiave KV del catalogo attivo (ADR-0006). */
export const CATALOG_CACHE_KEY = "catalog:current";

export const DEFAULT_CATALOG_CACHE_TTL_SECONDS = 30;

/** Catalogo non valido (FR-2): il job rifiuta l'esecuzione, `/locations` risponde 500. */
export class CatalogError extends Error {
  override name = "CatalogError";
}

const REQUIRED_FIELDS = ["slug", "name", "latitude", "longitude"] as const;

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

/** Voci validate di una lista (default: quella in ingresso), memoizzate per riferimento. */
export function loadCatalog(raw: readonly unknown[]): readonly CatalogEntry[] {
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

/** Snapshot del catalogo servito dalle API: corpo, ETag forte e versione. */
export interface CatalogSnapshot {
  locations: readonly CatalogEntry[];
  body: string;
  /** ETag con virgolette, pronto per l'header. */
  etag: string;
  catalogVersion: number;
}

export type CatalogLoad =
  | { status: "ok"; snapshot: CatalogSnapshot }
  | { status: "unavailable"; error: string };

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Corpo ed ETag di `/locations` per una lista di voci. Il confronto è per code
 * unit (come `sorted()` di Python e `sort()` di default); l'ETag è l'hash del
 * contenuto servito (FR-63: cambia se e solo se cambia il contenuto).
 */
export async function buildSnapshot(
  entries: readonly CatalogEntry[],
  catalogVersion = 0,
): Promise<CatalogSnapshot> {
  const locations = [...entries]
    .map(({ slug, name, latitude, longitude }) => ({ slug, name, latitude, longitude }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.slug < b.slug ? -1 : 1));
  const content = { schema_version: LOCATIONS_SCHEMA_VERSION, count: locations.length, locations };
  const version = (await sha256Hex(JSON.stringify(content))).slice(0, 16);
  const body = JSON.stringify({
    schema_version: content.schema_version,
    version,
    count: content.count,
    locations,
  });
  return { locations, body, etag: `"${version}"`, catalogVersion };
}

/** Compatibilità con i test e i percorsi che iniettano una lista (FR-62, FR-63). */
const documents = new WeakMap<object, Promise<CatalogSnapshot>>();

export function locationsDocument(raw: readonly unknown[]): Promise<CatalogSnapshot> {
  let document = documents.get(raw);
  if (document === undefined) {
    document = buildSnapshot(loadCatalog(raw));
    documents.set(raw, document);
  }
  return document;
}

interface Memoized {
  kv: object;
  snapshot: CatalogSnapshot;
  expiresAt: number;
}

let memo: Memoized | null = null;

/** Svuota la memo dell'isolate (test e riparazione dal dispatcher). */
export function resetCatalogMemo(): void {
  memo = null;
}

function ttlMs(value: string | undefined): number {
  const parsed = Number(value);
  return value !== undefined && Number.isInteger(parsed) && parsed >= 0
    ? parsed * 1000
    : DEFAULT_CATALOG_CACHE_TTL_SECONDS * 1000;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function snapshotFromKv(raw: string): Promise<CatalogSnapshot | null> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed["locations"])) return null;
    const version = Number(parsed["catalog_version"]);
    return await buildSnapshot(
      validateLocations(parsed["locations"]),
      Number.isFinite(version) ? version : 0,
    );
  } catch {
    return null;
  }
}

/**
 * Catalogo corrente: memo dell'isolate → KV `catalog:current` → D1 `CORE`
 * (solo attive). Su miss da KV ricostruisce la chiave (best effort).
 */
export async function getCatalog(
  env: Pick<Bindings, "FORECASTS" | "CORE" | "CATALOG_CACHE_TTL_SECONDS">,
  nowMs: () => number = Date.now,
): Promise<CatalogLoad> {
  const now = nowMs();
  if (memo !== null && memo.kv === env.FORECASTS && memo.expiresAt > now) {
    return { status: "ok", snapshot: memo.snapshot };
  }

  try {
    const raw = await env.FORECASTS.get(CATALOG_CACHE_KEY);
    if (raw !== null) {
      const snapshot = await snapshotFromKv(raw);
      if (snapshot !== null) {
        memo = { kv: env.FORECASTS, snapshot, expiresAt: now + ttlMs(env.CATALOG_CACHE_TTL_SECONDS) };
        return { status: "ok", snapshot };
      }
    }
  } catch {
    // Cache illeggibile: si prova il database (FR-120: 503 solo se anche il DB è giù).
  }

  try {
    const snapshot = await refreshCatalogCache(env);
    memo = { kv: env.FORECASTS, snapshot, expiresAt: now + ttlMs(env.CATALOG_CACHE_TTL_SECONDS) };
    return { status: "ok", snapshot };
  } catch (error) {
    return { status: "unavailable", error: errorMessage(error) };
  }
}

/** Legge il catalogo attivo da D1 (2 query) e lo trasforma nello snapshot servito. */
async function readActiveCatalog(
  env: Pick<Bindings, "CORE">,
): Promise<CatalogSnapshot> {
  const rows = await env.CORE.prepare(
    "SELECT slug, name, latitude, longitude FROM locations WHERE active = 1 ORDER BY name",
  ).all<CatalogEntry>();
  const meta = await env.CORE.prepare("SELECT version FROM catalog_meta WHERE id = 1").first<{
    version: number;
  }>();
  return await buildSnapshot(validateLocations(rows.results ?? []), meta?.version ?? 0);
}

/**
 * Ricostruisce `catalog:current` dal database e svuota la memo dell'isolate.
 * Usata dopo una scrittura del backoffice (FR-101) e dal dispatcher (ADR-0009).
 */
export async function refreshCatalogCache(
  env: Pick<Bindings, "FORECASTS" | "CORE">,
): Promise<CatalogSnapshot> {
  const snapshot = await readActiveCatalog(env);
  try {
    await env.FORECASTS.put(
      CATALOG_CACHE_KEY,
      JSON.stringify({
        schema_version: LOCATIONS_SCHEMA_VERSION,
        catalog_version: snapshot.catalogVersion,
        etag: snapshot.etag.slice(1, -1),
        locations: snapshot.locations,
      }),
    );
  } catch {
    // La `put` è best effort: il dispatcher ripara la chiave (ADR-0009).
  }
  resetCatalogMemo();
  return snapshot;
}
