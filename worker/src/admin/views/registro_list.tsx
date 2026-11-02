import { Layout } from "./layout";

export interface ActionRow {
  id: number;
  at: string;
  admin_email: string;
  action: string;
  slug: string | null;
  before_json: string | null;
  after_json: string | null;
  reason: string | null;
  outcome: string | null;
}

export interface RegistroListProps {
  email: string;
  rows: readonly ActionRow[];
  slug: string;
  admin: string;
  page: number;
  pages: number;
  total: number;
}

const labels: Record<string, string> = {
  add: "Aggiunta",
  update: "Modifica",
  deactivate: "Disattivazione",
  reactivate: "Riattivazione",
  run: "Esegui ora",
  run_rejected: "Esegui ora rifiutato",
};

function formatInstant(value: string): string {
  try {
    return new Intl.DateTimeFormat("it-IT", {
      timeZone: "Europe/Rome",
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function describe(row: ActionRow): string {
  if (row.outcome === "rejected") return row.reason ?? "Rifiutata";
  if (row.before_json === null && row.after_json === null) return "—";
  return `${row.before_json ?? "—"} → ${row.after_json ?? "—"}`;
}

/** Registro operazioni, sola lettura (FR-113). */
export function RegistroList({ email, rows, slug, admin, page, pages, total }: RegistroListProps) {
  const query = (nextPage: number) => {
    const params = new URLSearchParams();
    if (slug !== "") params.set("slug", slug);
    if (admin !== "") params.set("admin", admin);
    params.set("page", String(nextPage));
    return `/registro?${params.toString()}`;
  };

  return (
    <Layout title="Registro operazioni" email={email} active="registro">
      <h1>Registro operazioni</h1>
      <p class="muted">{total} voci</p>

      <form method="get" action="/registro" class="toolbar">
        <input name="slug" value={slug} placeholder="Slug" aria-label="Filtra per slug" />
        <input name="admin" value={admin} placeholder="Email amministratore" aria-label="Filtra per amministratore" />
        <button type="submit">Filtra</button>
      </form>

      {rows.length === 0 ? (
        <p class="empty">Nessuna operazione registrata.</p>
      ) : (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Istante</th>
                <th>Amministratore</th>
                <th>Operazione</th>
                <th>Slug</th>
                <th>Esito</th>
                <th>Dettaglio</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr>
                  <td>{formatInstant(row.at)}</td>
                  <td>{row.admin_email}</td>
                  <td>{labels[row.action] ?? row.action}</td>
                  <td>{row.slug ?? "—"}</td>
                  <td>
                    <span class={row.outcome === "rejected" ? "badge badge-err" : "badge badge-ok"}>
                      {row.outcome === "rejected" ? "Rifiutata" : "Ok"}
                    </span>
                  </td>
                  <td class="muted">{describe(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 ? (
        <div class="pager">
          {page > 1 ? <a href={query(page - 1)}>← Precedente</a> : null}
          <span class="pager-info">Pagina {page} di {pages}</span>
          {page < pages ? <a href={query(page + 1)}>Successiva →</a> : null}
        </div>
      ) : null}
    </Layout>
  );
}
