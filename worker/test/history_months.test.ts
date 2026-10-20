import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SEA_STATE_LABELS } from "../src/aggregate";
import { cacheControlFor, stateRankCase, type HistoryRow } from "../src/history";
import { readMonths, writeHistory } from "../src/history_store";

const SLUG = "cagliari";

function row(date: string, over: Partial<HistoryRow> = {}, slug = SLUG): HistoryRow {
  return {
    location_slug: slug,
    date,
    air_temperature_mean_c: 20,
    air_temperature_min_c: 15,
    air_temperature_max_c: 25,
    water_temperature_mean_c: 22,
    state: "Poco mosso",
    wave_height_mean_m: 0.4,
    wave_height_max_m: 0.6,
    ...over,
  };
}

async function months(from: string, to: string, slug = SLUG) {
  const result = await readMonths(env.HISTORY, slug, from, to);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.items;
}

beforeEach(async () => {
  await env.HISTORY.prepare("DELETE FROM daily_history").run();
});

describe("readMonths", () => {
  it("AC-1: aggregati per mese, ordinati, con arrotondamenti", async () => {
    await writeHistory(
      env.HISTORY,
      [
        row("2026-09-29", { air_temperature_mean_c: 20.0, air_temperature_min_c: 14, air_temperature_max_c: 26, water_temperature_mean_c: 21, wave_height_mean_m: 0.3, wave_height_max_m: 0.5 }),
        row("2026-09-30", { air_temperature_mean_c: 21.0, air_temperature_min_c: 12, air_temperature_max_c: 28, water_temperature_mean_c: 22, wave_height_mean_m: 0.4, wave_height_max_m: 0.9 }),
        row("2026-10-01", { air_temperature_mean_c: 10.0, air_temperature_min_c: 5, air_temperature_max_c: 15, water_temperature_mean_c: 18, wave_height_mean_m: 1.0, wave_height_max_m: 1.5 }),
        row("2026-10-02", { air_temperature_mean_c: 11.0, air_temperature_min_c: 6, air_temperature_max_c: 17, water_temperature_mean_c: 19, wave_height_mean_m: 1.0, wave_height_max_m: 1.2 }),
        row("2026-10-03", { air_temperature_mean_c: 12.0, air_temperature_min_c: 4, air_temperature_max_c: 16, water_temperature_mean_c: 19, wave_height_mean_m: 1.01, wave_height_max_m: 2.0 }),
        row("2026-10-04", { location_slug: "alghero", air_temperature_mean_c: 99 }),
      ],
      100,
    );
    expect(await months("2026-09-01", "2026-10-31")).toEqual([
      {
        month: "2026-09",
        days: 2,
        air_temperature_mean_c: 20.5,
        air_temperature_min_c: 12,
        air_temperature_max_c: 28,
        water_temperature_mean_c: 21.5,
        state: "Poco mosso",
        wave_height_mean_m: 0.35,
        wave_height_max_m: 0.9,
      },
      {
        month: "2026-10",
        days: 3,
        air_temperature_mean_c: 11,
        air_temperature_min_c: 4,
        air_temperature_max_c: 17,
        water_temperature_mean_c: 18.7,
        state: "Poco mosso",
        wave_height_mean_m: 1,
        wave_height_max_m: 2,
      },
    ]);
  });

  it("AC-2: mesi parziali aggregati solo sui giorni nell'intervallo", async () => {
    await writeHistory(
      env.HISTORY,
      [
        row("2026-09-10", { air_temperature_max_c: 40 }),
        row("2026-09-20", { air_temperature_max_c: 26 }),
        row("2026-09-25", { air_temperature_max_c: 27 }),
        row("2026-10-01", { air_temperature_max_c: 22 }),
        row("2026-10-15", { air_temperature_max_c: 23 }),
        row("2026-10-16", { air_temperature_max_c: 50 }),
      ],
      100,
    );
    const items = await months("2026-09-20", "2026-10-15");
    expect(items.map((item) => [item.month, item.days, item.air_temperature_max_c])).toEqual([
      ["2026-09", 2, 27],
      ["2026-10", 2, 23],
    ]);
  });

  it("AC-3: null ignorati; tutti null -> null (non 0); days conta i record", async () => {
    await writeHistory(
      env.HISTORY,
      [
        row("2026-10-01", { air_temperature_mean_c: null, water_temperature_mean_c: null, wave_height_max_m: null, state: null }),
        row("2026-10-02", { air_temperature_mean_c: 10, water_temperature_mean_c: null, wave_height_max_m: null, state: null }),
        row("2026-10-03", { air_temperature_mean_c: null, air_temperature_min_c: null, air_temperature_max_c: null, water_temperature_mean_c: null, wave_height_mean_m: null, wave_height_max_m: null, state: null }),
      ],
      100,
    );
    const [item] = await months("2026-10-01", "2026-10-31");
    expect(item).toEqual({
      month: "2026-10",
      days: 3,
      air_temperature_mean_c: 10,
      air_temperature_min_c: 15,
      air_temperature_max_c: 25,
      water_temperature_mean_c: null,
      state: null,
      wave_height_mean_m: 0.4,
      wave_height_max_m: null,
    });
  });

  async function stateOf(states: (string | null)[]): Promise<string | null | undefined> {
    await env.HISTORY.prepare("DELETE FROM daily_history").run();
    await writeHistory(
      env.HISTORY,
      states.map((state, index) => row(`2026-10-${String(index + 1).padStart(2, "0")}`, { state })),
      100,
    );
    return (await months("2026-10-01", "2026-10-31"))[0]?.state;
  }

  it("AC-4: moda, pareggio al rango Douglas più alto, tutti null", async () => {
    expect(await stateOf(["Poco mosso", "Poco mosso", "Poco mosso", "Mosso", "Mosso"])).toBe("Poco mosso");
    expect(await stateOf(["Poco mosso", "Poco mosso", "Mosso", "Mosso"])).toBe("Mosso");
    expect(await stateOf(["Calmo", "Tempestoso"])).toBe("Tempestoso");
    expect(await stateOf(["Tempestoso", "Calmo"])).toBe("Tempestoso");
    expect(await stateOf([null, null])).toBeNull();
    expect(await stateOf([null, "Calmo"])).toBe("Calmo");
  });

  it("AC-5: il CASE copre tutte le 10 etichette FR-10 in ordine", () => {
    expect(SEA_STATE_LABELS).toEqual([
      "Calmo", "Quasi calmo", "Poco mosso", "Mosso", "Molto mosso",
      "Agitato", "Molto agitato", "Grosso", "Molto grosso", "Tempestoso",
    ]);
    const sql = stateRankCase();
    const found = [...sql.matchAll(/WHEN '([^']+)' THEN (\d+)/g)].map((m) => [m[1], Number(m[2])]);
    expect(found).toEqual(SEA_STATE_LABELS.map((label, rank) => [label, rank]));
  });

  it("AC-6: nessun record -> items vuoto; mesi senza record omessi; una sola prepare", async () => {
    expect(await months("2026-10-01", "2026-10-31")).toEqual([]);
    await writeHistory(env.HISTORY, [row("2026-08-01"), row("2026-10-01")], 100);
    let prepares = 0;
    const counting = {
      prepare: (sql: string) => {
        prepares += 1;
        return env.HISTORY.prepare(sql);
      },
    } as unknown as D1Database;
    const result = await readMonths(counting, SLUG, "2026-08-01", "2026-10-31");
    expect(prepares).toBe(1);
    expect(result.ok && result.items.map((item) => item.month)).toEqual(["2026-08", "2026-10"]);
  });

  it("AC-9: 10 anni (~3.650 righe), 120 mesi", async () => {
    const rows: HistoryRow[] = [];
    for (let day = 0; day < 3650; day++) {
      const date = new Date(Date.UTC(2017, 0, 1) + day * 86_400_000).toISOString().slice(0, 10);
      rows.push(row(date));
    }
    expect((await writeHistory(env.HISTORY, rows, 100)).ok).toBe(true);
    const items = await months("2017-01-01", "2026-12-31");
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(120);
    expect(items.reduce((sum, item) => sum + item.days, 0)).toBe(3650);
  });

  it("AC-10: D1 che fallisce o binding assente -> esito unreadable, mai eccezione", async () => {
    const failing = {
      prepare: () => ({ bind: () => ({ all: async () => { throw new Error("boom"); } }) }),
    } as unknown as D1Database;
    expect(await readMonths(failing, SLUG, "2026-10-01", "2026-10-31")).toEqual({ ok: false, error: "boom" });
    expect((await readMonths(undefined, SLUG, "2026-10-01", "2026-10-31")).ok).toBe(false);
    vi.restoreAllMocks();
  });
});

describe("cacheControlFor", () => {
  const config = { shortSeconds: 900, longSeconds: 86_400 };
  it("AC-7: to >= oggi -> breve, to < oggi -> lungo", () => {
    expect(cacheControlFor("2026-10-20", "2026-10-20", config)).toBe("public, max-age=900");
    expect(cacheControlFor("2026-10-21", "2026-10-20", config)).toBe("public, max-age=900");
    expect(cacheControlFor("2026-10-19", "2026-10-20", config)).toBe("public, max-age=86400");
    expect(cacheControlFor("2026-10-19", "2026-10-20", { shortSeconds: 60, longSeconds: 3600 })).toBe("public, max-age=3600");
  });
});
