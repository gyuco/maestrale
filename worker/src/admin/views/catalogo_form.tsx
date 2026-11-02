import type { ValidationErrors } from "../../catalog_validation";
import { Layout } from "./layout";

export interface CatalogoFormValues {
  slug: string;
  name: string;
  latitude: string;
  longitude: string;
  version?: string;
}

export interface CatalogoFormProps {
  email: string;
  mode: "new" | "edit";
  values: CatalogoFormValues;
  errors?: ValidationErrors;
  warning?: string;
}

/** Form di aggiunta/modifica (FR-97, FR-99): errori per campo, slug in sola lettura in modifica. */
export function CatalogoForm({ email, mode, values, errors = {}, warning }: CatalogoFormProps) {
  const isNew = mode === "new";
  return (
    <Layout
      title={isNew ? "Nuova località" : "Modifica località"}
      email={email}
      active="catalogo"
    >
      <h1>{isNew ? "Nuova località" : `Modifica ${values.name}`}</h1>
      <p class="back">
        <a href="/catalogo">← Torna al catalogo</a>
      </p>
      {warning ? (
        <p class="flash flash-warn" role="alert">
          {warning}
        </p>
      ) : null}
      <form
        method="post"
        action={isNew ? "/catalogo/nuovo" : `/catalogo/${values.slug}`}
        class="form-card"
      >
        <label>
          Slug
          <input
            name="slug"
            value={values.slug}
            readonly={!isNew}
            required
            aria-describedby="errore-slug"
          />
          {errors.slug ? <span class="error" id="errore-slug">{errors.slug}</span> : null}
        </label>
        <label>
          Nome
          <input name="name" value={values.name} required aria-describedby="errore-nome" />
          {errors.name ? <span class="error" id="errore-nome">{errors.name}</span> : null}
        </label>
        <label>
          Latitudine
          <input
            name="latitude"
            value={values.latitude}
            inputmode="decimal"
            required
            aria-describedby="errore-latitudine"
          />
          {errors.latitude ? (
            <span class="error" id="errore-latitudine">{errors.latitude}</span>
          ) : null}
        </label>
        <label>
          Longitudine
          <input
            name="longitude"
            value={values.longitude}
            inputmode="decimal"
            required
            aria-describedby="errore-longitudine"
          />
          {errors.longitude ? (
            <span class="error" id="errore-longitudine">{errors.longitude}</span>
          ) : null}
        </label>
        {values.version ? <input type="hidden" name="version" value={values.version} /> : null}
        <div class="actions">
          <button type="submit" class="button-primary">
            {isNew ? "Aggiungi località" : "Salva modifiche"}
          </button>
        </div>
      </form>
    </Layout>
  );
}
