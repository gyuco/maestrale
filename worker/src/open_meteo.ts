/**
 * Port di `previsioni_mare.fetch_json` (FR-17) e helper di concorrenza.
 *
 * Comportamento replicato dal Python:
 *
 * - URL costruito con `urlencode` (query string `quote_plus`: spazio → `+`),
 *   header `User-Agent: copernicus-sea-app/0.1`, timeout 30 s per tentativo.
 * - Fino a 3 tentativi; tra un tentativo e il successivo attesa progressiva
 *   `2 ** attempt` secondi (1 s, poi 2 s).
 * - Una risposta con campo `error` è un **fallimento immediato** (usa `reason`),
 *   non un errore da ritentare: in Python `RuntimeError` non è fra le eccezioni
 *   catturate dal retry.
 *
 * `fetchImpl` e `sleep` sono iniettabili, così i test non attendono davvero.
 */

import type { RequestParams } from "./data_sources";

/** Header richiesto da Python (`Request(url, headers={"User-Agent": ...})`). */
export const USER_AGENT = "copernicus-sea-app/0.1";
/** Tentativi complessivi del Python (`retries: int = 3`). */
export const DEFAULT_RETRIES = 3;
/** Timeout per tentativo del Python (`urlopen(..., timeout=30)`). */
export const REQUEST_TIMEOUT_MS = 30_000;
/** Limite di connessioni simultanee verso i provider (NFR-15, Workers). */
export const MAX_CONCURRENCY = 6;

/** Payload JSON generico restituito da `fetchJson`. */
export type JsonObject = Record<string, unknown>;
/** `fetch` iniettabile (default: quello del runtime Workers). */
export type FetchImpl = typeof fetch;
/** Attesa iniettabile (default: `setTimeout`). */
export type SleepFn = (milliseconds: number) => Promise<void>;

export interface FetchJsonOptions {
  readonly fetchImpl?: FetchImpl;
  readonly sleep?: SleepFn;
  readonly retries?: number;
  readonly timeoutMs?: number;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Percent-encoding di `quote_plus` (default di `urlencode`): oltre a
 * `encodeURIComponent` codifica `! * ' ( )` e rende lo spazio `+`.
 */
function quotePlus(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

/** Costruisce l'URL come `f"{base_url}?{urlencode(params)}"`, nello stesso ordine di chiavi. */
export function buildUrl(baseUrl: string, params: RequestParams): string {
  const pairs: ReadonlyArray<readonly [string, unknown]> = Object.entries(params);
  const query = pairs
    .map(([key, value]) => `${quotePlus(key)}=${quotePlus(String(value))}`)
    .join("&");
  return `${baseUrl}?${query}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Scarica e valida una risposta JSON, con retry progressivo (FR-17). */
export async function fetchJson(
  baseUrl: string,
  params: RequestParams,
  options: FetchJsonOptions = {},
): Promise<JsonObject> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const url = buildUrl(baseUrl, params);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    let payload: unknown;
    try {
      const response = await fetchImpl(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      // `urlopen` solleva HTTPError sui non-2xx: stesso effetto per il retry.
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} per ${url}`);
      }
      payload = await response.json();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < retries) {
        await sleep(2 ** attempt * 1000);
      }
      continue;
    }
    if (!isRecord(payload)) {
      // In Python `payload.get(...)` su un JSON non-oggetto solleva e non è
      // catturato dal retry: stesso comportamento qui.
      throw new TypeError(`Risposta JSON non oggetto per ${url}`);
    }
    if (payload["error"]) {
      const reason = payload["reason"];
      throw new Error(typeof reason === "string" ? reason : "Errore API sconosciuto");
    }
    return payload;
  }

  throw new Error(`Impossibile consultare ${baseUrl}: ${describeError(lastError)}`);
}

/**
 * Esegue `task` su ogni elemento con al più `limit` esecuzioni simultanee,
 * preservando l'ordine dei risultati. Il default è `MAX_CONCURRENCY` (6), il
 * tetto di subrequest simultanee dei Workers (NFR-15); usato dal job (E01-S04)
 * per non aprire più di 6 connessioni verso Open-Meteo.
 *
 * Gli elementi `undefined` vengono saltati (non attesi: il tipo `T` non li
 * prevede). `limit` è forzato a un intero ≥ 1.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  task: (item: T, index: number) => Promise<R>,
  limit: number = MAX_CONCURRENCY,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const workers = Math.min(Math.max(Math.trunc(limit), 1), items.length);
  let next = 0;
  const run = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) {
        continue;
      }
      results[index] = await task(item, index);
    }
  };
  await Promise.all(Array.from({ length: workers }, run));
  return results;
}
