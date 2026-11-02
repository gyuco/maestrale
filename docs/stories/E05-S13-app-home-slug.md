---
id: E05-S13
epic: E05
title: "App: località iniziale per slug con migrazione una tantum"
type: feature
status: done
requirements: [FR-41, FR-42, FR-117]
depends_on: []
verify:
  - cd app && flutter analyze
  - cd app && flutter test
---

# E05-S13: App: località iniziale per slug con migrazione una tantum

## Context
Oggi l'app salva il **nome** della località iniziale e lo confronta senza distinzione di maiuscole
(`app/lib/screens/forecast_screen.dart`, `_restoreHomeLocation`, `_setCurrentLocationAsHome`,
`_isHomeLocation`). Con lo slug immutabile (FR-99) e il nome modificabile, l'app deve salvare lo slug
e convertire una volta il valore vecchio.

**Requisiti (testo operativo)**
- FR-41: "Stabilisci come pagina iniziale" salva la località mostrata; da v0.6.1 salva lo **slug**
  (`location.slug` della previsione) e il confronto avviene per slug; la conferma mostra il nome.
- FR-42: all'avvio, se esiste una preferenza, l'app precompila il campo con il **nome corrente** e
  carica la previsione con lo **slug** (`/forecast?localita=<slug>`); se la località è disattivata,
  mostra l'errore 404 di FR-33 e resta utilizzabile.
- FR-117: se la preferenza è nel formato precedente (un nome), l'app la converte **una sola volta**
  nello slug della località il cui slug o nome normalizzato (FR-22) coincide; se nessuna corrisponde,
  la preferenza resta invariata e la conversione è ritentata all'avvio successivo (OQ-54).

**Decisioni architetturali (ADR-0011)**
- `HomeLocationStore` resta una stringa; ora contiene lo **slug**.
- Funzione pura `resolveSavedHomeLocation(String saved, LocationCatalog catalog) → String?`:
  1. `saved` è uno slug del catalogo → restituisce `saved`;
  2. esiste una sola località con nome normalizzato uguale a `normalizeText(saved)` → restituisce il
     suo slug;
  3. altrimenti `null` (nessuna scrittura, si ritenta).
- La risoluzione usa il catalogo del `LocationRepository` già iniettato nella schermata
  (`widget.locationRepository.catalog.value`, FR-65/FR-67), quindi funziona anche offline con la copia
  locale o lo snapshot.
- Al salvataggio si scrive `_forecast.location.slug`; la snackbar mostra `location.name`.

**File probabili**: `app/lib/services/home_location.dart` (nuovo, funzione pura),
`app/lib/screens/forecast_screen.dart` (`_restoreHomeLocation`, `_setCurrentLocationAsHome`,
`_isHomeLocation`, campo di ricerca), test `app/test/home_location_test.dart`,
`app/test/forecast_screen_home_test.dart` (o estensione dei test esistenti).

## Acceptance criteria
- **AC-1** — Given una previsione caricata, when si preme "Stabilisci come pagina iniziale", then
  `HomeLocationStore.save` riceve lo **slug** (non il nome) e la snackbar mostra il nome (FR-41).
- **AC-2** — Given una preferenza che è già uno slug, when l'app si avvia, then il campo mostra il
  nome corrente del catalogo e la richiesta `/forecast` usa lo slug; nessuna scrittura della preferenza
  (FR-42, FR-117 regola 1).
- **AC-3** — Given una preferenza con il vecchio **nome** ("Torre dei Corsari"), then viene convertita
  nello slug ("torre-dei-corsari"), salvata, e la richiesta usa lo slug (FR-117 regola 2).
- **AC-4** — Given una preferenza con nome e maiuscole/accenti ("Chia"), then la conversione usa la
  forma normalizzata di FR-22 (FR-117).
- **AC-5** — Given una preferenza che non corrisponde ad alcuna località, then resta invariata,
  l'app usa il valore salvato come prima (richiesta con quel valore, 404 gestito da FR-33) e la
  conversione è ritentata all'avvio successivo (FR-117, OQ-54).
- **AC-6** — Given una località disattivata, then all'avvio la richiesta con lo slug produce 404 e
  l'app mostra l'errore di FR-33 senza bloccarsi (FR-42).
- **AC-7** — Il confronto "è la pagina iniziale" avviene per slug: una rinomina del nome non cambia lo
  stato del pulsante (FR-41).
- **AC-8** — `flutter analyze` e `flutter test` verdi; i test esistenti della località iniziale
  aggiornati al nuovo formato, senza regressioni sugli altri.

## Tasks
- [x] Scrivere i test falliti della funzione pura (AC-1..AC-5) e del widget (AC-6, AC-7)
- [x] Implementare `resolveSavedHomeLocation` con le tre regole
- [x] Aggiornare salvataggio, ripristino e confronto in `forecast_screen.dart` (AC-1, AC-2, AC-7)
- [x] Gestire il caso non risolvibile senza bloccare l'avvio (AC-5, AC-6)
- [x] Eseguire `flutter analyze` e `flutter test` (AC-8)

## Dev notes
- **File**: `app/lib/services/home_location.dart` (`resolveSavedHomeLocation`),
  `app/lib/screens/forecast_screen.dart` (ripristino, salvataggio, confronto per slug, `_search(query:)`),
  `app/test/home_location_test.dart`, `app/test/widget_test.dart` aggiornato.
- La preferenza salvata ora è lo slug; la migrazione avviene all'avvio con il catalogo del repository
  (anche offline). Se non risolve, il valore resta invariato e si ritenta al prossimo avvio (OQ-54).
- Verifica: `flutter analyze`, `flutter test` (116 test).

## Run log
<!-- Autopilot: iteration | command | result | note -->

## Review log
### 2026-11-02 — verdict: done
AC-1..AC-8 coperti: salvataggio slug, ripristino con nome corrente, conversione nome→slug, forma
normalizzata, preferenza non risolvibile, località disattivata (404), confronto per slug. Nessun
blocker.
