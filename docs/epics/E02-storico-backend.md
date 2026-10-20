---
id: E02
title: "Storico giornaliero su D1: scrittura dal job e API GET /history"
status: planned
requirements: [FR-69, FR-70, FR-71, FR-72, FR-73, FR-74, FR-75, FR-76, FR-77, FR-78, FR-79, FR-80, FR-81, FR-82]
---

# E02: Storico giornaliero su D1: scrittura dal job e API `GET /history`

## Value
Il backend conserva, per ogni località e per ogni giorno, le previsioni del giorno stesso (giorno 0)
in Cloudflare D1 e le espone in sola lettura con `GET /history`, per giorno o aggregate per mese.
Un client (l'app, epic E03) può così mostrare l'andamento passato delle condizioni previste. I valori
sono **previsioni, non misure** (FR-82). Il cache KV delle previsioni, `/forecast`, `/health` e
`/locations` restano invariati (FR-81).

Riferimenti di progetto: ADR-0002 (schema, scrittura, lettura), `docs/architecture.md` §3 (flusso del
job, punto 8), §4 (modello dati), §5 (interfaccia `/history` e configurazione).

## Stories
| ID | Title | Depends on | Status |
|---|---|---|---|
| E02-S01 | Migrazione D1, binding `HISTORY` e verifica del supporto SQL in Miniflare | — | ready |
| E02-S02 | Scrittura a blocchi dello storico nel job `scheduled` | E02-S01 | ready |
| E02-S03 | `GET /history` con granularità `day` (validazione, 404, 503) | E02-S02 | ready |
| E02-S04 | `GET /history` con granularità `month`, `Cache-Control` e rifinitura errori | E02-S03 | ready |
| E02-S05 | Documentazione API, README e runbook (setup D1, attivazione, `d1_size`) | E02-S02, E02-S04 | ready |
| E02-S06 | Debito tecnico trasversale (nessun FR): migrazione test runner a `@cloudflare/vitest-plugin` | — | ready |

Ordine di esecuzione: S01, S02, S03, S04, S05 (sequenziale; S03 dipende da S02 perché estende
`history.ts` e `history_store.ts` creati lì).

## Copertura dei requisiti
FR-69, FR-70, FR-71, FR-72, FR-73: S01 (schema), S02 (scrittura). FR-74, FR-75, FR-77, FR-78, FR-80:
S03. FR-76, FR-79: S04. FR-81: verificato in ogni storia (test esistenti verdi senza modifiche alle
fixture). FR-82: S05.

## Out of scope
- Backfill dello storico, grandezze diverse da FR-69, giorni di previsione successivi al giorno 0.
- Cancellazione automatica di righe (OQ-36), replica di lettura D1, cache al bordo con Cache API.
- Schermata e client nell'app (epic E03).
- Migrazione del pool di test al nuovo plugin (TODO E01-S08): le storie S01-S05 usano il pool in uso;
  la migrazione è la storia indipendente E02-S06 (debito tecnico, senza FR).
