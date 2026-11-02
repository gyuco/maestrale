import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { createAdminApp } from "../src/admin/index";
import type { AccessVerifier } from "../src/admin/access";

const ORIGIN = "https://admin.example.com";
const ok: AccessVerifier = async () => ({ status: "ok", identity: { email: "admin@example.com" } });

function bindings(): never {
  return { ...env, ADMIN_ORIGIN: ORIGIN } as never;
}

async function get(path: string): Promise<Response> {
  return await createAdminApp({ verifyAccess: ok }).request(`${ORIGIN}${path}`, {}, bindings());
}

async function insertRun(
  id: string,
  startedAt: string,
  outcome: string,
  over: Partial<Record<string, unknown>> = {},
): Promise<void> {
  await env.CORE.prepare(
    `INSERT INTO job_runs
       (id, origin, scope, scope_slug, triggered_by, status, started_at, finished_at, duration_ms,
        outcome, reject_reason, catalog_version, catalog_size, updated_count, failed_count,
        not_attempted_count, breaker, metrics, history_rows, history_error)
     VALUES (?, 'pianificata', 'tutte', NULL, NULL, 'done', ?, ?, 60000, ?, NULL, 1, 13, 13, 0, 0, 0, NULL, 13, NULL)`,
  )
    .bind(id, startedAt, startedAt, outcome)
    .run();
  if (Object.keys(over).length > 0) {
    for (const [column, value] of Object.entries(over)) {
      await env.CORE.prepare(`UPDATE job_runs SET ${column} = ? WHERE id = ?`)
        .bind(value, id)
        .run();
    }
  }
}

beforeEach(async () => {
  await env.CORE.prepare("DELETE FROM job_run_failures").run();
  await env.CORE.prepare("DELETE FROM job_runs").run();
  await env.CORE.prepare("DELETE FROM run_requests").run();
});

describe("elenco delle esecuzioni (FR-108)", () => {
  it("paginare a 20 dalla più recente, con i conteggi", async () => {
    const statements = Array.from({ length: 45 }, (_, index) => {
      const n = index + 1;
      const seconds = String(n).padStart(2, "0");
      return env.CORE.prepare(
        `INSERT INTO job_runs
           (id, origin, scope, status, started_at, finished_at, duration_ms, outcome,
            catalog_version, catalog_size, updated_count, failed_count, not_attempted_count, breaker)
         VALUES (?, 'pianificata', 'tutte', 'done', ?, ?, 60000, 'riuscita', 1, 13, 13, 0, 0, 0)`,
      ).bind(`run-${n}`, `2026-11-02T10:00:${seconds}.000Z`, `2026-11-02T10:01:${seconds}.000Z`);
    });
    await env.CORE.batch(statements);

    const body = await (await get("/esecuzioni")).text();
    expect(body).toContain("45 esecuzioni conservate");
    expect(body).toContain("Pagina 1 di 3");
    expect(body).toContain("run-45");
    expect(body).not.toContain("run-25");

    const page3 = await (await get("/esecuzioni?page=3")).text();
    expect(page3).toContain("Pagina 3 di 3");
    expect(page3).toContain("run-5");
  });

  it("filtra per esito e per intervallo di date", async () => {
    await insertRun("a", "2026-10-30T10:00:00.000Z", "riuscita");
    await insertRun("b", "2026-11-01T10:00:00.000Z", "parziale");
    await insertRun("c", "2026-11-02T10:00:00.000Z", "parziale");

    const parziale = await (await get("/esecuzioni?esito=parziale")).text();
    expect(parziale).toContain("2 esecuzioni conservate");
    expect(parziale).not.toContain("/esecuzioni/a");

    const intervallo = await (await get("/esecuzioni?da=2026-11-01&a=2026-11-01")).text();
    expect(intervallo).toContain("1 esecuzioni conservate");
    expect(intervallo).toContain("/esecuzioni/b");
  });

  it("mostra le richieste in attesa", async () => {
    await env.CORE.prepare(
      "INSERT INTO run_requests (id, requested_at, admin_email, scope, slug, status) VALUES ('req-1', '2026-11-02T10:00:00Z', 'a@example.com', 'singola', 'chia', 'pending')",
    ).run();
    const body = await (await get("/esecuzioni")).text();
    expect(body).toContain("In attesa di avvio");
    expect(body).toContain("chia");
    expect(body).toContain("a@example.com");
  });
});

describe("dettaglio di un'esecuzione (FR-109)", () => {
  it("mostra i campi e le località fallite ordinate per slug con il nome corrente", async () => {
    await insertRun("run-1", "2026-11-02T10:00:00.000Z", "parziale", {
      updated_count: 11,
      failed_count: 2,
      reject_reason: null,
      history_error: "D1 lento",
    });
    await env.CORE.batch([
      env.CORE.prepare(
        "INSERT INTO job_run_failures (run_id, slug, message, kind) VALUES (?, ?, ?, ?)",
      ).bind("run-1", "chia", "HTTP 503", "failed"),
      env.CORE.prepare(
        "INSERT INTO job_run_failures (run_id, slug, message, kind) VALUES (?, ?, ?, ?)",
      ).bind("run-1", "alghero", "Budget esaurito", "not_attempted"),
      env.CORE.prepare(
        "INSERT INTO job_run_failures (run_id, slug, message, kind) VALUES (?, ?, ?, ?)",
      ).bind("run-1", "rimossa", "HTTP 500", "failed"),
    ]);

    const body = await (await get("/esecuzioni/run-1")).text();
    expect(body).toContain("Parziale");
    expect(body).toContain("13 località (versione 1)");
    expect(body).toContain("D1 lento");
    expect(body.indexOf(">alghero<")).toBeLessThan(body.indexOf(">chia<"));
    expect(body.indexOf(">chia<")).toBeLessThan(body.indexOf(">rimossa<"));
    expect(body).toContain("Non tentata");
    expect(body).toContain("—");
  });

  it("mostra 'Non completata' e il motivo del rifiuto quando presenti", async () => {
    await insertRun("run-2", "2026-11-02T10:00:00.000Z", "non_completata");
    const nonCompletata = await (await get("/esecuzioni/run-2")).text();
    expect(nonCompletata).toContain("Non completata");

    await env.CORE.prepare("UPDATE job_runs SET outcome = 'rifiutata', reject_reason = 'Catalogo non valido' WHERE id = 'run-2'").run();
    const rifiutata = await (await get("/esecuzioni/run-2")).text();
    expect(rifiutata).toContain("Rifiutata");
    expect(rifiutata).toContain("Catalogo non valido");
  });

  it("404 per un id inesistente", async () => {
    expect((await get("/esecuzioni/nope")).status).toBe(404);
  });
});
