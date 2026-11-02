import { Hono } from "hono";

import {
  getRun,
  getRunFailures,
  listRuns,
  RUN_PAGE_SIZE,
  type RunFilters,
} from "../runs_queries";
import type { AdminEnv } from "../env";
import { EsecuzioneDetail } from "../views/esecuzione_detail";
import { EsecuzioniList } from "../views/esecuzioni_list";

export const esecuzioniRoutes = new Hono<AdminEnv>();

interface PendingRow {
  id: string;
  admin_email: string;
  scope: string;
  slug: string | null;
}

// GET /esecuzioni?esito=&da=&a=&page= — elenco paginato (FR-108).
esecuzioniRoutes.get("/", async (c) => {
  const filters: RunFilters = {
    esito: c.req.query("esito") ?? "",
    da: c.req.query("da") ?? "",
    a: c.req.query("a") ?? "",
  };
  const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1);
  const { rows, total } = await listRuns(c.env.CORE, filters, page);
  const pages = Math.max(1, Math.ceil(total / RUN_PAGE_SIZE));
  const { results } = await c.env.CORE.prepare(
    "SELECT id, admin_email, scope, slug FROM run_requests WHERE status IN ('pending', 'claimed') ORDER BY requested_at",
  ).all<PendingRow>();

  return c.html(
    <EsecuzioniList
      email={c.get("adminEmail")}
      rows={rows}
      filters={filters}
      page={page}
      pages={pages}
      total={total}
      pending={results ?? []}
    />,
  );
});

// GET /esecuzioni/:id — dettaglio con le località fallite (FR-109).
esecuzioniRoutes.get("/:id", async (c) => {
  const run = await getRun(c.env.CORE, c.req.param("id"));
  if (run === null) {
    return c.html(<p>Esecuzione non trovata.</p>, 404);
  }
  const failures = await getRunFailures(c.env.CORE, run.id);
  return c.html(
    <EsecuzioneDetail email={c.get("adminEmail")} run={run} failures={failures} />,
  );
});
