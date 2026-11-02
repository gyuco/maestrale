import { Layout } from "./layout";

export interface CatalogoConfirmProps {
  email: string;
  mode: "deactivate" | "reactivate";
  slug: string;
  name: string;
  error?: string;
}

/** Conferma esplicita con slug e nome (FR-100, FR-119). */
export function CatalogoConfirm({ email, mode, slug, name, error }: CatalogoConfirmProps) {
  const deactivate = mode === "deactivate";
  return (
    <Layout
      title={deactivate ? "Disattiva località" : "Riattiva località"}
      email={email}
      active="catalogo"
    >
      <h1>{deactivate ? "Disattiva località" : "Riattiva località"}</h1>
      <p class="back">
        <a href="/catalogo">← Torna al catalogo</a>
      </p>
      {error ? (
        <p class="flash flash-error" role="alert">
          {error}
        </p>
      ) : null}
      <p>
        {deactivate
          ? "La località sparirà da /locations e /forecast risponderà 404. La voce e lo storico restano nel database."
          : "La località tornerà in /locations. /forecast risponderà 503 finché il job non l'avrà aggiornata."}
      </p>
      <dl class="details">
        <dt>Slug</dt>
        <dd>
          <code>{slug}</code>
        </dd>
        <dt>Nome</dt>
        <dd>{name}</dd>
      </dl>
      <form method="post" action={`/catalogo/${slug}/${deactivate ? "disattiva" : "riattiva"}`}>
        <div class="actions">
          <button type="submit" class={deactivate ? "button-danger" : "button-primary"}>
            {deactivate ? "Disattiva" : "Riattiva"}
          </button>
          <a class="button" href="/catalogo">
            Annulla
          </a>
        </div>
      </form>
    </Layout>
  );
}
