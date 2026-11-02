import { Hono } from "hono";

import type { AdminEnv } from "../env";
import { RegistroList, type ActionRow } from "../views/registro_list";

export const registroRoutes = new Hono<AdminEnv>();

const PAGE_SIZE = 50;

// GET /registro?slug=&admin=&page= — registro operazioni dal più recente,
// filtrabile per slug e amministratore, sola lettura (FR-113, NFR-29).
registroRoutes.get("/", async (c) => {
  const slug = (c.req.query("slug") ?? "").trim();
  const admin = (c.req.query("admin") ?? "").trim();
  const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1);

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (slug !== "") {
    conditions.push("slug = ?");
    params.push(slug);
  }
  if (admin !== "") {
    conditions.push("admin_email = ?");
    params.push(admin);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const count = await c.env.CORE.prepare(
    `SELECT COUNT(*) AS n FROM admin_actions ${where}`,
  )
    .bind(...params)
    .first<{ n: number }>();
  const total = count?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const { results } = await c.env.CORE.prepare(
    `SELECT id, at, admin_email, action, slug, before_json, after_json, reason, outcome
     FROM admin_actions ${where} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE)
    .all<ActionRow>();

  return c.html(
    <RegistroList
      email={c.get("adminEmail")}
      rows={results ?? []}
      slug={slug}
      admin={admin}
      page={page}
      pages={pages}
      total={total}
    />,
  );
});
