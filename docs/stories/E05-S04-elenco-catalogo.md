---
id: E05-S04
epic: E05
title: "Backoffice: elenco del catalogo con filtri e conteggi"
type: feature
status: done
requirements: [FR-92, FR-96]
depends_on: [E05-S03]
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
---

# E05-S04: Backoffice: elenco del catalogo con filtri e conteggi

## Context
Prima pagina utile del backoffice: l'elenco completo delle località, attive e disattivate, con lo
stato e i conteggi, ordinato per nome e filtrabile. Le azioni arrivano in S05–S07.

**Requisiti (testo operativo)**
- FR-96: elenco di **tutte** le località con `slug`, `name`, `latitude`, `longitude` e numero totale;
  le disattivate hanno il proprio stato; il numero di località **attive** è riportato a parte; le
  attive hanno lo stesso contenuto che `GET /locations` serve dopo il ritardo di FR-101.
- OQ-46 risolta: ordinamento per `name`; filtro per testo contenuto in nome o slug; filtro per stato
  (attive / disattivate / tutte); fino a 500 località **nessuna paginazione**.
- NFR-10: testi in italiano; NFR-31: p95 < 1 s (proposta) con 500 righe.

**Decisioni architetturali (ADR-0007 §Pagine)**
- `GET /catalogo?q=&stato=` renderizzato lato server; una sola query D1 su `locations` (tutte le
  righe), filtro e ordinamento in memoria (500 righe ≈ trascurabili).
- La pagina mostra i conteggi `totale` e `attive`, la tabella con stato e i link alle azioni; nessun
  bottone di scrittura attivo finché S05–S07 non ci sono (o link alla pagina di aggiunta, se già
  presente come segnaposto).
- `stato` accetta `attive` (default), `disattivate`, `tutte`; un valore sconosciuto vale `attive`.

**File probabili**: `worker/src/admin/routes/catalogo.ts` (nuovo o esteso),
`worker/src/admin/views/catalogo_list.tsx`, `worker/src/admin/catalog_queries.ts` (lettura),
test `worker/test/admin_catalogo_list.test.ts`.

## Acceptance criteria
- **AC-1** — Given 13 località di cui 2 disattivate, when arriva `GET /catalogo`, then la tabella
  mostra tutte e 13 le righe con slug, nome, coordinate e stato, in ordine di `name` crescente, e i
  conteggi "13 totali" e "11 attive" (FR-96).
- **AC-2** — Given `?q=tor`, then restano solo le località il cui nome o slug contiene "tor"
  (case-insensitive) e i conteggi restano quelli del catalogo, non del filtro.
- **AC-3** — Given `?stato=disattivate`, then solo le 2 disattivate; `?stato=tutte` → 13;
  `?stato=altro` → come `attive`; il filtro testo e lo stato si combinano.
- **AC-4** — Given 500 località, then la pagina risponde 200 e contiene 500 righe (nessuna
  paginazione) in meno di 1 s nel test (NFR-31, misurato in modo grossolano).
- **AC-5** — Given una località disattivata, then la riga ha un'etichetta "Disattivata" distinta e
  non compare nell'elenco delle attive.
- **AC-6** — Given l'elenco, then le attive hanno lo stesso contenuto che `GET /locations` serve
  (stessi slug e nomi) (FR-96).
- **AC-7** — `npm test` e `npm run typecheck` verdi.

## Tasks
- [x] Scrivere i test falliti (AC-1..AC-6) con D1 `CORE` di Miniflare e identità finta
- [x] Implementare la lettura delle località (tutte e attive) e i conteggi
- [x] Implementare la pagina SSR con filtri `q`/`stato`, ordinamento e stato vuoto
- [x] Eseguire `npm test` e `npm run typecheck` (AC-7)

## Dev notes
- **File**: `worker/src/catalog_store.ts` (`listLocations`, `filterLocations`, `parseStato`),
  `worker/src/admin/views/catalogo_list.tsx`, `worker/src/admin/routes/catalogo.tsx`,
  `worker/test-admin/admin_catalogo_list.test.ts`.
- Filtro e ordinamento in memoria su 500 righe (una sola query, nessuna paginazione).
- Verifica: `npm test`, `npm run typecheck`.

## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
### 2026-11-02 — verdict: done
AC-1..AC-7 coperti: conteggi separati, ordine per nome, filtri testo/stato combinati, 500 righe senza
paginazione, stato vuoto. Nessun blocker.
