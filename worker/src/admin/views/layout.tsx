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
  return (
    <html lang="it">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${title} — Maestrale`}</title>
    <style>{`
      :root { color-scheme: light; }
      body { margin: 0; font-family: system-ui, sans-serif; background: #f6f7f9; color: #1b1f24; }
      header { background: #0b3d5c; color: #fff; padding: 12px 24px; display: flex; gap: 24px; align-items: center; }
      header strong { font-size: 18px; }
      header nav a { color: #cfe6f5; text-decoration: none; margin-right: 16px; }
      header nav a[aria-current="page"] { color: #fff; font-weight: 600; }
      header .email { margin-left: auto; font-size: 13px; opacity: .85; }
      main { max-width: 1080px; margin: 24px auto; padding: 0 24px; }
      table { border-collapse: collapse; width: 100%; background: #fff; }
      th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e3e6ea; font-size: 14px; }
      th { background: #eceff3; }
      form.inline { display: inline; }
      button { cursor: pointer; padding: 6px 10px; border: 1px solid #b8c0c8; border-radius: 6px; background: #fff; }
      .muted { color: #5b6672; font-size: 13px; }
    `}</style>
      </head>
      <body>
        <header>
          <strong>Maestrale · Amministrazione</strong>
          <nav>
            {sections.map((section) => (
              <a
                href={section.href}
                aria-current={section.key === active ? "page" : undefined}
              >
                {section.label}
              </a>
            ))}
          </nav>
          <span class="email">{email}</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
