---
id: E05-S03
epic: E05
title: "Worker maestrale-admin: scheletro, Cloudflare Access e header di sicurezza"
type: feature
status: done
requirements: [FR-92, FR-93, FR-118, NFR-13, NFR-27, NFR-28]
depends_on: [E05-S01]
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
---

# E05-S03: Worker `maestrale-admin`: scheletro, Access e header di sicurezza

## Context
Crea il secondo Worker, con la sua origine e la sua protezione, e le pagine vuote delle tre aree. Le
funzioni arrivano nelle storie successive; qui si costruisce il cancello che nessuna di esse può
aggirare.

**Requisiti (testo operativo)**
- FR-92: il backoffice offre due aree (catalogo, esecuzioni) più registro operazioni e "Esegui ora".
- FR-93: ogni funzione è accessibile solo a un amministratore autenticato e autorizzato; non
  autenticato → **401** (o redirect al login), autenticato ma non autorizzato → **403**; in entrambi i
  casi nessun dato nel corpo; le richieste che aggirano Access sono rifiutate allo stesso modo.
- FR-118: applicazione web **separata**, su origine propria distinta dall'API pubblica, per browser
  desktop recenti; nessuna funzione admin nell'app Flutter.
- NFR-27: solo HTTPS; nessun segreto nel repository; verifica delle richieste; revoca documentata.
- NFR-28: nessun CORS verso altre origini; il backoffice non degrada l'API pubblica.

**Decisioni architetturali (ADR-0007)**
- Entry `worker/src/admin/index.ts`, config `worker/wrangler.admin.jsonc`, origine `admin.<dominio>`
  (`ADMIN_ORIGIN`); binding `CORE` e `FORECASTS`, `vars` `ADMIN_ORIGIN`, `ACCESS_TEAM_DOMAIN`,
  `ACCESS_AUD`; nessun binding `HISTORY` né Open-Meteo.
- Verifica del JWT `Cf-Access-Jwt-Assertion` con `jose` (RS256, JWKS memoizzate 1 h, `aud`/`exp`/`iss`);
  l'email si legge da `Cf-Access-Authenticated-User-Email` **dopo** la verifica. In test un
  `AccessVerifier` finto restituisce ok / unauthenticated / unauthorized (NFR-13).
- Ogni richiesta non `GET` controlla `Origin`/`Referer` = `ADMIN_ORIGIN` (NFR-27, decisione
  2026-11-02). `Cache-Control: no-store`, CSP `default-src 'self'; frame-ancestors 'none'`,
  `X-Content-Type-Options: nosniff`.
- Test: progetto Vitest separato (`vitest.admin.config.ts`) con il suo `npm run test:admin`; `npm test`
  esegue entrambi i progetti.

**File probabili**: `worker/wrangler.admin.jsonc`, `worker/src/admin/index.ts`,
`worker/src/admin/access.ts`, `worker/src/admin/views/layout.tsx`, `worker/vitest.admin.config.ts`,
`worker/package.json` (dipendenza `jose`, script), test `worker/test/admin_access.test.ts`,
`worker/test/admin_pages.test.ts`.

## Acceptance criteria
- **AC-1** — Given una richiesta a `GET /catalogo` senza JWT, then **401** e nessun dato; given un JWT
  non valido (firma, `aud` o scadenza), then **401**; given un JWT valido ma senza email autorizzata,
  then **403**; given un JWT valido con email, then **200** (FR-93).
- **AC-2** — Given una richiesta `POST` senza `Origin` o con `Origin` diversa da `ADMIN_ORIGIN`, then
  **403** e nessuna modifica; con `Origin` corretta, then la richiesta prosegue (NFR-27).
- **AC-3** — Given una risposta del backoffice, then contiene `Cache-Control: no-store`, la CSP e
  `X-Content-Type-Options: nosniff`; nessun header CORS (NFR-28).
- **AC-4** — Given `GET /`, then 302 verso `/catalogo`; `GET /catalogo`, `/esecuzioni`, `/registro`
  rispondono 200 con il layout e i titoli in italiano (FR-92, NFR-10), anche se i contenuti sono
  segnaposto.
- **AC-5** — Given `wrangler deploy --dry-run -c wrangler.admin.jsonc`, then la build riesce e il
  Worker non espone `HISTORY` né variabili Open-Meteo (FR-118, NFR-28).
- **AC-6** — Given l'API pubblica, when si eseguono i suoi test, then nessun test cambia; il Worker
  admin non aggiunge route all'origine pubblica (FR-95, NFR-28).
- **AC-7** — `npm test` (entrambi i progetti) e `npm run typecheck` verdi.

## Tasks
- [x] Scrivere i test falliti con `AccessVerifier` finto e richieste HTTP (AC-1..AC-4)
- [x] Creare `wrangler.admin.jsonc`, l'entry Hono e il layout SSR minimale (AC-4, AC-5)
- [x] Implementare `access.ts` con verifica JWT/JWKS e i codici 401/403 (AC-1)
- [x] Implementare il controllo `Origin`/`Referer` e gli header di sicurezza (AC-2, AC-3)
- [x] Configurare il progetto Vitest admin e aggiornare `npm test` (AC-7)
- [x] Eseguire `npm test` e `npm run typecheck` (AC-6, AC-7)

## Dev notes
- **File**: `worker/wrangler.admin.jsonc` (origine propria, binding `CORE`/`FORECASTS`, vars Access),
  `worker/src/admin/env.ts`, `worker/src/admin/access.ts` (verifica JWT con `jose`), `worker/src/admin/index.tsx`,
  `worker/src/admin/views/layout.tsx`, `worker/vitest.admin.config.ts`, `worker/test-admin/**`, `worker/package.json`
  (`jose`, script `test:worker`/`test:admin`, `test` esegue entrambi), `worker/tsconfig.json` (JSX).
- L'entry del Worker admin è `.tsx` (JSX non trasformato nei `.ts`), `main: src/admin/index.tsx`.
- Test in un progetto Vitest separato (`test-admin/`, `vitest.admin.config.ts`); il progetto principale
  include solo `test/**`.
- `ACCESS_AUD` è vuoto nel config finché non si crea l'applicazione Access (runbook): senza aud il
  verificatore rifiuta con 401 (fail-closed).
- Verifica: `npm test` (305 + 12), `npm run typecheck`, `wrangler deploy --dry-run -c wrangler.admin.jsonc`
  (bundle 126 KiB; binding solo `FORECASTS`, `CORE` e le tre vars).


## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
### 2026-11-02 — verdict: done
Verify: `npm test` (305 test Worker + 12 admin), `npm run typecheck`, dry-run del Worker admin. AC-1..AC-7
coperti: 401 senza JWT, 401/403 con identità finta, controllo Origin/Referer, header di sicurezza,
redirect e pagine, assenza di `HISTORY`/Open-Meteo nel bundle admin. Nessun blocker.
