import type { ForecastCache } from "./types";

/** Chiave unica del payload su Workers KV (FR-19). */
export const CACHE_KEY = "latest";

/**
 * Esito della lettura del cache, come valore tipizzato (mai un'eccezione):
 *
 * - `ok` — JSON valido, interpretato come `ForecastCache` (il confine di fiducia);
 * - `missing` — la chiave non esiste ancora (job mai eseguito, FR-24);
 * - `unreadable` — la lettura o il parse sono falliti (FR-26, FR-24).
 */
export type CacheReadResult =
  | { status: "ok"; payload: ForecastCache }
  | { status: "missing" }
  | { status: "unreadable"; error: string };

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Legge il payload previsioni da Workers KV.
 *
 * Replica `ForecastStore.read` di `backend/main.py`, con la stessa gestione dei
 * due casi d'errore (file assente → `None`; lettura/parse falliti → `RuntimeError`
 * con testo `"Cache forecast non leggibile: <causa>"`). La lettura non lancia:
 * l'errore è parte del valore restituito.
 *
 * L'unica asserzione su dati non tipizzati è `as ForecastCache` su `JSON.parse`:
 * come il `json.load` di Python, il payload non è validato a runtime (i tipi
 * descrivono il contratto congelato, `tests/fixtures/forecast.schema.json`).
 */
export async function readForecastCache(
  kv: KVNamespace,
  key: string = CACHE_KEY,
): Promise<CacheReadResult> {
  let raw: string | null;
  try {
    raw = await kv.get(key);
  } catch (cause) {
    return { status: "unreadable", error: `Cache forecast non leggibile: ${describe(cause)}` };
  }

  if (raw === null) {
    return { status: "missing" };
  }

  try {
    return { status: "ok", payload: JSON.parse(raw) as ForecastCache };
  } catch (cause) {
    return { status: "unreadable", error: `Cache forecast non leggibile: ${describe(cause)}` };
  }
}

/** Chiave dei metadati dell'ultima esecuzione (FR-55, ADR-0003 §1). */
export const META_KEY = "meta";

/** Chiave del record di una località (FR-55). */
export function recordKey(slug: string): string {
  return `forecast:${slug}`;
}

/** Metadati dell'esecuzione (FR-55, ADR-0003 §1). Non validati a runtime. */
export interface ForecastMeta {
  schema_version: number;
  generated_at: string | null;
  updated_locations: string[];
  errors: Record<string, string>;
  locations: number;
  /** Slug con un record valido. */
  slugs: string[];
}

export type KeyReadResult<T> =
  | { status: "ok"; value: T }
  | { status: "missing" }
  | { status: "unreadable"; error: string };

function parseKey<T>(raw: string | null | undefined): KeyReadResult<T> {
  if (raw === null || raw === undefined) {
    return { status: "missing" };
  }
  try {
    return { status: "ok", value: JSON.parse(raw) as T };
  } catch (cause) {
    return { status: "unreadable", error: `Cache forecast non leggibile: ${describe(cause)}` };
  }
}

/** Legge e interpreta (senza validare) una chiave JSON: mai un'eccezione. */
export async function readJsonKey<T>(kv: KVNamespace, key: string): Promise<KeyReadResult<T>> {
  try {
    return parseKey<T>(await kv.get(key));
  } catch (cause) {
    return { status: "unreadable", error: `Cache forecast non leggibile: ${describe(cause)}` };
  }
}

export function readMeta(kv: KVNamespace): Promise<KeyReadResult<ForecastMeta>> {
  return readJsonKey<ForecastMeta>(kv, META_KEY);
}

/**
 * Legge più chiavi in **una** operazione KV (`get([...])`, max 100 chiavi). Se il
 * bulk non è disponibile (ambiente di test, runtime vecchio) ripiega su letture
 * parallele: per `/forecast` sono comunque 2 operazioni (NFR-19).
 */
export async function readManyRaw(
  kv: KVNamespace,
  keys: readonly string[],
): Promise<Map<string, string | null>> {
  try {
    return await kv.get([...keys], "text");
  } catch {
    const values = await Promise.all(keys.map((key) => kv.get(key)));
    return new Map(keys.map((key, index) => [key, values[index] ?? null]));
  }
}

/** Record di una località e meta, letti insieme (FR-57). */
export async function readRecordAndMeta<R>(
  kv: KVNamespace,
  slug: string,
): Promise<
  | { record: KeyReadResult<R>; meta: KeyReadResult<ForecastMeta> }
  | { error: string }
> {
  const key = recordKey(slug);
  let raw: Map<string, string | null>;
  try {
    raw = await readManyRaw(kv, [key, META_KEY]);
  } catch (cause) {
    return { error: `Cache forecast non leggibile: ${describe(cause)}` };
  }
  return {
    record: parseKey<R>(raw.get(key)),
    meta: parseKey<ForecastMeta>(raw.get(META_KEY)),
  };
}
