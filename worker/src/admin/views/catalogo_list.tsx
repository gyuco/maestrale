import type { LocationRow, StatoFiltro } from "../../catalog_store";
import { Layout } from "./layout";

export interface CatalogoListProps {
  email: string;
  rows: readonly LocationRow[];
  total: number;
  active: number;
  query: string;
  stato: StatoFiltro;
  flash?: string;
  warning?: string;
}

const stati: Array<{ value: StatoFiltro; label: string }> = [
  { value: "attive", label: "Attive" },
  { value: "disattivate", label: "Disattivate" },
  { value: "tutte", label: "Tutte" },
];

/** Elenco del catalogo con filtri e conteggi (FR-96). */
export function CatalogoList({
  email,
  rows,
  total,
  active,
  query,
  stato,
  flash,
  warning,
}: CatalogoListProps) {
  return (
    <Layout title="Catalogo" email={email} active="catalogo">
      <h1>Catalogo località</h1>
      <p class="muted">
        {total} località totali · {active} attive
      </p>
      {flash ? <p class="flash">{flash}</p> : null}
      {warning ? <p class="flash">{warning}</p> : null}
      <p>
        <a href="/catalogo/nuovo">Aggiungi località</a>
      </p>

      <form method="get" action="/catalogo" style="margin: 16px 0; display: flex; gap: 8px;">
        <input
          type="search"
          name="q"
          value={query}
          placeholder="Cerca per nome o slug"
          aria-label="Cerca per nome o slug"
        />
        <select name="stato" aria-label="Filtra per stato">
          {stati.map((option) => (
            <option value={option.value} selected={option.value === stato}>
              {option.label}
            </option>
          ))}
        </select>
        <button type="submit">Filtra</button>
      </form>

      {rows.length === 0 ? (
        <p>Nessuna località corrisponde ai filtri.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Slug</th>
              <th>Latitudine</th>
              <th>Longitudine</th>
              <th>Stato</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr>
                <td>{row.name}</td>
                <td>
                  <code>{row.slug}</code>
                </td>
                <td>{row.latitude}</td>
                <td>{row.longitude}</td>
                <td>{row.active === 1 ? "Attiva" : "Disattivata"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  );
}
