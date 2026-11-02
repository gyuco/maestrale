import { Hono } from "hono";

import {
  countActive,
  filterLocations,
  findLocation,
  listLocations,
  parseStato,
} from "../../catalog_store";
import { validateCatalogInput, type ExistingLocation } from "../../catalog_validation";
import { actionStatement, recordAction, refreshAfterWrite } from "../actions";
import type { AdminEnv } from "../env";
import { CatalogoConfirm } from "../views/catalogo_confirm";
import { CatalogoForm, type CatalogoFormValues } from "../views/catalogo_form";
import { CatalogoList } from "../views/catalogo_list";

export const catalogoRoutes = new Hono<AdminEnv>();

// GET /catalogo?q=&stato= — elenco completo, ordinato per nome, con conteggi
// (FR-96). Nessuna paginazione fino a 500 località (OQ-46).
catalogoRoutes.get("/", async (c) => {
  const query = (c.req.query("q") ?? "").trim();
  const stato = parseStato(c.req.query("stato"));
  const rows = await listLocations(c.env.CORE);
  const visible = filterLocations(rows, query, stato);
  const upload = c.req.query("esito") ?? "";
  const flash = ["aggiunta", "modifica", "disattivata", "riattivata"].includes(upload)
    ? {
        aggiunta: "Località aggiunta.",
        modifica: "Località aggiornata.",
        disattivata: "Località disattivata.",
        riattivata: "Località riattivata.",
      }[upload]
    : undefined;
  const warning =
    c.req.query("avviso") === "1"
      ? "Attenzione: con questa aggiunta le località attive superano 500."
      : undefined;
  return c.html(
    <CatalogoList
      email={c.get("adminEmail")}
      rows={visible}
      total={rows.length}
      active={countActive(rows)}
      query={query}
      stato={stato}
      flash={flash}
      warning={warning}
    />,
  );
});

function text(value: string | File | undefined): string {
  return typeof value === "string" ? value : "";
}

function decimal(value: string | File | undefined): number {
  if (typeof value !== "string" || value.trim() === "") return Number.NaN;
  return Number(value.replace(",", "."));
}

catalogoRoutes.get("/nuovo", (c) =>
  c.html(
    <CatalogoForm
      email={c.get("adminEmail")}
      mode="new"
      values={{ slug: "", name: "", latitude: "", longitude: "" }}
    />,
  ),
);

// POST /catalogo/nuovo — aggiunta (FR-97, FR-98), con voce nel registro (FR-113).
catalogoRoutes.post("/nuovo", async (c) => {
  const body = await c.req.parseBody();
  const values: CatalogoFormValues = {
    slug: text(body["slug"]),
    name: text(body["name"]),
    latitude: text(body["latitude"]),
    longitude: text(body["longitude"]),
  };
  const rows = await listLocations(c.env.CORE);
  const others: ExistingLocation[] = rows.map(({ active, ...rest }) => ({
    ...rest,
    active: active === 1,
  }));
  const result = validateCatalogInput(
    {
      slug: values.slug,
      name: values.name,
      latitude: decimal(body["latitude"]),
      longitude: decimal(body["longitude"]),
    },
    others,
    { isNew: true },
  );

  if (!result.ok) {
    return c.html(
      <CatalogoForm email={c.get("adminEmail")} mode="new" values={values} errors={result.errors} />,
      400,
    );
  }

  const at = new Date().toISOString();
  const { slug, name, latitude, longitude } = result.normalized;
  try {
    await c.env.CORE.batch([
      c.env.CORE.prepare(
        `INSERT INTO locations (slug, name, latitude, longitude, active, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 1, ?, ?)`,
      ).bind(slug, name, latitude, longitude, at, at),
      c.env.CORE.prepare(
        "UPDATE catalog_meta SET version = version + 1, updated_at = ? WHERE id = 1",
      ).bind(at),
      actionStatement(c.env.CORE, {
        adminEmail: c.get("adminEmail"),
        action: "add",
        slug,
        after: result.normalized,
        at,
      }),
    ]);
  } catch {
    return c.html(
      <CatalogoForm
        email={c.get("adminEmail")}
        mode="new"
        values={values}
        errors={{ slug: "Slug già usato da un'altra località." }}
      />,
      400,
    );
  }

  await refreshAfterWrite(c.env);
  const suffix = result.warning === undefined ? "" : "&avviso=1";
  return c.redirect(`/catalogo?esito=aggiunta${suffix}`, 303);
});

function toExisting(rows: Awaited<ReturnType<typeof listLocations>>): ExistingLocation[] {
  return rows.map(({ active, ...rest }) => ({ ...rest, active: active === 1 }));
}

catalogoRoutes.get("/:slug", async (c) => {
  const row = await findLocation(c.env.CORE, c.req.param("slug"));
  if (row === null) {
    return c.html(<p>Località non trovata.</p>, 404);
  }
  return c.html(
    <CatalogoForm
      email={c.get("adminEmail")}
      mode="edit"
      values={{
        slug: row.slug,
        name: row.name,
        latitude: String(row.latitude),
        longitude: String(row.longitude),
        version: String(row.version),
      }}
    />,
  );
});

// POST /catalogo/:slug — modifica di nome e coordinate con controllo di versione
// (FR-99, FR-103). Lo slug non è modificabile.
catalogoRoutes.post("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const row = await findLocation(c.env.CORE, slug);
  if (row === null) {
    return c.html(<p>Località non trovata.</p>, 404);
  }

  const body = await c.req.parseBody();
  const values: CatalogoFormValues = {
    slug: row.slug,
    name: text(body["name"]),
    latitude: text(body["latitude"]),
    longitude: text(body["longitude"]),
    version: text(body["version"]) || String(row.version),
  };
  const rows = await listLocations(c.env.CORE);
  const others = toExisting(rows.filter((item) => item.slug !== slug));
  const result = validateCatalogInput(
    {
      slug: row.slug,
      name: values.name,
      latitude: decimal(body["latitude"]),
      longitude: decimal(body["longitude"]),
    },
    others,
  );

  if (!result.ok) {
    return c.html(
      <CatalogoForm email={c.get("adminEmail")} mode="edit" values={values} errors={result.errors} />,
      400,
    );
  }

  const expectedVersion = Number(text(body["version"]));
  if (!Number.isInteger(expectedVersion)) {
    return c.html(<p>Versione della località mancante: ricarica la pagina.</p>, 400);
  }

  const at = new Date().toISOString();
  const { name, latitude, longitude } = result.normalized;
  const before = { name: row.name, latitude: row.latitude, longitude: row.longitude };

  const [update] = await c.env.CORE.batch([
    c.env.CORE.prepare(
      `UPDATE locations
       SET name = ?, latitude = ?, longitude = ?, version = version + 1, updated_at = ?
       WHERE slug = ? AND version = ?`,
    ).bind(name, latitude, longitude, at, slug, expectedVersion),
    c.env.CORE.prepare(
      "UPDATE catalog_meta SET version = version + 1, updated_at = ? WHERE id = 1 AND changes() = 1",
    ).bind(at),
    c.env.CORE.prepare(
      `INSERT INTO admin_actions (at, admin_email, action, slug, before_json, after_json, reason, outcome)
       SELECT ?, ?, 'update', ?, ?, ?, NULL, 'ok' WHERE changes() = 1`,
    ).bind(
      at,
      c.get("adminEmail"),
      slug,
      JSON.stringify(before),
      JSON.stringify({ name, latitude, longitude }),
    ),
  ]);

  if ((update?.meta.changes ?? 0) === 0) {
    await recordAction(c.env.CORE, {
      adminEmail: c.get("adminEmail"),
      action: "update",
      slug,
      before,
      after: { name, latitude, longitude },
      reason: "La località è stata modificata nel frattempo: ricarica la voce.",
      outcome: "rejected",
      at,
    });
    return c.html(
      <p>La località è stata modificata nel frattempo: ricarica la voce.</p>,
      409,
    );
  }

  await refreshAfterWrite(c.env);
  return c.redirect("/catalogo?esito=modifica", 303);
});

type StatusMode = "disattiva" | "riattiva";

function statusRoute(mode: StatusMode) {
  const target = mode === "disattiva" ? 0 : 1;
  const expected = mode === "disattiva" ? 1 : 0;
  const esito = mode === "disattiva" ? "disattivata" : "riattivata";
  const action = mode === "disattiva" ? "deactivate" : "reactivate";
  const confirmMode = mode === "disattiva" ? ("deactivate" as const) : ("reactivate" as const);

  const path = `/:slug/${mode}` as const;

  catalogoRoutes.get(path, async (c) => {
    const row = await findLocation(c.env.CORE, c.req.param("slug"));
    if (row === null) {
      return c.html(<p>Località non trovata.</p>, 404);
    }
    if (row.active !== expected) {
      return c.html(<p>La località è già nello stato richiesto.</p>, 409);
    }
    return c.html(
      <CatalogoConfirm
        email={c.get("adminEmail")}
        mode={confirmMode}
        slug={row.slug}
        name={row.name}
      />,
    );
  });

  catalogoRoutes.post(path, async (c) => {
    const slug = c.req.param("slug");
    const row = await findLocation(c.env.CORE, slug);
    if (row === null) {
      return c.html(<p>Località non trovata.</p>, 404);
    }
    if (row.active !== expected) {
      return c.html(<p>La località è già nello stato richiesto.</p>, 409);
    }

    if (mode === "riattiva") {
      const rows = await listLocations(c.env.CORE);
      const result = validateCatalogInput(
        {
          slug: row.slug,
          name: row.name,
          latitude: row.latitude,
          longitude: row.longitude,
        },
        toExisting(rows.filter((item) => item.slug !== slug)),
      );
      if (!result.ok) {
        return c.html(
          <CatalogoConfirm
            email={c.get("adminEmail")}
            mode={confirmMode}
            slug={row.slug}
            name={row.name}
            error={Object.values(result.errors)[0] ?? "Valori non validi."}
          />,
          400,
        );
      }
    }

    const at = new Date().toISOString();
    const [update] = await c.env.CORE.batch([
      c.env.CORE.prepare(
        "UPDATE locations SET active = ?, version = version + 1, updated_at = ? WHERE slug = ? AND version = ? AND active = ?",
      ).bind(target, at, slug, row.version, expected),
      c.env.CORE.prepare(
        "UPDATE catalog_meta SET version = version + 1, updated_at = ? WHERE id = 1 AND changes() = 1",
      ).bind(at),
      c.env.CORE.prepare(
        `INSERT INTO admin_actions (at, admin_email, action, slug, before_json, after_json, reason, outcome)
         SELECT ?, ?, ?, ?, ?, ?, NULL, 'ok' WHERE changes() = 1`,
      ).bind(
        at,
        c.get("adminEmail"),
        action,
        slug,
        JSON.stringify({ active: expected === 1 }),
        JSON.stringify({ active: target === 1 }),
      ),
    ]);

    if ((update?.meta.changes ?? 0) === 0) {
      return c.html(<p>La località è stata modificata nel frattempo: ricarica la voce.</p>, 409);
    }

    if (mode === "riattiva") {
      // FR-119: nessuna previsione vecchia finché il job non aggiorna.
      await c.env.FORECASTS.delete(`forecast:${slug}`);
    }
    await refreshAfterWrite(c.env);
    return c.redirect(`/catalogo?esito=${esito}`, 303);
  });
}

statusRoute("disattiva");
statusRoute("riattiva");
