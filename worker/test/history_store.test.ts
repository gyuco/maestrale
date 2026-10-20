import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { d1HistoryWriter, writeHistory } from "../src/history_store";
import type { HistoryRow } from "../src/history";

function row(slug: string, over: Partial<HistoryRow> = {}): HistoryRow {
  return {
    location_slug: slug,
    date: "2026-10-20",
    air_temperature_mean_c: 21.3,
    air_temperature_min_c: 17,
    air_temperature_max_c: 25.1,
    water_temperature_mean_c: 22.4,
    state: "Poco mosso",
    wave_height_mean_m: 0.42,
    wave_height_max_m: 0.61,
    ...over,
  };
}
const many = (n: number, over: Partial<HistoryRow> = {}): HistoryRow[] =>
  Array.from({ length: n }, (_, i) => row(`loc-${String(i).padStart(3, "0")}`, over));

async function all(): Promise<Record<string, unknown>[]> {
  const result = await env.HISTORY.prepare("SELECT * FROM daily_history ORDER BY location_slug").all();
  return result.results as Record<string, unknown>[];
}

beforeEach(async () => {
  await env.HISTORY.prepare("DELETE FROM daily_history").run();
});

describe("writeHistory (AC-3)", () => {
  it("13 righe: una sola istruzione; seconda scrittura = upsert", async () => {
    const first = await writeHistory(env.HISTORY, many(13), 100);
    expect(first).toMatchObject({ ok: true, rows_written: 13, queries: 1 });
    expect(await all()).toHaveLength(13);

    const second = await writeHistory(env.HISTORY, many(13, { air_temperature_mean_c: 30, state: "Mosso" }), 100);
    expect(second).toMatchObject({ ok: true, queries: 1 });
    const rows = await all();
    expect(rows).toHaveLength(13);
    expect(rows.every((r) => r["air_temperature_mean_c"] === 30 && r["state"] === "Mosso")).toBe(true);
  });

  it("nessuna riga: ok senza interrogare D1", async () => {
    const batch = vi.spyOn(env.HISTORY, "batch");
    expect(await writeHistory(env.HISTORY, [], 100)).toEqual({ ok: true, rows_written: 0, queries: 0 });
    expect(batch).not.toHaveBeenCalled();
    batch.mockRestore();
  });
});

describe("writeHistory: blocchi (AC-4)", () => {
  it.each([
    [100, 100, 1],
    [101, 100, 2],
    [10, 1, 10],
    [401, 400, 2],
    [401, 9999, 2], // clamp a 400
  ])("%i righe con blocco %i -> %i istruzioni in un solo batch()", async (n, size, queries) => {
    const batch = vi.spyOn(env.HISTORY, "batch");
    const result = await writeHistory(env.HISTORY, many(n), size);
    expect(result).toMatchObject({ ok: true, rows_written: n, queries });
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0]![0]).toHaveLength(queries);
    expect(await all()).toHaveLength(n);
    batch.mockRestore();
  });

  it("riporta size_after quando D1 lo fornisce", async () => {
    const result = await writeHistory(env.HISTORY, many(3), 100);
    expect(result.ok).toBe(true);
    if (result.ok && result.size_after !== undefined) {
      expect(result.size_after).toBeGreaterThan(0);
    }
  });
});

describe("writeHistory: andata e ritorno (AC-5)", () => {
  it("null restano null e i decimali identici", async () => {
    const nulls = row("nulls", {
      air_temperature_mean_c: null,
      air_temperature_min_c: null,
      air_temperature_max_c: null,
      water_temperature_mean_c: null,
      state: null,
      wave_height_mean_m: null,
      wave_height_max_m: null,
    });
    const dec = row("dec", {
      air_temperature_mean_c: 21.37,
      air_temperature_min_c: -0.1,
      air_temperature_max_c: 0.30000000000000004,
      water_temperature_mean_c: 22.4,
      wave_height_mean_m: 0.07,
      wave_height_max_m: 1.23,
    });
    await writeHistory(env.HISTORY, [nulls, dec], 100);
    const rows = await all();
    expect(rows.find((r) => r["location_slug"] === "nulls")).toEqual(nulls);
    expect(rows.find((r) => r["location_slug"] === "dec")).toEqual(dec);
  });
});

describe("writeHistory: errori (FR-72)", () => {
  it("tabella mancante: esito ok:false, nessuna eccezione, nessuna riga scritta", async () => {
    await env.HISTORY.prepare("ALTER TABLE daily_history RENAME TO daily_history_x").run();
    try {
      const result = await writeHistory(env.HISTORY, many(3), 100);
      expect(result).toMatchObject({ ok: false, rows_failed: 3, queries: 1 });
      expect(result.ok === false && result.error.length > 0).toBe(true);
    } finally {
      await env.HISTORY.prepare("ALTER TABLE daily_history_x RENAME TO daily_history").run();
    }
  });

  it("binding assente: ok:false", async () => {
    const result = await d1HistoryWriter(undefined).write(many(2), 100);
    expect(result).toMatchObject({ ok: false, rows_failed: 2, queries: 0 });
  });
});
