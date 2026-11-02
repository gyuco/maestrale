import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { createAdminApp } from "../src/admin/index";
import type { AccessVerifier } from "../src/admin/access";

const ORIGIN = "https://admin.example.com";
const ok: AccessVerifier = async () => ({ status: "ok", identity: { email: "admin@example.com" } });

function bindings(): never {
  return { ...env, ADMIN_ORIGIN: ORIGIN } as never;
}

function app() {
  return createAdminApp({ verifyAccess: ok });
}

async function get(path: string): Promise<Response> {
  return await app().request(`${ORIGIN}${path}`, {}, bindings());
}

async function post(path: string, form: Record<string, string>): Promise<Response> {
  return await app().request(
    `${ORIGIN}${path}`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", Origin: ORIGIN },
      body: new URLSearchParams(form).toString(),
    },
    bindings(),
  );
}

async function location(): Promise<{ name: string; latitude: number; longitude: number; version: number }> {
  const row = await env.CORE.prepare(
    "SELECT name, latitude, longitude, version FROM locations WHERE slug = 'alghero'",
  ).first<{ name: string; latitude: number; longitude: number; version: number }>();
  if (row === null) throw new Error("alghero assente");
  return row;
}

async function metaVersion(): Promise<number> {
  const row = await env.CORE.prepare("SELECT version FROM catalog_meta WHERE id = 1").first<{
    version: number;
  }>();
  return row?.version ?? 0;
}

beforeEach(async () => {
  await env.CORE.prepare(
    "UPDATE locations SET name = 'Alghero', latitude = 40.56, longitude = 8.26, version = 1, active = 1 WHERE slug = 'alghero'",
  ).run();
  await env.CORE.prepare("DELETE FROM admin_actions WHERE slug = 'alghero'").run();
});

describe("modifica di una località (FR-99, FR-103)", () => {
  it("aggiorna nome e coordinate, non lo slug, e registra prima/dopo", async () => {
    const beforeMeta = await metaVersion();
    const response = await post("/catalogo/alghero", {
      name: "Alghero Nuova",
      latitude: "40.6",
      longitude: "8.3",
      version: "1",
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/catalogo?esito=modifica");

    const row = await location();
    expect(row).toEqual({ name: "Alghero Nuova", latitude: 40.6, longitude: 8.3, version: 2 });
    expect(await metaVersion()).toBe(beforeMeta + 1);

    const action = await env.CORE.prepare(
      "SELECT action, before_json, after_json, outcome FROM admin_actions WHERE slug = 'alghero'",
    ).first<{ action: string; before_json: string; after_json: string; outcome: string }>();
    expect(action?.action).toBe("update");
    expect(action?.outcome).toBe("ok");
    expect(JSON.parse(action?.before_json ?? "{}")).toMatchObject({
      name: "Alghero",
      latitude: 40.56,
    });
    expect(JSON.parse(action?.after_json ?? "{}")).toMatchObject({
      name: "Alghero Nuova",
      latitude: 40.6,
    });

    const cached = JSON.parse((await env.FORECASTS.get("catalog:current")) ?? "{}") as {
      locations?: Array<{ slug: string; name: string }>;
    };
    expect(cached.locations?.find((item) => item.slug === "alghero")?.name).toBe("Alghero Nuova");
  });

  it("rifiuta coordinate fuori area senza scrivere", async () => {
    const response = await post("/catalogo/alghero", {
      name: "Alghero",
      latitude: "45",
      longitude: "8.26",
      version: "1",
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("La latitudine deve essere tra 38,5 e 41,5.");
    expect((await location()).version).toBe(1);
  });

  it("rifiuta un salvataggio concorrente con 409 e una voce rejected", async () => {
    const stale = await location();
    // Un altro amministratore salva prima: la versione della riga avanza.
    await env.CORE.prepare(
      "UPDATE locations SET name = 'Alghero (altro)', version = 5 WHERE slug = 'alghero'",
    ).run();

    const response = await post("/catalogo/alghero", {
      name: "Alghero Nuova",
      latitude: "40.6",
      longitude: "8.3",
      version: String(stale.version),
    });

    expect(response.status).toBe(409);
    expect(await response.text()).toContain("ricarica la voce");
    const row = await location();
    expect(row.name).toBe("Alghero (altro)");
    expect(row.version).toBe(5);

    const rejected = await env.CORE.prepare(
      "SELECT outcome, reason FROM admin_actions WHERE slug = 'alghero' ORDER BY id DESC LIMIT 1",
    ).first<{ outcome: string; reason: string }>();
    expect(rejected?.outcome).toBe("rejected");
    expect(rejected?.reason).toContain("ricarica la voce");
  });

  it("non permette di cambiare lo slug", async () => {
    const response = await post("/catalogo/alghero", {
      slug: "altro-slug",
      name: "Alghero",
      latitude: "40.56",
      longitude: "8.26",
      version: "1",
    });
    expect(response.status).toBe(303);
    const row = await env.CORE.prepare(
      "SELECT slug FROM locations WHERE slug = 'alghero'",
    ).first<{ slug: string }>();
    expect(row?.slug).toBe("alghero");
    expect(
      await env.CORE.prepare("SELECT 1 FROM locations WHERE slug = 'altro-slug'").first(),
    ).toBeNull();
  });

  it("mostra il form con lo slug in sola lettura e la versione corrente", async () => {
    const body = await (await get("/catalogo/alghero")).text();
    expect(body).toContain('value="alghero"');
    expect(body).toContain("readonly");
    expect(body).toContain('name="version"');
  });

  it("404 per uno slug inesistente", async () => {
    expect((await get("/catalogo/inesistente")).status).toBe(404);
  });
});
