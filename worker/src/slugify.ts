/**
 * Port fedele di `backend/main.py:slugify` (usata da FR-22 per far coincidere
 * slug e nomi normalizzati):
 *
 * ```python
 * normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
 * return "-".join(normalized.lower().strip().split()).replace("_", "-")
 * ```
 *
 * Differenze da tenere presenti, tutte ereditate dal Python:
 *
 * - `encode("ascii", "ignore")` elimina **tutto** ciò che non è ASCII, anche se
 *   non è un diacritico (`Ł`, `Ø`, `Œ`, alfabeti non latini, emoji…): non è una
 *   semplice rimozione di accenti.
 * - L'apostrofo è ASCII e resta: `"Sant'Antioco"` → `"sant'antioco"` (uno slug
 *   che poi non rispetta il pattern dello schema, come in Python).
 * - Spazi consecutivi e spazi ai bordi collassano in un solo trattino, e
 *   `_` diventa `-` (compresi underscore consecutivi).
 * - Una stringa vuota (o di soli spazi) produce `""`.
 */

// Whitespace di `str.split()`/`str.strip()` di Python su testo ASCII: spazio,
// tab, newline, vertical tab, form feed, carriage return e i separatori
// \x1c-\x1f. (Gli spazi non-ASCII sono già stati eliminati dal filtro ASCII.)
const PYTHON_ASCII_WHITESPACE = /[ \t\n\v\f\r\x1c-\x1f]+/;

/** Normalizza un nome di località nello slug equivalente del backend Python. */
export function slugify(value: string): string {
  const ascii = value.normalize("NFKD").replace(/[^\x00-\x7F]/g, "");

  // `split` + filtro degli elementi vuoti replicano `strip().split()` di Python,
  // che spezza sulle sequenze di whitespace e ignora quelle ai bordi.
  const tokens = ascii.toLowerCase().split(PYTHON_ASCII_WHITESPACE).filter((token) => token !== "");

  return tokens.join("-").replace(/_/g, "-");
}
