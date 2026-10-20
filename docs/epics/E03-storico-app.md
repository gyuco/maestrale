---
id: E03
title: "Schermata storico nell'app Flutter"
status: planned
requirements: [FR-83, FR-84, FR-85, FR-86, FR-87, FR-88, FR-89, FR-90, FR-91]
---

# E03: Schermata storico nell'app Flutter

## Value
Dalla schermata previsioni l'utente apre lo storico della località mostrata, sceglie "7 giorni",
"30 giorni", "12 mesi" o un intervallo personalizzato, la granularità giorno/mese, e vede grafico
(aria media, banda min/max, mare medio), stato del mare e tabella dei valori previsti, con la nota
che si tratta di previsioni del giorno e non di misure (scenario S-7 della PRD).

Riferimenti di progetto: ADR-0002 §4, `docs/architecture.md` §3 (componenti app) e §5 ("App:
schermata storico"). Il contratto HTTP di `/history` è quello di E02 (architettura §5).

## Stories
| ID | Title | Depends on | Status |
|---|---|---|---|
| E03-S01 | Modelli storico, `api_errors.dart`, `rome_date.dart` e `HistoryApi` con `http.Client` iniettabile | — | ready |
| E03-S02 | Schermata storico: preset, selettore date, granularità, stati, nota, comando "Storico" | E03-S01 | ready |
| E03-S03 | Grafico `fl_chart`, fascia stato del mare e tabella | E03-S02 | ready |

Ordine di esecuzione: S01, S02, S03. Le storie E03 sono testabili senza backend reale (client HTTP
finto); per lo smoke test contro il Worker servono E02-S03/S04 completate: ordine consigliato
E02 prima di E03, ma non vincolante per i test.

## Copertura dei requisiti
FR-91: S01. FR-83, FR-84, FR-85, FR-86, FR-89, FR-90: S02. FR-87, FR-88: S03 (FR-90 visibile anche
nel grafico, verificato in S03).

## Out of scope
- Cache offline dello storico, grandezze diverse da FR-69, notifiche.
- Modifiche a backend, `/forecast`, catalogo (comportamento di `ForecastApi` invariato).
