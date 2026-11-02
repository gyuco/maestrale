/**
 * Letture del registro delle esecuzioni per il backoffice (FR-108, FR-109).
 * Il filtro date lavora sui giorni UTC di `started_at` (l'istante è mostrato in
 * Europe/Rome); i test usano intervalli lontani dai bordi.
 */

export interface RunRow {
  id: string;
  origin: string;
  scope: string;
  scope_slug: string | null;
  triggered_by: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  outcome: string | null;
  reject_reason: string | null;
  catalog_version: number;
  catalog_size: number;
  updated_count: number;
  failed_count: number;
  not_attempted_count: number;
  breaker: number;
  breaker_blocks_failed: number | null;
  breaker_blocks_total: number | null;
  marine_blocks_failed: number | null;
  marine_blocks_total: number | null;
  forecast_blocks_failed: number | null;
  forecast_blocks_total: number | null;
  metrics: string | null;
  history_rows: number | null;
  history_error: string | null;
}

export interface RunFilters {
  esito: string;
  da: string;
  a: string;
}

export const RUN_PAGE_SIZE = 20;

function whereClause(filters: RunFilters): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.esito !== "") {
    conditions.push("outcome = ?");
    params.push(filters.esito);
  }
  if (filters.da !== "") {
    conditions.push("started_at >= ?");
    params.push(`${filters.da}T00:00:00.000Z`);
  }
  if (filters.a !== "") {
    conditions.push("started_at <= ?");
    params.push(`${filters.a}T23:59:59.999Z`);
  }
  return {
    sql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

export async function listRuns(
  db: D1Database,
  filters: RunFilters,
  page: number,
  pageSize = RUN_PAGE_SIZE,
): Promise<{ rows: RunRow[]; total: number }> {
  const where = whereClause(filters);
  const count = await db
    .prepare(`SELECT COUNT(*) AS n FROM job_runs ${where.sql}`)
    .bind(...where.params)
    .first<{ n: number }>();
  const { results } = await db
    .prepare(
      `SELECT * FROM job_runs ${where.sql}
       ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .bind(...where.params, pageSize, (page - 1) * pageSize)
    .all<RunRow>();
  return { rows: results ?? [], total: count?.n ?? 0 };
}

export async function getRun(db: D1Database, id: string): Promise<RunRow | null> {
  return await db.prepare("SELECT * FROM job_runs WHERE id = ?").bind(id).first<RunRow>();
}

export interface RunFailureRow {
  slug: string;
  message: string;
  kind: string;
  name: string | null;
}

export async function getRunFailures(db: D1Database, id: string): Promise<RunFailureRow[]> {
  const { results } = await db
    .prepare(
      `SELECT f.slug, f.message, f.kind, l.name
       FROM job_run_failures f
       LEFT JOIN locations l ON l.slug = f.slug
       WHERE f.run_id = ? ORDER BY f.slug`,
    )
    .bind(id)
    .all<RunFailureRow>();
  return results ?? [];
}
