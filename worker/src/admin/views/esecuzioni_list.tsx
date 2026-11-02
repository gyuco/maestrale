import type { RunFilters, RunRow } from "../runs_queries";
import { Layout } from "./layout";

export interface EsecuzioniListProps {
  email: string;
  rows: readonly RunRow[];
  filters: RunFilters;
  page: number;
  pages: number;
  total: number;
  pending: readonly { id: string; admin_email: string; scope: string; slug: string | null }[];
}

export const esiti = ["riuscita", "parziale", "fallita", "rifiutata", "non_completata"];

export function formatInstant(value: string): string {
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

export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${seconds % 60} s`;
}

export function outcomeLabel(outcome: string | null): string {
  switch (outcome) {
    case "riuscita":
      return "Riuscita";
    case "parziale":
      return "Parziale";
    case "fallita":
      return "Fallita";
    case "rifiutata":
      return "Rifiutata";
    case "non_completata":
      return "Non completata";
    default:
      return "In corso";
  }
}

export function outcomeBadgeClass(outcome: string | null): string {
  switch (outcome) {
    case "riuscita":
      return "badge badge-ok";
    case "parziale":
    case "non_completata":
      return "badge badge-warn";
    case "fallita":
      return "badge badge-err";
    case "rifiutata":
      return "badge badge-off";
    default:
      return "badge badge-info";
  }
}

export function EsecuzioniList({
  email,
  rows,
  filters,
  page,
  pages,
  total,
  pending,
}: EsecuzioniListProps) {
  const query = (nextPage: number) => {
    const params = new URLSearchParams();
    if (filters.esito !== "") params.set("esito", filters.esito);
    if (filters.da !== "") params.set("da", filters.da);
    if (filters.a !== "") params.set("a", filters.a);
    params.set("page", String(nextPage));
    return `/esecuzioni?${params.toString()}`;
  };

  return (
    <Layout title="Esecuzioni" email={email} active="esecuzioni">
      <h1>Esecuzioni del job</h1>
      <p class="muted">{total} esecuzioni conservate</p>

      {pending.length > 0 ? (
        <div class="flash flash-info" role="status">
          <strong>In attesa di avvio:</strong>{" "}
          {pending.map((request) => (
            <span>
              {request.scope === "singola" ? request.slug : "tutte le località"} ({request.admin_email}){" "}
            </span>
          ))}
        </div>
      ) : null}

      <div class="actions">
        <a class="button button-primary" href="/esegui">
          Esegui ora
        </a>
      </div>

      <form method="get" action="/esecuzioni" class="toolbar">
        <select name="esito" aria-label="Filtra per esito">
          <option value="">Tutti gli esiti</option>
          {esiti.map((esito) => (
            <option value={esito} selected={esito === filters.esito}>
              {outcomeLabel(esito)}
            </option>
          ))}
        </select>
        <input type="date" name="da" value={filters.da} aria-label="Dal" />
        <input type="date" name="a" value={filters.a} aria-label="Al" />
        <button type="submit">Filtra</button>
      </form>

      {rows.length === 0 ? (
        <p class="empty">Nessuna esecuzione corrisponde ai filtri.</p>
      ) : (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Inizio</th>
                <th>Durata</th>
                <th>Origine</th>
                <th>Esito</th>
                <th>Aggiornate</th>
                <th>Fallite</th>
                <th>Interruttore</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr>
                  <td>
                    <a href={`/esecuzioni/${row.id}`}>{formatInstant(row.started_at)}</a>
                  </td>
                  <td>{formatDuration(row.duration_ms)}</td>
                  <td>{row.origin === "su-richiesta" ? "Su richiesta" : "Pianificata"}</td>
                  <td>
                    <span class={outcomeBadgeClass(row.outcome)}>{outcomeLabel(row.outcome)}</span>
                  </td>
                  <td>{row.updated_count}</td>
                  <td>{row.failed_count}</td>
                  <td>{row.breaker === 1 ? "Sì" : "No"}</td>
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
