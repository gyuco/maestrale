/**
 * Foglio di stile del backoffice, servito da `/assets/admin.css`.
 *
 * Non può stare inline nel layout: la CSP (`default-src 'self'`) blocca
 * `<style>` e gli attributi `style`, quindi il CSS arriva come file della
 * stessa origine.
 */
export const ADMIN_CSS = `
:root {
  color-scheme: light;
  --navy: #0b2c3f;
  --navy-2: #11465f;
  --accent: #2f9ea6;
  --accent-strong: #1f7f88;
  --bg: #f2f5f8;
  --card: #ffffff;
  --text: #16242f;
  --muted: #5f7180;
  --border: #dbe3ea;
  --border-strong: #c3ced8;
  --ok: #1f7a4d;
  --ok-bg: #e3f5ec;
  --warn: #8a5d06;
  --warn-bg: #fdf1d4;
  --err: #a32a2a;
  --err-bg: #fbe5e5;
  --info: #1f5f8b;
  --info-bg: #e3eff8;
  --radius: 14px;
  --shadow: 0 1px 2px rgba(16, 38, 52, .06), 0 8px 24px rgba(16, 38, 52, .06);
}

*, *::before, *::after { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 15px;
  line-height: 1.55;
  color: var(--text);
  background: var(--bg);
}

a { color: var(--accent-strong); text-decoration: none; }
a:hover { text-decoration: underline; }

/* ---------- Header ---------- */
.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 12px clamp(16px, 4vw, 40px);
  color: #fff;
  background: linear-gradient(115deg, var(--navy) 0%, var(--navy-2) 62%, #146b73 100%);
  box-shadow: 0 2px 12px rgba(6, 24, 36, .25);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: inherit;
  text-decoration: none;
  flex: none;
}
.brand:hover { text-decoration: none; }

.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  color: #d9f6f7;
  background: linear-gradient(140deg, rgba(255, 255, 255, .22), rgba(255, 255, 255, .06));
  border: 1px solid rgba(255, 255, 255, .22);
}

.brand-text { display: flex; flex-direction: column; line-height: 1.2; }
.brand-title { font-size: 15px; font-weight: 650; letter-spacing: .01em; }
.brand-sub {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .16em;
  color: rgba(255, 255, 255, .62);
}

.mainnav { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; overflow-x: auto; }
.mainnav a {
  flex: none;
  padding: 7px 13px;
  border-radius: 999px;
  color: rgba(255, 255, 255, .78);
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  text-decoration: none;
  transition: background .15s ease, color .15s ease;
}
.mainnav a:hover { color: #fff; background: rgba(255, 255, 255, .1); }
.mainnav a[aria-current="page"] { color: #08222f; background: #eafcfc; font-weight: 650; }

.user { display: inline-flex; align-items: center; gap: 9px; flex: none; max-width: 260px; }
.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  font-size: 13px;
  font-weight: 700;
  color: var(--navy);
  background: linear-gradient(140deg, #b7ecef, #79d5da);
}
.email {
  font-size: 13px;
  color: rgba(255, 255, 255, .82);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- Layout ---------- */
.page {
  flex: 1;
  width: min(1180px, 100% - 48px);
  margin: 32px auto 56px;
}

h1 {
  margin: 0 0 6px;
  font-size: clamp(24px, 2.4vw, 31px);
  font-weight: 700;
  letter-spacing: -.02em;
  color: #0d2331;
}

h2 {
  margin: 34px 0 12px;
  font-size: 19px;
  font-weight: 650;
  letter-spacing: -.01em;
}

p { margin: 0 0 14px; }

.muted { color: var(--muted); font-size: 13.5px; }

code {
  padding: 1px 6px;
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px;
  color: #26414f;
  background: #eef3f7;
}

.back { display: inline-block; margin-bottom: 18px; font-size: 13.5px; }

/* ---------- Flash ---------- */
.flash {
  margin: 16px 0;
  padding: 11px 14px;
  border: 1px solid var(--border);
  border-left: 4px solid var(--info);
  border-radius: 10px;
  font-size: 14px;
  background: var(--card);
}
.flash-success { border-left-color: var(--ok); background: var(--ok-bg); color: #145c3a; }
.flash-warn { border-left-color: #d99a12; background: var(--warn-bg); color: var(--warn); }
.flash-error { border-left-color: var(--err); background: var(--err-bg); color: var(--err); }
.flash-info { border-left-color: var(--info); background: var(--info-bg); color: var(--info); }

/* ---------- Bottoni e link-bottone ---------- */
button, .button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 9px 16px;
  min-height: 38px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: #22404f;
  background: #fff;
  cursor: pointer;
  text-decoration: none;
  transition: transform .12s ease, box-shadow .12s ease, background .12s ease, border-color .12s ease;
}
button:hover, .button:hover {
  text-decoration: none;
  border-color: #9fb0bd;
  background: #f8fafc;
  box-shadow: 0 3px 10px rgba(16, 38, 52, .08);
}
button:active, .button:active { transform: translateY(1px); }
button:focus-visible, .button:focus-visible,
input:focus-visible, select:focus-visible {
  outline: 3px solid rgba(47, 158, 166, .35);
  outline-offset: 1px;
}

.button-primary {
  color: #fff;
  border-color: transparent;
  background: linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%);
  box-shadow: 0 4px 14px rgba(31, 127, 136, .28);
}
.button-primary:hover { color: #fff; background: linear-gradient(135deg, #35aab2 0%, #1f7f88 100%); }
.button-danger { color: #fff; border-color: transparent; background: #b33434; }
.button-danger:hover { color: #fff; background: #c23d3d; }

.actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 18px 0; }

/* ---------- Form ---------- */
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin: 18px 0 20px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--card);
  box-shadow: var(--shadow);
}
.toolbar input, .toolbar select { margin: 0; }
.toolbar input[type="search"] { flex: 1 1 240px; }

input, select, textarea {
  min-height: 38px;
  padding: 8px 11px;
  border: 1px solid var(--border-strong);
  border-radius: 9px;
  font: inherit;
  font-size: 14px;
  color: var(--text);
  background: #fff;
}
input[readonly] { color: var(--muted); background: #f3f6f9; cursor: not-allowed; }
input[type="radio"], input[type="checkbox"] { min-height: 0; accent-color: var(--accent-strong); }

.form-card {
  display: grid;
  gap: 16px;
  max-width: 560px;
  margin: 8px 0 24px;
  padding: 22px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--card);
  box-shadow: var(--shadow);
}
.form-card label { display: grid; gap: 6px; font-size: 13.5px; font-weight: 600; color: #2b4453; }
.form-card input:not([type="radio"]):not([type="hidden"]) { width: 100%; font-weight: 400; }
.form-card .radio-row {
  display: flex;
  align-items: center;
  gap: 9px;
  font-weight: 500;
  padding: 8px 0;
}
.form-card .radio-row + .radio-row { border-top: 1px dashed var(--border); }
.form-card select { width: 100%; font-weight: 400; }
.form-card .actions { margin: 4px 0 0; }

.error { font-size: 12.5px; font-weight: 500; color: var(--err); }

/* ---------- Tabelle ---------- */
.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--card);
  box-shadow: var(--shadow);
}
table { width: 100%; border-collapse: collapse; font-size: 14px; }
thead th {
  padding: 11px 14px;
  text-align: left;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .07em;
  text-transform: uppercase;
  color: var(--muted);
  background: #f7f9fb;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
tbody td { padding: 11px 14px; border-bottom: 1px solid #edf1f5; vertical-align: top; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover { background: #f8fbfc; }

.empty {
  padding: 28px;
  text-align: center;
  color: var(--muted);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
  background: rgba(255, 255, 255, .6);
}

/* ---------- Badge di stato ---------- */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
  background: #eef2f6;
  color: #40515e;
}
.badge-ok { background: var(--ok-bg); color: var(--ok); }
.badge-off { background: #eceff2; color: #5c6b76; }
.badge-warn { background: var(--warn-bg); color: var(--warn); }
.badge-err { background: var(--err-bg); color: var(--err); }
.badge-info { background: var(--info-bg); color: var(--info); }

/* ---------- Dettaglio ---------- */
.details {
  display: grid;
  grid-template-columns: minmax(170px, 220px) 1fr;
  gap: 0;
  margin: 8px 0 24px;
  padding: 6px 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--card);
  box-shadow: var(--shadow);
}
.details dt {
  padding: 11px 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .05em;
  text-transform: uppercase;
  color: var(--muted);
  border-bottom: 1px solid #edf1f5;
}
.details dd { margin: 0; padding: 11px 0; border-bottom: 1px solid #edf1f5; overflow-wrap: anywhere; }
.details dt:nth-last-of-type(1), .details dd:last-of-type { border-bottom: 0; }

/* ---------- Paginazione ---------- */
.pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 18px 0 0;
  font-size: 13.5px;
  color: var(--muted);
}
.pager a { display: inline-flex; padding: 6px 12px; border: 1px solid var(--border-strong); border-radius: 9px; background: #fff; }
.pager a:hover { text-decoration: none; background: #f8fafc; }
.pager .pager-info { padding: 0 4px; }

/* ---------- Footer ---------- */
.footer {
  padding: 18px 24px 28px;
  text-align: center;
  font-size: 12px;
  color: #7b8a96;
}

/* ---------- Mobile ---------- */
@media (max-width: 760px) {
  .topbar { flex-wrap: wrap; gap: 10px 16px; }
  .mainnav { order: 3; width: 100%; }
  .user { margin-left: auto; }
  .page { width: calc(100% - 28px); margin: 22px auto 40px; }
  .details { grid-template-columns: 1fr; padding: 4px 16px; }
  .details dt { padding-bottom: 0; border-bottom: 0; }
  .details dd { padding-top: 2px; }
  .form-card { padding: 16px; }
}
`;
