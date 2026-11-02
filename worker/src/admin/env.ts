import type { Bindings } from "../env";

/** Binding del Worker `maestrale-admin` (ADR-0007): niente HISTORY né provider. */
export interface AdminBindings extends Bindings {
  /** Origine del backoffice, usata per il controllo di Origin/Referer (NFR-27). */
  ADMIN_ORIGIN: string;
  /** Team Cloudflare Access per le JWKS (es. `https://team.cloudflareaccess.com`). */
  ACCESS_TEAM_DOMAIN: string;
  /** Audience del JWT di Access. */
  ACCESS_AUD: string;
}

export interface AdminEnv {
  Bindings: AdminBindings;
  Variables: {
    /** Email dell'amministratore verificata (FR-93). */
    adminEmail: string;
  };
}
