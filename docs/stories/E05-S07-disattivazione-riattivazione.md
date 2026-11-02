---
id: E05-S07
epic: E05
title: "Backoffice: disattivazione e riattivazione con conferma"
type: feature
status: done
requirements: [FR-100, FR-119]
depends_on: [E05-S06]
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
---

# E05-S07: Backoffice: disattivazione e riattivazione con conferma

## Context
La rimozione è una **disattivazione riattivabile**: la voce e lo storico restano, l'API pubblica la
tratta come sconosciuta, il job la salta. La riattivazione la ripristina, ma `/forecast` risponde 503
finché il job non l'ha aggiornata.

**Requisiti (testo operativo)**
- FR-100: disattivazione previa conferma esplicita che mostra slug e nome. Dopo (ritardo FR-101): la
  località non compare in `GET /locations` né in `detail.available`; `/forecast` e `/history`
  rispondono 404 come per una sconosciuta; il job non la aggiorna; la voce e i record di storico
  restano nel database; nessuna funzione cancella definitivamente una località.
- FR-119: riattivazione previa conferma, con la validazione di FR-98 sui valori correnti; dopo, la
  località torna in `GET /locations`, è risolta da `/forecast` e `/history` con lo stesso slug e il job
  la aggiorna dalla prima esecuzione successiva; `/history` restituisce anche i record precedenti.
  Finché non è aggiornata, `/forecast` risponde **503** "Previsioni non ancora disponibili" (OQ-53).

**Decisioni architetturali (ADR-0006)**
- `GET /catalogo/:slug/disattiva` e `/riattiva` mostrano la pagina di conferma con slug e nome;
  `POST` esegue l'aggiornamento (`active = 0/1`, `version + 1`, `catalog_meta.version + 1`), scrive
  `admin_actions` (`deactivate`/`reactivate`, `before_json`/`after_json`) e ricostruisce
  `catalog:current`.
- Alla **riattivazione** il backoffice elimina la chiave `forecast:<slug>`: così `/forecast` non serve
  la previsione precedente alla disattivazione ma risponde 503 fino al primo aggiornamento riuscito
  (FR-119). Lo storico (`daily_history`) non viene toccato.
- Slug sconosciuto → 404; disattivare una già disattivata o riattivare una già attiva → `409`/messaggio,
  nessuna scrittura.
- Tutte le scritture passano dal controllo dell'origine di S03.

**File probabili**: `worker/src/admin/routes/catalogo.ts`,
`worker/src/admin/views/catalogo_confirm.tsx`, `worker/src/admin/actions.ts`,
test `worker/test/admin_catalogo_status.test.ts`.

## Acceptance criteria
- **AC-1** — Given una località attiva, when si apre la pagina di disattivazione, then mostra slug e
  nome e un pulsante di conferma; con `POST` then 303, `active = 0`, `version` avanzata e voce
  `admin_actions` `deactivate` con i valori prima/dopo (FR-100, FR-113).
- **AC-2** — Given una località disattivata, when arriva `GET /locations`, then non compare; `GET
  /forecast?localita=<slug>` e `/history` rispondono 404 con lo stesso formato di una sconosciuta; il
  job non la include nell'elenco delle località da aggiornare (FR-100).
- **AC-3** — Given una località disattivata, when la si riattiva, then 303, `active = 1`, voce
  `admin_actions` `reactivate`, e `GET /locations` la include di nuovo (FR-119).
- **AC-4** — Given una località riattivata con una previsione vecchia ancora in KV, when arriva `GET
  /forecast`, then **503** "Previsioni non ancora disponibili" (la chiave `forecast:<slug>` è stata
  eliminata) e `/history` restituisce i record precedenti (FR-119).
- **AC-5** — Given valori correnti non più validi (es. nome che collide con una località aggiunta nel
  frattempo), then la riattivazione è rifiutata con errore per campo e nessuna scrittura (FR-119,
  FR-98).
- **AC-6** — Given uno slug inesistente, then 404; given una località già nello stato richiesto, then
  messaggio e nessuna scrittura.
- **AC-7** — `npm test` e `npm run typecheck` verdi.

## Tasks
- [x] Scrivere i test falliti (AC-1..AC-6) con D1 e KV di Miniflare
- [x] Implementare le pagine di conferma e i POST con controllo di stato
- [x] Aggiornare la cache del catalogo e cancellare `forecast:<slug>` alla riattivazione (AC-4)
- [x] Registrare le operazioni con valori prima/dopo (AC-1, AC-3)
- [x] Eseguire `npm test` e `npm run typecheck` (AC-7)

## Dev notes
- **File**: `worker/src/admin/views/catalogo_confirm.tsx`, `GET|POST /catalogo/:slug/disattiva|riattiva`,
  `worker/test-admin/admin_catalogo_status.test.ts`.
- Le transizioni sono condizionate a `active = stato atteso` e `version = versione letta`; una
  transizione persa → 409 senza scritture.
- Alla riattivazione si elimina `forecast:<slug>` (FR-119): `/forecast` risponde 503 fino al primo
  aggiornamento riuscito. Nessuna cancellazione di storico.
- Verifica: `npm test`, `npm run typecheck`.

## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
### 2026-11-02 — verdict: done
AC-1..AC-7 coperti: conferma con slug/nome, effetti su cache, 404 pubblico (via cache), riattivazione
con cancellazione della previsione, 409 sugli stati già raggiunti, validazione FR-98 alla
riattivazione. Nessun blocker.
