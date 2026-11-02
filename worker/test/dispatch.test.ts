import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { CATALOG_CACHE_KEY, resetCatalogMemo } from "../src/catalog";
import { dispatch } from "../src/dispatch";
import { clearKv } from "./helpers/kv";
import { fakeProvider } from "./helpers/provider";

const NOW = "2026-11-02T10:00:00.000Z";
const NOW_MS = Date.parse(NOW);

function deps() {
  return {
    fetchImpl: fakeProvider().fetchImpl,
    sleep: async (): Promise<void> => {},
    now: (): string => NOW,
    nowMs: (): number => NOW_MS,
  };
}

async function insertRequest(id: string, scope: string, slug: string | null): Promise<void> {
  await env.CORE.prepare(
    "INSERT INTO run_requests (id, requested_at, admin_email, scope, slug, status) VALUES (?, ?, 'admin@example.com', ?, ?, 'pending')",
  )
    .bind(id, "2026-11-02T09:59:00.000Z", scope, slug)
    .run();
}

beforeEach(async () => {
  resetCatalogMemo();
  await clearKv();
  await env.CORE.prepare("DELETE FROM job_run_failures").run();
  await env.CORE.prepare("DELETE FROM job_runs").run();
  await env.CORE.prepare("DELETE FROM run_requests").run();
  await env.CORE.prepare("DELETE FROM admin_actions").run();
  await env.CORE.prepare("UPDATE job_lock SET lease_until = '1970-01-01T00:00:00Z'").run();
  await env.CORE.prepare("UPDATE catalog_meta SET version = 1").run();
});

describe("dispatcher (ADR-0009)", () => {
  it("esegue una richiesta 'tutte', chiude la richiesta e rilascia il lock", async () => {
    await insertRequest("req-1", "tutte", null);
    await dispatch(env, deps());

    const run = await env.CORE.prepare(
      "SELECT origin, scope, status, outcome, triggered_by, catalog_size FROM job_runs",
    ).first<Record<string, unknown>>();
    expect(run).toMatchObject({
      origin: "su-richiesta",
      scope: "tutte",
      status: "done",
      outcome: "riuscita",
      triggered_by: "admin@example.com",
      catalog_size: 13,
    });

    const request = await env.CORE.prepare(
      "SELECT status FROM run_requests WHERE id = 'req-1'",
    ).first<{ status: string }>();
    expect(request?.status).toBe("done");

    const lock = await env.CORE.prepare("SELECT lease_until FROM job_lock WHERE id = 1").first<{
      lease_until: string;
    }>();
    expect(lock?.lease_until).toBe("1970-01-01T00:00:00Z");
    expect(await env.FORECASTS.get("meta")).not.toBeNull();
  });

  it("esegue una richiesta su una sola località senza toccare /health", async () => {
    await insertRequest("req-2", "singola", "chia");
    await dispatch(env, deps());

    const run = await env.CORE.prepare(
      "SELECT scope, scope_slug, outcome, catalog_size FROM job_runs",
    ).first<Record<string, unknown>>();
    expect(run).toMatchObject({
      scope: "singola",
      scope_slug: "chia",
      outcome: "riuscita",
      catalog_size: 13,
    });
    expect(await env.FORECASTS.get("meta")).toBeNull();
    expect(await env.FORECASTS.get("forecast:chia")).not.toBeNull();
    expect(await env.FORECASTS.get("forecast:alghero")).toBeNull();
  });

  it("chiude come 'non completata' un'esecuzione scaduta (FR-107)", async () => {
    const old = new Date(NOW_MS - 60 * 60_000).toISOString();
    await env.CORE.prepare(
      `INSERT INTO job_runs (id, origin, scope, status, started_at, catalog_version, catalog_size)
       VALUES ('stale', 'pianificata', 'tutte', 'running', ?, 1, 13)`,
    )
      .bind(old)
      .run();

    await dispatch(env, deps());

    const run = await env.CORE.prepare(
      "SELECT status, outcome, finished_at FROM job_runs WHERE id = 'stale'",
    ).first<{ status: string; outcome: string; finished_at: string }>();
    expect(run?.status).toBe("done");
    expect(run?.outcome).toBe("non_completata");
    expect(run?.finished_at).not.toBeNull();
  });

  it("applica la retention di 90 giorni e 24 mesi (FR-112, NFR-29)", async () => {
    const oldRun = new Date(NOW_MS - 100 * 86_400_000).toISOString();
    const recentRun = new Date(NOW_MS - 2 * 86_400_000).toISOString();
    const oldAction = new Date(NOW_MS - 800 * 86_400_000).toISOString();

    await env.CORE.batch([
      env.CORE.prepare(
        `INSERT INTO job_runs (id, origin, scope, status, started_at, catalog_version, catalog_size)
         VALUES ('old', 'pianificata', 'tutte', 'done', ?, 1, 13)`,
      ).bind(oldRun),
      env.CORE.prepare(
        `INSERT INTO job_runs (id, origin, scope, status, started_at, catalog_version, catalog_size)
         VALUES ('recent', 'pianificata', 'tutte', 'done', ?, 1, 13)`,
      ).bind(recentRun),
      env.CORE.prepare(
        "INSERT INTO admin_actions (at, admin_email, action, outcome) VALUES (?, 'a@example.com', 'add', 'ok')",
      ).bind(oldAction),
      env.CORE.prepare(
        "INSERT INTO job_run_failures (run_id, slug, message, kind) VALUES ('old', 'chia', 'x', 'failed')",
      ),
    ]);

    await dispatch(env, deps());

    const ids = await env.CORE.prepare("SELECT id FROM job_runs ORDER BY id").all<{ id: string }>();
    expect(ids.results?.map((row) => row.id)).toEqual(["recent"]);
    const failures = await env.CORE.prepare("SELECT COUNT(*) AS n FROM job_run_failures").first<{
      n: number;
    }>();
    expect(failures?.n).toBe(0);
    const actions = await env.CORE.prepare("SELECT COUNT(*) AS n FROM admin_actions").first<{
      n: number;
    }>();
    expect(actions?.n).toBe(0);
  });

  it("ripara la cache del catalogo se la versione diverge (NFR-33)", async () => {
    await env.FORECASTS.put(
      CATALOG_CACHE_KEY,
      JSON.stringify({ schema_version: 1, catalog_version: 999, etag: "x", locations: [] }),
    );
    await env.CORE.prepare("UPDATE catalog_meta SET version = 4").run();

    await dispatch(env, deps());

    const raw = await env.FORECASTS.get(CATALOG_CACHE_KEY);
    const parsed = JSON.parse(raw ?? "{}") as { catalog_version?: number };
    expect(parsed.catalog_version).toBe(4);
  });

  it("non fa nulla se il dispatcher è disattivato", async () => {
    await insertRequest("req-3", "tutte", null);
    await dispatch({ ...env, RUN_DISPATCH_ENABLED: "false" }, deps());
    expect(await env.CORE.prepare("SELECT COUNT(*) AS n FROM job_runs").first<{ n: number }>()).toEqual({
      n: 0,
    });
  });
});
