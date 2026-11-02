import type { LocationRow } from "../../catalog_store";
import { Layout } from "./layout";

export interface EseguiFormProps {
  email: string;
  locations: readonly LocationRow[];
}

/** Conferma di "Esegui ora" (FR-114): tutte le località o una sola. */
export function EseguiForm({ email, locations }: EseguiFormProps) {
  return (
    <Layout title="Esegui ora" email={email} active="esecuzioni">
      <h1>Esegui ora</h1>
      <p class="back">
        <a href="/esecuzioni">← Torna alle esecuzioni</a>
      </p>
      <p class="muted">
        L'esecuzione parte entro un minuto. Intervallo minimo fra due richieste: 15 minuti.
      </p>
      <form method="post" action="/esegui" class="form-card">
        <label class="radio-row">
          <input type="radio" name="scope" value="tutte" checked /> Tutte le località attive
        </label>
        <label class="radio-row">
          <input type="radio" name="scope" value="singola" /> Una sola località
        </label>
        <label>
          Località
          <select name="slug" aria-label="Località">
            {locations.map((location) => (
              <option value={location.slug}>
                {location.name} ({location.slug})
              </option>
            ))}
          </select>
        </label>
        <div class="actions">
          <button type="submit" class="button-primary">Avvia</button>
          <a class="button" href="/esecuzioni">
            Annulla
          </a>
        </div>
      </form>
    </Layout>
  );
}
