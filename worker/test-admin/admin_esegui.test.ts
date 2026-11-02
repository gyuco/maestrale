import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { createAdminApp } from "../src/admin/index";
import type { AccessVerifier } from "../src/admin/access";

const ORIGIN = "https://admin.example.com";
const ok: AccessVerifier = async () => ({ status: "ok", identity: { email: "admin@example.com" } });

function bindings(): never {
  return { ...env, ADMIN_ORIGIN: ORIGIN } as never;
}
const app = () => createAdminApp({ verifyAccess: ok });

async function get(path: string): Promise<Response> {
  return await app().request(`${ORIGIN}${path}`, {}, bindings());
}
async function post(form: Record<string, string>): Promise<Response> {
  return await app().request(
    `${ORIGIN}/esegui`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", Origin: ORIGIN },
      body: new URLSearchParams(form).toString(),
    },
    bindings(),
  );
}

async function requests(): Promise<Array<{ scope: string; slug: string | null; status: string }>> {
  const { results } = await env.CORE.prepare("SELECT scope, slug, status FROM run_requests").all<{
    scope: string;
    slug: string | null;
    status: string;
  }>();
  return results ?? [];
}

async function lastAction(): Promise<{ action: string; outcome: string; reason: string | null } | null> {
  return await env.CORE.prepare(
    "SELECT action, outcome, reason FROM admin_actions ORDER BY id DESC LIMIT 1",
  ).first<{ action: string; outcome: string; reason: string | null }>();
}

beforeEach(async () => {
  await env.CORE.prepare("DELETE FROM run_requests").run();
  await env.CORE.prepare("DELETE FROM job_runs").run();
  await env.CORE.prepare("DELETE FROM admin_actions").run();
  await env.CORE.prepare("UPDATE job_lock SET lease_until = '1970-01-01T00:00:00Z'").run();
  await env.CORE.prepare("UPDATE locations SET active = 1").run();
});

describe("Esegui ora: richiesta e rifiuti (FR-114, FR-115)", () => {
  it("mostra il form con le località attive", async () => {
    const body = await (await get("/esegui")).text();
    expect(body).toContain("Tutte le località attive");
    expect(body).toContain("chia");
  });

  it("accetta 'tutte' e registra la richiesta e l'operazione", async () => {
    const response = await post({ scope: "tutte" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/esecuzioni?esito=richiesta");

    expect(await requests()).toEqual([{ scope: "tutte", slug: null, status: "pending" }]);
    expect((await lastAction())?.action).toBe("run");
    expect((await lastAction())?.outcome).toBe("ok");
  });

  it("accetta 'singola' su una località attiva", async () => {
    const response = await post({ scope: "singola", slug: "chia" });
    expect(response.status).toBe(303);
    expect(await requests()).toEqual([{ scope: "singola", slug: "chia", status: "pending" }]);
  });

  it("rifiuta 'singola' su una località disattivata", async () => {
    await env.CORE.prepare("UPDATE locations SET active = 0 WHERE slug = 'chia'").run();
    const response = await post({ scope: "singola", slug: "chia" });
    expect(response.status).toBe(400);
    expect(await requests()).toEqual([]);
  });

  it("rifiuta una seconda richiesta mentre una è in attesa", async () => {
    await post({ scope: "tutte" });
    const response = await post({ scope: "tutte" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("esito=rifiutata");
    expect(await requests()).toHaveLength(1);
    expect((await lastAction())?.action).toBe("run_rejected");
    expect((await lastAction())?.reason).toContain("in corso");
  });

  it("rifiuta se un'esecuzione è in corso (lease attivo)", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    await env.CORE.prepare("UPDATE job_lock SET lease_until = ?").bind(future).run();
    const response = await post({ scope: "tutte" });
    expect(response.headers.get("location")).toContain("esito=rifiutata");
    expect(await requests()).toEqual([]);
  });

  it("rifiuta se l'ultima esecuzione su richiesta è recente, accetta dopo 15 minuti", async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    await env.CORE.prepare(
      `INSERT INTO job_runs (id, origin, scope, status, started_at, catalog_version, catalog_size)
       VALUES ('old', 'su-richiesta', 'tutte', 'done', ?, 1, 13)`,
    )
      .bind(tenMinutesAgo)
      .run();

    const rejected = await post({ scope: "tutte" });
    expect(rejected.headers.get("location")).toContain("esito=rifiutata");
    expect((await lastAction())?.reason).toContain("15 minuti");

    const sixteenMinutesAgo = new Date(Date.now() - 16 * 60_000).toISOString();
    await env.CORE.prepare("UPDATE job_runs SET started_at = ? WHERE id = 'old'")
      .bind(sixteenMinutesAgo)
      .run();
    const accepted = await post({ scope: "tutte" });
    expect(accepted.headers.get("location")).toContain("esito=richiesta");
  });
});
