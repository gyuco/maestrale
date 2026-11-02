---
id: Q-001
epic: none
title: Avvio senza località precaricata
type: quick
status: done
requirements: [FR-34, FR-67, FR-117]
depends_on: []
verify:
  - cd app && flutter analyze
  - cd app && flutter test
---

# Q-001: Avvio senza località precaricata

## Context
Oggi il campo di ricerca parte precompilato con "Torre dei Corsari"
(`app/lib/screens/forecast_screen.dart`, `_locationController`) e il pulsante
"Scopri le previsioni" avvia la ricerca di quel testo. Decisione dell'owner
(2026-11-02): all'avvio il campo deve essere **vuoto**; l'app cerca
automaticamente solo la località scelta dall'utente come iniziale
("Stabilisci come pagina iniziale", FR-41, FR-42, FR-117, salvata in
`HomeLocationStore`).

Comportamento atteso:
- primo avvio senza preferenza salvata: campo vuoto, schermata di benvenuto,
  nessuna richiesta `/forecast`;
- avvio con preferenza salvata: la località salvata viene caricata e cercata
  come oggi (`_restoreHomeLocation`);
- pulsante "Cerca" disabilitato finché il campo è vuoto;
- pulsante "Scopri le previsioni" con campo vuoto: porta il focus sul campo
  invece di avviare una ricerca vuota.

## Acceptance criteria
- **AC-1** — Given un primo avvio senza località iniziale salvata, then il
  campo di ricerca è vuoto e non parte alcuna richiesta `/forecast`.
- **AC-2** — Given un campo vuoto, then il pulsante "Cerca" è disabilitato e
  "Scopri le previsioni" non avvia richieste (sposta il focus sul campo).
- **AC-3** — Given una località iniziale salvata, when l'app si avvia, then
  viene cercata automaticamente e mostrata come prima.
- **AC-4** — Given un testo digitato nel campo, then il pulsante "Cerca" si
  abilita e la ricerca funziona come prima.

## Tasks
- [x] Write failing tests for AC-1..AC-4
- [x] Implement AC-1..AC-4
- [x] Run verify commands
- [x] Aggiornare PRD FR-34 e OQ-10 alla decisione dell'owner

## Dev notes
La modifica tocca una frase di FR-34 (testo precompilato con "Torre dei
Corsari") ed è quindi una decisione di requisito presa dall'owner; PRD
aggiornato a 0.7.1 con nota di modifica (FR-34, FR-67, OQ-10).

Cambi:
- `app/lib/screens/forecast_screen.dart`: `_locationController` parte vuoto;
  `_canSearch` aggiornato da un listener sul controller; il pulsante "Cerca"
  è disabilitato se il campo è vuoto o durante il caricamento; nuovo
  `_startSearch` usato da "Scopri le previsioni" che, a campo vuoto, porta il
  focus sul campo senza chiamare l'API. Il ripristino della località iniziale
  (FR-42, FR-117) è invariato.
- Test: nuovo caso "all avvio il campo è vuoto e non parte nessuna
  richiesta"; i test esistenti che premevano "Cerca" senza digitare ora
  inseriscono prima il testo.

Verify: `flutter analyze` pulito, `flutter test` 117/117 verdi.

## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
<!-- Reviewer: date, verdict, findings R-1… (blocker/should/nit) with file:line. -->

### 2026-11-02 — verdict: **done**

Verify: `cd app && flutter analyze` → No issues found; `cd app && flutter test` → 117/117 passed.

Acceptance criteria:
- **AC-1** ✅ campo vuoto (`forecast_screen.dart:43`), nessuna richiesta con store vuoto (`_restoreHomeLocation` esce prima di `_search`, `:111`); test `widget_test.dart:62` (prima della modifica il campo sarebbe stato non vuoto e il pulsante abilitato → rosso).
- **AC-2** ✅ `_canSearch` via listener (`:60`,`:64-67`), `onPressed: null` a campo vuoto/caricamento (`:370`), `_startSearch` porta il focus senza chiamare l'API (`:100-106`, usato da `_body` `:465`); asserzioni sul focus e su `requests == 0` nello stesso test.
- **AC-3** ✅ ripristino invariato (`:108-140`); test esistente `widget_test.dart:102` ancora verde.
- **AC-4** ✅ primo test esistente ora digita il testo e la ricerca parte dal pulsante (se il pulsante fosse rimasto disabilitato il test fallirebbe).

Architettura/scope: nessuna nuova dipendenza o pattern; modifiche limitate a schermata, test e PRD (FR-34, FR-67, OQ-10 + riga di changelog 0.7.1 coerente con la decisione owner). Nessun test indebolito: le modifiche ai test esistenti aggiungono solo `enterText` prima del tap.

Findings (non bloccanti):
- **R-1** `nit` — `app/lib/screens/forecast_screen.dart:118-121` e `:132-135` (e analogo `:178-182`): assegnare `_locationController.text` dentro `setState` notifica il listener `_onLocationChanged`, che chiama `setState` in modo annidato. Funziona, ma è fragile da leggere: atteso `_canSearch` impostato esplicitamente nello stesso `setState` (o assegnazione del testo fuori dal `setState`, lasciando al listener il compito di aggiornare lo stato).
- **R-2** `nit` — `app/test/widget_test.dart:37-43`: AC-4 è verificato solo indirettamente (se il pulsante restasse disabilitato la ricerca non partirebbe e il test fallirebbe). Un `expect(..., onPressed, isNotNull)` dopo `enterText`, più un caso "campo svuotato → 'Cerca' di nuovo disabilitato", renderebbe esplicito il requisito.
- **R-3** `nit` — frontmatter story `requirements: [FR-34, FR-117]`: la modifica PRD tocca anche FR-67 (e FR-42 resta il comportamento correlato). Aggiungere FR-67 per tracciabilità.

Verdict rationale: nessun blocker, verify verde, AC-1..AC-4 coperti da test che falliscono senza il cambiamento → `done`.

Follow-up (coder, 2026-11-02): applicati i tre nit — testo del controller
assegnato fuori dal `setState` (R-1), asserzioni esplicite su pulsante
abilitato/disabilitato al variare del testo (R-2), FR-67 aggiunto ai
`requirements` (R-3). Re-verify: `flutter analyze` pulito, `flutter test`
117/117 verdi. Status resta `done`.
