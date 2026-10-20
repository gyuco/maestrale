import type { UpdateEnv } from "./config";

/**
 * Binding del Worker: il KV `FORECASTS` generato da `wrangler types` (E01-S01)
 * più le variabili di configurazione di FR-28, che su Workers arrivano
 * dall'ambiente della richiesta (come `os.getenv` in `backend/main.py`).
 *
 * Sono **opzionali**: i default (`CORS_ORIGINS=*`, `FORECAST_MAX_AGE_HOURS=12`)
 * vivono nel codice, così il Worker funziona anche senza `vars` in
 * `wrangler.jsonc` e i test possono iniettare valori diversi senza rigenerare
 * i tipi.
 */
export interface Bindings extends Env, UpdateEnv {
  /** Origini CORS consentite, separate da virgola (default `*`). */
  CORS_ORIGINS?: string;
  /** Soglia di dati vecchi in ore (default `12`). */
  FORECAST_MAX_AGE_HOURS?: string;
  /**
   * Ripiego di migrazione (ADR-0003 §2): con `meta` presente ma record assente,
   * `/forecast` serve la località da `latest` se contiene lo slug. Attivo salvo
   * `false`/`0`; si disattiva con la dismissione di `latest` (FR-60).
   */
  LEGACY_LATEST_FALLBACK?: string;
  /** `max-age` in secondi del `Cache-Control` di `GET /locations` (default 86400, FR-63). */
  LOCATIONS_MAX_AGE_SECONDS?: string;
}

/** Voce del catalogo incluso nel Worker (nome -> slug senza leggere lo storage, FR-57). */
export interface CatalogEntry {
  slug: string;
  name: string;
  latitude: number;
  longitude: number;
}

/**
 * Tipi dell'app Hono: binding e catalogo per richiesta. `catalog` è la lista
 * iniettata/inclusa: la validazione è in `catalog.ts` (`loadCatalog`).
 */
export interface AppEnv {
  Bindings: Bindings;
  Variables: { catalog: readonly CatalogEntry[] };
}

/** Sottoinsieme dell'ambiente che basta alla risoluzione delle origini CORS. */
export interface CorsEnv {
  CORS_ORIGINS?: string;
}
