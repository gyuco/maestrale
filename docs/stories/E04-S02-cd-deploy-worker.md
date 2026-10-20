---
id: E04-S02
epic: E04
title: "CD: deploy automatico del Worker su main dopo CI verde"
type: feature
status: blocked
requirements: []
depends_on: [E04-S01]
verify:
  - cd worker && npm ci && npm run typecheck && npm test
  - cd worker && npx wrangler deploy --dry-run --outdir dist
---

# E04-S02: CD, deploy automatico del Worker su `main`

Infrastruttura: nessun FR. Nessun NFR del PRD tratta il deploy automatico (vedi epic E04). Vincoli
rilevanti: NFR-8 (nessun segreto applicativo), NFR-11 (nessun endpoint di scrittura), NFR-15
(limiti piattaforma, regola go/no-go per Paid).

## Stato: blocked
Sbloccare quando **entrambe** le condizioni sono vere:
1. E04-S01 è `done`.
2. L'owner ha risposto alla domanda aperta qui sotto.

### Domanda aperta per l'owner
**Quale opzione di deploy automatico vuoi adottare: A (Workers Builds dal dashboard Cloudflare) o
B (GitHub Actions con `cloudflare/wrangler-action`)?** Raccomandazione del planner: vedi sotto.
Ti serve anche decidere se il deploy su `main` richiede approvazione manuale (consigliato: sì).
Quando l'owner sceglie, il planner aggiorna questa storia (sezioni di scelta e tasks) e la porta a
`ready`; la scelta va registrata in un ADR da parte dell'architect.

## Context
- Oggi il deploy è manuale: `docs/runbook.md`, sezione *Deploy* (`npx wrangler deploy` da `worker/`,
  **[account]**) e *Rilascio dello storico* (righe ~140-159). Il job `scheduled` e le migrazioni D1
  sono coinvolti: `worker/migrations/*.sql`, binding `HISTORY`, database `maestrale-history`.
- **Ordine obbligatorio (runbook, "Rilascio dello storico", punto 3)**:
  `npx wrangler d1 migrations apply maestrale-history --remote` **prima** di `npx wrangler deploy`.
  Un deploy prima delle migrazioni non rompe KV, `/forecast`, `/health`, ma `GET /history` risponde
  **503** finché le migrazioni non sono applicate. `migrations apply` è idempotente (applica solo le
  migrazioni non ancora applicate).
- Rollback attuale (runbook, *Rollback*): `npx wrangler deployments list` e
  `npx wrangler rollback [version-id] -m "motivo"`; ripristina **solo il codice**, non KV né D1
  (le migrazioni D1 non si annullano: scrivere le migrazioni in modo retrocompatibile col codice
  precedente, regola "expand then contract").
- Prerequisito: la CI di E04-S01 (`.github/workflows/ci.yml`, job `worker`, `scripts`, `app`).
- `worker/wrangler.jsonc`: `database_id` D1 reale già sostituito al segnaposto? Verificarlo prima
  del primo deploy automatico (il segnaposto `00000000-...` farebbe fallire `migrations apply`).

## Valutazione delle opzioni

| Criterio | A. Workers Builds (dashboard) | B. GitHub Actions + `wrangler-action` |
|---|---|---|
| Segreti in GitHub | Nessuno: Cloudflare si collega al repo via app GitHub | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` come secrets (meglio nell'environment) |
| "Dopo CI verde" | Non nativo: parte al push su `main` in parallelo alla CI; per bloccare il deploy serve branch protection che impedisce il merge su `main` con CI rossa | Nativo: job `deploy` con `needs: [worker, scripts, app]` (CI riusata con `workflow_call` o stesso workflow) |
| Migrazioni D1 prima del deploy | Possibile col comando di build/deploy personalizzato (`wrangler d1 migrations apply ... --remote && wrangler deploy`), ma il token di build deve avere permesso D1 edit | Step espliciti e ordinati: `migrations apply` poi `deploy` |
| Approvazione manuale | Non prevista: l'unico filtro è la branch protection su `main` (PR approvate) | GitHub **environment** `production` con *required reviewers*: il job si ferma finché l'owner approva |
| Rollback | Dal dashboard (Deployments > Rollback) o `wrangler rollback` | `wrangler rollback` (manuale o workflow dedicato `workflow_dispatch`) |
| Superficie d'attacco | Minore (token gestito da Cloudflare) | Maggiore: token API in GitHub; mitigabile con token a minimo privilegio, environment protetto, nessun trigger da fork |
| Manutenzione | Minima | Un workflow in più da mantenere e action da pinnare |

**Raccomandazione del planner: opzione B (GitHub Actions + `wrangler-action`) con environment
`production` protetto**, perché è l'unica che soddisfa insieme: deploy *dopo* CI verde, ordine
garantito migrazioni -> deploy, approvazione manuale, e tutto versionato nel repo. Il costo è la
gestione di due secrets, mitigata da un token a permessi minimi. L'opzione A è preferibile **solo**
se l'owner vuole zero segreti in GitHub e accetta di fare rispettare "CI verde" tramite branch
protection e di rinunciare all'approvazione manuale per singolo deploy. (La scelta finale è
dell'owner; il planner non modifica architettura.)

## Passi dell'owner [account] (da fare prima di sbloccare la storia)
Comuni:
1. Confermare che `worker/wrangler.jsonc` ha il `database_id` D1 reale (runbook, *Rilascio
   dello storico*, punti 1-2) e che le migrazioni esistenti sono già applicate in remoto.
2. Attivare la *branch protection* su `main`: PR obbligatoria e check richiesti `worker`,
   `scripts`, `app` (Settings > Branches).

Se opzione B:
3. **[account]** Cloudflare dashboard > My Profile > API Tokens > Create Token, con permessi minimi:
   *Account > Workers Scripts: Edit*, *Account > D1: Edit*, *Account > Workers KV Storage: Edit*
   (solo se servono, il deploy di un Worker con binding KV può richiederlo; verificare con
   `--dry-run`), limitato al solo account. Annotare anche l'**Account ID**
   (dashboard > Workers & Pages > Overview).
4. GitHub > Settings > Environments > nuovo environment `production`: *Required reviewers* = owner;
   *Deployment branches* = solo `main`; aggiungere come **environment secrets**
   `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` (non repository secrets).

Se opzione A:
3. **[account]** Cloudflare dashboard > Workers & Pages > `maestrale` > Settings > Builds > collegare
   il repo `gyuco/maestrale`, ramo di produzione `main`, root directory `worker`, build command
   `npm ci`, deploy command `npx wrangler d1 migrations apply maestrale-history --remote && npx wrangler deploy`;
   verificare che il token di build gestito da Cloudflare abbia permesso D1.
4. Disattivare le *preview builds* sugli altri rami se non volute.

## Acceptance criteria (per l'opzione B raccomandata; da riadattare se l'owner sceglie A)
- **AC-1** — Given un push su `main` (merge di PR), when la CI (E04-S01) è verde, then parte il job
  `deploy` e solo allora (`needs` sui job della CI); se la CI è rossa il deploy non parte.
- **AC-2** — Given il job `deploy`, when si leggono gli step, then `wrangler d1 migrations apply
  maestrale-history --remote` precede `wrangler deploy` (stesso job, ordine verificabile nel YAML) e un
  fallimento delle migrazioni interrompe il job prima del deploy.
- **AC-3** — Given il job `deploy`, when si leggono le impostazioni, then usa `environment:
  production` (con approvazione manuale configurata dall'owner), `permissions: contents: read`,
  `concurrency` con `cancel-in-progress: false` (un deploy in corso non si interrompe), trigger solo
  su `push` a `main` (nessun `pull_request`, nessun fork), action pinnate, e i secrets
  `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` sono letti solo dall'environment.
- **AC-4** — Given un deploy riuscito, when termina, then lo step finale esegue lo smoke test
  `node scripts/compare_backends.mjs --smoke <URL del Worker>` (URL non segreto, da variabile di
  environment) e il job fallisce se lo smoke fallisce.
- **AC-5** — Given `docs/runbook.md`, when si legge, then la sezione *Deploy* descrive il deploy
  automatico, i secrets/environment richiesti, come approvare, e il rollback: `npx wrangler rollback`
  [**account**] o il rollback dal dashboard; ricorda che D1 non torna indietro e che le migrazioni
  devono restare retrocompatibili col codice precedente; *Passi futuri* è aggiornata.
- **AC-6** — Given un test statico (stile `scripts/ci_workflow.test.mjs` di E04-S01), when si
  esegue `node --test scripts/*.test.mjs`, then verifica AC-1..AC-3 sul YAML (ordine degli step,
  `needs`, `environment`, assenza di trigger `pull_request`, pinning) e passa.

## Tasks
- [ ] Attendere la risposta dell'owner (domanda aperta) e che E04-S01 sia `done`; poi riportare la
      storia a `ready` adattando AC/tasks all'opzione scelta.
- [ ] Scrivere test statici per AC-1..AC-3 (devono fallire prima del workflow).
- [ ] Implementare il workflow di deploy (e documentare i passi owner già elencati).
- [ ] Aggiornare `docs/runbook.md` (AC-5).
- [ ] Eseguire i comandi `verify`; primo deploy automatico verificato con l'owner (run + smoke).

## Dev notes

## Run log

## Review log
