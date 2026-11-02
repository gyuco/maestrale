import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { createAdminApp } from "../src/admin/index";
import type { AccessVerifier } from "../src/admin/access";

const ORIGIN = "https://admin.example.com";
const ok: AccessVerifier = async () => ({ status: "ok", identity: { email: "admin@example.com" } });

function bindings(): never {
  return { ...env, ADMIN_ORIGIN: ORIGIN } as never;
}

async function post(form: Record<string, string>): Promise<Response> {
  return await createAdminApp({ verifyAccess: ok }).request(
    `${ORIGIN}/catalogo/nuovo`,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        Origin: ORIGIN,
      },
      body: new URLSearchParams(form).toString(),
    },
    bindings(),
  );
}

async function metaVersion(): Promise<number> {
  const row = await env.CORE.prepare("SELECT version FROM catalog_meta WHERE id = 1").first<{
    version: number;
  }>();
  return row?.version ?? 0;
}

async function actionsFor(slug: string): Promise<
  Array<{ admin_email: string; action: string; after_json: string | null; outcome: string }>
> {
  const { results } = await env.CORE.prepare(
    "SELECT admin_email, action, after_json, outcome FROM admin_actions WHERE slug = ?",
  )
    .bind(slug)
    .all<{ admin_email: string; action: string; after_json: string | null; outcome: string }>();
  return results ?? [];
}

const valid = {
  slug: "porto-pino",
  name: "Porto Pino",
  latitude: "38.98",
  longitude: "8.42",
};

beforeEach(async () => {
  await env.CORE.prepare("DELETE FROM locations WHERE slug LIKE 'test-%' OR slug = 'porto-pino'").run();
  await env.CORE.prepare("DELETE FROM admin_actions WHERE slug = 'porto-pino'").run();
  await env.CORE.prepare("UPDATE locations SET active = 1").run();
});

describe("aggiunta di una località (FR-97, FR-98, FR-113)", () => {
  it("salva una voce valida, aggiorna la cache e scrive il registro", async () => {
    const before = await metaVersion();
    const response = await post(valid);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/catalogo?esito=aggiunta");

    const row = await env.CORE.prepare(
      "SELECT slug, name, latitude, longitude, active, version FROM locations WHERE slug = 'porto-pino'",
    ).first<Record<string, unknown>>();
    expect(row).toMatchObject({
      slug: "porto-pino",
      name: "Porto Pino",
      latitude: 38.98,
      longitude: 8.42,
      active: 1,
      version: 1,
    });
    expect(await metaVersion()).toBe(before + 1);

    const cached = JSON.parse((await env.FORECASTS.get("catalog:current")) ?? "{}") as {
      locations?: Array<{ slug: string }>;
    };
    expect(cached.locations?.map((item) => item.slug)).toContain("porto-pino");

    const actions = await actionsFor("porto-pino");
    expect(actions).toHaveLength(1);
    expect(actions[0]?.admin_email).toBe("admin@example.com");
    expect(actions[0]?.action).toBe("add");
    expect(actions[0]?.outcome).toBe("ok");
    expect(JSON.parse(actions[0]?.after_json ?? "{}")).toMatchObject({ slug: "porto-pino" });
  });

  it("rifiuta un campo mancante senza scrivere nulla", async () => {
    const actionsBefore = (await actionsFor("porto-pino")).length;
    const response = await post({ ...valid, name: "  " });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Il nome è obbligatorio.");
    expect(
      await env.CORE.prepare("SELECT 1 FROM locations WHERE slug = 'porto-pino'").first(),
    ).toBeNull();
    expect((await actionsFor("porto-pino")).length).toBe(actionsBefore);
  });

  it("rifiuta uno slug già usato, anche da una località disattivata", async () => {
    await env.CORE.prepare("UPDATE locations SET active = 0 WHERE slug = 'olbia'").run();

    const attiva = await post({ ...valid, slug: "chia" });
    expect(attiva.status).toBe(400);
    expect(await attiva.text()).toContain("Slug già usato");

    const disattivata = await post({ ...valid, slug: "olbia" });
    expect(disattivata.status).toBe(400);
    expect(await disattivata.text()).toContain("Slug già usato");
  });

  it("rifiuta uno slug non normalizzato o un nome in collisione", async () => {
    const maiuscole = await post({ ...valid, slug: "Porto-Pino" });
    expect(maiuscole.status).toBe(400);
    expect(await maiuscole.text()).toContain("Lo slug deve essere in minuscolo");

    const collisione = await post({ ...valid, name: "Alghero" });
    expect(collisione.status).toBe(400);
    expect(await collisione.text()).toContain("Il nome coincide");
  });

  it("rifiuta coordinate fuori area e accetta i limiti esatti", async () => {
    const fuori = await post({ ...valid, latitude: "45" });
    expect(fuori.status).toBe(400);
    expect(await fuori.text()).toContain("La latitudine deve essere tra 38,5 e 41,5.");

    const limiti = await post({
      ...valid,
      slug: "test-limiti",
      name: "Test Limiti",
      latitude: "38.5",
      longitude: "10.2",
    });
    expect(limiti.status).toBe(303);
    await env.CORE.prepare("DELETE FROM locations WHERE slug = 'test-limiti'").run();
  });

  it("avvisa oltre 500 attive ma salva (FR-98)", async () => {
    await env.CORE.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 500)
       INSERT INTO locations (slug, name, latitude, longitude, active, version, created_at, updated_at)
       SELECT 'test-' || i, 'Test ' || i, 39, 8, 1, 1, '2026-11-02T00:00:00Z', '2026-11-02T00:00:00Z' FROM n`,
    ).run();

    const response = await post(valid);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/catalogo?esito=aggiunta&avviso=1");
  });
});
