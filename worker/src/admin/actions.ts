/**
 * Scritture del backoffice: voce nel registro operazioni (FR-113) e
 * aggiornamento della cache del catalogo (FR-101).
 */

import { refreshCatalogCache } from "../catalog";
import type { AdminBindings } from "./env";

export type AdminAction =
  | "add"
  | "update"
  | "deactivate"
  | "reactivate"
  | "run"
  | "run_rejected";

export interface ActionEntry {
  adminEmail: string;
  action: AdminAction;
  slug?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  outcome?: "ok" | "rejected";
  at?: string;
}

export interface ActionStatement {
  bind: (...values: unknown[]) => unknown;
}

/** Istruzione di inserimento nel registro, da mettere nella stessa `batch()`. */
export function actionStatement(
  db: D1Database,
  entry: ActionEntry,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO admin_actions (at, admin_email, action, slug, before_json, after_json, reason, outcome)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      entry.at ?? new Date().toISOString(),
      entry.adminEmail,
      entry.action,
      entry.slug ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.reason ?? null,
      entry.outcome ?? "ok",
    ) as D1PreparedStatement;
}

/** Voce isolata (rifiuti, operazioni senza modifica del catalogo). */
export async function recordAction(db: D1Database, entry: ActionEntry): Promise<void> {
  await actionStatement(db, entry).run();
}

/** Ricostruisce la cache del catalogo dopo una scrittura (FR-101). */
export async function refreshAfterWrite(env: AdminBindings): Promise<void> {
  await refreshCatalogCache(env);
}
