/**
 * Dispatcher del cron ogni minuto (ADR-0009): ripara la cache del catalogo,
 * chiude le esecuzioni scadute, applica la retention ed esegue una richiesta
 * "Esegui ora" in attesa. Ogni passo è isolato: un errore non blocca gli altri.
 */

import { CATALOG_CACHE_KEY, getCatalog, refreshCatalogCache } from "./catalog";
import { updateConfigFromEnv } from "./config";
import type { Bindings } from "./env";
import { d1HistoryWriter } from "./history_store";
import { d1RunsWriter, newRunId, type RunRecord } from "./runs_store";
import { runUpdate, type UpdateDeps } from "./update";

export type DispatchDeps = Pick<UpdateDeps, "fetchImpl" | "sleep" | "now" | "nowMs">;

const DEFAULT_MAX_DURATION_SECONDS = 900;
const DEFAULT_RUN_RETENTION_DAYS = 90;
const DEFAULT_ACTIONS_RETENTION_DAYS = 730;

function intEnv(value: string | undefined, fallback: number, minimum = 0): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
}

async function safe(step: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(
      `dispatch ${step} fallito: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Ricostruisce `catalog:current` se la versione diverge da `catalog_meta` (NFR-33). */
export async function repairCatalogCache(env: Bindings): Promise<void> {
  const meta = await env.CORE.prepare("SELECT version FROM catalog_meta WHERE id = 1").first<{
    version: number;
  }>();
  const raw = await env.FORECASTS.get(CATALOG_CACHE_KEY);
  let cachedVersion = Number.NaN;
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        cachedVersion = Number((parsed as Record<string, unknown>)["catalog_version"]);
      }
    } catch {
      cachedVersion = Number.NaN;
    }
  }
  if (!Number.isFinite(cachedVersion) || cachedVersion !== (meta?.version ?? 0)) {
    await refreshCatalogCache(env);
  }
}

/** Chiude come "non completata" le esecuzioni oltre la durata massima (FR-107). */
export async function watchdog(env: Bindings, nowMs: number): Promise<void> {
  const maxSeconds =
    intEnv(env.JOB_MAX_DURATION_SECONDS, DEFAULT_MAX_DURATION_SECONDS, 1) + 60;
  const nowIso = new Date(nowMs).toISOString();
  const cutoff = new Date(nowMs - maxSeconds * 1000).toISOString();
  await env.CORE.prepare(
    `UPDATE job_runs SET status = 'done', outcome = 'non_completata', finished_at = ?
     WHERE status = 'running' AND started_at < ?`,
  )
    .bind(nowIso, cutoff)
    .run();
}

/** Elimina registri oltre la conservazione (FR-112, NFR-29/30). */
export async function applyRetention(env: Bindings, nowMs: number): Promise<void> {
  const runCutoff = new Date(
    nowMs - intEnv(env.RUN_RETENTION_DAYS, DEFAULT_RUN_RETENTION_DAYS, 1) * 86_400_000,
  ).toISOString();
  const actionsCutoff = new Date(
    nowMs - intEnv(env.ACTIONS_RETENTION_DAYS, DEFAULT_ACTIONS_RETENTION_DAYS, 1) * 86_400_000,
  ).toISOString();

  await env.CORE.batch([
    env.CORE.prepare(
      "DELETE FROM job_run_failures WHERE run_id IN (SELECT id FROM job_runs WHERE started_at < ?)",
    ).bind(runCutoff),
    env.CORE.prepare("DELETE FROM job_runs WHERE started_at < ?").bind(runCutoff),
    env.CORE.prepare("DELETE FROM admin_actions WHERE at < ?").bind(actionsCutoff),
  ]);
}

interface PendingRequest {
  id: string;
  admin_email: string;
  scope: string;
  slug: string | null;
}

async function claimAndRun(
  env: Bindings,
  deps: DispatchDeps,
  nowMs: () => number,
  now: () => string,
): Promise<void> {
  const pending = await env.CORE.prepare(
    "SELECT id, admin_email, scope, slug FROM run_requests WHERE status = 'pending' ORDER BY requested_at LIMIT 1",
  ).first<PendingRequest>();
  if (pending === null) return;

  const nowIso = now();
  const leaseSeconds =
    intEnv(env.JOB_MAX_DURATION_SECONDS, DEFAULT_MAX_DURATION_SECONDS, 1) + 120;
  const lease = new Date(nowMs() + leaseSeconds * 1000).toISOString();
  const lock = await env.CORE.prepare(
    "UPDATE job_lock SET run_id = ?, lease_until = ? WHERE id = 1 AND lease_until < ?",
  )
    .bind(pending.id, lease, nowIso)
    .run();
  if ((lock.meta.changes ?? 0) === 0) return;

  await env.CORE.prepare("UPDATE run_requests SET status = 'claimed' WHERE id = ?")
    .bind(pending.id)
    .run();

  let completed = false;
  try {
    const loaded = await getCatalog(env);
    if (loaded.status === "unavailable") {
      // Cache e D1 giù: la richiesta resta pending, il dispatcher riprova.
      return;
    }
    let entries = loaded.snapshot.locations;
    if (pending.scope === "singola") {
      entries = entries.filter((entry) => entry.slug === pending.slug);
      if (entries.length === 0) {
        const record: RunRecord = {
          id: newRunId(nowIso),
          origin: "su-richiesta",
          scope: "singola",
          scopeSlug: pending.slug,
          triggeredBy: pending.admin_email,
          catalogVersion: loaded.snapshot.catalogVersion,
          catalogSize: loaded.snapshot.locations.length,
          startedAt: nowIso,
        };
        await d1RunsWriter(env.CORE).reject(record, "Località non più attiva", nowIso);
        completed = true;
        return;
      }
    }

    await runUpdate(env.FORECASTS, entries, {
      ...deps,
      config: updateConfigFromEnv(env),
      history: d1HistoryWriter(env.HISTORY),
      runs: d1RunsWriter(env.CORE),
      catalogVersion: loaded.snapshot.catalogVersion,
      catalogSize: loaded.snapshot.locations.length,
      run: {
        origin: "su-richiesta",
        scope: pending.scope === "singola" ? "singola" : "tutte",
        scopeSlug: pending.slug,
        triggeredBy: pending.admin_email,
      },
      writeMeta: pending.scope !== "singola",
    });
    completed = true;
  } catch (error) {
    console.error(
      `dispatch run fallito: ${error instanceof Error ? error.message : String(error)}`,
    );
    completed = true;
  } finally {
    if (completed) {
      await env.CORE.prepare("UPDATE run_requests SET status = 'done' WHERE id = ?")
        .bind(pending.id)
        .run();
    }
    await env.CORE.prepare(
      "UPDATE job_lock SET lease_until = '1970-01-01T00:00:00Z' WHERE id = 1",
    ).run();
  }
}

/** Esegue un giro di dispatcher (cron `* * * * *`). */
export async function dispatch(env: Bindings, deps: DispatchDeps = {}): Promise<void> {
  if (env.RUN_DISPATCH_ENABLED === "false" || env.RUN_DISPATCH_ENABLED === "0") return;
  const nowMs = deps.nowMs ?? ((): number => Date.now());
  const now = deps.now ?? ((): string => new Date(nowMs()).toISOString());

  await safe("repair", () => repairCatalogCache(env));
  await safe("watchdog", () => watchdog(env, nowMs()));
  await safe("retention", () => applyRetention(env, nowMs()));
  await safe("claim", () => claimAndRun(env, deps, nowMs, now));
}
