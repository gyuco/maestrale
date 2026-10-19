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
