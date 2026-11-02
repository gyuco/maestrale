import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import locations from "../../locations.json";
import type { UpdateDeps } from "../src/update";
import { runUpdate } from "../src/update";
import { d1RunsWriter } from "../src/runs_store";
import { clearKv } from "./helpers/kv";
import { fakeProvider, type FakeProviderOptions } from "./helpers/provider";

const NOW = "2026-11-02T10:00:00.000Z";
const ONE = [locations[0]!];

function deps(options: FakeProviderOptions = {}): UpdateDeps {
  return {
    fetchImpl: fakeProvider(options).fetchImpl,
    sleep: async () => {},
    now: () => NOW,
    runs: d1RunsWriter(env.CORE),
    catalogVersion: 3,
  };
}

beforeEach(async () => {
  await clearKv();
  await env.CORE.prepare("DELETE FROM job_run_failures").run();
  await env.CORE.prepare("DELETE FROM job_runs").run();
});

describe("registro delle esecuzioni nel job (FR-105, FR-106, FR-110, FR-111)", () => {
  it("registra una esecuzione riuscita con versione e numero di località", async () => {
    const result = await runUpdate(env.FORECASTS, ONE, deps());

    const run = await env.CORE.prepare(
      "SELECT status, outcome, catalog_version, catalog_size, updated_count, failed_count, finished_at FROM job_runs",
    ).first<Record<string, unknown>>();
    expect(run).toMatchObject({
      status: "done",
      outcome: "riuscita",
      catalog_version: 3,
      catalog_size: 1,
      updated_count: 1,
      failed_count: 0,
    });
    expect(run?.finished_at).not.toBeNull();
    expect(result.updated_locations).toHaveLength(1);
  });

  it("registra 'rifiutata' con il motivo se il catalogo non è valido", async () => {
    await expect(
      runUpdate(env.FORECASTS, [{ slug: "x", name: "X" }], deps()),
    ).rejects.toThrow();

    const run = await env.CORE.prepare(
      "SELECT outcome, reject_reason FROM job_runs",
    ).first<{ outcome: string; reject_reason: string }>();
    expect(run?.outcome).toBe("rifiutata");
    expect(run?.reject_reason).toContain("campi mancanti");
  });

  it("registra una esecuzione fallita con la località e il messaggio", async () => {
    await runUpdate(env.FORECASTS, ONE, deps({ fail: () => "apiError" }));

    const run = await env.CORE.prepare(
      "SELECT outcome, failed_count FROM job_runs",
    ).first<{ outcome: string; failed_count: number }>();
    expect(run?.outcome).toBe("fallita");
    expect(run?.failed_count).toBe(1);

    const failure = await env.CORE.prepare(
      "SELECT slug, message, kind FROM job_run_failures",
    ).first<{ slug: string; message: string; kind: string }>();
    expect(failure?.slug).toBe(ONE[0]?.slug);
    expect(failure?.message.length).toBeGreaterThan(0);
    expect(["failed", "not_attempted"]).toContain(failure?.kind);
  });

  it("un registro che fallisce non cambia cache, meta o esito (FR-111)", async () => {
    const failing = {
      start: async () => {
        throw new Error("D1 giù");
      },
      finish: async () => {
        throw new Error("D1 giù");
      },
      reject: async () => {
        throw new Error("D1 giù");
      },
    };
    const result = await runUpdate(env.FORECASTS, ONE, { ...deps(), runs: failing });

    expect(result.updated_locations).toHaveLength(1);
    expect(await env.FORECASTS.get("meta")).not.toBeNull();
  });
});
