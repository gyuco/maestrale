import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createAdminApp } from "../src/admin/index";
import type { AccessVerifier } from "../src/admin/access";

const ORIGIN = "https://admin.example.com";
const bindings = () => ({ ...env, ADMIN_ORIGIN: ORIGIN }) as never;
const ok: AccessVerifier = async () => ({ status: "ok", identity: { email: "admin@example.com" } });

async function get(path: string): Promise<Response> {
  return await createAdminApp({ verifyAccess: ok }).request(`${ORIGIN}${path}`, {}, bindings());
}

describe("pagine del backoffice (FR-92, NFR-10)", () => {
  it.each([
    ["/catalogo", "Catalogo località"],
    ["/esecuzioni", "Esecuzioni del job"],
    ["/registro", "Registro operazioni"],
  ])("%s mostra il titolo in italiano", async (path, title) => {
    const response = await get(path);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain(title);
    expect(body).toContain("Maestrale · Amministrazione");
  });

  it("la navigazione è presente e marca la sezione attiva", async () => {
    const body = await (await get("/esecuzioni")).text();
    expect(body).toContain('href="/catalogo"');
    expect(body).toContain('href="/esecuzioni"');
    expect(body).toContain('href="/registro"');
    expect(body).toContain('aria-current="page"');
  });

  it("include il foglio di stile della stessa origine", async () => {
    const body = await (await get("/catalogo")).text();
    expect(body).toContain('href="/assets/admin.css"');

    const css = await get("/assets/admin.css");
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
    expect(await css.text()).toContain(".topbar");
  });

  it("una route sconosciuta risponde 404", async () => {
    expect((await get("/nope")).status).toBe(404);
  });
});
