import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createAdminApp } from "../src/admin/index";
import type { AccessVerifier } from "../src/admin/access";

const ORIGIN = "https://admin.example.com";
const bindings = () => ({ ...env, ADMIN_ORIGIN: ORIGIN }) as never;

const ok: AccessVerifier = async () => ({ status: "ok", identity: { email: "admin@example.com" } });
const unauthenticated: AccessVerifier = async () => ({ status: "unauthenticated" });
const forbidden: AccessVerifier = async () => ({ status: "forbidden" });

function app(verifier: AccessVerifier = ok) {
  return createAdminApp({ verifyAccess: verifier });
}

async function request(
  verifier: AccessVerifier,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return await app(verifier).request(`${ORIGIN}${path}`, init, bindings());
}

describe("accesso al backoffice (FR-93, NFR-27)", () => {
  it("senza JWT risponde 401 con il verificatore reale", async () => {
    const response = await createAdminApp().request(`${ORIGIN}/catalogo`, {}, bindings());
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Non autenticato");
  });

  it("401 per identità non autenticata, 403 per non autorizzata", async () => {
    expect((await request(unauthenticated, "/catalogo")).status).toBe(401);
    expect((await request(forbidden, "/catalogo")).status).toBe(403);
  });

  it("200 con identità valida e email visibile", async () => {
    const response = await request(ok, "/catalogo");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("admin@example.com");
  });

  it("le scritture richiedono Origin/Referer del backoffice (NFR-27)", async () => {
    const missing = await request(ok, "/catalogo", { method: "POST" });
    expect(missing.status).toBe(403);

    const wrong = await request(ok, "/catalogo", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    expect(wrong.status).toBe(403);

    const right = await request(ok, "/catalogo", {
      method: "POST",
      headers: { Origin: ORIGIN },
    });
    expect(right.status).not.toBe(403);
  });

  it("accetta il Referer con la stessa origine", async () => {
    const response = await request(ok, "/catalogo", {
      method: "POST",
      headers: { Referer: `${ORIGIN}/catalogo` },
    });
    expect(response.status).not.toBe(403);
  });

  it("imposta no-store, CSP e nosniff su ogni risposta", async () => {
    const response = await request(ok, "/catalogo");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("GET / reindirizza a /catalogo", async () => {
    const response = await request(ok, "/");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/catalogo");
  });
});
