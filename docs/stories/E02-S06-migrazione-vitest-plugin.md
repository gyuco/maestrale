---
id: E02-S06
epic: E02
title: Migrazione del test runner da @cloudflare/vitest-pool-workers a @cloudflare/vitest-plugin
type: feature
status: ready
requirements: []
depends_on: []
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
  - cd worker && npx wrangler deploy --dry-run
---

# E02-S06: Migrazione a `@cloudflare/vitest-plugin`

Debito tecnico trasversale (nessun FR): non cambia comportamento, API o schema. Eredita il TODO
`TODO(E01-S08)` di `worker/vitest.config.ts` e il rilievo R-2 della review di E01-S01.

## Context
- **Origine 1, TODO in `worker/vitest.config.ts` (righe 9-14)**: migrare da
  `@cloudflare/vitest-pool-workers` (deprecato) a `@cloudflare/vitest-plugin` (codemod
  `vitest:pool-workers-to-vitest-plugin`). Il rinvio era motivato dal fatto che la
  `compatibility_date` è bloccata a `2026-08-22`: è la data più recente supportata dal `workerd`
  incluso nel pool `0.23.0`. Il nuovo plugin userebbe il `wrangler`/`workerd` di progetto e
  potrebbe sbloccare l'aggiornamento della data.
- **Origine 2, review E01-S01, R-2 (should)**: il pacchetto è deprecato (warning a ogni `npm test`);
  il successore `@cloudflare/vitest-plugin@1.4.5` è pubblicato e stabile; la sola dipendenza dal pool
  trascina 5 vulnerabilità high di devDependency (`sharp`, `undici` via `miniflare`);
  `npm audit --omit=dev` = 0. Evidenza sulla data, sempre da E01-S01: con `compatibility_date`
  `2026-10-01` i test fallivano con `newest date supported by this server binary is "2026-08-22"`.
- **Stato attuale** (`worker/vitest.config.ts`): importa `cloudflareTest` e `readD1Migrations` da
  `@cloudflare/vitest-pool-workers`; legge `./migrations` con `await readD1Migrations(...)`; passa
  `miniflare: { bindings: { TEST_MIGRATIONS: migrations } }` e `wrangler: { configPath:
  "./wrangler.jsonc" }`; `setupFiles: ["./test/setup/apply-migrations.ts"]`, che applica le migrazioni
  con `applyD1Migrations`. I binding (KV `FORECASTS`, D1 `HISTORY`) arrivano solo da `wrangler.jsonc`
  e non vanno duplicati in config (review E01-S01 R-1).
- **Regola**: i test esistenti (284 al momento della stesura) non si modificano né si indeboliscono.
  Se il nuovo plugin richiede modifiche al solo setup (`test/setup/*`, tipi di `cloudflare:test`,
  `tsconfig`), sono ammesse purché le asserzioni dei test restano identiche.
- **File probabili**: `worker/package.json` e `package-lock.json` (dipendenze), `worker/vitest.config.ts`,
  `worker/test/setup/apply-migrations.ts`, eventuali `.d.ts`/`tsconfig.json` per i tipi
  `cloudflare:test` / `ProvidedEnv`, `worker/wrangler.jsonc` (solo `compatibility_date`, e solo se
  consentito), commento sul vincolo in `wrangler.jsonc` righe 7-9.
- **Fuori scope**: nuove funzionalità, cambio versione di Vitest oltre il necessario per la
  compatibilità, modifiche a binding, `main`, `kv_namespaces`, `d1_databases`, cron o altro in
  `wrangler.jsonc`; modifiche al codice sotto `worker/src/`.

## Acceptance criteria
- **AC-1** — Given il Worker migrato, when si esegue `cd worker && npm test`, then tutti i 284 test
  esistenti passano, il loro numero non diminuisce, e nessun file `*.test.ts` è modificato (verificabile
  con `git diff --stat -- worker/test ':!worker/test/setup'`, che deve essere vuoto).
- **AC-2** — Given la migrazione, when si esegue `cd worker && npm run typecheck`, then `tsc --noEmit`
  termina con codice 0 e nessun errore.
- **AC-3** — Given i test che usano D1 `HISTORY`, when partono, then le migrazioni di `migrations/`
  sono ancora lette con `readD1Migrations` e applicate con `applyD1Migrations` prima dei test (i test
  di E02 sullo storico restano verdi senza dati inseriti a mano della tabella).
- **AC-4** — Given `package.json`, when si controllano le dipendenze, then
  `@cloudflare/vitest-pool-workers` non è più presente (né dichiarato né in `package-lock.json`),
  `@cloudflare/vitest-plugin` lo sostituisce, e `npm test` non emette più il warning di deprecazione.
- **AC-5** — Given la migrazione completata, when si prova ad aggiornare `compatibility_date` in
  `wrangler.jsonc` alla data più recente supportata dal `workerd` del progetto, then se `npm test` e
  `wrangler deploy --dry-run` restano verdi la data è aggiornata (con il commento sul vincolo
  riscritto o rimosso); se non è possibile, la data resta `2026-08-22` e la causa è documentata in
  *Dev notes* e nel commento di `wrangler.jsonc`.
- **AC-6** — Given `wrangler.jsonc`, when si guarda il diff, then le uniche modifiche ammesse sono
  `compatibility_date` (AC-5) e il relativo commento; binding, cron, `main` e nome restano identici.
- **AC-7** — Given il TODO in `worker/vitest.config.ts`, when la migrazione è fatta, then il commento
  `TODO(E01-S08)` è rimosso e il file riflette la configurazione finale.

## Tasks
- [ ] Baseline: su `develop` pulito esegui `cd worker && npm test` e `npm run typecheck`; annota il
      numero di test (atteso 284) e il warning di deprecazione in *Dev notes*. Se la baseline non è verde,
      fermati e imposta `status: blocked`.
- [ ] Scrivi un controllo che fallisce per AC-3/AC-4 prima di migrare: ad esempio verifica che
      `package.json` non contenga `vitest-pool-workers` e che un test esistente su D1 (storico) fallisca
      senza l'applicazione delle migrazioni; non aggiungere asserzioni ai test esistenti, usa un test
      di setup separato o un comando di shell documentato in *Dev notes*.
- [ ] Leggi la documentazione ufficiale/codemod di `@cloudflare/vitest-plugin` (API di `cloudflareTest`,
      `readD1Migrations`, `applyD1Migrations`, import di `cloudflare:test`) e annota le differenze.
- [ ] Migra: installa `@cloudflare/vitest-plugin`, rimuovi `@cloudflare/vitest-pool-workers`, adegua gli
      import in `vitest.config.ts` e in `test/setup/apply-migrations.ts`, aggiorna i tipi per
      `cloudflare:test` e `TEST_MIGRATIONS`; compatibilità di Vitest verificata.
- [ ] Esegui `npm test` e `npm run typecheck`; correggi solo config/setup/tipi, mai i test (AC-1, AC-2, AC-3).
- [ ] Prova ad alzare `compatibility_date` (AC-5): ripeti `npm test` e `wrangler deploy --dry-run`;
      mantieni la data solo se tutto è verde, altrimenti ripristinala e documenta.
- [ ] Rimuovi il TODO e aggiorna i commenti obsoleti (`vitest.config.ts`, `wrangler.jsonc`) (AC-6, AC-7).
- [ ] Esegui `npm audit` (completo e `--omit=dev`) e annota il risultato in *Dev notes*.
- [ ] Esegui i comandi `verify` e controlla `git diff --stat` (AC-1, AC-6).

## Rischi
- **API cambiate**: nomi, firme o import di `cloudflareTest`, `readD1Migrations`, `applyD1Migrations`
  o del modulo `cloudflare:test` possono differire; il codemod può lasciare import o tipi da sistemare a mano.
- **Setup file**: `test/setup/apply-migrations.ts` potrebbe essere eseguito in un contesto diverso
  (isolamento dello storage, ordine rispetto ai test, accesso a `env.TEST_MIGRATIONS`); rischio di
  migrazioni non applicate con test falsamente verdi o rossi in modo intermittente.
- **Pool/pacchetto deprecato**: se `vitest-plugin` richiede un `vitest` o un `wrangler` diversi da quelli
  in uso, l'aggiornamento può propagarsi ad altre dipendenze; verifica la compatibilità prima di
  alzare le versioni. Se il nuovo plugin è ancora legato al `workerd` del pool, la data non si sblocca
  (AC-5 resta soddisfatta documentando la causa).
- **Isolamento e tempi**: differenze di isolamento tra test o di performance possono far emergere test
  fragili; vanno diagnosticate, non bypassate (nessun `skip`, nessun aumento arbitrario dei timeout).
- **Vulnerabilità devDependency**: il numero di avvisi di `npm audit` può cambiare; non è un criterio
  di accettazione ma va annotato.

## Dev notes
<!-- Coder: decisions, deviations, summary of changes. -->

## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
<!-- Reviewer: date, verdict, findings R-1… (blocker/should/nit) with file:line. -->
