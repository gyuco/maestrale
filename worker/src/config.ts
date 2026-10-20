/**
 * Parametri del job di aggiornamento (ADR-0003 §4, §5). Tutti hanno un default
 * nel codice e sono sovrascrivibili da variabili d'ambiente (nessuna modifica
 * di codice per passare da Free a Paid o per cambiare le soglie aperte
 * OQ-28/OQ-29).
 */

export interface UpdateConfig {
  /** Località per richiesta multi-coordinata (FR-53): 1..100, default 50. */
  blockSize: number;
  /** Interruttore del fallback (FR-54, OQ-28): fallback saltato se rapporto > soglia. */
  breakerThreshold: number;
  /** Tetto di subrequest per esecuzione, KV incluse (NFR-15): 45 su Free. */
  maxSubrequests: number;
  /** Budget di durata dell'esecuzione in secondi (NFR-5): 12 min su 15. */
  budgetSeconds: number;
  /** Richieste Open-Meteo in volo (NFR-17), 1..6. */
  concurrency: number;
  /** Chiamate pesate al minuto verso Open-Meteo (NFR-20): metà del limite di 600. */
  maxWeightPerMin: number;
  /** Avviso Paid: subrequest dell'esecuzione oltre questa soglia (NFR-15 b). */
  paidAlertSubrequests: number;
  /** Avviso Paid: scritture KV/giorno oltre questa soglia (NFR-15 c, OQ-29). */
  paidAlertKvWritesPerDay: number;
  /** Esecuzioni al giorno (cron ogni 6 h, FR-49), per stimare le scritture/giorno. */
  runsPerDay: number;
}

export const DEFAULT_UPDATE_CONFIG: UpdateConfig = {
  blockSize: 50,
  breakerThreshold: 0.5,
  maxSubrequests: 45,
  budgetSeconds: 720,
  concurrency: 4,
  maxWeightPerMin: 300,
  paidAlertSubrequests: 40,
  paidAlertKvWritesPerDay: 700,
  runsPerDay: 4,
};

export const MAX_BLOCK_SIZE = 100;
export const MAX_CONCURRENCY = 6;

/** Variabili d'ambiente lette dal job (tutte opzionali, stringhe come in `vars`). */
export interface UpdateEnv {
  OPEN_METEO_BLOCK_SIZE?: string;
  FALLBACK_BREAKER_THRESHOLD?: string;
  UPDATE_MAX_SUBREQUESTS?: string;
  UPDATE_BUDGET_SECONDS?: string;
  UPDATE_CONCURRENCY?: string;
  OPEN_METEO_MAX_WEIGHT_PER_MIN?: string;
  PAID_ALERT_SUBREQUESTS?: string;
  PAID_ALERT_KV_WRITES_PER_DAY?: string;
}

function parse(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function updateConfigFromEnv(env: UpdateEnv): Partial<UpdateConfig> {
  const entries: Partial<Record<keyof UpdateConfig, number | undefined>> = {
    blockSize: parse(env.OPEN_METEO_BLOCK_SIZE),
    breakerThreshold: parse(env.FALLBACK_BREAKER_THRESHOLD),
    maxSubrequests: parse(env.UPDATE_MAX_SUBREQUESTS),
    budgetSeconds: parse(env.UPDATE_BUDGET_SECONDS),
    concurrency: parse(env.UPDATE_CONCURRENCY),
    maxWeightPerMin: parse(env.OPEN_METEO_MAX_WEIGHT_PER_MIN),
    paidAlertSubrequests: parse(env.PAID_ALERT_SUBREQUESTS),
    paidAlertKvWritesPerDay: parse(env.PAID_ALERT_KV_WRITES_PER_DAY),
  };
  const config: Partial<UpdateConfig> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) {
      config[key as keyof UpdateConfig] = value;
    }
  }
  return config;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Applica default e limiti: i valori fuori intervallo sono riportati nel range ammesso. */
export function resolveUpdateConfig(partial: Partial<UpdateConfig> = {}): UpdateConfig {
  const merged = { ...DEFAULT_UPDATE_CONFIG, ...partial };
  return {
    blockSize: clamp(Math.trunc(merged.blockSize), 1, MAX_BLOCK_SIZE),
    breakerThreshold: clamp(merged.breakerThreshold, 0, 1),
    maxSubrequests: Math.max(Math.trunc(merged.maxSubrequests), 1),
    budgetSeconds: Math.max(merged.budgetSeconds, 1),
    concurrency: clamp(Math.trunc(merged.concurrency), 1, MAX_CONCURRENCY),
    maxWeightPerMin: Math.max(merged.maxWeightPerMin, 1),
    paidAlertSubrequests: merged.paidAlertSubrequests,
    paidAlertKvWritesPerDay: merged.paidAlertKvWritesPerDay,
    runsPerDay: Math.max(merged.runsPerDay, 1),
  };
}
