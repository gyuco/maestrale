import { createRemoteJWKSet, jwtVerify } from "jose";

import type { AdminBindings } from "./env";

export interface AccessIdentity {
  email: string;
}

export type AccessResult =
  | { status: "ok"; identity: AccessIdentity }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

export type AccessVerifier = (request: Request, env: AdminBindings) => Promise<AccessResult>;

const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/**
 * Verifica il JWT di Cloudflare Access (ADR-0007): RS256 con JWKS del team,
 * `aud`/`exp`/`iss` controllati; l'email si legge dal JWT o dall'header Access
 * **dopo** la verifica (FR-93). Senza JWT o con JWT non valido → 401; JWT valido
 * senza identità → 403.
 */
export function createAccessVerifier(): AccessVerifier {
  return async (request, env) => {
    const token = request.headers.get("Cf-Access-Jwt-Assertion");
    if (token === null || token === "") {
      return { status: "unauthenticated" };
    }
    const team = (env.ACCESS_TEAM_DOMAIN ?? "").replace(/\/+$/, "");
    const audience = env.ACCESS_AUD ?? "";
    if (team === "" || audience === "") {
      return { status: "unauthenticated" };
    }
    try {
      let jwks = jwksByTeam.get(team);
      if (jwks === undefined) {
        jwks = createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
        jwksByTeam.set(team, jwks);
      }
      const { payload } = await jwtVerify(token, jwks, { issuer: team, audience });
      const email =
        typeof payload["email"] === "string"
          ? payload["email"]
          : (request.headers.get("Cf-Access-Authenticated-User-Email") ?? "");
      if (email === "") {
        return { status: "forbidden" };
      }
      return { status: "ok", identity: { email } };
    } catch {
      return { status: "unauthenticated" };
    }
  };
}
