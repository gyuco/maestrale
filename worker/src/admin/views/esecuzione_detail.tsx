import type { Child } from "hono/jsx";

import type { RunFailureRow, RunRow } from "../runs_queries";
import { formatDuration, formatInstant, outcomeLabel } from "./esecuzioni_list";
import { Layout } from "./layout";

export interface EsecuzioneDetailProps {
  email: string;
  run: RunRow;
  failures: readonly RunFailureRow[];
}

function field(label: string, value: string): Child {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

export function EsecuzioneDetail({ email, run, failures }: EsecuzioneDetailProps) {
  return (
    <Layout title="Dettaglio esecuzione" email={email} active="esecuzioni">
      <h1>Esecuzione {formatInstant(run.started_at)}</h1>
      <p>
        <a href="/esecuzioni">← Torna alle esecuzioni</a>
      </p>

      <dl>
        {field("Esito", outcomeLabel(run.outcome))}
        {field("Origine", run.origin === "su-richiesta" ? "Su richiesta" : "Pianificata")}
        {run.triggered_by ? field("Richiesta da", run.triggered_by) : null}
        {field("Ambito", run.scope === "singola" ? `Località ${run.scope_slug ?? ""}` : "Tutte le località")}
        {field("Inizio", formatInstant(run.started_at))}
        {field("Fine", run.finished_at === null ? "—" : formatInstant(run.finished_at))}
        {field("Durata", formatDuration(run.duration_ms))}
        {field("Catalogo", `${run.catalog_size} località (versione ${run.catalog_version})`)}
        {field("Aggiornate", String(run.updated_count))}
        {field("Fallite", String(run.failed_count))}
        {field("Non tentate", String(run.not_attempted_count))}
        {field("Interruttore", run.breaker === 1 ? "Attivato" : "Non attivato")}
        {field("Storico", run.history_error ?? `${run.history_rows ?? 0} record scritti`)}
        {run.reject_reason ? field("Motivo del rifiuto", run.reject_reason) : null}
      </dl>

      <h2>Località fallite</h2>
      {failures.length === 0 ? (
        <p>Nessuna località fallita.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Slug</th>
              <th>Nome</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {failures.map((failure) => (
              <tr>
                <td>
                  <code>{failure.slug}</code>
                </td>
                <td>{failure.name ?? "—"}</td>
                <td class="muted">
                  {failure.kind === "not_attempted" ? "Non tentata: " : ""}
                  {failure.message}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  );
}
