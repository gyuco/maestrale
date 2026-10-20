import { describe, expect, it } from "vitest";

import { parseHistoryParams } from "../src/history";

const ok = { localita: "Cagliari", from: "2026-10-14", to: "2026-10-20" };

function invalid(query: Record<string, string | undefined>): string {
  const result = parseHistoryParams(query);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.detail;
}

describe("parseHistoryParams (AC-5)", () => {
  it("valido: granularity di default day", () => {
    expect(parseHistoryParams(ok)).toEqual({
      ok: true,
      value: { localita: "Cagliari", granularity: "day", from: "2026-10-14", to: "2026-10-20" },
    });
    expect(parseHistoryParams({ ...ok, granularity: "month" })).toMatchObject({
      ok: true,
      value: { granularity: "month" },
    });
  });

  it.each([
    [{ ...ok, localita: undefined }, "localita"],
    [{ ...ok, localita: "" }, "localita"],
    [{ ...ok, granularity: "week" }, "granularity"],
    [{ ...ok, from: undefined }, "from"],
    [{ ...ok, to: undefined }, "to"],
    [{ ...ok, from: "2026-13-01" }, "from"],
    [{ ...ok, from: "2026-02-30" }, "from"],
    [{ ...ok, from: "26-10-14" }, "from"],
    [{ ...ok, to: "2026-10-32" }, "to"],
    [{ ...ok, from: "2026-10-21" }, "from"],
  ])("422 %j", (query, word) => {
    const detail = invalid(query);
    expect(detail.length).toBeGreaterThan(0);
    expect(detail).toContain(word);
  });

  it("ordine di validazione: localita prima di granularity prima delle date", () => {
    expect(invalid({ granularity: "week", from: "x" })).toContain("localita");
    expect(invalid({ localita: "A", granularity: "week", from: "x" })).toContain("granularity");
    expect(invalid({ localita: "A", from: "x", to: "2026-01-01" })).toContain("from");
  });

  it("data di calendario: 29 febbraio valido solo negli anni bisestili", () => {
    expect(parseHistoryParams({ localita: "A", from: "2028-02-29", to: "2028-02-29" }).ok).toBe(true);
    expect(parseHistoryParams({ localita: "A", from: "2027-02-29", to: "2027-03-01" }).ok).toBe(false);
  });

  it("day: 366 giorni ammessi, 367 no (estremi inclusi)", () => {
    expect(parseHistoryParams({ localita: "A", from: "2026-01-01", to: "2026-12-31" }).ok).toBe(true); // 365
    expect(parseHistoryParams({ localita: "A", from: "2027-01-01", to: "2027-12-31" }).ok).toBe(true); // 365
    expect(parseHistoryParams({ localita: "A", from: "2028-01-01", to: "2028-12-31" }).ok).toBe(true); // 366
    expect(parseHistoryParams({ localita: "A", from: "2025-12-31", to: "2026-12-31" }).ok).toBe(true); // 366
    expect(parseHistoryParams({ localita: "A", from: "2027-12-31", to: "2028-12-31" }).ok).toBe(false); // 367
    expect(parseHistoryParams({ localita: "A", from: "2027-12-31", to: "2028-12-30" }).ok).toBe(true); // 366
    expect(invalid({ localita: "A", from: "2027-12-31", to: "2028-12-31" })).toContain("366");
  });

  it("month: 120 mesi ammessi, 121 no, anche attraverso il cambio anno", () => {
    const base = { localita: "A", granularity: "month" };
    expect(parseHistoryParams({ ...base, from: "2017-01-15", to: "2026-12-01" }).ok).toBe(true); // 120
    expect(parseHistoryParams({ ...base, from: "2016-12-31", to: "2026-12-01" }).ok).toBe(false); // 121
    expect(parseHistoryParams({ ...base, from: "2016-11-30", to: "2026-10-01" }).ok).toBe(true); // 120
    expect(parseHistoryParams({ ...base, from: "2016-10-30", to: "2026-10-01" }).ok).toBe(false); // 121
    expect(invalid({ ...base, from: "2016-12-31", to: "2026-12-01" })).toContain("120");
  });

  it("to nel futuro è ammesso", () => {
    expect(parseHistoryParams({ localita: "A", from: "2999-01-01", to: "2999-01-31" }).ok).toBe(true);
    expect(parseHistoryParams({ localita: "A", from: "2026-10-20", to: "2026-10-21" }).ok).toBe(true);
  });
});
