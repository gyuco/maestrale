import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { HistoryRow } from "../src/history";
import { readDays, writeHistory } from "../src/history_store";

function row(slug: string, date: string, over: Partial<HistoryRow> = {}): HistoryRow {
  return {
    location_slug: slug,
    date,
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

beforeEach(async () => {
  await env.HISTORY.prepare("DELETE FROM daily_history").run();
});

describe("readDays", () => {
  it("ordina per data, include gli estremi, esclude fuori intervallo e altre località (AC-1, AC-2)", async () => {
    await writeHistory(
      env.HISTORY,
      [
        row("cagliari", "2026-10-20"),
        row("cagliari", "2026-10-14"),
        row("cagliari", "2026-10-16"),
        row("cagliari", "2026-10-13"),
        row("cagliari", "2026-10-21"),
        row("alghero", "2026-10-15"),
      ],
      100,
    );
    const result = await readDays(env.HISTORY, "cagliari", "2026-10-14", "2026-10-20");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((item) => item.date)).toEqual(["2026-10-14", "2026-10-16", "2026-10-20"]);
    expect(Object.keys(result.items[0]!)).toEqual([
      "date",
      "air_temperature_mean_c",
      "air_temperature_min_c",
      "air_temperature_max_c",
      "water_temperature_mean_c",
      "state",
      "wave_height_mean_m",
      "wave_height_max_m",
    ]);
  });

  it("nessun record: elenco vuoto", async () => {
    expect(await readDays(env.HISTORY, "cagliari", "2026-10-14", "2026-10-20")).toEqual({ ok: true, items: [] });
  });

  it("null e numeri identici a quelli scritti (AC-4)", async () => {
    await writeHistory(
      env.HISTORY,
      [
        row("cagliari", "2026-10-14", {
          air_temperature_min_c: null,
          water_temperature_mean_c: null,
          state: null,
          wave_height_mean_m: null,
          wave_height_max_m: null,
        }),
      ],
      100,
    );
    const result = await readDays(env.HISTORY, "cagliari", "2026-10-14", "2026-10-14");
    expect(result).toEqual({
      ok: true,
      items: [
        {
          date: "2026-10-14",
          air_temperature_mean_c: 21.3,
          air_temperature_min_c: null,
          air_temperature_max_c: 25.1,
          water_temperature_mean_c: null,
          state: null,
          wave_height_mean_m: null,
          wave_height_max_m: null,
        },
      ],
    });
  });

  it("esito unreadable, senza lanciare, con binding assente, tabella assente o query fallita (AC-7)", async () => {
    const missing = await readDays(undefined, "cagliari", "2026-10-14", "2026-10-20");
    expect(missing.ok).toBe(false);
    const failing = {
      prepare: () => {
        throw new Error("no such table: daily_history");
      },
    } as unknown as D1Database;
    const result = await readDays(failing, "cagliari", "2026-10-14", "2026-10-20");
    expect(result).toEqual({ ok: false, error: "no such table: daily_history" });
  });
});
