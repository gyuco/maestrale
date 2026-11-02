---
id: E05
title: "Backoffice di amministrazione: catalogo su D1, registri ed Esegui ora"
status: done
requirements: [FR-41, FR-42, FR-61, FR-62, FR-63, FR-92, FR-93, FR-94, FR-95, FR-96, FR-97, FR-98, FR-99, FR-100, FR-101, FR-102, FR-103, FR-104, FR-105, FR-106, FR-107, FR-108, FR-109, FR-110, FR-111, FR-112, FR-113, FR-114, FR-115, FR-116, FR-117, FR-118, FR-119, FR-120, FR-121, NFR-13, NFR-19, NFR-27, NFR-28, NFR-29, NFR-30, NFR-31, NFR-32, NFR-33]
---

# E05: Backoffice di amministrazione

## Value
Gli amministratori (1–3 persone, browser desktop) gestiscono il catalogo località senza commit né
deploy e diagnosticano le esecuzioni del job da un unico punto protetto: aggiunta, modifica,
disattivazione e riattivazione delle località, elenco e dettaglio delle esecuzioni con località fallite
e messaggi, registro delle operazioni e "Esegui ora" su tutte le località o su una sola (scenari S-8,
S-9, S-10 del PRD; FR-92..FR-121).

Riferimenti: PRD v0.7 §5.13–5.18 e NFR-27..NFR-33; `docs/architecture.md` §3–§5; ADR-0006
(catalogo D1 + cache), ADR-0007 (Worker admin + Access), ADR-0008 (registri), ADR-0009 (Esegui ora),
ADR-0010 (snapshot app), ADR-0011 (località iniziale per slug). Runbook: sezione "Catalogo località e
backoffice".

> **Nota di gate**: `docs/architecture.md` è `draft` (ADR-0006..0011 `proposed`). Le storie sono
> pronte ma non vanno avviate prima dell'approvazione dell'architettura da parte dell'owner; se un
> ADR cambia, le storie che lo citano vanno riviste.

## Stories
| ID | Title | Depends on | Status |
|---|---|---|---|
| E05-S01 | Schema D1 `CORE`, seed del catalogo e validazione pura | — | done |
| E05-S02 | Lettura del catalogo da KV/D1 e 503 quando non disponibile | S01 | done |
| E05-S03 | Worker `maestrale-admin`: scheletro, Cloudflare Access, header di sicurezza | S01 | done |
| E05-S04 | Backoffice: elenco del catalogo con filtri e conteggi | S03 | done |
| E05-S05 | Backoffice: aggiunta di una località con validazione | S04 | done |
| E05-S06 | Backoffice: modifica di `name` e coordinate con controllo di versione | S05 | done |
| E05-S07 | Backoffice: disattivazione e riattivazione con conferma | S06 | done |
| E05-S08 | Backoffice: registro delle operazioni | S05 | done |
| E05-S09 | Job: registro delle esecuzioni (esiti, fallimenti, coerenza con `/health`) | S01 | done |
| E05-S10 | Backoffice: elenco paginato e dettaglio delle esecuzioni | S09, S03 | done |
| E05-S11 | "Esegui ora": richiesta, rifiuti e registrazione | S09, S08, S04 | done |
| E05-S12 | Dispatcher a cron: claim, lease, watchdog, retention, riparazione cache | S11, S02, S09 | done |
| E05-S13 | App: località iniziale per slug con migrazione una tantum | — | done |
| E05-S14 | Snapshot dell'app dal database e aggiornamento CI | S01 | done |

Ordine consigliato: S01 → S02 → S03 → S04 → S05 → S06 → S07 → S08 → S09 → S10 → S11 → S12;
S13 e S14 sono indipendenti e possono procedere in parallelo.

## Copertura dei requisiti
- **S01**: FR-1, FR-2, FR-61 (schema), FR-98, FR-104, NFR-33 (lato storage).
- **S02**: FR-61, FR-101, FR-120, NFR-19, NFR-33.
- **S03**: FR-93, FR-118, NFR-13, NFR-27, NFR-28.
- **S04**: FR-92, FR-96.
- **S05**: FR-97, FR-98.
- **S06**: FR-99, FR-103.
- **S07**: FR-100, FR-119.
- **S08**: FR-113, NFR-29.
- **S09**: FR-102, FR-105, FR-106, FR-110, FR-111, NFR-32.
- **S10**: FR-107 (visualizzazione), FR-108, FR-109, NFR-31.
- **S11**: FR-114, FR-115, FR-116.
- **S12**: FR-107 (chiusura), FR-112, NFR-30.
- **S13**: FR-41, FR-42, FR-117.
- **S14**: FR-65, FR-104, ADR-0010.
- **Trasversali verificati in ogni storia**: FR-95 (additività: test di parità esistenti verdi senza
  modifiche alle fixture), NFR-10 (testi in italiano), NFR-13 (test senza account Cloudflare).

## Out of scope
- Export/import in blocco del catalogo e backup dal backoffice (FR-121: backup operativo).
- Notifiche/allerte (OQ-4), ruoli diversi da amministratore, gestione utenti (OQ-38, FR-94).
- Consultazione dei log delle richieste API e modifica di altri parametri di configurazione.
- Più di 500 località (FR-98: solo avviso) e fan-out del job.

## Rischi di piano
- **Architettura non approvata**: blocca l'avvio; il piano è coerente con la v0.6 ma può cambiare.
- **S01 tocca lo schema condiviso**: se le tabelle dei registri cambiano (ADR-0008/0009), S09–S12
  vanno aggiornate.
- **S12 è l'unica storia con un cron nuovo**: da sola non cambia l'API pubblica, ma va verificata con
  `RUN_DISPATCH_ENABLED=false` nei test di parità.
