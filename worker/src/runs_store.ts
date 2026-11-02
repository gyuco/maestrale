/**
 * Registro delle esecuzioni del job su D1 `CORE` (FR-105, ADR-0008).
 *
 * Scrittura: riga `running` all'avvio; a fine esecuzione una `batch()` chiude la
 * riga e inserisce i fallimenti (una riga per località, così nessun valore JSON
 * si avvicina al limite di 100 KB per istruzione). Un errore del registro non
 * deve mai propagare al job (FR-111).
 */

export type RunOrigin = "pianificata" | "su-richiesta";
export type RunScope = "tutte" | "singola";
export type RunOutcome = "riuscita" | "parziale" | "fallita" | "rifiutata" | "non_completata";

export interface RunFailure {
  slug: string;
  message: string;
  kind: "failed" | "not_attempted";
}

export interface RunRecord {
  id: string;
  origin: RunOrigin;
  scope: RunScope;
  scopeSlug?: string | null;
  triggeredBy?: string | null;
  catalogVersion: number;
  catalogSize: number;
  startedAt: string;
}

export interface RunFinish {
  finishedAt: string;
  durationMs: number;
  outcome: RunOutcome;
  updatedCount: number;
  failedCount: number;
  notAttemptedCount: number;
  failures: readonly RunFailure[];
  breaker: boolean;
  breakerBlocksFailed?: number | null;
  breakerBlocksTotal?: number | null;
  marineBlocksFailed?: number | null;
  marineBlocksTotal?: number | null;
  forecastBlocksFailed?: number | null;
  forecastBlocksTotal?: number | null;
  metrics?: unknown;
  historyRows?: number | null;
  historyError?: string | null;
}

export interface RunsWriter {
  start(record: RunRecord): Promise<void>;
  finish(record: RunRecord, result: RunFinish): Promise<void>;
  reject(record: RunRecord, reason: string, finishedAt: string): Promise<void>;
}

/** Esito da località aggiornate e fallite (FR-106); "rifiutata" è gestita a parte. */
export function computeOutcome(updated: number, failed: number): RunOutcome {
  if (updated === 0) return "fallita";
  return failed > 0 ? "parziale" : "riuscita";
}

export function newRunId(startedAt: string): string {
  const compact = startedAt.replace(/[-:.+]/g, "").replace("Z", "Z");
  return `${compact}-${crypto.randomUUID().slice(0, 6)}`;
}

export function d1RunsWriter(db: D1Database): RunsWriter {
  return {
    async start(record) {
      await db
        .prepare(
          `INSERT INTO job_runs
             (id, origin, scope, scope_slug, triggered_by, status, started_at,
              catalog_version, catalog_size)
           VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
        )
        .bind(
          record.id,
          record.origin,
          record.scope,
          record.scopeSlug ?? null,
          record.triggeredBy ?? null,
          record.startedAt,
          record.catalogVersion,
          record.catalogSize,
        )
        .run();
    },

    async finish(record, result) {
      const failuresJson = JSON.stringify(result.failures);
      await db.batch([
        db
          .prepare(
            `UPDATE job_runs SET
               status = 'done', finished_at = ?, duration_ms = ?, outcome = ?,
               updated_count = ?, failed_count = ?, not_attempted_count = ?,
               breaker = ?, breaker_blocks_failed = ?, breaker_blocks_total = ?,
               marine_blocks_failed = ?, marine_blocks_total = ?,
               forecast_blocks_failed = ?, forecast_blocks_total = ?,
               metrics = ?, history_rows = ?, history_error = ?
             WHERE id = ?`,
          )
          .bind(
            result.finishedAt,
            result.durationMs,
            result.outcome,
            result.updatedCount,
            result.failedCount,
            result.notAttemptedCount,
            result.breaker ? 1 : 0,
            result.breakerBlocksFailed ?? null,
            result.breakerBlocksTotal ?? null,
            result.marineBlocksFailed ?? null,
            result.marineBlocksTotal ?? null,
            result.forecastBlocksFailed ?? null,
            result.forecastBlocksTotal ?? null,
            result.metrics === undefined ? null : JSON.stringify(result.metrics),
            result.historyRows ?? null,
            result.historyError ?? null,
            record.id,
          ),
        db
          .prepare(
            `INSERT INTO job_run_failures (run_id, slug, message, kind)
             SELECT ?1, json_extract(value, '$.slug'), json_extract(value, '$.message'),
                    json_extract(value, '$.kind')
             FROM json_each(?2)`,
          )
          .bind(record.id, failuresJson),
      ]);
    },

    async reject(record, reason, finishedAt) {
      await db
        .prepare(
          `INSERT INTO job_runs
             (id, origin, scope, scope_slug, triggered_by, status, started_at, finished_at,
              duration_ms, outcome, reject_reason, catalog_version, catalog_size,
              updated_count, failed_count, not_attempted_count, breaker)
           VALUES (?, ?, ?, ?, ?, 'done', ?, ?, 0, 'rifiutata', ?, ?, ?, 0, 0, 0, 0)`,
        )
        .bind(
          record.id,
          record.origin,
          record.scope,
          record.scopeSlug ?? null,
          record.triggeredBy ?? null,
          record.startedAt,
          finishedAt,
          reason,
          record.catalogVersion,
          record.catalogSize,
        )
        .run();
    },
  };
}
