---
id: E01-S01
epic: E01
title: "Scaffold Worker: TypeScript + Hono + Wrangler + KV + Vitest"
type: feature
status: done
requirements: [FR-49, FR-50, NFR-12, NFR-13, NFR-15]
depends_on: [E01-S00]
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
  - cd worker && npx wrangler deploy --dry-run --outdir dist
---

# E01-S01: Scaffold Worker — TypeScript + Hono + Wrangler + KV + Vitest

## Context

Il backend Maestrale passa da FastAPI/Python a **Cloudflare Workers in TypeScript** con cache su
**Workers KV** (decisione utente 2026-10-03, NFR-12). Questa storia crea lo scheletro del Worker:
build, test runner e binding KV, senza ancora implementare né l'API né il job di aggiornamento
(che arrivano nelle storie successive e devono mantenere il contratto congelato in
`tests/fixtures/forecast.schema.json` e i golden di E01-S00 — FR-50/FR-51).

Contesto tecnico rilevante:

- **NFR-12** — backend su Cloudflare Workers in TypeScript, cache su Workers KV; sostituisce
  Python/FastAPI/uvicorn e `data/forecasts.json`.
- **NFR-13** — suite di test eseguibile **in locale, senza accesso ai provider né all'account
  Cloudflare**; il test runner è una scelta dell'architect. Scelta: `vitest` con
  `@cloudflare/vitest-pool-workers`, che esegue i test dentro `workerd` (Miniflare), quindi il
  binding KV è reale e simulato in locale.
- **NFR-15** — i limiti di piattaforma (subrequest, CPU, durata) vanno rispettati dal job; qui
  serve solo che il Worker giri sul runtime corretto (`compatibility_date` recente).
- **FR-49** — il job di aggiornamento gira ogni 6 h sulla piattaforma: il Worker dovrà esportare
  un handler `scheduled` (E01-S04). In questa storia si predispone solo il gancio, documentato.
- La suite Python resta la baseline (E01-S00) e **non va toccata**: `python3 -m unittest discover
  -s tests -v` deve continuare a passare.

Il backend Python (`app/`, `backend/`, `*.py`) e i fixture/golden non fanno parte di questa storia.

## Acceptance criteria

- **AC-1** — Esiste `worker/` con `wrangler.jsonc`, `package.json`, `tsconfig.json`; il Worker usa
  Hono come router ed esporta `default { fetch }`.
- **AC-2** — Il binding KV si chiama `FORECASTS` ed è dichiarato in `wrangler.jsonc`; nei test è
  disponibile e utilizzabile (scrittura/lettura riuscita) senza account Cloudflare.
- **AC-3** — I test girano con `vitest` + `@cloudflare/vitest-pool-workers`, con `SELF.fetch`;
  `package.json` espone gli script `dev`, `test`, `deploy` e `typecheck`.
- **AC-4** — `cd worker && npm test` è verde; `wrangler dev` risponde 200 su una route di prova
  (`GET /`); il bundle si costruisce con `npx wrangler deploy --dry-run --outdir dist`.
- **AC-5** — `worker/README.md` documenta comandi di sviluppo e i passi manuali che richiedono
  l'account Cloudflare (login, `wrangler kv namespace create FORECASTS`, deploy reale).

## Tasks

- [x] Scrivere `worker/test/app.test.ts` e vederlo fallire
- [x] `worker/package.json` + installazione dipendenze (lockfile committato)
- [x] `worker/wrangler.jsonc` (name, main, compatibility_date, KV `FORECASTS`)
- [x] `worker/src/index.ts` (Hono, route di prova, gancio `scheduled` E01-S04)
- [x] `worker/tsconfig.json` + `worker/vitest.config.ts`
- [x] `.gitignore` root: `worker/node_modules/`, `worker/.wrangler/`, `worker/dist/`
- [x] `worker/README.md`
- [x] Eseguire tutti i comandi di `verify:`

## Dev notes

**File creati**

- `worker/package.json`, `worker/package-lock.json`
- `worker/wrangler.jsonc` — Worker `maestrale`, `main: src/index.ts`, KV `FORECASTS`
- `worker/tsconfig.json`
- `worker/vitest.config.ts`
- `worker/src/index.ts` — app Hono, `GET /` → `{status:"ok", service:"maestrale"}`,
  `export default { fetch }` + commento `// E01-S04` per l'handler `scheduled`
- `worker/test/app.test.ts` — 3 test: 200/JSON su `/`, binding KV scrivibile, 404 su route ignota
- `worker/worker-configuration.d.ts` — tipi generati da `wrangler types` (committati)
- `worker/README.md`
- `docs/stories/E01-S01-scaffold-worker.md` (questa storia)

**File modificati**

- `.gitignore` — aggiunte `worker/node_modules/`, `worker/.wrangler/`, `worker/dist/`.

**Decisioni**

- **API del pool di test**: la storia citava `defineWorkersConfig`, ma
  `@cloudflare/vitest-pool-workers` lo ha rimosso (l'export `./config` non esiste più da 0.18).
  Con la versione corrente (0.23.0, compatibile con vitest 4) si usa il plugin `cloudflareTest({...})`
  dentro `defineConfig` di `vitest/config`. Gli AC sono rispettati: Vitest gira in `workerd` e il
  binding `FORECASTS` è realmente disponibile (test di put/get).
- Il pacchetto `@cloudflare/vitest-pool-workers` è **deprecato** in favore di
  `@cloudflare/vitest-plugin`; resta perché richiesto esplicitamente dalla storia. Migrazione da
  valutare in una storia successiva (il codemod ufficiale è `vitest:pool-workers-to-vitest-plugin`).
- **`compatibility_date: 2026-08-22`**: è la data più recente supportata dal `workerd` incluso in
  `@cloudflare/vitest-pool-workers` 0.23.0. Con `2026-10-01` i test fallivano con
  `This Worker requires compatibility date "2026-10-01", but the newest date supported by this
  server binary is "2026-08-22"`. Il `wrangler` top-level (4.151.2) userebbe un runtime più nuovo,
  ma la data deve restare compatibile col runtime di test.
- **Tipi**: `npx wrangler types` genera `worker-configuration.d.ts` (interfaccia `Env` con
  `FORECASTS` + tipi runtime) partendo da `wrangler.jsonc`. È committato così `npm run typecheck`
  gira offline. `@cloudflare/workers-types` è stato rimosso: Wrangler lo dichiara superato dai tipi
  generati. In `tsconfig.json` resta `@cloudflare/vitest-pool-workers/types` per il modulo
  `cloudflare:test`.
- **Placeholder KV**: `id`/`preview_id` = `000…0` (32 hex) per permettere build e dry-run senza
  account; `wrangler deploy --dry-run` lo accetta. La sostituzione con gli id reali è documentata
  in `worker/README.md` ("Passi manuali"), insieme a `wrangler login`, creazione namespace
  (anche `--preview`) e deploy reale. **Nessun deploy reale è stato eseguito.**
- **Versioni**: Hono 4.13, Wrangler 4.151, TypeScript 7.0, Vitest 4.1 (vitest-pool-workers 0.23
  richiede `^4.1.0`). Zod/openapi non introdotti (E01-S06).
- **Lockfile**: generato con npm 11 perché `npm 10.9.2` va in crash (`Cannot read properties of
  null (reading 'edgesOut')`, bug di arborist) sulla risoluzione iniziale senza lockfile. Con il
  lockfile committato, `npm ci` e `npm install` funzionano con npm 10.9.2 (verificato in una copia
  pulita). Il README consiglia `npm ci`.

**Verifica**

```bash
cd worker && npm test          # Test Files 1 passed — Tests 3 passed
cd worker && npm run typecheck # tsc --noEmit, nessun errore
cd worker && npx wrangler deploy --dry-run --outdir dist
# Total Upload: 57.63 KiB / gzip: 14.65 KiB — env.FORECASTS (KV Namespace) — dry-run: exiting now
npx wrangler dev --port 8791   # GET / → 200 {"status":"ok","service":"maestrale"}; GET /nope → 404
python3 -m unittest discover -s tests   # Ran 17 tests — OK (backend Python intatto)
```

Nota: `wrangler dev` termina con un dump `fatal error: all goroutines are asleep - deadlock!` di
esbuild **allo shutdown** (SIGTERM), dopo aver servito correttamente le richieste; noto
comportamento di Wrangler in modalità agent, non impatta l'AC.

## Run log

| Iterazione | Comando | Esito | Note |
|---|---|---|---|
| 1 | `cd worker && npm test` (senza `src/index.ts`) | rosso | entrypoint mancante + compat date troppo nuova |
| 1 | `cd worker && npm test` | verde | 3 test |
| 1 | `cd worker && npm run typecheck` | verde | |
| 1 | `cd worker && npx wrangler deploy --dry-run --outdir dist` | verde | 57.63 KiB |
| 1 | `wrangler dev` + `curl` | 200 / 404 | |
| 1 | `python3 -m unittest discover -s tests` | verde | 17 test

## Review log

### 2026-10-19 — Reviewer — verdict: **done**

**Comandi eseguiti (tutti exit 0, worktree pulita dopo le mutazioni):**

- `cd worker && npm test` → 3/3 verdi (Vitest 4.1.12, workerd).
- `cd worker && npm run typecheck` → `tsc --noEmit`, nessun errore.
- `cd worker && npx wrangler deploy --dry-run --outdir dist` → Total Upload 57.63 KiB / gzip 14.65 KiB, binding `env.FORECASTS (000…) KV Namespace`, dry-run.
- `wrangler dev --port 8791` → `GET /` **200** `{"status":"ok","service":"maestrale"}`, `GET /nope` **404**.
- `npm ci` su copia pulita (`git archive 82a5ae8 worker`) con npm 10.9.2 → install OK + 3 test verdi (lockfile coerente).
- `npx wrangler types` → rigenera `worker-configuration.d.ts` identico all'header a parte la data (config e tipi coerenti).
- `python3 -m unittest discover -s tests` → **Ran 17 tests — OK** (backend Python intatto).
- `git ls-files worker` → solo sorgenti/config; nessun `node_modules`/`dist`/`.wrangler`; nessuna credenziale; nessun deploy reale.

**Mutazioni locali (ripristinate, `git status worker` pulito):**

- `src/index.ts`: `service: "MUTATED"` → 1 test rosso (i test non sono vacui).
- `src/index.ts`: errore di tipo iniettato → `tsc` rosso TS2322 (i tipi generati non mascherano errori).
- `wrangler.jsonc`: `compatibility_date` 2026-10-01 → test rossi con `newest date supported by this server binary is "2026-08-22"` (giustificazione del coder confermata).
- `wrangler.jsonc`: rimozione `kv_namespaces` → test **ancora verdi** (vedi R-1).

**R-1 — should — `worker/vitest.config.ts:12-14`** — `miniflare.kvNamespaces: ["FORECASTS"]` duplica il binding già letto da `wrangler.configPath`. Verificato: togliendo `kv_namespaces` da `wrangler.jsonc` i test restano verdi, quindi il test KV non copre la clausola AC-2 "dichiarato in wrangler.jsonc" e può dare falso verde se il binding viene rinominato/rimosso (il `Env` generato resta allineato finché non si rigenera). Fix: eliminare il blocco `miniflare` — con il solo `wrangler.configPath` i test restano verdi, e con il binding tolto da `wrangler.jsonc` falliscono con `Cannot read properties of undefined (reading 'put')` (verificato). Non bloccante: binding e dry-run sono corretti.

**R-2 — should — `worker/package.json:19`** — `@cloudflare/vitest-pool-workers` è deprecato (warning a ogni `npm test`); il successore `@cloudflare/vitest-plugin@1.4.5` è pubblicato e stabile. Accettabile qui perché il pacchetto è citato nella storia, ma va deciso: migrazione (codemod `vitest:pool-workers-to-vitest-plugin`) in una storia E01 dedicata, oppure ADR in `docs/decisions/` che motiva il rinvio. Nota: trascina 5 vulnerabilità high di devDependency (`sharp`, `undici` via `miniflare`); `npm audit --omit=dev` = 0, quindi nessuna esposizione in produzione.

**R-3 — nit — `worker/README.md:56-58`** — l'output di `wrangler kv namespace create` è mostrato in TOML (`[[kv_namespaces]]`) mentre il progetto usa `wrangler.jsonc`: mostrare il frammento JSONC (o usare `--update-config`).

**R-4 — nit — `.gitignore:11-13`** — manca `worker/.dev.vars` (secrets locali Wrangler). Aggiungerlo prima del primo secret.

**R-5 — nit — commit `82a5ae8`** — il messaggio non cita gli ID requisito (FR-49/FR-50, NFR-12/13/15) come chiede `AGENTS.md`.

**R-6 — nit — `worker/wrangler.jsonc:10-12`** — `observability.enabled: true` non è richiesto dagli AC né citato in storia/architettura; innocuo, ma va annotato o rimandato alla storia che definisce l'osservabilità (FR-52).

**R-7 — nit — `docs/`** — `docs/architecture.md` è ancora il template `status: draft` e `docs/adr/` contiene solo il template; le decisioni di questa storia (compat date pinnata al runtime di test, pool deprecato, `worker-configuration.d.ts` committato) vivono solo nel Dev notes. Spostarle in `docs/decisions/` come da `AGENTS.md`.

**Note (nessuna azione):** il commit di `worker/worker-configuration.d.ts` (625 KB, 16k righe) è giustificato (typecheck offline, NFR-13), generato da `wrangler types`, rigenerabile e non maschera errori di tipo. `scheduled` è solo un commento `// E01-S04`: coerente con "nessun codice morto"; l'handler arriva in E01-S04. Placeholder KV (32 zeri) chiaramente documentato in config e README, accettato dal dry-run.
