---
id: E04-S01
epic: E04
title: CI con GitHub Actions (worker, scripts, app Flutter)
type: feature
status: ready
requirements: []
depends_on: []
verify:
  - node --test scripts/*.test.mjs
  - cd worker && npm ci && npm run typecheck && npm test
  - cd app && flutter pub get && flutter analyze && flutter test
---

# E04-S01: CI con GitHub Actions

Infrastruttura: nessun FR. Nessun NFR del PRD tratta CI/CD (vedi epic E04); attinente a **NFR-13**
(target proposto: "suite backend e Flutter verdi su ogni modifica"). Non introduce segreti (NFR-8).

## Context
- Repository: `github.com/gyuco/maestrale` (remoto `origin`); rami `develop` (lavoro) e `main`.
  Oggi non esiste `.github/workflows/` (esiste solo `.github/modernize/`, estraneo, da non toccare).
- **Comandi reali locali** (README.md righe ~150-158 e `worker/package.json`):
  - Worker (Node 22+): `cd worker && npm ci && npm run typecheck && npm test`
    (`typecheck` = `tsc --noEmit`, `test` = `vitest run`, vedi `worker/package.json`).
  - Script Node: `node --test scripts/*.test.mjs` dalla radice (oggi
    `scripts/compare_backends.test.mjs`; `scripts/*.mjs` non hanno dipendenze npm).
  - App: `cd app && flutter pub get && flutter analyze && flutter test`.
- **Versione Flutter**: `app/pubspec.yaml` ha solo `environment: sdk: ^3.11.5` (Dart) e **nessun**
  vincolo `flutter:`. La versione Flutter va quindi **fissata nel workflow** (es.
  `subosito/flutter-action` con `flutter-version: "<X.Y.Z>"` e `channel: stable`), scegliendo una
  versione il cui Dart incluso sia >= 3.11.5 e con cui `flutter analyze` e `flutter test` passano
  in locale. Il coder determina la versione con `flutter --version` locale (stessa usata dallo
  sviluppatore) e la riporta nel runbook. Non usare `channel: stable` senza versione.
- **Worker e test**: i test girano in Miniflare (`@cloudflare/vitest-pool-workers`), senza account
  né rete verso Cloudflare/provider: nessun segreto necessario. `worker/wrangler.jsonc` contiene un
  `database_id` segnaposto e va bene per i test. E04-S01 non esegue `wrangler deploy`.
  Nota: E02-S06 (stato `ready`) migrerà il test runner; i comandi `npm run typecheck` / `npm test`
  restano gli stessi, quindi il workflow non dipende da quella migrazione.
- **Politica di sicurezza del workflow**: `permissions: contents: read` a livello workflow;
  `concurrency` con `group: ci-${{ github.workflow }}-${{ github.ref }}` e `cancel-in-progress: true`;
  nessun uso di `secrets.*`; nessuno step di deploy; action di terze parti **pinnate** (tag di
  versione maggiore esatta o, meglio, SHA completo con commento della versione).
- **Cache**: `actions/setup-node` con `cache: npm` e `cache-dependency-path: worker/package-lock.json`;
  per Flutter/pub `subosito/flutter-action` con `cache: true` (cache dell'SDK) più cache di
  `~/.pub-cache` con chiave su `app/pubspec.lock` (o `pubspec.yaml` se il lock non è versionato:
  verificarlo con `git ls-files app/pubspec.lock`).
- **File da creare/modificare**: `.github/workflows/ci.yml` (nuovo), `scripts/ci_workflow.test.mjs`
  (nuovo), `docs/runbook.md` (sezione *Passi futuri*, righe ~280-287, e riga 34-35 della sezione
  *Deploy*).

## Acceptance criteria
- **AC-1** — Given `.github/workflows/ci.yml`, when lo si analizza (actionlint se installabile,
  altrimenti parse YAML e controlli testuali del test AC-7), then il file è YAML valido e privo di
  errori actionlint, e dichiara `on: push` e `on: pull_request` con `branches: [develop, main]`.
- **AC-2** — Given il workflow, when se ne leggono i job, then esistono tre job indipendenti
  (eseguibili in parallelo, nessun `needs` tra loro): `worker`, `scripts`, `app`.
- **AC-3** — Given il job `worker`, when si leggono i suoi step, then usa Node `22` (setup-node con
  cache npm su `worker/package-lock.json`) ed esegue, con `working-directory: worker`, esattamente
  `npm ci`, `npm run typecheck`, `npm test` (nell'ordine).
- **AC-4** — Given il job `scripts`, when si leggono i suoi step, then usa Node `22` ed esegue dalla
  radice del repo `node --test scripts/*.test.mjs` (stesso comando di README.md).
- **AC-5** — Given il job `app`, when si leggono i suoi step, then installa Flutter con versione
  **fissata** (X.Y.Z esatta, non solo `stable`) con cache attiva ed esegue, con
  `working-directory: app`, `flutter pub get`, `flutter analyze`, `flutter test` (nell'ordine).
- **AC-6** — Given il workflow, when se ne verificano sicurezza e rilascio, then: ha
  `permissions: contents: read` a livello workflow (nessun permesso di scrittura), un blocco
  `concurrency` con `cancel-in-progress: true`, nessun riferimento a `secrets.` (a parte
  `GITHUB_TOKEN` implicito non usato), nessuno step contenente `wrangler deploy`,
  `wrangler-action` o `d1 migrations apply`, e ogni `uses:` è pinnata a una versione/SHA esplicita
  (nessun `@main`, `@master`, `@latest`).
- **AC-7** — Given `scripts/ci_workflow.test.mjs`, when si esegue `node --test scripts/*.test.mjs`,
  then il test verifica automaticamente AC-1..AC-6 sul file reale (senza dipendenze npm nuove:
  controlli testuali/regex sul YAML, lettura di `worker/package.json` per confermare che gli script
  `typecheck` e `test` citati dal workflow esistono) e passa in locale.
- **AC-8** — Given `docs/runbook.md`, when si legge *Passi futuri* e *Deploy*, then la voce "CI con
  `npm test`... non ancora configurata" è sostituita da: CI configurata (`.github/workflows/ci.yml`,
  tre job, versione Flutter usata), con il deploy automatico ancora elencato come passo futuro
  rimandato a E04-S02; la riga "Il deploy automatico da GitHub non è configurato" resta vera.
- **AC-9** — Given una PR verso `develop` o `main`, when il workflow gira su GitHub, then i tre job
  risultano verdi (verifica manuale dopo il push; riportare nel Dev notes l'URL della run).

## Tasks
- [ ] Scrivere `scripts/ci_workflow.test.mjs` con i test per AC-1..AC-6 (falliscono: il workflow non
      esiste ancora); confermare il rosso con `node --test scripts/ci_workflow.test.mjs`.
- [ ] Determinare in locale la versione Flutter (`flutter --version`) e verificare che i comandi
      dell'app passano (AC-5); verificare se `app/pubspec.lock` è versionato.
- [ ] Creare `.github/workflows/ci.yml` (AC-1..AC-6) con action pinnate.
- [ ] Se `actionlint` è installabile (`brew install actionlint`), eseguirlo e riportare l'esito;
      altrimenti annotarlo nel Dev notes (il test AC-7 resta la verifica minima).
- [ ] Aggiornare `docs/runbook.md` (AC-8).
- [ ] Eseguire i comandi `verify` in locale; push e verifica della run su GitHub (AC-9).

## Dev notes
<!-- Coder: versione Flutter scelta, SHA/versioni delle action, esito actionlint, URL della run. -->

## Run log

## Review log
