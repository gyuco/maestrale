import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

// E02-S01: verifica del supporto SQLite della D1 di Miniflare (ADR-0002).
const COLS = [
  "location_slug",
  "date",
  "air_temperature_mean_c",
  "air_temperature_min_c",
  "air_temperature_max_c",
  "water_temperature_mean_c",
  "state",
  "wave_height_mean_m",
  "wave_height_max_m",
];

const UPSERT_JSON = `INSERT INTO daily_history (${COLS.join(", ")})
SELECT ${COLS.map((c) => `json_extract(value, '$.${c}')`).join(", ")}
FROM json_each(?1) WHERE true
ON CONFLICT (location_slug, date) DO UPDATE SET
${COLS.slice(2).map((c) => `${c} = excluded.${c}`).join(", ")}`;

function row(slug: string, date: string, over: Record<string, unknown> = {}) {
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

describe("D1 Miniflare: schema (AC-1)", () => {
  it("crea daily_history con 9 colonne, PK composta, WITHOUT ROWID, nessun indice secondario", async () => {
    const master = await env.HISTORY.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'daily_history'",
    ).first<{ sql: string }>();
    expect(master).not.toBeNull();
    expect(master!.sql).toMatch(/PRIMARY KEY\s*\(\s*location_slug\s*,\s*date\s*\)/i);
    expect(master!.sql).toMatch(/WITHOUT ROWID/i);
    const info = await env.HISTORY.prepare("PRAGMA table_info(daily_history)").all<{ name: string }>();
    expect(info.results.map((c) => c.name)).toEqual(COLS);
    const idx = await env.HISTORY.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'daily_history' AND sql IS NOT NULL",
    ).all();
    expect(idx.results).toEqual([]);
  });
});

describe("D1 Miniflare: upsert (AC-2)", () => {
  it("due scritture della stessa coppia lasciano una riga con l'ultimo valore", async () => {
    const sql = `INSERT INTO daily_history (location_slug, date, state, wave_height_max_m)
      VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT (location_slug, date) DO UPDATE SET state = excluded.state, wave_height_max_m = excluded.wave_height_max_m`;
    await env.HISTORY.prepare(sql).bind("cagliari", "2026-10-20", "Calmo", 0.1).run();
    await env.HISTORY.prepare(sql).bind("cagliari", "2026-10-20", "Mosso", 1.2).run();
    const all = await env.HISTORY.prepare("SELECT * FROM daily_history").all<any>();
    expect(all.results).toHaveLength(1);
    expect(all.results[0]).toMatchObject({ state: "Mosso", wave_height_max_m: 1.2 });
  });
});

describe("D1 Miniflare: upsert da json_each (AC-3)", () => {
  it("scrive le righe, JSON null -> NULL, numeri identici; riscrittura aggiorna", async () => {
    const rows = [
      row("cagliari", "2026-10-20"),
      row("cagliari", "2026-10-21", { air_temperature_mean_c: null, state: null, wave_height_max_m: null }),
    ];
    await env.HISTORY.prepare(UPSERT_JSON).bind(JSON.stringify(rows)).run();
    const got = await env.HISTORY.prepare("SELECT * FROM daily_history ORDER BY date").all<any>();
    expect(got.results).toHaveLength(2);
    expect(got.results[0]).toEqual(rows[0]);
    expect(typeof got.results[0].wave_height_mean_m).toBe("number");
    expect(got.results[0].wave_height_mean_m).toBe(0.42);
    expect(got.results[0].air_temperature_mean_c).toBe(21.3);
    expect(got.results[1].air_temperature_mean_c).toBeNull();
    expect(got.results[1].state).toBeNull();
    expect(got.results[1].wave_height_max_m).toBeNull();

    const again = [row("cagliari", "2026-10-20", { state: "Mosso", wave_height_max_m: 1.5 })];
    await env.HISTORY.prepare(UPSERT_JSON).bind(JSON.stringify(again)).run();
    const after = await env.HISTORY.prepare("SELECT * FROM daily_history ORDER BY date").all<any>();
    expect(after.results).toHaveLength(2);
    expect(after.results[0]).toMatchObject({ state: "Mosso", wave_height_max_m: 1.5 });
  });
});

describe("D1 Miniflare: CTE con funzioni finestra (AC-4)", () => {
  it("restituisce una riga per mese con la moda dello stato", async () => {
    const rows = [
      row("a", "2026-09-01", { state: "Calmo" }),
      row("a", "2026-09-02", { state: "Mosso" }),
      row("a", "2026-09-03", { state: "Mosso" }),
      row("a", "2026-10-01", { state: "Calmo" }),
      row("a", "2026-10-02", { state: "Mosso" }),
      row("a", "2026-11-01", { state: null }),
    ];
    await env.HISTORY.prepare(UPSERT_JSON).bind(JSON.stringify(rows)).run();
    const rank = "CASE state WHEN 'Calmo' THEN 0 WHEN 'Poco mosso' THEN 1 WHEN 'Mosso' THEN 2 END";
    const res = await env.HISTORY.prepare(
      `WITH d AS (
         SELECT substr(date, 1, 7) AS month, * FROM daily_history
         WHERE location_slug = ?1 AND date BETWEEN ?2 AND ?3
       ),
       agg AS (SELECT month, COUNT(*) AS days FROM d GROUP BY month),
       modes AS (
         SELECT month, state,
                ROW_NUMBER() OVER (PARTITION BY month ORDER BY COUNT(*) DESC, ${rank} DESC) AS rn
         FROM d WHERE state IS NOT NULL GROUP BY month, state
       )
       SELECT agg.month, agg.days, modes.state FROM agg
       LEFT JOIN modes ON modes.month = agg.month AND modes.rn = 1
       ORDER BY agg.month`,
    )
      .bind("a", "2026-09-01", "2026-11-30")
      .all<any>();
    expect(res.results).toEqual([
      { month: "2026-09", days: 3, state: "Mosso" },
      { month: "2026-10", days: 2, state: "Mosso" }, // pareggio -> rango più alto
      { month: "2026-11", days: 1, state: null },
    ]);
  });
});

describe("D1 Miniflare: batch transazionale (AC-5)", () => {
  it("rollback se un'istruzione fallisce; registra meta.size_after se presente", async () => {
    const ok = env.HISTORY.prepare(UPSERT_JSON).bind(JSON.stringify([row("cagliari", "2026-10-20")]));
    const bad = env.HISTORY.prepare(
      "INSERT INTO daily_history (location_slug, date) VALUES (NULL, '2026-10-20')",
    );
    await expect(env.HISTORY.batch([ok, bad])).rejects.toThrow();
    const count = await env.HISTORY.prepare("SELECT COUNT(*) AS n FROM daily_history").first<{ n: number }>();
    expect(count!.n).toBe(0);

    const good = await env.HISTORY.batch([
      env.HISTORY.prepare(UPSERT_JSON).bind(JSON.stringify([row("cagliari", "2026-10-20")])),
    ]);
    const sizeAfter = (good[0]!.meta as Record<string, unknown>).size_after;
    console.log(`meta.size_after nel batch: ${sizeAfter === undefined ? "ASSENTE" : String(sizeAfter)}`);
  });
});
