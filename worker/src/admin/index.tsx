import { Hono } from "hono";

import { createAccessVerifier, type AccessVerifier } from "./access";
import type { AdminBindings, AdminEnv } from "./env";
import { catalogoRoutes } from "./routes/catalogo";
import { eseguiRoutes } from "./routes/esegui";
import { esecuzioniRoutes } from "./routes/esecuzioni";
import { registroRoutes } from "./routes/registro";
import { ADMIN_CSS } from "./styles";

export interface AdminDeps {
  /** Iniettabile nei test (NFR-13); in produzione usa il verificatore JWT di Access. */
  verifyAccess: AccessVerifier;
}

/** Origine di `Origin` o `Referer` (null se assente o non valido). */
function requestOrigin(c: { req: { header: (name: string) => string | undefined } }): string | null {
  const origin = c.req.header("Origin");
  if (origin !== undefined && origin !== "") {
    return origin;
  }
  const referer = c.req.header("Referer");
  if (referer === undefined || referer === "") {
    return null;
  }
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function createAdminApp(deps: Partial<AdminDeps> = {}): Hono<AdminEnv> {
  const app = new Hono<AdminEnv>();
  const verifyAccess = deps.verifyAccess ?? createAccessVerifier();

  // Identità prima di tutto: nessuna pagina o funzione è raggiungibile senza
  // un JWT valido (FR-93).
  app.use("*", async (c, next) => {
    const result = await verifyAccess(c.req.raw, c.env);
    if (result.status === "unauthenticated") {
      return c.text("Non autenticato", 401);
    }
    if (result.status === "forbidden") {
      return c.text("Non autorizzato", 403);
    }
    c.set("adminEmail", result.identity.email);
    await next();
  });

  // Scritture solo dall'origine del backoffice (NFR-27, decisione 2026-11-02).
  app.use("*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      if (requestOrigin(c) !== c.env.ADMIN_ORIGIN) {
        return c.text("Origine non consentita", 403);
      }
    }
    await next();
  });

  // Nessuna cache, nessun framing (FR-118, NFR-28).
  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
    c.header("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'");
    c.header("X-Content-Type-Options", "nosniff");
  });

  // CSS della stessa origine: la CSP `default-src 'self'` blocca lo stile inline.
  app.get("/assets/admin.css", (c) =>
    c.body(ADMIN_CSS, 200, { "Content-Type": "text/css; charset=utf-8" }),
  );

  app.get("/", (c) => c.redirect("/catalogo", 302));

  app.route("/catalogo", catalogoRoutes);

  app.route("/esecuzioni", esecuzioniRoutes);
  app.route("/esegui", eseguiRoutes);

  app.route("/registro", registroRoutes);

  return app;
}

export default {
  fetch: createAdminApp().fetch,
} satisfies ExportedHandler<AdminBindings>;
