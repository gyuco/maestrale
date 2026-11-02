import { Hono } from "hono";

import { listLocations } from "../../catalog_store";
import { recordAction } from "../actions";
import type { AdminEnv } from "../env";
import { EseguiForm } from "../views/esegui_form";

export const eseguiRoutes = new Hono<AdminEnv>();

const DEFAULT_INTERVAL_SECONDS = 900;

function intervalSeconds(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= DEFAULT_INTERVAL_SECONDS
    ? parsed
    : DEFAULT_INTERVAL_SECONDS;
}

eseguiRoutes.get("/", async (c) => {
  const locations = (await listLocations(c.env.CORE)).filter((row) => row.active === 1);
  return c.html(<EseguiForm email={c.get("adminEmail")} locations={locations} />);
});

// POST /esegui — accetta o rifiuta la richiesta (FR-114, FR-115, ADR-0009).
eseguiRoutes.post("/", async (c) => {
  const body = await c.req.parseBody();
  const scope = body["scope"] === "singola" ? "singola" : "tutte";
  const slug = scope === "singola" ? String(body["slug"] ?? "") : null;

  if (scope === "singola") {
    const row =
      slug === null || slug === ""
        ? null
        : await c.env.CORE.prepare(
            "SELECT slug FROM locations WHERE slug = ? AND active = 1",
          )
            .bind(slug)
            .first<{ slug: string }>();
    if (row === null) {
      return c.html(<p>Scegli una località attiva.</p>, 400);
    }
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const cutoff = new Date(
    now.getTime() - intervalSeconds(c.env.MIN_ON_DEMAND_INTERVAL_SECONDS) * 1000,
  ).toISOString();
  const id = crypto.randomUUID();

  const [insert] = await c.env.CORE.batch([
    c.env.CORE.prepare(
      `INSERT INTO run_requests (id, requested_at, admin_email, scope, slug, status)
       SELECT ?, ?, ?, ?, ?, 'pending'
       WHERE NOT EXISTS (SELECT 1 FROM run_requests WHERE status IN ('pending', 'claimed'))
         AND NOT EXISTS (SELECT 1 FROM job_lock WHERE id = 1 AND lease_until > ?)
         AND NOT EXISTS (
           SELECT 1 FROM job_runs WHERE origin = 'su-richiesta' AND started_at > ?
         )`,
    ).bind(id, nowIso, c.get("adminEmail"), scope, slug, nowIso, cutoff),
    c.env.CORE.prepare(
      `INSERT INTO admin_actions (at, admin_email, action, slug, before_json, after_json, reason, outcome)
       SELECT ?, ?, 'run', ?, NULL, ?, NULL, 'ok' WHERE changes() = 1`,
    ).bind(nowIso, c.get("adminEmail"), slug, JSON.stringify({ scope, slug })),
  ]);

  if ((insert?.meta.changes ?? 0) === 0) {
    const pending = await c.env.CORE.prepare(
      "SELECT 1 FROM run_requests WHERE status IN ('pending', 'claimed') LIMIT 1",
    ).first();
    const locked = await c.env.CORE.prepare(
      "SELECT 1 FROM job_lock WHERE id = 1 AND lease_until > ? LIMIT 1",
    )
      .bind(nowIso)
      .first();
    const reason =
      pending !== null || locked !== null
        ? "Esecuzione in corso: riprova quando è terminata."
        : "Attendi almeno 15 minuti dall'ultima esecuzione su richiesta.";

    await recordAction(c.env.CORE, {
      adminEmail: c.get("adminEmail"),
      action: "run_rejected",
      slug,
      reason,
      outcome: "rejected",
      at: nowIso,
    });
    return c.redirect(`/esecuzioni?esito=rifiutata&motivo=${encodeURIComponent(reason)}`, 303);
  }

  return c.redirect("/esecuzioni?esito=richiesta", 303);
});
