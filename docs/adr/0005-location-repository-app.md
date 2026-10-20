---
id: ADR-0005
status: accepted     # proposed | accepted | superseded by ADR-XXXX
date: 2026-10-20
---

# ADR-0005: LocationRepository nell'app, snapshot di primo avvio e clustering della mappa

Allineato al PRD v0.4: snapshot incluso nell'app (OQ-26 risolta, C-6) e comportamento di FR-65
riformulato dall'owner (copia locale o snapshot subito, poi rete).

## Context
- **FR-65** (mod. 0.4): un solo componente (LocationRepository) che (1) fornisce **subito**, senza
  attendere la rete, la copia locale o, se manca, lo snapshot incluso nell'app; (2) in parallelo
  chiede `GET /locations` (15 s, NFR-6); (3) se la rete risponde con successo, sostituisce copia
  locale e catalogo in uso; (4) se fallisce, continua con copia locale o snapshot senza errori
  bloccanti. Ricerca e mappa sono sempre utilizzabili, anche al primo avvio offline.
- **FR-66** (*could*): `If-None-Match` con l'ETag della copia locale, 304 → nessun riscaricamento.
- **FR-67**: ricerca (FR-30, FR-45), pin e inquadratura (FR-43, FR-47), località più vicina (OQ-10)
  usano solo il repository; nessun elenco nel codice (oggi `coastalLocations` in
  `app/lib/models/coastal_location.dart`, usato da `forecast_screen.dart` e
  `coastal_map_screen.dart`).
- **FR-68, NFR-22**: cluster dei pin con 500 località; mappa < 1 s con catalogo locale, suggerimenti
  < 100 ms per carattere; "il catalogo dalla copia locale è disponibile senza attendere la rete".
- **NFR-13**: client HTTP, archivio e servizi restano iniettabili (come `ForecastApi`,
  `HomeLocationStore`, `LocationService`).
- Dipendenze già presenti: `http`, `shared_preferences`, `flutter_map ^8.3.1`, `latlong2`.
- ADR-0004: il catalogo è un file versionato da cui si può generare uno snapshot.

## Options
### A. Persistenza della copia locale
1. **`shared_preferences`** (stringa JSON del corpo + ETag) — già in uso per la località iniziale;
   ~40 KB con 500 voci, accettabile; nessuna nuova dipendenza.
2. **File su disco (`path_provider`)** — più adatto a contenuti grandi, ma nuova dipendenza e
   gestione file; nessun vantaggio a 40 KB.
3. **Database locale (sqflite/drift)** — sproporzionato.

### B. Primo avvio senza rete e senza copia locale (OQ-26, decisa dall'owner: B.1)
1. **Snapshot incluso nell'app** (`app/assets/locations.json`, generato da `locations.json`,
   ADR-0004) — funziona subito offline; coerente con NFR-22 (catalogo senza attendere la rete);
   costo: ~40 KB nel pacchetto, può essere obsoleto fino alla release successiva (una località
   rimossa dà 404 → messaggio di FR-33; una aggiunta compare al primo accesso alla rete).
2. **Messaggio "Connessione necessaria" con "Riprova"** — nessuno snapshot da tenere allineato;
   ma al primo avvio offline ricerca e mappa sono inutilizzabili.

### C. Clustering (FR-68)
1. **`flutter_map_marker_cluster` 8.2.x** (BSD-3, dipende da `flutter_map ^8.2.2`, compatibile con
   la 8.3.1 in uso; porting di Leaflet.markercluster: cluster con conteggio, tap → zoom fino a
   separare i pin).
2. **Clustering scritto in casa** (griglia per livello di zoom) — nessuna dipendenza, ma da scrivere
   e testare animazioni e "spiderfy".

## Decision
- **A.1**: `shared_preferences`.
- **B.1 — snapshot incluso** (decisione owner, OQ-26/C-6), generato da `locations.json` con
  `scripts/sync_app_catalog.mjs` e verificato da un test Flutter che lo confronta con
  `../locations.json` (nessun elenco scritto a mano nell'app, FR-61/FR-67). Lo snapshot è sempre
  presente, quindi il repository ha sempre un catalogo da mostrare: nessun messaggio "Connessione
  necessaria" (FR-65 punto 4).
- **C.1**: `flutter_map_marker_cluster`.

### Componenti (in `app/lib/`)
| File | Ruolo |
|---|---|
| `models/coastal_location.dart` | resta la classe `CoastalLocation` con `fromJson`; **rimossa** la costante `coastalLocations` |
| `models/location_catalog.dart` | `LocationCatalog { List<CoastalLocation> locations; String? etag; CatalogOrigin origin }`, `CatalogOrigin = network \| local \| snapshot`; precalcola per ogni voce il nome normalizzato (minuscole, senza accenti) per i suggerimenti |
| `services/location_catalog_api.dart` | `GET /locations` con `If-None-Match`, timeout 15 s; esito `fresh(catalog)` / `notModified` / errore; `http.Client` iniettabile come `ForecastApi` |
| `services/location_cache_store.dart` | interfaccia + implementazione `shared_preferences` (chiavi `maestrale_catalog_json`, `maestrale_catalog_etag`) |
| `services/location_repository.dart` | `LocationRepository`: unico punto da cui le schermate ottengono il catalogo |
| `services/catalog_snapshot.dart` | carica `assets/locations.json` (iniettabile per i test) |

### Comportamento del repository
```
Future<LocationCatalog> loadCached()    // copia locale valida, altrimenti snapshot; mai rete
Future<void> refresh()                  // rete con If-None-Match; 200 → salva e aggiorna `catalog`;
                                        // 304 → nessun cambio; errore → nessun cambio, nessun
                                        // errore bloccante (FR-65 punto 4)
ValueListenable<LocationCatalog> catalog  // catalogo in uso, per le schermate
```
Sequenza di FR-65 / NFR-22: all'avvio (`main.dart`) il repository pubblica in `catalog` il risultato
di `loadCached()` (lettura locale, nessuna attesa di rete; lo snapshot è un asset del pacchetto) e
avvia `refresh()` in parallelo; se la rete risponde con 200 valido, il nuovo catalogo sostituisce
la copia locale salvata e quello in `catalog`, e ricerca e mappa lo usano da quel momento. Un corpo
200 non interpretabile o una copia locale illeggibile sono trattati come assenti (la copia locale
non viene sovrascritta; si ripiega sullo snapshot). `refresh()` può essere richiamata anche alla
ripresa dell'app.

### Schermate
- `ForecastScreen` e `CoastalMapScreen` ricevono `LocationRepository` (iniettato da `main.dart`, come
  `HomeLocationStore`) e ascoltano `catalog`; tutte le occorrenze di `coastalLocations` passano dal
  repository (FR-67).
- Suggerimenti: filtro `contains` sul nome normalizzato precalcolato, al più 500 confronti per
  carattere (ordine dei µs, NFR-22); elenco suggerimenti limitato a 20 voci visibili.
- Mappa: `MarkerClusterLayerWidget` con i 500 marker creati una volta per catalogo; inquadratura
  iniziale sui limiti del catalogo (zoom 6-14, FR-43); tap sul cluster → zoom fino a separare;
  ai livelli in cui non si sovrappongono, pin singoli con il comportamento di FR-44.
- Località più vicina (OQ-10, se adottata): calcolo locale sul catalogo del repository, nessun dato
  inviato al backend (NFR-9).

## Consequences
- **Più semplice**: un solo punto di accesso al catalogo; nuove località senza release dell'app
  (salvo lo snapshot, aggiornato a ogni release).
- **Più difficile**: le schermate diventano reattive a un catalogo che può cambiare durante l'uso
  (una località selezionata può sparire: si mantiene la selezione corrente, la richiesta
  `/forecast` risponderà 404 con il messaggio di FR-33); i test widget devono iniettare repository
  finti.
- **Nuova dipendenza** `flutter_map_marker_cluster` (porta anche `flutter_map_marker_popup`),
  legata alla major di `flutter_map`: un futuro aggiornamento di `flutter_map` può richiedere di
  attendere il plugin.
- **Snapshot**: un passo in più al rilascio (script di sincronizzazione), protetto dal test.
