import type { Child } from "hono/jsx";

export interface LayoutProps {
  title: string;
  email: string;
  active: "catalogo" | "esecuzioni" | "registro";
  children: Child;
}

const sections: Array<{ key: LayoutProps["active"]; href: string; label: string }> = [
  { key: "catalogo", href: "/catalogo", label: "Catalogo" },
  { key: "esecuzioni", href: "/esecuzioni", label: "Esecuzioni" },
  { key: "registro", href: "/registro", label: "Registro operazioni" },
];

/** Layout comune delle pagine del backoffice (italiano, NFR-10). */
export function Layout({ title, email, active, children }: LayoutProps) {
  const initial = email.trim().charAt(0).toUpperCase() || "?";
  return (
    <html lang="it">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${title} — Maestrale`}</title>
        <link rel="stylesheet" href="/assets/admin.css" />
      </head>
      <body>
        <header class="topbar">
          <a class="brand" href="/catalogo" aria-label="Maestrale Amministrazione — Catalogo">
            <span class="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 32 32" width="22" height="22" fill="none">
                <path
                  d="M2 19c3.5 0 3.5-3 7-3s3.5 3 7 3 3.5-3 7-3 3.5 3 7 3"
                  stroke="currentColor"
                  stroke-width="2.6"
                  stroke-linecap="round"
                />
                <path
                  d="M2 26c3.5 0 3.5-3 7-3s3.5 3 7 3 3.5-3 7-3 3.5 3 7 3"
                  stroke="currentColor"
                  stroke-width="2.6"
                  stroke-linecap="round"
                  opacity=".55"
                />
              </svg>
            </span>
            <span class="brand-text">
              <span class="brand-title">Maestrale · Amministrazione</span>
              <span class="brand-sub">Backoffice</span>
            </span>
          </a>
          <nav class="mainnav" aria-label="Sezioni">
            {sections.map((section) => (
              <a
                href={section.href}
                aria-current={section.key === active ? "page" : undefined}
              >
                {section.label}
              </a>
            ))}
          </nav>
          <div class="user" title={email}>
            <span class="avatar" aria-hidden="true">{initial}</span>
            <span class="email">{email}</span>
          </div>
        </header>
        <main class="page">{children}</main>
        <footer class="footer">Maestrale · dati Open-Meteo · orari Europe/Rome</footer>
      </body>
    </html>
  );
}
