---
id: PRD
status: draft        # draft | approved — only the user approves
version: 0.2
owner: analyst
---

# Product Requirements — Maestrale (Sardegna Mare)

> **PRD brownfield con migrazione.** La v0.1 descriveva il prodotto **così com'è costruito** al
> commit `181c2f3`, ricostruito da `README.md`, `data_sources.py`, `previsioni_mare.py`,
> `update_forecasts.py`, `backend/main.py`, `locations.json`, `app/lib/` e dai test.
> La v0.2 recepisce la **decisione dell'utente del 2026-10-03** di migrare il backend su
> **Cloudflare Workers (TypeScript)** con cache su **Workers KV**. Il contratto del prodotto
> (API, logica di aggregazione, aggiornamento periodico, fallback) deve restare invariato; i
> requisiti legati alla CLI Python sono stati riscritti come comportamento del job di
> aggiornamento o marcati come superati.
>
> **Legenda colonna "Fonte"**
> - **T** — comportamento verificato da almeno un test automatico esistente (implementazione Python).
> - **R** — comportamento dichiarato esplicitamente nel `README.md` (e presente nel codice).
> - **D** — dedotto solo dalla lettura del codice; nessun test né documentazione lo fissa.
> - **U** — deriva da una decisione esplicita dell'utente (2026-10-03: migrazione a Cloudflare).
> - "mod. 0.2" indica un requisito riformulato in v0.2 per renderlo indipendente dal runtime.
>
> Le **priorità** (`must` / `should` / `could`) sono una proposta dell'analista; vanno confermate
> (OQ-16). Le scelte tecnologiche oltre a Workers + KV (framework, test runner, configurazione di
> deploy, layout delle chiavi KV, meccanismo di pianificazione) spettano all'architect.

## 1. Problem
Chi frequenta la costa sarda (per balneazione, uscite in barca o sport d'acqua — *dedotto*,
vedi OQ-1) deve oggi incrociare servizi diversi per sapere, località per località, com'è il mare
(onde, direzione, periodo, temperatura dell'acqua) e com'è il tempo (aria, vento, raffiche) nei
prossimi giorni. I dati grezzi dei modelli sono orari, su griglia, con nomenclatura tecnica e
celle che possono cadere sulla terra invece che sul mare (o viceversa).

Maestrale risolve il problema con:
- un job di aggiornamento periodico che scarica da Open-Meteo le previsioni marine (cella di
  **mare**) e meteo (cella di **terra**) per un insieme chiuso di località costiere, le aggrega
  per giorno e le salva in un cache robusto ai guasti;
- un'API HTTP in sola lettura che serve le previsioni per località, con provenienza completa;
- un'app Flutter in italiano che presenta la previsione a 7 giorni "a colpo d'occhio", con
  ricerca, mappa della costa e località iniziale preferita.

Con la v0.2 il backend (API + job di aggiornamento + cache) passa da un server Python con file
JSON locale a Cloudflare Workers + Workers KV, eliminando la necessità di gestire un server e uno
scheduler esterni.

## 2. Goals and success metrics
Obiettivi desumibili dal prodotto attuale. **Le metriche di successo non sono definite nel
progetto** (OQ-2); i segnali sotto sono solo quelli già misurabili dal sistema.

| # | Obiettivo | Segnale misurabile oggi |
|---|---|---|
| G-1 | Previsioni giornaliere a 7 giorni per tutte le località supportate | `GET /health` → `locations` = 13 e `update_errors` vuoto |
| G-2 | Dati sempre freschi | `GET /health` → `stale = false` (età cache ≤ soglia, default 12 h) |
| G-3 | Servizio disponibile anche se il provider è giù | `/forecast` continua a rispondere 200 con l'ultimo dato valido dopo un aggiornamento fallito |
| G-4 | Trasparenza sull'origine dei dati | Ogni risposta `/forecast` contiene `sources.sea` e `sources.weather` con licenza e cella risolta |
| G-5 | Consultazione semplice da mobile | *Nessun segnale definito* (nessuna analytics nell'app) — vedi OQ-2 |
| G-6 | Migrazione a Cloudflare trasparente per l'app (U) | L'app Flutter esistente funziona puntando `API_BASE_URL` al nuovo backend, senza modifiche al codice dell'app (FR-50) |

## 3. Non-goals
Escluso dal prodotto attuale (constatato nel codice; da confermare come scelta voluta, OQ-14):
- **Località arbitrarie**: niente geocoding né previsioni per coordinate libere; solo le 13
  località del catalogo.
- **Previsioni orarie** o intra-giornaliere esposte all'utente: solo aggregati giornalieri.
- **Storico / osservazioni reali**: nessun dato passato, nessuna boa o stazione.
- **Copernicus Marine** come sorgente operativa: gli script in `legacy/` sono solo riferimento
  sperimentale e non partecipano alla pipeline (R).
- **Account utente, autenticazione, sincronizzazione** delle preferenze fra dispositivi.
- **Scrittura via API**: il backend espone solo `GET`; l'aggiornamento dati è un processo separato
  dalla gestione delle richieste HTTP.
- **Notifiche/allerte**: il pulsante "Notifiche" esiste nell'app ma non fa nulla (OQ-8).
- **Lingue diverse dall'italiano**.
- **Funzionamento offline dell'app** (nessun cache lato client delle previsioni).
- **Cambi funzionali durante la migrazione** (v0.2): la migrazione a Cloudflare non modifica il
  contratto API né l'app Flutter; eventuali evoluzioni vanno trattate separatamente.

## 4. Users and scenarios
I target user non sono documentati (OQ-1). Ruoli dedotti dal codice:

| Ruolo | Descrizione (dedotta) |
|---|---|
| **Utente app** | Persona che vuole sapere com'è il mare in una località sarda, oggi e nei giorni seguenti, dal telefono. |
| **Operatore** | Chi gestisce il deploy su Cloudflare, monitora `/health` e i log del job, gestisce l'elenco località. |
| **Client API** | Consumatore dell'API `/forecast` (oggi solo l'app Flutter; altri client possibili via CORS). |

Scenari principali:
- **S-1 Consultazione rapida** — L'utente apre l'app; se ha una località iniziale salvata, la
  previsione si carica da sola. Scorre i 7 giorni nel carosello.
- **S-2 Ricerca** — L'utente digita parte del nome, sceglie un suggerimento, vede la previsione.
- **S-3 Scelta dalla mappa** — L'utente apre la mappa, vede la sua posizione e i pin delle
  località, tocca un pin e preme "Vedi meteo".
- **S-4 Località preferita** — L'utente imposta la località corrente come pagina iniziale.
- **S-5 Aggiornamento dati** — Ogni 6 ore il job di aggiornamento parte automaticamente su
  Cloudflare; se una località fallisce, resta disponibile il dato precedente e l'errore è visibile
  in `/health`.
- **S-6 Monitoraggio** — L'operatore interroga `/health` per sapere se i dati sono vecchi o se
  l'ultimo aggiornamento ha avuto errori.

## 5. Functional requirements

### 5.1 Catalogo località e sorgenti dati

| ID | Requirement | Priority | Fonte |
|---|---|---|---|
| FR-1 | Il sistema shall supportare un catalogo chiuso di località costiere, versionato nel repository (oggi `locations.json`), in cui ogni voce ha `slug`, `name`, `latitude`, `longitude`. Il catalogo attuale contiene 13 località: Alghero, Arbatax, Cagliari, Carloforte, Chia, La Maddalena, Olbia, Oristano, Porto Torres, Santa Teresa Gallura, Siniscola, Torre dei Corsari, Villasimius. Slug e nomi restano invariati dopo la migrazione. | must | R, mod. 0.2 |
| FR-2 | Il job di aggiornamento shall rifiutare l'esecuzione (errore registrato, nessuna modifica al cache) se una voce del catalogo manca di uno dei campi `slug`, `name`, `latitude`, `longitude`. | should | D, mod. 0.2 |
| FR-3 | Per ogni località il sistema shall richiedere alla Open-Meteo Marine Weather API (`https://marine-api.open-meteo.com/v1/marine`) le variabili orarie `wave_height`, `wave_direction`, `wave_period`, `sea_surface_temperature` con `cell_selection=sea`, `models=best_match`, `timezone=Europe/Rome` e `forecast_days` pari al numero di giorni (FR-14). | must | T |
| FR-4 | Per ogni località il sistema shall richiedere alla Open-Meteo Weather Forecast API (`https://api.open-meteo.com/v1/forecast`) le variabili orarie `temperature_2m`, `wind_speed_10m`, `wind_direction_10m`, `wind_gusts_10m` e giornaliere `weather_code`, `temperature_2m_min`, `temperature_2m_max`, `wind_speed_10m_max`, `wind_gusts_10m_max`, con `cell_selection=land`, `models=best_match`, `timezone=Europe/Rome`. | must | T |
| FR-5 | Endpoint, variabili, selezione del modello e della cella, attribuzione, URL di documentazione e di licenza di ciascun provider shall essere dichiarati in un unico punto del codice backend (oggi `data_sources.py`) e da lì usati sia per costruire le richieste sia per la provenienza. | should | R, mod. 0.2 |

### 5.2 Aggregazione giornaliera

| ID | Requirement | Priority | Fonte |
|---|---|---|---|
| FR-6 | Il sistema shall produrre una voce giornaliera solo per le date (fuso Europe/Rome) presenti sia nelle serie orarie marine, sia nelle serie orarie meteo, sia nei valori giornalieri meteo; le voci sono ordinate per data crescente e limitate al numero di giorni (FR-14). | must | D |
| FR-7 | Per ogni giorno il blocco `sea` shall contenere: `wave_height_mean_m` (media oraria, 2 decimali), `wave_height_max_m` (massimo orario, 2 decimali), `wave_period_mean_s` (media, 2 decimali), `wave_direction_mean_deg` (media circolare, intero), `wave_direction_name`, `water_temperature_mean_c` (media, 1 decimale), `state`. Valori orari nulli o non finiti sono ignorati nel calcolo. | must | D |
| FR-8 | Per ogni giorno il blocco `weather` shall contenere: `air_temperature_mean_c` (media oraria, 1 decimale), `air_temperature_min_c` / `air_temperature_max_c` / `weather_code` / `wind_speed_max_kmh` / `wind_gust_max_kmh` (valori giornalieri del provider, non ricalcolati), `wind_speed_mean_kmh` e `wind_gust_mean_kmh` (medie orarie, 1 decimale), `wind_direction_mean_deg` (media circolare, intero), `wind_name`. | must | D |
| FR-9 | Le direzioni medie (onde e vento) shall essere calcolate come media circolare dei gradi orari, risultato in [0, 360). | must | D |
| FR-10 | Lo stato del mare (`state`) shall essere derivato dall'altezza d'onda media giornaliera secondo la scala Douglas/WMO: ≤0 "Calmo"; ≤0,1 "Quasi calmo"; ≤0,5 "Poco mosso"; ≤1,25 "Mosso"; ≤2,5 "Molto mosso"; ≤4 "Agitato"; ≤6 "Molto agitato"; ≤9 "Grosso"; ≤14 "Molto grosso"; oltre "Tempestoso". Se l'altezza media non è calcolabile, `state` è nullo. | must | D |
| FR-11 | I nomi di direzione (`wave_direction_name`, `wind_name`) shall seguire la rosa dei venti a 8 settori da 45° centrati sui punti cardinali/intercardinali: Tramontana (N, 337,5°–22,5°), Grecale, Levante, Scirocco, Ostro, Libeccio, Ponente, Maestrale. | must | D |

### 5.3 Provenienza

| ID | Requirement | Priority | Fonte |
|---|---|---|---|
| FR-12 | Ogni previsione di località shall includere `sources.sea` e `sources.weather`, ciascuno con: `id`, `provider`, `service`, `endpoint`, `model_selection`, `variables` (`hourly`, `daily`), `requested_coordinates`, `resolved_cell` (latitudine, longitudine e, se fornita, `elevation_m` della cella effettivamente usata dal provider), `fetched_at` (UTC ISO 8601), `attribution`, `documentation_url`, `license_url`. | must | T |
| FR-13 | Ogni previsione di località shall includere anche `location` (nome, coordinate richieste, slug), `cells` (cella marina e cella meteo risolte), `timezone` e `generated_at` (UTC ISO 8601). | must | D |

### 5.4 Job di aggiornamento

> In v0.1 questi requisiti descrivevano la CLI `update_forecasts.py`. Dopo la migrazione il job
> gira su Cloudflare; il meccanismo di pianificazione e di esecuzione è scelta dell'architect.

| ID | Requirement | Priority | Fonte |
|---|---|---|---|
| FR-14 | Ogni esecuzione del job shall aggiornare tutte le località del catalogo con previsioni per 7 giorni. (In v0.1 il numero di giorni era configurabile 1–8 via `--days`; se debba restare configurabile: OQ-18.) | must | R, mod. 0.2 |
| ~~FR-15~~ | *(superato in v0.2)* Aggiornamento di singole località via `--location <slug>` con uscita codice 2 per slug sconosciuti. Comportamento legato alla CLI Python; l'eventuale necessità di un aggiornamento manuale/mirato è in OQ-17. | — | — |
| ~~FR-16~~ | *(superato in v0.2)* Parallelismo configurabile via `--workers` (1–8, default 4). Sostituito dal vincolo di concorrenza verso i provider NFR-17. | — | — |
| FR-17 | Ogni chiamata a un provider shall essere ritentata fino a 3 tentativi complessivi, con attesa progressiva (1 s, poi 2 s) e timeout di 30 s per tentativo; una risposta con campo `error` del provider è trattata come fallimento. Tempi e numero di tentativi devono restare compatibili con i limiti di piattaforma (NFR-15). | must | D, mod. 0.2 |
| FR-18 | Se l'aggiornamento di una località fallisce, il sistema shall conservare nel cache l'ultima previsione valida di quella località (se esiste) e registrare il messaggio d'errore in `errors[<slug>]`. | must | R |
| FR-19 | Il job shall salvare il risultato nel cache su Workers KV in modo che un lettore non osservi mai una previsione di località parziale o mista fra due esecuzioni. I dati logici esposti restano quelli della v0.1: `schema_version` (1), `generated_at` (fine esecuzione, UTC ISO 8601), `updated_locations`, `errors`, `locations: {<slug>: previsione}`. Layout delle chiavi e formato di serializzazione: scelta dell'architect. | must | U, mod. 0.2 |
| FR-20 | Se il cache precedente è assente o non valido, il job shall partire da un insieme vuoto di località invece di fallire. | should | D, mod. 0.2 |
| ~~FR-21~~ | *(superato in v0.2)* Codici d'uscita 0/1/2 del processo CLI. Sostituito da FR-52 (esito dell'esecuzione osservabile). | — | — |
| FR-49 | Il job di aggiornamento shall essere eseguito automaticamente sulla piattaforma Cloudflare ogni 6 ore, senza dipendere da server o scheduler esterni a Cloudflare. | must | U, R (frequenza) |
| FR-52 | Ogni esecuzione del job shall rendere osservabile il proprio esito: località aggiornate, località fallite con messaggio d'errore, istante di completamento. Le località fallite sono esposte da `/health` in `update_errors` (FR-26); l'esito complessivo è registrato anche nei log della piattaforma. | should | D, mod. 0.2 |

### 5.5 API backend

| ID | Requirement | Priority | Fonte |
|---|---|---|---|
| FR-22 | `GET /forecast?localita=<valore>` shall restituire 200 con la previsione completa (FR-12, FR-13, giorni FR-6..FR-11) della località il cui slug o nome normalizzato coincide con il valore normalizzato (minuscole, accenti rimossi, spazi/underscore → trattino). Es.: "Torre dei Corsari" e "torre-dei-corsari" sono equivalenti. | must | T |
| FR-23 | Se la località non esiste nel cache, `/forecast` shall rispondere 404 con `detail.message` ("Localita '<valore>' non trovata") e `detail.available` = elenco ordinato dei nomi disponibili. | must | T (solo 404) |
| FR-24 | Se il cache non è ancora stato popolato, `/forecast` shall rispondere 503 con `detail` = "Previsioni non ancora disponibili"; se il contenuto del cache non è valido, 503 con descrizione dell'errore in `detail`. | must | D, mod. 0.2 |
| FR-25 | Un parametro `localita` assente o vuoto shall produrre un errore di validazione 422 con corpo JSON contenente il campo `detail`. | should | D, mod. 0.2 |
| FR-26 | `GET /health` shall rispondere sempre 200 con `status` = `ok` oppure `degraded`. Con cache valido riporta `generated_at`, `age_hours` (2 decimali), `stale`, `locations` (numero), `update_errors`. `status` è `degraded` se l'età supera la soglia configurata (FR-28), se `generated_at` manca, se `errors` non è vuoto, se il cache è assente o non valido (in questi ultimi due casi con `error` e un identificativo del cache, in v0.1 `cache_path`: vedi OQ-19). | must | T (solo caso `ok`), mod. 0.2 |
| FR-27 | Dopo il completamento di un aggiornamento, il backend shall servire i nuovi dati senza redeploy né riavvio, entro il ritardo di propagazione ammesso da NFR-16. | must | D, mod. 0.2 |
| FR-28 | Senza modificare il codice, il backend shall essere configurabile per: soglia di dati vecchi in ore (default 12) e origini CORS consentite (default `*`, lista). CORS consente solo il metodo `GET` (più le preflight necessarie). La configurazione del percorso del cache (`FORECAST_CACHE_PATH` in v0.1) è superata: il collegamento a KV è scelta dell'architect. Nomi dei parametri: scelta dell'architect. | should | R, mod. 0.2 |
| FR-29 | Il backend shall esporre la documentazione interattiva dell'API (in v0.1 OpenAPI generata da FastAPI su `/docs`). Mantenimento dopo la migrazione da confermare (OQ-20). | could | R, mod. 0.2 |
| FR-50 | Parità di contratto: per gli stessi dati in cache, le risposte di `/forecast` e `/health` del backend su Cloudflare shall avere gli stessi codici HTTP, nomi di campo, tipi, arrotondamenti e semantica dell'implementazione Python al commit `181c2f3`, così che l'app Flutter esistente funzioni senza modifiche. Eccezioni ammesse solo se elencate esplicitamente in questo PRD (oggi: identificativo del cache in `/health`, OQ-19). | must | U |
| FR-51 | Parità di aggregazione: a parità di risposte Open-Meteo in ingresso, il nuovo job shall produrre previsioni giornaliere identiche a quelle dell'implementazione Python (FR-6..FR-13, esclusi gli istanti `fetched_at`/`generated_at`). La tolleranza ammessa sugli arrotondamenti va confermata (OQ-21). | must | U |

### 5.6 App Flutter — previsione

| ID | Requirement | Priority | Fonte |
|---|---|---|---|
| FR-30 | L'app shall offrire un campo di ricerca con suggerimenti: digitando, mostra le località del catalogo il cui nome contiene il testo (senza distinzione maiuscole/minuscole); selezionando un suggerimento avvia la ricerca. | must | T |
| FR-31 | Inviando il testo dal campo (tasto invio o pulsante "Cerca"), l'app shall richiedere `GET /forecast?localita=<testo ripulito da spazi>`; se il testo non corrisponde ad alcun suggerimento la richiesta è inviata comunque al backend. Testo vuoto: nessuna richiesta. | must | T |
| FR-32 | Durante il caricamento l'app shall mostrare un indicatore di avanzamento e disabilitare il pulsante "Cerca". | should | D |
| FR-33 | In caso di errore (HTTP ≠ 200, timeout di 15 s, risposta non valida) l'app shall mostrare la scheda "Previsioni non disponibili" con il messaggio del backend (`detail` testuale o `detail.message`) o un messaggio generico con il codice HTTP, e un pulsante "Riprova". | must | T (estrazione messaggio) |
| FR-34 | Senza previsione caricata e senza errore, l'app shall mostrare una schermata di benvenuto con il pulsante "Scopri le previsioni", che avvia la ricerca del testo presente nel campo (precompilato con "Torre dei Corsari"). | should | D |
| FR-35 | Con una previsione caricata, l'app shall mostrare il nome della località e un carosello principale con una scheda per giorno contenente: data (con prefisso "OGGI" per il primo giorno), icona meteo, temperatura media dell'aria, stato del mare, minima e massima dell'aria, altezza media delle onde (1 decimale), temperatura dell'acqua, nome e velocità media del vento. | must | T |
| FR-36 | L'icona meteo shall essere derivata da `weather_code`: 51–82 pioggia; 2–48 nuvoloso; altrimenti sereno. | should | D |
| FR-37 | L'app shall mostrare un selettore secondario "Scegli il giorno" (card con data, onde medie, massima dell'aria) sincronizzato in entrambe le direzioni con il carosello principale, e indicatori di pagina quando i giorni sono più di uno. Cambiando località la selezione torna al primo giorno. | should | T |
| FR-38 | L'app shall consentire di ricaricare la previsione corrente con il gesto pull-to-refresh. | should | D |
| FR-39 | L'app shall mostrare "Aggiornato <giorno data mese · hh:mm>" in ora locale del dispositivo, derivato da `generated_at` della previsione. | should | D |
| FR-40 | Se la previsione non contiene giorni, l'app shall mostrare la scheda "Nessuna previsione". | should | D |

### 5.7 App Flutter — località iniziale

| ID | Requirement | Priority | Fonte |
|---|---|---|---|
| FR-41 | Quando la località mostrata non è la località iniziale salvata (confronto senza distinzione maiuscole/minuscole), l'app shall mostrare il pulsante "Stabilisci come pagina iniziale"; premendolo salva il nome nelle preferenze locali del dispositivo e mostra la conferma "<località> sarà mostrata all'avvio" (o "Impossibile salvare la località. Riprova." in caso di errore). | should | T |
| FR-42 | All'avvio, se esiste una località iniziale salvata, l'app shall precompilare il campo e caricarne automaticamente la previsione; se la preferenza non è leggibile l'app resta utilizzabile. | should | T |

### 5.8 App Flutter — mappa della costa

| ID | Requirement | Priority | Fonte |
|---|---|---|---|
| FR-43 | Dal pulsante "Apri mappa" l'app shall aprire una mappa (tile OpenStreetMap, attribuzione "OpenStreetMap contributors") con un pin per ciascuna delle 13 località, inquadrate tutte all'apertura (zoom 6–14). Se il testo di ricerca corrente coincide con nome o slug di una località, questa risulta già selezionata. | must | T |
| FR-44 | Toccando un pin, l'app shall evidenziarlo, centrare la mappa sulla località (zoom 10) e mostrare una scheda con il nome e il pulsante "Vedi meteo"; premendolo torna alla schermata previsioni e carica quella località. | must | T |
| FR-45 | La mappa shall offrire una ricerca con suggerimenti; all'invio seleziona la località con nome/slug esatto o, in mancanza, la prima il cui nome contiene il testo; se nessuna corrisponde mostra "Località non trovata tra quelle disponibili." | should | D |
| FR-46 | All'apertura della mappa e con il pulsante "La mia posizione", l'app shall tentare di localizzare l'utente: se i servizi di localizzazione sono spenti, il permesso è negato o la posizione non è ottenibile entro 15 s mostra un messaggio specifico; se il permesso è negato permanentemente offre il pulsante "Impostazioni"; se riesce mostra un marker "La tua posizione" e centra la mappa (zoom 12,5). | should | D |
| FR-47 | Il pulsante "Mostra tutte le località" shall reinquadrare la mappa su tutte le località. | could | D |
| FR-48 | L'URL del backend shall essere configurabile in fase di build con `--dart-define=API_BASE_URL=...` (default `http://localhost:8000`). | must | R |

## 6. Non-functional requirements
Ogni target è marcato come **Vincolo** (imposto da decisione utente, provider o piattaforma: va
rispettato), **Attuale** (valore già presente nel prodotto, da preservare) o **Proposto**
(suggerito dall'analista, da confermare nella domanda aperta indicata).

| ID | Requirement | Target |
|---|---|---|
| NFR-1 | Freschezza dati: il cache è considerato vecchio oltre una soglia configurabile; `/health` lo segnala come `degraded`. | **Attuale**: età cache ≤ 12 h — R |
| NFR-2 | Frequenza di aggiornamento: il job gira automaticamente su Cloudflare (FR-49). *(mod. 0.2: in v0.1 era pianificato esternamente con cron.)* | **Attuale**: ogni 6 h (in v0.1 alle 02:30, 08:30, 14:30, 20:30); orari esatti e fuso: OQ-4 |
| NFR-3 | Resilienza: un guasto del provider o di una singola località non rende indisponibile il servizio né cancella dati validi; il cache non è mai osservabile in stato parziale. *(mod. 0.2)* | **Attuale**: 0 risposte servite da dati parziali; località fallita servita con l'ultimo dato valido (FR-18, FR-19) |
| NFR-4 | Prestazioni API: `/forecast` e `/health` servono dati letti dal cache, senza chiamare i provider. *(mod. 0.2)* | **Proposto**: p95 < 200 ms misurato dal client in Italia, con 13 località — da confermare (OQ-13) |
| NFR-5 | Durata aggiornamento: 2 richieste provider per località. *(mod. 0.2)* | **Vincolo**: un'esecuzione completa deve stare nei limiti di durata/CPU della piattaforma (NFR-15). **Proposto**: < 5 min nel caso peggiore con retry (OQ-13) |
| NFR-6 | Timeout: chiamate upstream 30 s × max 3 tentativi; chiamata app → backend 15 s; geolocalizzazione 15 s. | **Attuale**: valori fissi come indicato — D |
| NFR-7 | Attribuzione e licenza: ogni risposta `/forecast` riporta attribuzione e URL licenza Open-Meteo; la mappa riporta l'attribuzione OpenStreetMap. | **Vincolo** (licenza Open-Meteo): 100% delle risposte `/forecast` con `sources.*.attribution` e `license_url` — T. Attribuzione Open-Meteo nell'UI dell'app: assente (OQ-9) |
| NFR-8 | Nessun segreto richiesto: i provider sono usati senza API key. | **Attuale**: 0 credenziali applicative nella configurazione — R |
| NFR-9 | Privacy: la posizione del dispositivo è usata solo localmente sulla mappa e non è inviata al backend; il permesso richiesto è "durante l'uso". La località iniziale è salvata solo sul dispositivo. | **Attuale**: 0 dati personali inviati al backend (solo il parametro `localita`) — D |
| NFR-10 | Localizzazione: interfaccia, messaggi d'errore e nomi (stato mare, venti) in italiano; date giornaliere nel fuso Europe/Rome; orario di aggiornamento in ora locale del dispositivo. | **Attuale**: 100% stringhe UI e messaggi API in italiano — D |
| NFR-11 | Sicurezza API: API in sola lettura (solo `GET`), nessuna autenticazione, CORS configurabile; servita solo via HTTPS tramite Cloudflare. *(mod. 0.2)* | **Vincolo** (U): nessun endpoint pubblico di scrittura; HTTPS gestito da Cloudflare. Restrizione CORS in produzione: OQ-3 |
| NFR-12 | Piattaforme/runtime: backend su **Cloudflare Workers in TypeScript** con cache su **Workers KV** (sostituisce Python/FastAPI/uvicorn e `data/forecasts.json`); app Flutter 3.x, Dart SDK ^3.11.5, configurazioni Android e iOS presenti. *(mod. 0.2)* | **Vincolo** (U) per il backend. Piattaforme target ufficiali dell'app: OQ-3 |
| NFR-13 | Testabilità: backend e app hanno suite di test automatici eseguibili in locale senza accesso ai provider né all'account Cloudflare; client API, archivio preferenze e servizio di localizzazione dell'app restano iniettabili. Le suite coprono la parità FR-50/FR-51 con fixture. Test runner: scelta dell'architect. *(mod. 0.2)* | **Proposto**: suite backend e Flutter verdi su ogni modifica |
| NFR-14 | Concorrenza: una lettura concorrente a un aggiornamento restituisce o la previsione precedente o la nuova, mai un misto. *(mod. 0.2: in v0.1 lock + rename atomico del file)* | **Vincolo**: rispettare il limite KV di 1 scrittura/s sulla stessa chiave |
| NFR-15 | Limiti piattaforma Cloudflare: il job e l'API devono rispettare i limiti del piano Workers in uso per invocazione (subrequest, tempo CPU, durata, memoria 128 MB) e di Workers KV (valore ≤ 25 MiB, 1 scrittura/s per chiave, quote giornaliere di letture/scritture). Riferimento (doc Cloudflare, 2026-10): piano Free 50 subrequest e 10 ms CPU per invocazione, 1.000 scritture KV/giorno, 100.000 letture KV/giorno; piano Paid 10.000 subrequest, CPU fino a 30 s per cron con intervallo < 1 h e fino a 15 min con intervallo ≥ 1 h, durata cron max 15 min. Un'esecuzione completa richiede 26 chiamate provider nominali e fino a 78 con tutti i retry, cioè più del limite Free. | **Vincolo** (piattaforma). Scelta del piano: OQ-22 |
| NFR-16 | Consistenza: Workers KV è a consistenza eventuale; dopo un aggiornamento alcune location di Cloudflare possono servire ancora il dato precedente per un breve intervallo (la doc Cloudflare indica tipicamente fino a ~60 s). Accettabile dato l'intervallo di 6 h e la soglia di 12 h. | **Vincolo** (piattaforma) accettato. **Proposto**: nuovi dati visibili ovunque entro 5 min dalla fine del job |
| NFR-17 | Uso corretto dei provider: il job limita le chiamate concorrenti verso Open-Meteo (sostituisce `--workers`, FR-16) e resta entro i limiti d'uso gratuiti di Open-Meteo. | **Attuale**: max 4 località in parallelo. Rischio limiti per IP condivisi Cloudflare: OQ-9 |
| NFR-18 | Osservabilità: esito e durata di ogni esecuzione del job e gli errori dell'API sono consultabili dall'operatore negli strumenti di log della piattaforma. | **Proposto**: log conservati per almeno 7 giorni; allerting: OQ-4 |

## 7. Constraints and assumptions
**Decisioni utente (vincoli confermati, 2026-10-03)**
- C-1 Il backend (API + job di aggiornamento) gira su **Cloudflare Workers**, scritto in
  **TypeScript**, e sostituisce FastAPI/uvicorn.
- C-2 Il cache delle previsioni è su **Workers KV** e sostituisce `data/forecasts.json`.
- C-3 Hosting e HTTPS sono forniti da Cloudflare.
- Restano all'architect: framework HTTP, test runner, configurazione di deploy, layout delle chiavi
  KV, meccanismo di pianificazione, strategia di rilascio.

**Altri vincoli**
- Sorgenti dati: solo Open-Meteo (Marine + Forecast), selezione modello `best_match`: il
  modello sottostante può cambiare dinamicamente per località e disponibilità, quindi i valori
  non sono riproducibili rispetto a un modello fisso (R).
- Condizioni d'uso Open-Meteo: attribuzione obbligatoria; l'uso gratuito ha limiti di frequenza e
  vincoli d'uso (es. non commerciale) da verificare rispetto al modello di business (OQ-9).
- Tile OpenStreetMap da `tile.openstreetmap.org`, soggetti alla policy d'uso OSM (OQ-9).
- L'aggiornamento dati è separato dalla gestione delle richieste HTTP: l'API non chiama mai i
  provider (R).
- Limiti di piattaforma Cloudflare Workers/KV: NFR-15, NFR-16.
- Il codice in `legacy/` non fa parte del prodotto.

**Assunzioni (da confermare)**
- A-1 L'elenco delle località cambia raramente e a mano.
- A-2 L'app è destinata a smartphone (Android/iOS).
- A-3 Il carico atteso è basso (nessun requisito di scalabilità nel codice).
- A-4 La migrazione non richiede di conservare il contenuto dell'attuale `data/forecasts.json`:
  il primo aggiornamento su Cloudflare ricostruisce il cache (OQ-23).

**Incongruenze e rischi rilevati** (non sono requisiti, servono ad architect e planner)
- R-1 L'elenco località è duplicato: `locations.json` (backend) e `app/lib/models/coastal_location.dart` (app). Non esiste un endpoint che esponga il catalogo (OQ-5).
- R-2 Il backend può emettere campi `null` (es. `state`, `water_temperature_mean_c`, direzioni) mentre il modello dati dell'app li richiede non nulli: una risposta con un `null` fa fallire la visualizzazione dell'intera località ("Risposta del server non valida"). Inoltre un giorno senza alcuna altezza d'onda valida fa fallire l'aggiornamento dell'intera località (OQ-6).
- R-3 `/forecast` non comunica se il dato è vecchio e l'app mostra sempre il badge "Live" (OQ-7).
- R-4 Molti campi calcolati (onda massima, periodo, direzione onde, raffiche, vento massimo, provenienza) non sono mostrati nell'app (OQ-11).
- R-5 (v0.2) Arrotondamenti: Python `round()` arrotonda a pari sulla rappresentazione binaria (es. `round(0.125, 2) = 0.12`), mentre i metodi JavaScript comuni si comportano diversamente; senza attenzione FR-51 fallisce sui valori al limite (OQ-21).
- R-6 (v0.2) Le chiamate in uscita da Cloudflare Workers partono da IP condivisi: i limiti per IP del piano gratuito Open-Meteo potrebbero essere raggiunti anche per traffico altrui, causando errori 429 (OQ-9).
- R-7 (v0.2) Con il piano Workers Free il job non rientra nei limiti di subrequest nel caso peggiore e il budget di CPU di 10 ms è a rischio (NFR-15, OQ-22).

## 8. Open questions
| # | Question | Owner |
|---|---|---|
| OQ-1 | Chi sono i target user (bagnanti, diportisti, surfisti/kiter, pescatori, turisti, operatori turistici)? Ci sono esigenze diverse per gruppo che cambiano le priorità? | Product owner (Giuseppe Concas) |
| OQ-2 | Quali metriche di successo vogliamo (utenti attivi, ritenzione, sessioni/giorno, errori lato app, uptime)? Serve introdurre analytics/crash reporting nell'app? | Product owner |
| OQ-3 | **Risolta in parte (v0.2):** hosting = Cloudflare Workers + Workers KV, HTTPS tramite Cloudflare. Restano aperte: valore delle origini CORS in produzione; dominio pubblico dell'API; piattaforme ufficiali dell'app (Android, iOS, web, desktop) e pubblicazione sugli store. | Product owner + architect |
| OQ-4 | *(aggiornata v0.2)* L'aggiornamento ogni 6 h ora gira su Cloudflare (FR-49): gli orari attuali (02:30, 08:30, 14:30, 20:30) vanno mantenuti, e in quale fuso (UTC o Europe/Rome)? Chi viene avvisato, e come, quando `/health` è `degraded` o un'esecuzione ha località fallite? La soglia di 12 h è corretta? | Product owner (operatore) |
| OQ-5 | L'elenco località deve restare duplicato nell'app oppure l'app deve ottenerlo dal backend (nuovo endpoint)? È previsto aggiungere località (e con quale processo)? | Product owner |
| OQ-6 | Comportamento atteso con dati mancanti dal provider: mostrare il giorno con "n.d." per i singoli campi, nascondere il giorno, o fallire come oggi? | Product owner |
| OQ-7 | L'utente deve essere avvisato quando i dati sono vecchi (es. età > 12 h)? Il badge "Live" deve riflettere lo stato reale? `/forecast` deve esporre un indicatore di freschezza? | Product owner |
| OQ-8 | Il pulsante "Notifiche" (oggi inattivo) va implementato (es. allerte mare mosso/vento), nascosto, o rimosso? | Product owner |
| OQ-9 | Il prodotto è commerciale? In tal caso servono piano a pagamento Open-Meteo (con API key, che toglierebbe anche il rischio R-6 dei limiti per IP condivisi Cloudflare) e un fornitore di tile diverso da `tile.openstreetmap.org`. L'attribuzione Open-Meteo va mostrata anche nell'interfaccia dell'app? | Product owner |
| OQ-10 | La località precompilata "Torre dei Corsari" è un default voluto per tutti gli utenti al primo avvio, oppure si preferisce la località più vicina alla posizione dell'utente? | Product owner |
| OQ-11 | Quali dei campi già disponibili ma non mostrati (onda massima, periodo, direzione onde, raffiche, vento massimo, fonti/cella) devono comparire nell'app? | Product owner |
| OQ-12 | Il materiale Copernicus in `legacy/` va conservato, rimosso, o è prevista una reintroduzione di Copernicus Marine come sorgente (anche alternativa/di fallback)? | Product owner |
| OQ-13 | Esistono obiettivi di prestazioni e disponibilità (latenza API, uptime, durata massima dell'aggiornamento)? I target "proposti" di NFR-4, NFR-5, NFR-16 e NFR-18 sono accettabili? | Product owner + architect |
| OQ-14 | I non-goal della sezione 3 sono scelte confermate o solo lo stato attuale? Qual è la roadmap (più giorni fino a 8, previsioni orarie, altre lingue, offline, località libere)? | Product owner |
| OQ-15 | La ricerca libera di un nome fuori catalogo deve continuare a interrogare il backend (che risponde 404 con l'elenco), oppure l'app deve proporre direttamente le località disponibili? | Product owner |
| OQ-16 | Le priorità `must`/`should`/`could` assegnate ai requisiti sono corrette? | Product owner |
| OQ-17 | *(nuova v0.2)* Dopo la migrazione serve ancora un aggiornamento manuale su richiesta (di tutte le località o di una sola, come `--location` in v0.1)? Se sì, chi può lanciarlo e come va protetto, visto che l'API pubblica è in sola lettura (NFR-11)? Gli script Python (`update_forecasts.py`, `previsioni_mare.py`) devono restare utilizzabili in locale? | Product owner |
| OQ-18 | *(nuova v0.2)* Il numero di giorni di previsione deve restare configurabile (1–8 in v0.1) o è fisso a 7? | Product owner |
| OQ-19 | *(nuova v0.2)* In `/health`, il campo `cache_path` (percorso del file, privo di senso con KV) va mantenuto con un altro identificativo, rimosso o rinominato? L'app non lo usa. | Product owner + architect |
| OQ-20 | *(nuova v0.2)* La documentazione interattiva su `/docs` (FR-29) va mantenuta nel backend su Cloudflare? | Product owner |
| OQ-21 | *(nuova v0.2)* La parità di aggregazione (FR-51) deve essere esatta all'ultimo decimale, compresi i casi di arrotondamento al limite (R-5), o è ammessa una tolleranza (es. ±1 unità sull'ultima cifra)? | Product owner |
| OQ-22 | *(nuova v0.2)* Piano Cloudflare: Workers Free o Paid? Con il piano Free il job rischia di superare i limiti di subrequest e di CPU (R-7). | Product owner |
| OQ-23 | *(nuova v0.2)* Passaggio al nuovo backend: il backend Python resta attivo in parallelo durante la migrazione? Quando vanno rimossi `backend/`, `update_forecasts.py` e i test Python? Il cache attuale va migrato su KV o basta il primo aggiornamento (A-4)? | Product owner + architect |

## Changelog
| Date | Version | Change | Reason |
|---|---|---|---|
| 2026-10-03 | 0.1 | Prima stesura brownfield: 48 FR, 14 NFR, 16 domande aperte, ricostruiti dal codice al commit `181c2f3`. | Documentare il prodotto esistente prima di pianificare evoluzioni con il flusso gyukit. |
| 2026-10-03 | 0.2 | Aggiunti FR-49 (aggiornamento automatico su Cloudflare ogni 6 h), FR-50 (parità contratto API), FR-51 (parità aggregazione), FR-52 (esito esecuzione osservabile); aggiunti NFR-15..NFR-18 (limiti Workers/KV, consistenza eventuale KV, concorrenza verso i provider, osservabilità). Riformulati in modo indipendente dal runtime FR-1, FR-2, FR-5, FR-14, FR-17, FR-19, FR-20, FR-24..FR-29 e NFR-2..NFR-5, NFR-11..NFR-14. Superati FR-15, FR-16, FR-21 (CLI Python). OQ-3 risolta in parte, OQ-4, OQ-9 e OQ-13 aggiornate, aggiunte OQ-17..OQ-23, rischi R-5..R-7, vincoli C-1..C-3, assunzione A-4, obiettivo G-6. | Migrazione a Cloudflare Workers, decisione utente 2026-10-03. |
