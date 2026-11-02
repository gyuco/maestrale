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
async function post(path: string): Promise<Response> {
  return await app().request(
    `${ORIGIN}${path}`,
    { method: "POST", headers: { Origin: ORIGIN } },
    bindings(),
  );
}

async function setActive(slug: string, active: 0 | 1): Promise<void> {
  await env.CORE.prepare("UPDATE locations SET active = ?, version = 1 WHERE slug = ?")
    .bind(active, slug)
    .run();
}

async function row(slug: string): Promise<{ active: number; version: number } | null> {
  return await env.CORE.prepare("SELECT active, version FROM locations WHERE slug = ?")
    .bind(slug)
    .first<{ active: number; version: number }>();
}

async function cachedSlugs(): Promise<string[]> {
  const parsed = JSON.parse((await env.FORECASTS.get("catalog:current")) ?? "{}") as {
    locations?: Array<{ slug: string }>;
  };
  return (parsed.locations ?? []).map((item) => item.slug);
}

beforeEach(async () => {
  await env.CORE.prepare("UPDATE locations SET active = 1, version = 1 WHERE slug IN ('alghero', 'chia')").run();
  await env.CORE.prepare("UPDATE locations SET name = 'Chia' WHERE slug = 'chia'").run();
  await env.CORE.prepare("DELETE FROM admin_actions WHERE slug = 'alghero'").run();
  await env.FORECASTS.delete("forecast:alghero");
});

describe("disattivazione e riattivazione (FR-100, FR-119)", () => {
  it("disattiva dopo conferma con slug e nome e aggiorna la cache", async () => {
    const confirm = await get("/catalogo/alghero/disattiva");
    const confirmBody = await confirm.text();
    expect(confirm.status).toBe(200);
    expect(confirmBody).toContain("alghero");
    expect(confirmBody).toContain("Alghero");

    const response = await post("/catalogo/alghero/disattiva");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/catalogo?esito=disattivata");

    expect(await row("alghero")).toEqual({ active: 0, version: 2 });
    expect(await cachedSlugs()).not.toContain("alghero");

    const action = await env.CORE.prepare(
      "SELECT action, before_json, after_json FROM admin_actions WHERE slug = 'alghero' ORDER BY id DESC LIMIT 1",
    ).first<{ action: string; before_json: string; after_json: string }>();
    expect(action?.action).toBe("deactivate");
    expect(JSON.parse(action?.before_json ?? "{}")).toEqual({ active: true });
    expect(JSON.parse(action?.after_json ?? "{}")).toEqual({ active: false });
  });

  it("riattiva, riporta la località in cache e cancella la previsione vecchia (FR-119)", async () => {
    await setActive("alghero", 0);
    await env.FORECASTS.put("forecast:alghero", JSON.stringify({ vecchia: true }));

    const response = await post("/catalogo/alghero/riattiva");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/catalogo?esito=riattivata");

    expect(await row("alghero")).toEqual({ active: 1, version: 2 });
    expect(await cachedSlugs()).toContain("alghero");
    expect(await env.FORECASTS.get("forecast:alghero")).toBeNull();

    const action = await env.CORE.prepare(
      "SELECT action FROM admin_actions WHERE slug = 'alghero' ORDER BY id DESC LIMIT 1",
    ).first<{ action: string }>();
    expect(action?.action).toBe("reactivate");
  });

  it("rifiuta di disattivare una località già disattivata", async () => {
    await setActive("alghero", 0);
    const response = await post("/catalogo/alghero/disattiva");
    expect(response.status).toBe(409);
    expect((await row("alghero"))?.version).toBe(1);
  });

  it("rifiuta la riattivazione se i valori correnti non sono più validi (FR-98)", async () => {
    await setActive("alghero", 0);
    await env.CORE.prepare("UPDATE locations SET name = 'Alghero' WHERE slug = 'chia'").run();

    const response = await post("/catalogo/alghero/riattiva");
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("coincide");
    expect((await row("alghero"))?.active).toBe(0);
  });

  it("404 per uno slug inesistente", async () => {
    expect((await get("/catalogo/inesistente/disattiva")).status).toBe(404);
    expect((await post("/catalogo/inesistente/riattiva")).status).toBe(404);
  });
});
