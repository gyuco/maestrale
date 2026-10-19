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
export interface Bindings extends Env {
  /** Origini CORS consentite, separate da virgola (default `*`). */
  CORS_ORIGINS?: string;
  /** Soglia di dati vecchi in ore (default `12`). */
  FORECAST_MAX_AGE_HOURS?: string;
}

/** Sottoinsieme dell'ambiente che basta alla risoluzione delle origini CORS. */
export interface CorsEnv {
  CORS_ORIGINS?: string;
}
