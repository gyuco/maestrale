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

async function insertAction(
  at: string,
  email: string,
  action: string,
  slug: string,
  outcome = "ok",
  reason: string | null = null,
): Promise<void> {
  await env.CORE.prepare(
    `INSERT INTO admin_actions (at, admin_email, action, slug, before_json, after_json, reason, outcome)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(at, email, action, slug, JSON.stringify({ name: "Prima" }), JSON.stringify({ name: "Dopo" }), reason, outcome)
    .run();
}

beforeEach(async () => {
  await env.CORE.prepare("DELETE FROM admin_actions").run();
});

describe("registro operazioni (FR-113, NFR-29)", () => {
  it("mostra le voci dalla più recente con tipo, email, slug e dettaglio", async () => {
    await insertAction("2026-11-02T10:00:00Z", "a@example.com", "add", "alghero");
    await insertAction("2026-11-02T12:00:00Z", "b@example.com", "update", "chia");

    const body = await (await get("/registro")).text();
    expect(body).toContain("2 voci");
    expect(body.indexOf(">chia<")).toBeLessThan(body.indexOf(">alghero<"));
    expect(body).toContain("Modifica");
    expect(body).toContain("b@example.com");
    expect(body).toContain("Dopo");
    expect(body).not.toContain("<form method=\"post\"");
  });

  it("filtra per slug e per amministratore, anche combinati", async () => {
    await insertAction("2026-11-02T10:00:00Z", "a@example.com", "add", "alghero");
    await insertAction("2026-11-02T10:01:00Z", "b@example.com", "update", "alghero");
    await insertAction("2026-11-02T10:02:00Z", "b@example.com", "deactivate", "chia");

    const perSlug = await (await get("/registro?slug=alghero")).text();
    expect(perSlug).toContain("2 voci");
    expect(perSlug).not.toContain(">chia<");

    const perAdmin = await (await get("/registro?admin=b@example.com")).text();
    expect(perAdmin).toContain("2 voci");
    expect(perAdmin).not.toContain("a@example.com");

    const combinato = await (await get("/registro?slug=alghero&admin=b@example.com")).text();
    expect(combinato).toContain("1 voci");
  });

  it("mostra i rifiuti con il motivo", async () => {
    await insertAction(
      "2026-11-02T10:00:00Z",
      "a@example.com",
      "run_rejected",
      null as unknown as string,
      "rejected",
      "Attendi 15 minuti",
    );
    const body = await (await get("/registro")).text();
    expect(body).toContain("Rifiutata");
    expect(body).toContain("Attendi 15 minuti");
  });

  it("paginare a 50 voci conservando i filtri", async () => {
    await env.CORE.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 60)
       INSERT INTO admin_actions (at, admin_email, action, slug, before_json, after_json, reason, outcome)
       SELECT strftime('%Y-%m-%dT%H:%M:%SZ', '2026-11-02T00:00:00Z', '+' || i || ' seconds'),
              'a@example.com', 'add', 'test-' || i, NULL, NULL, NULL, 'ok' FROM n`,
    ).run();

    const page1 = await (await get("/registro")).text();
    expect(page1).toContain("60 voci");
    expect(page1).toContain("Pagina 1 di 2");
    expect(page1).toContain("test-60");
    expect(page1).not.toContain("test-1<");

    const page2 = await (await get("/registro?page=2")).text();
    expect(page2).toContain("Pagina 2 di 2");
    expect(page2).toContain("test-1<");
  });

  it("non espone percorsi di modifica o cancellazione", async () => {
    expect((await get("/registro/1")).status).toBe(404);
    const response = await createAdminApp({ verifyAccess: ok }).request(
      `${ORIGIN}/registro/1`,
      { method: "DELETE", headers: { Origin: ORIGIN } },
      bindings(),
    );
    expect([404, 405]).toContain(response.status);
  });
});
