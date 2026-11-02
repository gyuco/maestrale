import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { createAdminApp } from "../src/admin/index";
import type { AccessVerifier } from "../src/admin/access";

const ORIGIN = "https://admin.example.com";
const ok: AccessVerifier = async () => ({ status: "ok", identity: { email: "admin@example.com" } });

function bindings() {
  return { ...env, ADMIN_ORIGIN: ORIGIN } as never;
}

async function get(path: string): Promise<Response> {
  return await createAdminApp({ verifyAccess: ok }).request(`${ORIGIN}${path}`, {}, bindings());
}

async function setActive(slugs: string[], active: 0 | 1): Promise<void> {
  for (const slug of slugs) {
    await env.CORE.prepare("UPDATE locations SET active = ? WHERE slug = ?").bind(active, slug).run();
  }
}

beforeEach(async () => {
  await env.CORE.prepare("DELETE FROM locations WHERE slug LIKE 'test-%'").run();
  await env.CORE.prepare("UPDATE locations SET active = 1").run();
  await setActive(["chia", "olbia"], 0);
});

describe("elenco del catalogo (FR-96)", () => {
  it("mostra le località con stato e i conteggi separati", async () => {
    const attive = await (await get("/catalogo")).text();
    expect(attive).toContain("13 località totali");
    expect(attive).toContain("11 attive");
    expect(attive).toContain("Cagliari");
    expect(attive).not.toContain(">Chia<");
    expect(attive).not.toContain("Disattivata");

    const tutte = await (await get("/catalogo?stato=tutte")).text();
    expect(tutte).toContain(">Chia<");
    expect(tutte.match(/Disattivata/g)?.length).toBe(2);
  });

  it("ordina per nome crescente", async () => {
    const body = await (await get("/catalogo?stato=tutte")).text();
    const names = ["Alghero", "Arbatax", "Cagliari", "Carloforte", "Chia", "La Maddalena"];
    const positions = names.map((name) => body.indexOf(`>${name}<`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("filtra per testo contenuto in nome o slug", async () => {
    const body = await (await get("/catalogo?q=tor")).text();
    expect(body).toContain("Torre dei Corsari");
    expect(body).toContain("Porto Torres");
    expect(body).not.toContain("Alghero");
    // I conteggi restano quelli del catalogo, non del filtro.
    expect(body).toContain("13 località totali");
  });

  it("filtra per stato, anche combinato con il testo", async () => {
    const disattivate = await (await get("/catalogo?stato=disattivate")).text();
    expect(disattivate).toContain("Chia");
    expect(disattivate).toContain("Olbia");
    expect(disattivate).not.toContain("Alghero");

    const tutte = await (await get("/catalogo?stato=tutte")).text();
    expect(tutte).toContain("Alghero");

    const sconosciuto = await (await get("/catalogo?stato=altro")).text();
    expect(sconosciuto).not.toContain(">Chia<");
    expect(sconosciuto).toContain("Alghero");

    const combinato = await (await get("/catalogo?stato=attive&q=chia")).text();
    expect(combinato).not.toContain(">Chia<");
  });

  it("con 500 località le mostra tutte, senza paginazione", async () => {
    await env.CORE.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 487)
       INSERT INTO locations (slug, name, latitude, longitude, active, version, created_at, updated_at)
       SELECT 'test-' || i, 'Test ' || i, 39, 8, 1, 1, '2026-11-02T00:00:00Z', '2026-11-02T00:00:00Z' FROM n`,
    ).run();

    const started = Date.now();
    const response = await get("/catalogo?stato=tutte");
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain("500 località totali");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("mostra lo stato vuoto quando nessuna località corrisponde", async () => {
    const body = await (await get("/catalogo?q=zzzz")).text();
    expect(body).toContain("Nessuna località corrisponde ai filtri");
  });
});
