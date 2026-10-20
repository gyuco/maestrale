/**
 * Job di aggiornamento delle previsioni (FR-1, FR-2, FR-14, FR-18, FR-19,
 * FR-52..FR-55, FR-59; ADR-0003 §1 e §4).
 *
 * 1. Richieste Open-Meteo multi-coordinata a blocchi (FR-53): una Marine e una
 *    Forecast per blocco, retry per tentativo (FR-17).
 * 2. Interruttore (FR-54): con più di `breakerThreshold` richieste di blocco
 *    fallite non parte alcuna richiesta singola.
 * 3. Altrimenti fallback per singola località, solo per il provider mancante.
 * 4. Budget di durata, tetto di subrequest e limite di peso/minuto (NFR-5,
 *    NFR-15, NFR-20): ciò che non può essere tentato finisce in `errors`.
 * 5. Scrittura: un record `forecast:<slug>` per località aggiornata, poi `meta`
 *    per ultima. `latest` non è mai scritto (FR-59); alla prima esecuzione
 *    (`meta` assente) le località non aggiornabili sono copiate da `latest`.
 *
 * Se **nessuna** località è aggiornata non si scrive nulla: `generated_at`
 * invecchia e `/health` segnala `stale` (decisione del product owner, 2026-10-19).
 */

import {
  resolveUpdateConfig,
  type UpdateConfig,
} from "./config";
import { validateLocations, type CatalogEntry } from "./catalog";
import { MARINE_SOURCE, WEATHER_SOURCE, type DataSource } from "./data_sources";
import { buildForecastFromPayloads, type ForecastDeps } from "./forecast";
import {
  defaultSleep,
  fetchJson,
  fetchJsonList,
  mapWithConcurrency,
  REQUEST_TIMEOUT_MS,
  type SleepFn,
} from "./open_meteo";
import { dayZeroRow, romeDate, type HistoryRow } from "./history";
import type { HistoryWriter } from "./history_store";
import { CACHE_KEY, META_KEY, readForecastCache, readMeta, recordKey, type ForecastMeta } from "./store";
import type { Forecast } from "./types";

/** Giorni di previsione (FR-14; la configurabilità è OQ-18). */
const FORECAST_DAYS = 7;

/** Voce valida del catalogo `locations.json` (definita in `catalog.ts`). */
export type CatalogLocation = CatalogEntry;

export interface UpdateDeps extends Pick<ForecastDeps, "fetchImpl" | "sleep" | "now"> {
  readonly days?: number;
  /** Orologio in millisecondi (budget di durata e limite di peso/minuto); default `Date.now`. */
  readonly nowMs?: () => number;
  /** Sovrascrive i parametri di `config.ts` (di norma letti dall'ambiente). */
  readonly config?: Partial<UpdateConfig>;
  /** Scrittore dello storico D1 (ADR-0002 §2.7); assente = nessuno storico. */
  readonly history?: HistoryWriter;
}

export const BREAKER_MESSAGE =
  "Aggiornamento non tentato: interruttore del fallback attivo (guasto diffuso del provider)";
export const BUDGET_DURATION_MESSAGE = "Aggiornamento non tentato: budget di durata esaurito";
export const BUDGET_SUBREQUESTS_MESSAGE =
  "Aggiornamento non tentato: budget di subrequest esaurito";

/** Misure dell'esecuzione (NFR-21), riportate nel log `forecast_update`. */
export interface UpdateMetrics {
  /** Blocchi per provider. */
  blocks: number;
  /** Richieste di blocco previste (Marine + Forecast). */
  block_requests: number;
  /** Richieste di blocco fallite dopo tutti i tentativi (esclusi i non tentati per budget). */
  block_failures: number;
  /** Località messe in coda per richieste singole. */
  fallbacks: number;
  /** Subrequest: tentativi verso il provider + operazioni KV. */
  subrequests: number;
  kv_writes: number;
  kv_deletes: number;
  /** Chiamate pesate consumate verso Open-Meteo (retry inclusi). */
  weight_used: number;
  budget_exhausted: "none" | "duration" | "subrequests";
  /** Motivi per cui conviene passare a Paid (NFR-15 b, c). */
  paid_alerts: string[];
  /** Data Europe/Rome del giorno 0 (assente senza `deps.history` o senza località aggiornate). */
  history_date?: string;
  /** Righe di storico scritte. */
  history_rows: number;
  /** Istruzioni D1 eseguite (contate come subrequest). */
  history_queries: number;
  /** Righe non scritte per errore D1 (FR-72). */
  history_failed: number;
  history_error?: string;
  /** Località aggiornate senza il giorno 0 nella previsione (FR-70). */
  history_missing_day0: string[];
  /** `meta.rows_written` riportato da D1 (indici inclusi), se presente. */
  d1_rows_written?: number;
  /** `meta.size_after` riportato da D1, in byte, se presente. */
  d1_size_bytes?: number;
}

/** Esito del job: il payload logico più `written` (false = KV non toccata). */
export interface UpdateResult {
  written: boolean;
  generated_at: string;
  updated_locations: string[];
  errors: Record<string, string>;
  /** `true` se l'interruttore del fallback è scattato (FR-54). */
  fallback_breaker: boolean;
  metrics: UpdateMetrics;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type BudgetKind = "duration" | "subrequests";

/** Richiesta non tentata perché un budget è esaurito: non è un fallimento del provider. */
class BudgetExhausted extends Error {
  constructor(readonly kind: BudgetKind) {
    super(budgetMessage(kind));
  }
}

function budgetMessage(kind: BudgetKind): string {
  return kind === "duration" ? BUDGET_DURATION_MESSAGE : BUDGET_SUBREQUESTS_MESSAGE;
}

const WINDOW_MS = 60_000;

/**
 * Budget dell'esecuzione: tetto di subrequest (con riserva per le scritture KV),
 * scadenza di durata e finestra mobile di 60 s sul peso verso Open-Meteo.
 * Ogni **tentativo** (anche i retry) passa da `beforeAttempt`.
 */
class RunBudget {
  subrequests: number;
  weightUsed = 0;
  exhausted: "none" | BudgetKind = "none";
  private readonly log: { at: number; weight: number }[] = [];
  private readonly deadline: number;

  constructor(
    private readonly config: UpdateConfig,
    private readonly nowMs: () => number,
    private readonly sleep: SleepFn,
    startMs: number,
    initialSubrequests: number,
    private readonly reservedForWrites: number,
  ) {
    this.subrequests = initialSubrequests;
    this.deadline = startMs + this.config.budgetSeconds * 1000;
  }

  async beforeAttempt(weight: number): Promise<void> {
    if (this.subrequests + 1 + this.reservedForWrites > this.config.maxSubrequests) {
      this.fail("subrequests");
    }
    // Riserva subito il posto: più richieste concorrenti non devono sforare il tetto.
    this.subrequests += 1;
    try {
      await this.acquire(Math.min(weight, this.config.maxWeightPerMin));
    } catch (error) {
      this.subrequests -= 1;
      throw error;
    }
  }

  private fail(kind: BudgetKind): never {
    if (this.exhausted === "none") {
      this.exhausted = kind;
    }
    throw new BudgetExhausted(kind);
  }

  private async acquire(weight: number): Promise<void> {
    for (;;) {
      const now = this.nowMs();
      // Nessuna richiesta parte se non può concludersi entro la scadenza.
      if (now + REQUEST_TIMEOUT_MS > this.deadline) {
        this.fail("duration");
      }
      while (this.log.length > 0 && this.log[0]!.at <= now - WINDOW_MS) {
        this.log.shift();
      }
      const used = this.log.reduce((total, entry) => total + entry.weight, 0);
      if (used + weight <= this.config.maxWeightPerMin) {
        this.log.push({ at: now, weight });
        this.weightUsed += weight;
        return;
      }
      let freed = 0;
      let waitUntil = now + 1;
      for (const entry of this.log) {
        freed += entry.weight;
        if (used - freed + weight <= this.config.maxWeightPerMin) {
          waitUntil = entry.at + WINDOW_MS;
          break;
        }
      }
      await this.sleep(Math.max(waitUntil - now, 1));
    }
  }
}

type ProviderName = "marine" | "weather";
const PROVIDERS: Record<ProviderName, DataSource> = {
  marine: MARINE_SOURCE,
  weather: WEATHER_SOURCE,
};
const TIMEZONE = "Europe/Rome";

/** Peso Open-Meteo di una località: `max(1, giorni/14 * variabili/10)` (ADR-0003). */
function locationWeight(source: DataSource, days: number): number {
  const variables = source.hourlyVariables.length + source.dailyVariables.length;
  return Math.max(1, (days / 14) * (variables / 10));
}

type BlockResult =
  | { ok: true; list: unknown[]; fetchedAt: string }
  | { ok: false; error: string; budget?: BudgetKind };

/** Stato di una località durante l'esecuzione. */
interface Pending {
  entry: CatalogLocation;
  elements: Partial<Record<ProviderName, Record<string, unknown>>>;
  fetchedAt: Partial<Record<ProviderName, string>>;
  needs: ProviderName[];
  /** Errore già definitivo (budget). */
  error?: string;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Elemento utilizzabile di una risposta a blocco: oggetto senza errore del provider. */
function validElement(value: unknown): Record<string, unknown> | null {
  return isRecord(value) && !value["error"] && "latitude" in value ? value : null;
}

/** Esegue l'aggiornamento. Lancia solo per catalogo invalido (FR-2) o `KV.put` fallita. */
export async function runUpdate(
  kv: KVNamespace,
  rawLocations: readonly unknown[],
  deps: UpdateDeps = {},
): Promise<UpdateResult> {
  const catalog = validateLocations(rawLocations);
  const config = resolveUpdateConfig(deps.config);
  const now = deps.now ?? ((): string => new Date().toISOString());
  const nowMs = deps.nowMs ?? ((): number => Date.now());
  const sleep = deps.sleep ?? defaultSleep;
  const days = deps.days ?? FORECAST_DAYS;
  const startMs = nowMs();
  const catalogSlugs = new Set(catalog.map((entry) => entry.slug));

  // Letture KV iniziali: meta (sempre) e `latest` (solo alla prima esecuzione, FR-59).
  let kvReads = 1;
  const previousMeta = await readMeta(kv);
  const migrating = previousMeta.status === "missing";
  const previousSlugs =
    previousMeta.status === "ok" && isRecord(previousMeta.value)
      ? stringArray(previousMeta.value.slugs)
      : [];
  let legacyLocations: Record<string, unknown> = {};
  if (migrating) {
    kvReads += 1;
    const legacy = await readForecastCache(kv, CACHE_KEY);
    const payload: unknown = legacy.status === "ok" ? legacy.payload : null;
    const locations = isRecord(payload) ? payload["locations"] : null;
    legacyLocations = isRecord(locations) ? locations : {};
  }
  const removed = previousSlugs.filter((slug) => !catalogSlugs.has(slug));
  const startIso = deps.history ? now() : undefined;
  const historyQueries = deps.history ? Math.ceil(catalog.length / config.historyWriteBatchRows) : 0;
  const budget = new RunBudget(
    config,
    nowMs,
    sleep,
    startMs,
    kvReads,
    catalog.length + removed.length + 1 + historyQueries,
  );

  // --- Fase blocchi -------------------------------------------------------
  const chunks = chunk(catalog, config.blockSize);
  const tasks = chunks.flatMap((locations, index) =>
    (["marine", "weather"] as const).map((provider) => ({ provider, locations, index })),
  );
  const blockResults = await mapWithConcurrency(
    tasks,
    async ({ provider, locations }): Promise<BlockResult> => {
      const source = PROVIDERS[provider];
      const weight = locations.length * locationWeight(source, days);
      try {
        const list = await fetchJsonList(
          source.endpoint,
          source.requestParams(
            locations.map((item) => item.latitude).join(","),
            locations.map((item) => item.longitude).join(","),
            days,
            TIMEZONE,
          ),
          { fetchImpl: deps.fetchImpl, sleep: deps.sleep, beforeAttempt: () => budget.beforeAttempt(weight) },
        );
        if (list.length !== locations.length) {
          // Non mappabile località per località: blocco fallito, non ritentato.
          return {
            ok: false,
            error: `Risposta a blocco di lunghezza inattesa: ${list.length} elementi per ${locations.length} località`,
          };
        }
        return { ok: true, list, fetchedAt: now() };
      } catch (cause) {
        if (cause instanceof BudgetExhausted) {
          return { ok: false, error: cause.message, budget: cause.kind };
        }
        return { ok: false, error: describe(cause) };
      }
    },
    config.concurrency,
  );
  const blockFailures = blockResults.filter((result) => !result.ok && result.budget === undefined).length;

  // Classificazione per località.
  const pending: Pending[] = [];
  tasks.forEach((task, taskIndex) => {
    if (task.provider !== "marine") {
      return;
    }
    const marine = blockResults[taskIndex]!;
    const weather = blockResults[taskIndex + 1]!;
    task.locations.forEach((entry, position) => {
      const item: Pending = { entry, elements: {}, fetchedAt: {}, needs: [] };
      for (const [provider, result] of [["marine", marine], ["weather", weather]] as const) {
        if (!result.ok) {
          if (result.budget !== undefined) {
            item.error = budgetMessage(result.budget);
          }
          item.needs.push(provider);
          continue;
        }
        const element = validElement(result.list[position]);
        if (element === null) {
          item.needs.push(provider);
        } else {
          item.elements[provider] = element;
          item.fetchedAt[provider] = result.fetchedAt;
        }
      }
      pending.push(item);
    });
  });

  // --- Interruttore del fallback (una sola valutazione, prima delle singole) ---
  const blockRequests = tasks.length;
  const breaker = blockRequests > 0 && blockFailures > config.breakerThreshold * blockRequests;

  const forecasts = new Map<string, Forecast>();
  const errors: Record<string, string> = {};
  const build = (item: Pending): Forecast => {
    const built = buildForecastFromPayloads(
      item.entry.name,
      item.entry.latitude,
      item.entry.longitude,
      days,
      TIMEZONE,
      {
        marine: item.elements.marine!,
        weather: item.elements.weather!,
        marineFetchedAt: item.fetchedAt.marine!,
        weatherFetchedAt: item.fetchedAt.weather!,
      },
      now,
    );
    return { ...built, location: { ...built.location, slug: item.entry.slug } };
  };

  const fallbackQueue: Pending[] = [];
  for (const item of pending) {
    if (item.error !== undefined) {
      errors[item.entry.slug] = item.error;
    } else if (item.needs.length === 0) {
      try {
        forecasts.set(item.entry.slug, build(item));
      } catch {
        // Dati non validi in un blocco riuscito (FR-54): richiesta singola di entrambi.
        item.needs = ["marine", "weather"];
        item.elements = {};
        item.fetchedAt = {};
        fallbackQueue.push(item);
      }
    } else {
      fallbackQueue.push(item);
    }
  }

  // --- Fase fallback ------------------------------------------------------
  let fallbacks = 0;
  if (breaker) {
    for (const item of fallbackQueue) {
      errors[item.entry.slug] = BREAKER_MESSAGE;
    }
  } else {
    fallbacks = fallbackQueue.length;
    await mapWithConcurrency(
      fallbackQueue,
      async (item) => {
        try {
          for (const provider of item.needs) {
            const source = PROVIDERS[provider];
            const weight = locationWeight(source, days);
            item.elements[provider] = await fetchJson(
              source.endpoint,
              source.requestParams(item.entry.latitude, item.entry.longitude, days, TIMEZONE),
              {
                fetchImpl: deps.fetchImpl,
                sleep: deps.sleep,
                beforeAttempt: () => budget.beforeAttempt(weight),
              },
            );
            item.fetchedAt[provider] = now();
          }
          forecasts.set(item.entry.slug, build(item));
        } catch (cause) {
          errors[item.entry.slug] = describe(cause);
        }
      },
      config.concurrency,
    );
  }

  const updated = catalog.filter((entry) => forecasts.has(entry.slug)).map((entry) => entry.slug);
  const generatedAt = now();

  // --- Scritture: record, cancellazioni, `meta` per ultima ------------------
  let kvWrites = 0;
  let kvDeletes = 0;
  let written = false;
  if (updated.length > 0) {
    const puts: Array<[string, string]> = updated.map((slug) => [
      recordKey(slug),
      JSON.stringify(forecasts.get(slug)),
    ]);
    const known = new Set(migrating ? [] : previousSlugs);
    if (migrating) {
      // FR-59: le località di `latest` non aggiornate ricevono il proprio record.
      for (const entry of catalog) {
        const legacy = legacyLocations[entry.slug];
        if (!forecasts.has(entry.slug) && legacy !== undefined) {
          puts.push([recordKey(entry.slug), JSON.stringify(legacy)]);
          known.add(entry.slug);
        }
      }
    }
    for (const slug of updated) {
      known.add(slug);
    }
    await mapWithConcurrency(puts, ([key, value]) => kv.put(key, value), 6);
    kvWrites += puts.length;
    await mapWithConcurrency(removed, (slug) => kv.delete(recordKey(slug)), 6);
    kvDeletes += removed.length;

    const slugs = [...known].filter((slug) => catalogSlugs.has(slug)).sort();
    const meta: ForecastMeta = {
      schema_version: 1,
      generated_at: generatedAt,
      updated_locations: [...updated].sort(),
      errors,
      locations: slugs.length,
      slugs,
    };
    await kv.put(META_KEY, JSON.stringify(meta));
    kvWrites += 1;
    written = true;
  }

  // --- Storico D1 dopo la pubblicazione del cache (ADR-0002 §2; FR-70..FR-72) ---
  const history: Pick<
    UpdateMetrics,
    | "history_date"
    | "history_rows"
    | "history_queries"
    | "history_failed"
    | "history_error"
    | "history_missing_day0"
    | "d1_rows_written"
    | "d1_size_bytes"
  > = { history_rows: 0, history_queries: 0, history_failed: 0, history_missing_day0: [] };
  let d1SizeAfter: number | undefined;
  if (deps.history && written) {
    const writer = deps.history;
    const rows: HistoryRow[] = [];
    try {
      const date = romeDate(new Date(startIso!));
      history.history_date = date;
      for (const slug of updated) {
        const row = dayZeroRow(slug, forecasts.get(slug)!, date);
        if (row === null) {
          history.history_missing_day0.push(slug);
        } else {
          rows.push(row);
        }
      }
      if (rows.length > 0) {
        const outcome = await writer.write(rows, config.historyWriteBatchRows);
        history.history_queries = outcome.queries;
        if (outcome.ok) {
          history.history_rows = outcome.rows_written;
          d1SizeAfter = outcome.size_after;
          history.d1_rows_written = outcome.rows_written_meta;
          history.d1_size_bytes = outcome.size_after;
        } else {
          history.history_failed = outcome.rows_failed;
          history.history_error = outcome.error;
        }
      }
    } catch (cause) {
      // Il writer non dovrebbe lanciare; in ogni caso il cache resta intatto (FR-72).
      history.history_failed = rows.length;
      history.history_error = describe(cause);
    }
    if (history.history_error !== undefined) {
      console.error(
        `Scrittura storico fallita (${history.history_failed} righe non scritte): ${history.history_error}`,
      );
    }
  }

  const subrequests = budget.subrequests + kvWrites + kvDeletes + history.history_queries;
  const paidAlerts: string[] = [];
  if (subrequests > config.paidAlertSubrequests) {
    paidAlerts.push("subrequests");
  }
  if (kvWrites * config.runsPerDay > config.paidAlertKvWritesPerDay) {
    paidAlerts.push("kv_writes_per_day");
  }
  if (d1SizeAfter !== undefined && d1SizeAfter > config.paidAlertD1SizeMb * 1024 * 1024) {
    paidAlerts.push("d1_size");
  }
  if (budget.exhausted === "subrequests") {
    paidAlerts.push("budget_subrequests");
  }

  return {
    written,
    generated_at: generatedAt,
    updated_locations: [...updated].sort(),
    errors,
    fallback_breaker: breaker,
    metrics: {
      blocks: chunks.length,
      block_requests: blockRequests,
      block_failures: blockFailures,
      fallbacks,
      subrequests,
      kv_writes: kvWrites,
      kv_deletes: kvDeletes,
      weight_used: budget.weightUsed,
      budget_exhausted: budget.exhausted,
      paid_alerts: paidAlerts,
      ...history,
    },
  };
}
