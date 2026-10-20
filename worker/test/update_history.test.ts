import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import locations from "../../locations.json";
import worker from "../src/index";
import type { HistoryRow } from "../src/history";
import type { HistoryWriter, HistoryWriteResult } from "../src/history_store";
import { runUpdate, type UpdateDeps } from "../src/update";
import { clearKv, forecastKeys, readJson } from "./helpers/kv";
import { fakeProvider, type FakeProviderOptions } from "./helpers/provider";

const NOW = "2026-10-19T09:00:00+00:00"; // giorno 0 = 2026-10-19 (Europe/Rome)
const noSleep = async (): Promise<void> => {};

interface Call {
  rows: HistoryRow[];
  batchRows: number;
  metaWritten: boolean;
}

function fakeWriter(result?: (rows: readonly HistoryRow[]) => Promise<HistoryWriteResult>) {
  const calls: Call[] = [];
  const writer: HistoryWriter = {
    async write(rows, batchRows) {
      calls.push({ rows: [...rows], batchRows, metaWritten: (await env.FORECASTS.get("meta")) !== null });
      return result
        ? result(rows)
        : { ok: true, rows_written: rows.length, queries: Math.ceil(rows.length / batchRows) };
    },
  };
  return { writer, calls };
}

function deps(history: HistoryWriter | undefined, options: FakeProviderOptions = {}, extra: Partial<UpdateDeps> = {}): UpdateDeps {
  return {
    fetchImpl: fakeProvider(options).fetchImpl,
    sleep: noSleep,
    now: () => NOW,
    ...(history ? { history } : {}),
    ...extra,
  };
}

beforeEach(async () => {
  await clearKv();
  await env.HISTORY.prepare("DELETE FROM daily_history").run();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("runUpdate + storico (AC-6, AC-11)", () => {
  it("scrive 13 righe dopo put meta, data Europe/Rome dell'avvio, 18 subrequest", async () => {
    const { writer, calls } = fakeWriter();
    await runUpdate(env.FORECASTS, locations, deps(undefined));
    await clearKv();
    const result = await runUpdate(env.FORECASTS, locations, deps(writer));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.metaWritten).toBe(true);
    expect(calls[0]!.batchRows).toBe(100);
    expect(calls[0]!.rows).toHaveLength(13);
    expect(calls[0]!.rows.every((r) => r.date === "2026-10-19")).toBe(true);
    expect(calls[0]!.rows.map((r) => r.location_slug).sort()).toEqual(result.updated_locations);
    const record = (await readJson("forecast:cagliari"))!;
    const day = record["daily"][0];
    const row = calls[0]!.rows.find((r) => r.location_slug === "cagliari")!;
    expect(row.state).toBe(day.sea.state);
    expect(row.air_temperature_max_c).toBe(day.weather.air_temperature_max_c);
    expect(result.metrics.history_date).toBe("2026-10-19");
    expect(result.metrics.history_rows).toBe(13);
    expect(result.metrics.history_queries).toBe(1);
    expect(result.metrics.history_failed).toBe(0);
    // KV vuota: la prima esecuzione ha anche la get latest (migrazione) = 19.
    expect(result.metrics.subrequests).toBe(19);
    const second = await runUpdate(env.FORECASTS, locations, deps(writer));
    expect(second.metrics.subrequests).toBe(18);
  });

  it("senza deps.history: invariato (17 subrequest, nessun campo di storico valorizzato)", async () => {
    await runUpdate(env.FORECASTS, locations, deps(undefined));
    const result = await runUpdate(env.FORECASTS, locations, deps(undefined));
    expect(result.metrics.subrequests).toBe(17);
    expect(result.metrics.history_rows).toBe(0);
    expect(result.metrics.history_date).toBeUndefined();
  });

  it("usa HISTORY_WRITE_BATCH_ROWS da config", async () => {
    const { writer, calls } = fakeWriter();
    const result = await runUpdate(env.FORECASTS, locations, deps(writer, {}, { config: { historyWriteBatchRows: 5 } }));
    expect(calls[0]!.batchRows).toBe(5);
    expect(result.metrics.history_queries).toBe(3);
  });

  it("budget basso: le istruzioni D1 sono riservate e il tetto non è superato", async () => {
    const { writer } = fakeWriter();
    for (const max of [17, 18, 19, 20, 30]) {
      await clearKv();
      const result = await runUpdate(env.FORECASTS, locations, deps(writer, {}, { config: { maxSubrequests: max } }));
      expect(result.metrics.subrequests).toBeLessThanOrEqual(max);
    }
    // Con tetto 18 e storico: 1 get meta + 1 get latest + riserva (13+1+1) = 17 -> resta 1 tentativo
    // al massimo; senza riserva ne sarebbero consentiti 2. Il tetto vale anche per le D1.
    await clearKv();
    const r = await runUpdate(env.FORECASTS, locations, deps(writer, {}, { config: { maxSubrequests: 18 } }));
    expect(r.metrics.budget_exhausted).toBe("subrequests");
  });
});

describe("runUpdate + storico: località non scritte (AC-7, AC-8, AC-10)", () => {
  it("località fallita: nessuna riga", async () => {
    const cagliari = locations.find((l) => l.slug === "cagliari")!;
    const { writer, calls } = fakeWriter();
    const result = await runUpdate(
      env.FORECASTS,
      locations,
      deps(writer, {
        fail: (request) =>
          request.lats.length === 1 && request.lats[0] === cagliari.latitude ? "apiError" : request.isBlock ? "apiError" : undefined,
      }),
    );
    expect(result.errors["cagliari"]).toBeDefined();
    const slugs = calls[0]?.rows.map((r) => r.location_slug) ?? [];
    expect(slugs).not.toContain("cagliari");
    expect(slugs.sort()).toEqual(result.updated_locations);
  });

  it("interruttore: nessuna località aggiornata, nessuna scrittura né KV né D1", async () => {
    const { writer, calls } = fakeWriter();
    const result = await runUpdate(env.FORECASTS, locations, deps(writer, { fail: () => "apiError" }));
    expect(result.written).toBe(false);
    expect(calls).toHaveLength(0);
    expect(await forecastKeys()).toEqual([]);
    expect(result.metrics.history_queries).toBe(0);
  });

  it("interruttore con alcune località aggiornate dal blocco: nessuna riga per le fallite (AC-7)", async () => {
    const { writer, calls } = fakeWriter();
    // Blocchi riusciti; ogni richiesta singola (fallback) fallisce: scatta l'interruttore.
    const result = await runUpdate(
      env.FORECASTS,
      locations,
      deps(writer, {
        fail: (request) => (request.provider === "weather" && !request.isBlock ? "apiError" : undefined),
        invalidLats: [locations[0]!.latitude, locations[1]!.latitude, locations[2]!.latitude],
      }),
    );
    const failed = Object.keys(result.errors);
    expect(failed.length).toBeGreaterThan(0);
    expect(result.updated_locations.length).toBeGreaterThan(0);
    const slugs = (calls[0]?.rows ?? []).map((r) => r.location_slug);
    for (const slug of failed) {
      expect(slugs).not.toContain(slug);
    }
    expect(slugs.sort()).toEqual(result.updated_locations);
  });

  it("seed da latest: solo le aggiornate producono righe", async () => {
    const legacy = (await (async () => {
      await runUpdate(env.FORECASTS, locations, deps(undefined));
      return readJson("forecast:cagliari");
    })())!;
    await clearKv();
    await env.FORECASTS.put("latest", JSON.stringify({ locations: { cagliari: legacy } }));
    const { writer, calls } = fakeWriter();
    const result = await runUpdate(
      env.FORECASTS,
      locations,
      deps(writer, { fail: (request) => (request.provider === "weather" ? "apiError" : undefined) }),
    );
    expect(result.updated_locations).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("budget esaurito: nessuna riga per le località non tentate", async () => {
    const { writer, calls } = fakeWriter();
    const result = await runUpdate(env.FORECASTS, locations, deps(writer, {}, { config: { maxSubrequests: 3 } }));
    expect(result.metrics.budget_exhausted).toBe("subrequests");
    expect(calls).toHaveLength(0);
  });

  it("previsione senza il giorno 0: nessuna riga, slug in history_missing_day0", async () => {
    const { writer, calls } = fakeWriter();
    const result = await runUpdate(env.FORECASTS, locations, {
      ...deps(writer),
      now: () => "2026-12-01T09:00:00+00:00",
    });
    expect(calls).toHaveLength(0);
    expect(result.metrics.history_rows).toBe(0);
    expect(result.metrics.history_missing_day0).toEqual(result.updated_locations);
    expect(result.written).toBe(true);
  });

  it("giorno 0 mancante solo per alcune: scrive le altre", async () => {
    const cagliari = locations.find((l) => l.slug === "cagliari")!;
    const base = fakeProvider().fetchImpl;
    // Per Cagliari (indice nelle risposte a blocco e singola) la data del giorno 0 è spostata in
    // entrambi i provider, quindi la sua previsione non contiene più 2026-10-19.
    const fetchImpl: typeof base = async (input, init) => {
      const url = new URL(String(input));
      const lats = (url.searchParams.get("latitude") ?? "").split(",").map(Number);
      const response = await base(input, init);
      const body = (await response.json()) as unknown;
      const shift = (element: unknown): unknown =>
        JSON.parse(JSON.stringify(element).replaceAll("2026-10-19", "2026-09-01"));
      const out = Array.isArray(body)
        ? body.map((element, index) => (lats[index] === cagliari.latitude ? shift(element) : element))
        : lats[0] === cagliari.latitude
          ? shift(body)
          : body;
      return new Response(JSON.stringify(out));
    };
    const { writer, calls } = fakeWriter();
    const result = await runUpdate(env.FORECASTS, locations, deps(writer, {}, { fetchImpl }));
    expect(result.updated_locations).toContain("cagliari");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.rows).toHaveLength(12);
    expect(calls[0]!.rows.map((r) => r.location_slug)).not.toContain("cagliari");
    expect(result.metrics.history_rows).toBe(12);
    expect(result.metrics.history_missing_day0).toEqual(["cagliari"]);
  });
});

describe("runUpdate + storico: errori (AC-9)", () => {
  async function baseline() {
    await clearKv();
    const result = await runUpdate(env.FORECASTS, locations, deps(undefined));
    const meta = await env.FORECASTS.get("meta");
    const records = await Promise.all((await forecastKeys()).map((k) => env.FORECASTS.get(k)));
    return { result, meta, records };
  }

  it.each([
    ["writer che lancia", { write: async () => { throw new Error("D1 giù"); } } as HistoryWriter, "D1 giù"],
    [
      "writer con errore",
      { write: async (rows: readonly HistoryRow[]) => ({ ok: false, error: "quota", rows_failed: rows.length, queries: 0 }) } as HistoryWriter,
      "quota",
    ],
  ])("%s: il job non rigetta e il cache è identico", async (_name, writer, message) => {
    const base = await baseline();
    await clearKv();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runUpdate(env.FORECASTS, locations, deps(writer));
    expect(result.written).toBe(true);
    expect(result.errors).toEqual(base.result.errors);
    expect(result.metrics.history_failed).toBe(13);
    expect(result.metrics.history_error).toBe(message);
    expect(result.metrics.history_rows).toBe(0);
    expect(error).toHaveBeenCalled();
    expect(await env.FORECASTS.get("meta")).toBe(base.meta);
    const records = await Promise.all((await forecastKeys()).map((k) => env.FORECASTS.get(k)));
    expect(records).toEqual(base.records);
  });
});

describe("runUpdate + storico: soglia D1 (AC-12)", () => {
  const sized = (size?: number) =>
    fakeWriter(async (rows) => ({ ok: true, rows_written: rows.length, queries: 1, ...(size === undefined ? {} : { size_after: size }) }));

  it("sopra soglia: paid_alerts contiene d1_size", async () => {
    const { writer } = sized(2 * 1024 * 1024);
    const result = await runUpdate(env.FORECASTS, locations, deps(writer, {}, { config: { paidAlertD1SizeMb: 1 } }));
    expect(result.metrics.paid_alerts).toContain("d1_size");
    expect(result.metrics.d1_size_bytes).toBe(2 * 1024 * 1024);
  });

  it("sotto soglia o size_after assente: nessun avviso", async () => {
    for (const size of [1024 * 1024, 100, undefined]) {
      await clearKv();
      const { writer } = sized(size);
      const result = await runUpdate(env.FORECASTS, locations, deps(writer, {}, { config: { paidAlertD1SizeMb: 1 } }));
      expect(result.metrics.paid_alerts).not.toContain("d1_size");
    }
  });
});

describe("scheduled con D1 di Miniflare (integrazione)", () => {
  async function trigger(): Promise<void> {
    vi.spyOn(globalThis, "fetch").mockImplementation(fakeProvider().fetchImpl);
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: "30 0,6,12,18 * * *" }), env, ctx);
    await waitOnExecutionContext(ctx);
  }

  it("giorno 0 assente dalle fixture: nessuna riga, cache scritto, campi nel log", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-15T09:00:00Z"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await trigger();
    } finally {
      vi.useRealTimers();
    }
    const line = JSON.parse(String(log.mock.calls.map((c) => c[0]).find((l) => String(l).includes("forecast_update"))));
    expect(line.history_rows).toBe(0);
    expect(line.history_missing_day0).toHaveLength(13);
    expect(line.history_date).toBe("2027-01-15");
    const count = await env.HISTORY.prepare("SELECT COUNT(*) AS n FROM daily_history").first<{ n: number }>();
    expect(count!.n).toBe(0);
  });

  it("giro completo con D1 reale: righe presenti; tabella assente: cache intatto", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    try {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await trigger();
      const count = await env.HISTORY.prepare("SELECT COUNT(*) AS n FROM daily_history WHERE date = '2026-10-19'").first<{ n: number }>();
      expect(count!.n).toBe(13);
      const line = JSON.parse(String(log.mock.calls.map((c) => c[0]).find((l) => String(l).includes("forecast_update"))));
      expect(line.history_rows).toBe(13);
      expect(line.history_queries).toBe(1);

      await clearKv();
      await env.HISTORY.prepare("ALTER TABLE daily_history RENAME TO daily_history_x").run();
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await trigger();
        const meta = (await readJson("meta"))!;
        expect(meta["updated_locations"]).toHaveLength(13);
        expect(meta["errors"]).toEqual({});
        expect(error).toHaveBeenCalled();
      } finally {
        await env.HISTORY.prepare("ALTER TABLE daily_history_x RENAME TO daily_history").run();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
