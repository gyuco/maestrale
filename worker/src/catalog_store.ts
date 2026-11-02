/**
 * Accesso al catalogo in D1 `CORE` (ADR-0006): lettura per il backoffice e
 * (nelle storie successive) scrittura con controllo di versione.
 */

export interface LocationRow {
  slug: string;
  name: string;
  latitude: number;
  longitude: number;
  /** 0 = disattivata, 1 = attiva (SQLite non ha boolean). */
  active: number;
  version: number;
}

export type StatoFiltro = "attive" | "disattivate" | "tutte";

export function parseStato(value: string | undefined): StatoFiltro {
  return value === "disattivate" || value === "tutte" ? value : "attive";
}

/** Tutte le località, attive e disattivate, ordinate per nome (FR-96). */
export async function listLocations(db: D1Database): Promise<LocationRow[]> {
  const { results } = await db
    .prepare(
      "SELECT slug, name, latitude, longitude, active, version FROM locations ORDER BY name, slug",
    )
    .all<LocationRow>();
  return results ?? [];
}

/** Filtro testo (nome o slug) e stato; i conteggi restano quelli del catalogo. */
export function filterLocations(
  rows: readonly LocationRow[],
  query: string,
  stato: StatoFiltro,
): LocationRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (stato === "attive" && row.active !== 1) return false;
    if (stato === "disattivate" && row.active !== 0) return false;
    if (needle === "") return true;
    return row.name.toLowerCase().includes(needle) || row.slug.toLowerCase().includes(needle);
  });
}

export function countActive(rows: readonly LocationRow[]): number {
  return rows.filter((row) => row.active === 1).length;
}

/** Una località per slug (anche disattivata), o `null`. */
export async function findLocation(db: D1Database, slug: string): Promise<LocationRow | null> {
  return await db
    .prepare(
      "SELECT slug, name, latitude, longitude, active, version FROM locations WHERE slug = ?",
    )
    .bind(slug)
    .first<LocationRow>();
}
