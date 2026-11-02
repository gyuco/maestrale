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
  /** D1 `maestrale-history` (storico giornaliero, ADR-0002); assenza a runtime gestita da E02-S02/S03. */
  HISTORY: D1Database;
  /** D1 `maestrale-core` (catalogo e registri, ADR-0006/0008/0009). */
  CORE: D1Database;
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
  /** `max-age` breve di `/history` se `to` >= oggi Europe/Rome (default 900, FR-79). */
  HISTORY_MAX_AGE_SHORT_SECONDS?: string;
  /** `max-age` lungo di `/history` se l'intervallo è interamente nel passato (default 86400). */
  HISTORY_MAX_AGE_LONG_SECONDS?: string;
  /** TTL della memo del catalogo per isolate (default 30, ADR-0006, NFR-33). */
  CATALOG_CACHE_TTL_SECONDS?: string;
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
  Variables: {
    /** Catalogo risolto per la richiesta; `null` se non disponibile (FR-120). */
    catalog: readonly CatalogEntry[] | null;
    /** Corpo ed ETag di `/locations`, già calcolati. */
    catalogDocument?: { body: string; etag: string };
    /** Motivo tecnico dell'indisponibilità (solo log/500, mai esposto come 503). */
    catalogError?: string;
    /** `true` = cache e database non leggibili → 503; `false` = catalogo non valido → 500. */
    catalogUnavailable?: boolean;
  };
}

/** Sottoinsieme dell'ambiente che basta alla risoluzione delle origini CORS. */
export interface CorsEnv {
  CORS_ORIGINS?: string;
}
