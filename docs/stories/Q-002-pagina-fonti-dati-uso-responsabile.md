---
id: Q-002
epic: none
title: Pagina informativa su fonti dei dati e uso responsabile
type: quick
status: done
requirements: [FR-122, NFR-7, FR-90]
depends_on: []
verify:
  - cd app && flutter analyze
  - cd app && flutter test
---

# Q-002: Pagina informativa su fonti dei dati e uso responsabile

## Context
Richiesta dell'owner (2026-11-02): l'app deve avere una **pagina di disclaimer** che
informi sulla **fonte dei dati** e sull'**uso responsabile** delle previsioni.

Stato attuale:

- l'app Flutter (`app/`) mostra previsioni marine/meteo da `GET /forecast` e lo storico
  da `GET /history`; i dati provengono da **Open-Meteo** (Marine + Weather Forecast,
  modello `best_match`), come dichiarato in `worker/src/data_sources.ts`
  (`attribution`: "Marine data by Open-Meteo.com" / "Weather data by Open-Meteo.com",
  `licenseUrl`: `https://open-meteo.com/en/terms`).
- la mappa (`app/lib/screens/coastal_map_screen.dart`, riga ~529) mostra l'attribuzione
  "OpenStreetMap contributors" tramite `SimpleAttributionWidget`, ma non c'è una pagina
  che spieghi in modo organico provenienza e limiti dei dati.
- NFR-7 impone l'attribuzione Open-Meteo nelle risposte `/forecast` e l'attribuzione
  OpenStreetMap nella mappa; l'attribuzione Open-Meteo **nell'UI dell'app** era assente
  (OQ-9). Lo storico mostra già la nota FR-90 "Valori previsti per il giorno stesso,
  non misure osservate".
- Non esistono dipendenze per aprire URL esterni (`url_launcher` assente): la pagina
  mostra gli URL come testo selezionabile/copiabile, senza nuova dipendenza.

La pagina deve essere raggiungibile dalla schermata principale in ogni stato (benvenuto,
previsione, errore) e deve essere scrollabile e leggibile anche con testo grande.

## Acceptance criteria
- **AC-1** — Given la schermata principale dell'app in uno qualsiasi dei suoi stati
  (benvenuto, previsione caricata, errore), when l'utente tocca il comando
  "Fonti dei dati e uso responsabile", then si apre la pagina informativa e il tasto
  indietro riporta alla schermata principale.
- **AC-2** — La pagina indica le fonti dei dati: Open-Meteo Marine Weather API e
  Open-Meteo Weather Forecast API, con attribuzione, licenza/condizioni d'uso
  (`https://open-meteo.com/en/terms`), e le tile OpenStreetMap come fonte della mappa
  (`https://www.openstreetmap.org/copyright`).
- **AC-3** — La pagina spiega l'uso responsabile: le previsioni sono indicative e non
  sostituiscono i bollettini/avvisi ufficiali delle autorità competenti; non vanno usate
  come unica fonte per la sicurezza in mare; in caso di pericolo chiamare il 112.
- **AC-4** — La pagina chiarisce che i valori sono **previsioni, non misure** osservate
  (anche per lo storico, FR-90) e che il modello Open-Meteo può cambiare nel tempo.
- **AC-5** — Il comando di apertura è visibile senza previsioni caricate e non effettua
  richieste di rete.

## Tasks
- [x] Write failing tests for AC-1..AC-5
- [x] Implement AC-1..AC-5
- [x] Run verify commands

## Dev notes
Decisione: la pagina è raggiungibile da un **collegamento a fondo pagina** nella schermata
principale ("Fonti dei dati e uso responsabile", `Key('open-disclaimer-button')`), con sotto
la riga di attribuzione "Dati meteo: Open-Meteo · Mappa: OpenStreetMap contributors".
Scelta rispetto a una terza icona nella barra superiore: la barra ha già due pulsanti
(mappa, storico) e resta leggibile su schermi stretti; il footer è presente in ogni stato
della schermata (benvenuto, previsione, errore).

Cambi:
- `app/lib/screens/disclaimer_screen.dart`: nuova pagina `DisclaimerScreen` con sezioni
  "Le fonti dei dati", "Mappa e catalogo", "Previsioni, non misure", "Uso responsabile",
  "Aggiornamento e disponibilità". Gli URL sono `SelectableText` (nessuna nuova dipendenza
  `url_launcher`).
- `app/lib/screens/forecast_screen.dart`: import della pagina, `_openDisclaimer`,
  `_disclaimerFooter()` come ultimo sliver della home.
- `app/test/disclaimer_screen_test.dart`: test del contenuto (con scroll), della
  raggiungibilità dalla home e del ritorno indietro, con `requests == 0`.
- `docs/PRD.md` v0.7.2: FR-122, NFR-7 (attribuzione nell'UI), OQ-9 (parte sull'attribuzione
  risolta), changelog. La modifica è tracciata come richiesta owner del 2026-11-02.

Verify: `flutter analyze` pulito, `flutter test` 122/122 verdi.

## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
<!-- Reviewer: date, verdict, findings R-1… (blocker/should/nit) with file:line. -->

### 2026-11-02 — verdict: done (verify green, nessun blocker)

Verify eseguiti dal reviewer: `cd app && flutter analyze` → "No issues found!";
`cd app && flutter test` → 119/119 verdi (le due prove di Q-002 incluse, nessuno skip).

AC: AC-1 coperto dal test "dalla home si apre la pagina e si torna indietro"
(push + `pageBack`), AC-2/AC-3/AC-4 dal test del contenuto con scroll,
AC-5 dal footer raggiungibile senza previsione e da `expect(requests, 0)`.
Fatti verificati sul codice: fonti e `best_match` (`worker/src/data_sources.ts:31,138-153`),
cadenza 6 h (`worker/wrangler.jsonc:15`: `30 0,6,12,18 * * *`), cache KV (`/forecast`),
tile OSM (`app/lib/screens/coastal_map_screen.dart:476,528`), data/ora per previsione
(`app/lib/screens/forecast_screen.dart:776`), nessuna nuova dipendenza (`url_launcher` assente,
URL solo `SelectableText`). PRD v0.7.2 coerente: FR-122 in §5.19, NFR-7 e OQ-9 aggiornate,
changelog e banner di versione allineati; diff limitato a PRD + `forecast_screen.dart` (footer).

- **R-1** `should` — `app/lib/screens/disclaimer_screen.dart:41-43`: "senza modificarne i
  valori" non è accurato. Il backend aggrega e deriva i valori esposti
  (`worker/src/aggregate.ts:119,125,232`: `mean`, `circular_mean`, `maxOfValidNumbers`,
  classificazione `sea_state`, `direction_name`), quindi i numeri mostrati per il giorno
  sono in parte calcolati da Maestrale. Fix atteso: "elaborate a partire dai dati di
  Open-Meteo; gli indicatori derivati (es. stato del mare, direzione del vento) sono
  calcolati da Maestrale".
- **R-2** `should` — `app/test/disclaimer_screen_test.dart:68-106`: è coperto solo lo stato
  "benvenuto" (il `MockClient` non riceve richieste: `requests == 0`, nessuna home salvata →
  `_body()` ritorna `_WelcomeCard`, `forecast_screen.dart:504-506`). FR-122
  (`docs/PRD.md:465`) richiede la pagina "in ogni stato (benvenuto, previsione, errore)":
  mancano i test con previsione caricata e con errore (stato `_error`, riga 490), e AC-1
  non recepisce "ogni stato". Fix atteso: estendere AC-1 e aggiungere i due casi,
  asserendo footer visibile, apertura della pagina e `requests` invariato.
- **R-3** `should` — `app/lib/screens/disclaimer_screen.dart:56,72`: le affermazioni di
  licenza "CC BY 4.0" e "ODbL" non sono riscontrabili in `docs/PRD.md` /
  `docs/architecture.md` (il resto del progetto cita solo `licenseUrl`), mentre
  `docs/PRD.md:609-610` tiene aperto il vincolo d'uso dei provider e il fornitore di tile
  (OQ-9), e l'app emette già il warning flutter_map sulla OSM Tile Usage Policy. Fix atteso:
  documentare la fonte delle due licenze (PRD/architecture, come per `data_sources.ts`) e
  citare la policy d'uso delle tile, oppure limitarsi al rimando alle condizioni d'uso.
- **R-4** `nit` — `app/test/disclaimer_screen_test.dart:22-58`: le asserzioni coprono solo
  una stringa per sezione (`'112'`, `'non misure osservate'`), quindi una regressione su
  "bollettini/avvisi", "unica fonte", `best_match`, attribuzione "Open-Meteo.com" e
  attribuzione nel footer passerebbe inosservata. Fix suggerito: qualche
  `textContaining` in più sui punti chiave di AC-2/AC-3/AC-4.
- **R-5** `nit` — nessun test a larghezza ridotta o testo grande per il footer e la pagina.
  Verificato a mano che non c'è overflow strutturale (label di `TextButton.icon` in
  `Flexible`, `flutter/lib/src/material/text_button.dart:479`; titoli e bullet in `Expanded`,
  contenuto in `ListView`): un test a 320 dp / `textScaler` 1.3 sarebbe una regressione utile.
- **R-6** `nit` — `app/lib/screens/disclaimer_screen.dart:134` dichiara cadenza 6 h e cache
  mentre l'header della previsione mostra il badge "Live"
  (`app/lib/screens/forecast_screen.dart:659`, già tracciato in OQ-7): preesistente e fuori
  ambito, ma con questa pagina la contraddizione diventa più visibile.

R-1/R-2 non bloccano il `done` perché nessun AC è violato e la funzionalità richiesta è
presente e verde.

Follow-up (coder, 2026-11-02): applicati R-1..R-4 e R-5 (larghezza 320 dp):
- **R-1** risolto: il testo ora parla di dati aggregati e indicatori calcolati da Maestrale.
- **R-2** risolto: AC-1 esteso a "ogni stato"; aggiunti i test con previsione caricata e con
  errore.
- **R-3** risolto: FR-122 cita le licenze (Open-Meteo CC BY 4.0, OSM ODbL) e la pagina
  rimanda alle condizioni dei fornitori (fonti verificate su `open-meteo.com/en/terms` e
  `openstreetmap.org/copyright`).
- **R-4** risolto: aggiunte asserzioni su `best_match`, "bollettini" e "unica fonte".
- **R-5** risolto in parte: test a 320 dp; `textScaler` 1.3 resta non coperto.
- **R-6** lasciato: contraddizione preesistente col badge "Live" (OQ-7), fuori ambito.

Re-verify: `cd app && flutter analyze` pulito, `cd app && flutter test` 122/122 verdi.
Status resta `done`.

