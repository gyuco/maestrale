/**
 * Scrittura a blocchi dello storico su D1 (ADR-0002 §2, FR-70, FR-72).
 * Un solo `batch()` (transazione), un'istruzione per blocco con un solo
 * parametro JSON espanso con `json_each`. Non lancia mai verso il chiamante.
 */

import { stateRankCase, type HistoryRow } from "./history";
import { MAX_HISTORY_BATCH_ROWS } from "./config";

const COLUMNS = [
  "location_slug",
  "date",
  "air_temperature_mean_c",
  "air_temperature_min_c",
  "air_temperature_max_c",
  "water_temperature_mean_c",
  "state",
  "wave_height_mean_m",
  "wave_height_max_m",
] as const;

const UPSERT_SQL = `INSERT INTO daily_history (${COLUMNS.join(", ")})
SELECT ${COLUMNS.map((column) => `json_extract(value, '$.${column}')`).join(", ")}
FROM json_each(?1) WHERE true
ON CONFLICT (location_slug, date) DO UPDATE SET
${COLUMNS.slice(2)
  .map((column) => `${column} = excluded.${column}`)
  .join(", ")}`;

export type HistoryWriteResult =
  | {
      ok: true;
      /** Righe inviate e scritte (upsert). */
      rows_written: number;
      /** Istruzioni D1 eseguite. */
      queries: number;
      /** Dimensione del database in byte dopo il batch, se riportata da D1. */
      size_after?: number;
      /** Somma di `meta.rows_written` di D1 (indici inclusi), se riportata. */
      rows_written_meta?: number;
    }
  | { ok: false; error: string; rows_failed: number; queries: number };

/** Componente iniettabile nel job (ADR-0002 §2.7). */
export interface HistoryWriter {
  write(rows: readonly HistoryRow[], batchRows: number): Promise<HistoryWriteResult>;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export async function writeHistory(
  db: D1Database | undefined,
  rows: readonly HistoryRow[],
  batchRows: number,
): Promise<HistoryWriteResult> {
  if (rows.length === 0) {
    return { ok: true, rows_written: 0, queries: 0 };
  }
  let attempted = 0;
  try {
    if (db === undefined || db === null) {
      throw new Error("Binding D1 HISTORY non disponibile");
    }
    const size = Math.min(Math.max(Math.trunc(batchRows) || 1, 1), MAX_HISTORY_BATCH_ROWS);
    const statements: D1PreparedStatement[] = [];
    for (let index = 0; index < rows.length; index += size) {
      statements.push(db.prepare(UPSERT_SQL).bind(JSON.stringify(rows.slice(index, index + size))));
    }
    attempted = statements.length;
    const results = await db.batch(statements);
    const result: HistoryWriteResult = { ok: true, rows_written: rows.length, queries: statements.length };
    let metaWritten: number | undefined;
    for (const item of results) {
      const meta = item?.meta as { size_after?: unknown; rows_written?: unknown } | undefined;
      if (typeof meta?.size_after === "number") {
        result.size_after = meta.size_after;
      }
      if (typeof meta?.rows_written === "number") {
        metaWritten = (metaWritten ?? 0) + meta.rows_written;
      }
    }
    if (metaWritten !== undefined) {
      result.rows_written_meta = metaWritten;
    }
    return result;
  } catch (cause) {
    return { ok: false, error: describe(cause), rows_failed: rows.length, queries: attempted };
  }
}

/** Writer D1 per `env.HISTORY` (assente = errore gestito, mai eccezione). */
export function d1HistoryWriter(db: D1Database | undefined): HistoryWriter {
  return { write: (rows, batchRows) => writeHistory(db, rows, batchRows) };
}

/** Elemento della risposta `day` di `GET /history` (FR-75). */
export interface HistoryDayItem {
  date: string;
  air_temperature_mean_c: number | null;
  air_temperature_min_c: number | null;
  air_temperature_max_c: number | null;
  water_temperature_mean_c: number | null;
  state: string | null;
  wave_height_mean_m: number | null;
  wave_height_max_m: number | null;
}

export type ReadDaysResult = { ok: true; items: HistoryDayItem[] } | { ok: false; error: string };

const READ_DAYS_SQL = `SELECT date, air_temperature_mean_c, air_temperature_min_c, air_temperature_max_c,
  water_temperature_mean_c, state, wave_height_mean_m, wave_height_max_m
FROM daily_history WHERE location_slug = ?1 AND date BETWEEN ?2 AND ?3 ORDER BY date`;

/** Record giornalieri di `slug` in [from, to], per data crescente. Non lancia mai. */
export async function readDays(
  db: D1Database | undefined,
  slug: string,
  from: string,
  to: string,
): Promise<ReadDaysResult> {
  try {
    if (db === undefined || db === null) {
      throw new Error("Binding D1 HISTORY non disponibile");
    }
    const result = await db.prepare(READ_DAYS_SQL).bind(slug, from, to).all<HistoryDayItem>();
    return { ok: true, items: result.results };
  } catch (cause) {
    return { ok: false, error: describe(cause) };
  }
}

/** Elemento della risposta `month` di `GET /history` (FR-76). */
export interface HistoryMonthItem {
  month: string;
  days: number;
  air_temperature_mean_c: number | null;
  air_temperature_min_c: number | null;
  air_temperature_max_c: number | null;
  water_temperature_mean_c: number | null;
  state: string | null;
  wave_height_mean_m: number | null;
  wave_height_max_m: number | null;
}

export type ReadMonthsResult = { ok: true; items: HistoryMonthItem[] } | { ok: false; error: string };

/** Aggregazione mensile in una sola istruzione SQL (ADR-0002 §3, FR-76). */
export function readMonthsSql(): string {
  return `WITH d AS (
  SELECT substr(date, 1, 7) AS month, * FROM daily_history
  WHERE location_slug = ?1 AND date BETWEEN ?2 AND ?3
),
agg AS (
  SELECT month, COUNT(*) AS days,
         ROUND(AVG(air_temperature_mean_c), 1)   AS air_temperature_mean_c,
         MIN(air_temperature_min_c)              AS air_temperature_min_c,
         MAX(air_temperature_max_c)              AS air_temperature_max_c,
         ROUND(AVG(water_temperature_mean_c), 1) AS water_temperature_mean_c,
         ROUND(AVG(wave_height_mean_m), 2)       AS wave_height_mean_m,
         MAX(wave_height_max_m)                  AS wave_height_max_m
  FROM d GROUP BY month
),
modes AS (
  SELECT month, state,
         ROW_NUMBER() OVER (PARTITION BY month
                            ORDER BY COUNT(*) DESC, ${stateRankCase()} DESC) AS rn
  FROM d WHERE state IS NOT NULL GROUP BY month, state
)
SELECT agg.month, agg.days, agg.air_temperature_mean_c, agg.air_temperature_min_c,
       agg.air_temperature_max_c, agg.water_temperature_mean_c, modes.state,
       agg.wave_height_mean_m, agg.wave_height_max_m
FROM agg
LEFT JOIN modes ON modes.month = agg.month AND modes.rn = 1
ORDER BY agg.month`;
}

/** Aggregati mensili di `slug` sui soli record in [from, to]. Non lancia mai. */
export async function readMonths(
  db: D1Database | undefined,
  slug: string,
  from: string,
  to: string,
): Promise<ReadMonthsResult> {
  try {
    if (db === undefined || db === null) {
      throw new Error("Binding D1 HISTORY non disponibile");
    }
    const result = await db.prepare(readMonthsSql()).bind(slug, from, to).all<HistoryMonthItem>();
    return { ok: true, items: result.results };
  } catch (cause) {
    return { ok: false, error: describe(cause) };
  }
}
