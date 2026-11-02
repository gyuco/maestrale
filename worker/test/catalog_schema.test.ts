import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const db = env.CORE;
const testEnv = env as unknown as { TEST_LOCATIONS_JSON: string };

async function all<T>(sql: string): Promise<T[]> {
  const result = await db.prepare(sql).all<T>();
  return result.results ?? [];
}

describe("schema D1 CORE (ADR-0006/0008/0009)", () => {
  it("crea tutte le tabelle del backoffice", async () => {
    const tables = (
      await all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
    ).map((row) => row.name);
    for (const table of [
      "catalog_meta",
      "locations",
      "job_runs",
      "job_run_failures",
      "admin_actions",
      "run_requests",
      "job_lock",
    ]) {
      expect(tables).toContain(table);
    }
  });

  it("inizializza catalog_meta e job_lock con una sola riga", async () => {
    const meta = await all<{ id: number; version: number }>(
      "SELECT id, version FROM catalog_meta",
    );
    expect(meta).toEqual([{ id: 1, version: 1 }]);

    const lock = await all<{ id: number; lease_until: string }>(
      "SELECT id, lease_until FROM job_lock",
    );
    expect(lock).toHaveLength(1);
    expect(lock[0]?.id).toBe(1);
    expect(lock[0]?.lease_until).toBe("1970-01-01T00:00:00Z");
  });

  it("il seed contiene esattamente le voci di locations.json, tutte attive (FR-104)", async () => {
    const expected = JSON.parse(testEnv.TEST_LOCATIONS_JSON) as Array<{
      slug: string;
      name: string;
      latitude: number;
      longitude: number;
    }>;
    const rows = await all<{
      slug: string;
      name: string;
      latitude: number;
      longitude: number;
      active: number;
      version: number;
    }>("SELECT slug, name, latitude, longitude, active, version FROM locations ORDER BY slug");

    expect(rows).toHaveLength(expected.length);
    expect(rows).toEqual(
      [...expected]
        .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
        .map((entry) => ({ ...entry, active: 1, version: 1 })),
    );
  });
});
