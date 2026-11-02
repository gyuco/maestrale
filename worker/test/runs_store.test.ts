import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  computeOutcome,
  d1RunsWriter,
  newRunId,
  type RunRecord,
} from "../src/runs_store";

const record: RunRecord = {
  id: "20261102T100000Z-abcdef",
  origin: "pianificata",
  scope: "tutte",
  scopeSlug: null,
  triggeredBy: null,
  catalogVersion: 7,
  catalogSize: 13,
  startedAt: "2026-11-02T10:00:00.000Z",
};

beforeEach(async () => {
  await env.CORE.prepare("DELETE FROM job_run_failures").run();
  await env.CORE.prepare("DELETE FROM job_runs").run();
});

describe("computeOutcome (FR-106)", () => {
  it("distingue riuscita, parziale e fallita", () => {
    expect(computeOutcome(13, 0)).toBe("riuscita");
    expect(computeOutcome(12, 1)).toBe("parziale");
    expect(computeOutcome(0, 13)).toBe("fallita");
  });
});

describe("RunsWriter su D1 (FR-105, FR-111)", () => {
  it("apre l'esecuzione, la chiude con i fallimenti e la durata", async () => {
    const writer = d1RunsWriter(env.CORE);
    await writer.start(record);

    const running = await env.CORE.prepare(
      "SELECT status, catalog_version, catalog_size FROM job_runs WHERE id = ?",
    )
      .bind(record.id)
      .first<{ status: string; catalog_version: number; catalog_size: number }>();
    expect(running).toEqual({ status: "running", catalog_version: 7, catalog_size: 13 });

    await writer.finish(record, {
      finishedAt: "2026-11-02T10:01:00.000Z",
      durationMs: 60_000,
      outcome: "parziale",
      updatedCount: 12,
      failedCount: 1,
      notAttemptedCount: 0,
      failures: [{ slug: "chia", message: "HTTP 503", kind: "failed" }],
      breaker: false,
      breakerBlocksFailed: 0,
      breakerBlocksTotal: 2,
      metrics: { subrequests: 26 },
      historyRows: 12,
      historyError: null,
    });

    const done = await env.CORE.prepare(
      "SELECT status, outcome, duration_ms, updated_count, failed_count, history_rows FROM job_runs WHERE id = ?",
    )
      .bind(record.id)
      .first<Record<string, unknown>>();
    expect(done).toMatchObject({
      status: "done",
      outcome: "parziale",
      duration_ms: 60_000,
      updated_count: 12,
      failed_count: 1,
      history_rows: 12,
    });

    const failures = await env.CORE.prepare(
      "SELECT slug, message, kind FROM job_run_failures WHERE run_id = ?",
    )
      .bind(record.id)
      .all<{ slug: string; message: string; kind: string }>();
    expect(failures.results).toEqual([{ slug: "chia", message: "HTTP 503", kind: "failed" }]);
  });

  it("registra un'esecuzione rifiutata senza fallimenti", async () => {
    const writer = d1RunsWriter(env.CORE);
    await writer.reject(record, "Localita non valida, campi mancanti: ['name']", record.startedAt);

    const row = await env.CORE.prepare(
      "SELECT status, outcome, reject_reason, updated_count, failed_count FROM job_runs WHERE id = ?",
    )
      .bind(record.id)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({
      status: "done",
      outcome: "rifiutata",
      updated_count: 0,
      failed_count: 0,
    });
    expect(String(row?.reject_reason)).toContain("campi mancanti");
  });

  it("genera id univoci e ordinabili", () => {
    const a = newRunId("2026-11-02T10:00:00.000Z");
    const b = newRunId("2026-11-02T10:00:00.000Z");
    expect(a).not.toBe(b);
    expect(a.startsWith("20261102T100000000Z")).toBe(true);
  });
});
