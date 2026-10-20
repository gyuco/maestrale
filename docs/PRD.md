---
id: PRD
status: approved        # draft | approved — only the user approves
version: 0.5
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
> La v0.3 recepisce due task my-planner dell'owner, collegati (il primo blocca il secondo):
> **"Scalabilità del backend a ~500 località"** (`cmvfp0lzk0009711ssui58rjh`, scala decisa
> dall'owner il 2026-10-19) e **"Catalogo località: un'unica fonte, servita da GET /locations"**
> (`cmvfof5zz0005k8j3ga6i3hp1`). Le scelte di layout del cache (KV per località o D1) sono
> demandate all'architect (ADR-0003).
>
> La v0.4 recepisce le **decisioni dell'owner del 2026-10-20** sulle domande aperte OQ-22,
> OQ-24..OQ-27 (piano Workers, 404 troncato, forma del catalogo, snapshot nell'app, dismissione di
> `latest`), sulla precedenza del catalogo nell'app (FR-65) e sull'interruttore del fallback (FR-54).
>
> La v0.5 recepisce due task my-planner dell'owner: **"Storico giornaliero su Cloudflare D1"**
> (`cmvfovcfd0003711so0tnk3gl`, con le decisioni owner D-1..D-6, sezione 7 C-8) e **"Schermata
> storico nell'app Flutter"** (`cmvfoytba0005711shtx2bdgj`). Lo storico contiene le **previsioni
> del giorno stesso (giorno 0)**, non misure osservate; le osservazioni reali restano fuori scope.
>
> **Legenda colonna "Fonte"**
> - **T** — comportamento verificato da almeno un test automatico esistente (implementazione Python).
> - **R** — comportamento dichiarato esplicitamente nel `README.md` (e presente nel codice).
> - **D** — dedotto solo dalla lettura del codice; nessun test né documentazione lo fissa.
> - **U** — deriva da una decisione esplicita dell'utente (2026-10-03: migrazione a Cloudflare).
> - **P** — deriva da un task my-planner dell'owner (v0.3; id nel changelog). La scala di ~500
>   località è una decisione esplicita dell'owner del 2026-10-19 (marcata **U**).
> - "mod. 0.2" indica un requisito riformulato in v0.2 per renderlo indipendente dal runtime;
>   "mod. 0.3" un requisito modificato in v0.3; "mod. 0.4" un requisito modificato in v0.4 su
>   decisione dell'owner del 2026-10-20; "mod. 0.5" un requisito modificato in v0.5 per lo storico.
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
| G-1 | Previsioni giornaliere a 7 giorni per tutte le località supportate | `GET /health` → `locations` = numero di voci del catalogo (oggi 13, fino a ~500: NFR-19) e `update_errors` vuoto |
| G-2 | Dati sempre freschi | `GET /health` → `stale = false` (età cache ≤ soglia, default 12 h) |
| G-3 | Servizio disponibile anche se il provider è giù | `/forecast` continua a rispondere 200 con l'ultimo dato valido dopo un aggiornamento fallito |
| G-4 | Trasparenza sull'origine dei dati | Ogni risposta `/forecast` contiene `sources.sea` e `sources.weather` con licenza e cella risolta |
| G-5 | Consultazione semplice da mobile | *Nessun segnale definito* (nessuna analytics nell'app) — vedi OQ-2 |
| G-6 | Migrazione a Cloudflare trasparente per l'app (U) | L'app Flutter esistente funziona puntando `API_BASE_URL` al nuovo backend, senza modifiche al codice dell'app (FR-50) |
| G-7 | *(v0.5)* Consultare l'andamento passato delle condizioni previste per una località (P) | `GET /history` restituisce una riga per ogni giorno, dall'attivazione dello storico, in cui il job ha aggiornato la località (FR-69, FR-71); nessun segnale d'uso nell'app (OQ-2) |

## 3. Non-goals
Escluso dal prodotto attuale (constatato nel codice; da confermare come scelta voluta, OQ-14):
- **Località arbitrarie**: niente geocoding né previsioni per coordinate libere; solo le
  località del catalogo (oggi 13, fino a ~500: NFR-19). *(mod. 0.3)*
- **Previsioni orarie** o intra-giornaliere esposte all'utente: solo aggregati giornalieri.
- **Osservazioni reali**: nessuna misura da boe, stazioni o satelliti. *(mod. 0.5: in v0.1–v0.4
  questa voce escludeva anche lo storico; lo storico delle **previsioni del giorno 0** entra in
  scope, sezioni 5.10–5.12, ma i suoi valori restano previsioni, non misure, FR-82, FR-90.)*
- **Backfill dello storico** *(v0.5)*: nessun recupero di giorni anteriori all'attivazione dello
  storico né di giorni in cui il job non ha aggiornato una località (C-8).
- **Storico di grandezze diverse** da quelle di FR-69 *(v0.5)* (es. vento, periodo e direzione
  delle onde, `weather_code`), e dei giorni di previsione successivi al giorno 0.
- **Cache offline dello storico nell'app** *(v0.5)*: coerente con il non-goal sul funzionamento
  offline delle previsioni.
- **Copernicus Marine** come sorgente operativa: gli script in `legacy/` sono solo riferimento
  sperimentale e non partecipano alla pipeline (R).
- **Account utente, autenticazione, sincronizzazione** delle preferenze fra dispositivi.
- **Scrittura via API**: il backend espone solo `GET`; l'aggiornamento dati è un processo separato
  dalla gestione delle richieste HTTP.
- **Notifiche/allerte**: il pulsante "Notifiche" esiste nell'app ma non fa nulla (OQ-8).
- **Lingue diverse dall'italiano**.
- **Funzionamento offline dell'app per le previsioni** (nessun cache lato client delle
  previsioni). *(mod. 0.3: il solo catalogo località è disponibile offline, FR-65.)*
- **Fan-out del job su più invocazioni (es. Cloudflare Queues)** finché la misura di NFR-21 non
  ne dimostra la necessità. *(v0.3)*
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
- **S-7 Storico** *(v0.5)* — Dalla schermata previsioni l'utente apre lo storico della località
  mostrata, sceglie "7 giorni", "30 giorni", "12 mesi" o un intervallo personalizzato e vede
  grafico, stato del mare e tabella dei valori previsti giorno per giorno (o mese per mese).

## 5. Functional requirements

### 5.1 Catalogo località e sorgenti dati

| ID | Requirement | Priority | Fonte |
|---|---|---|---|
| FR-1 | Il sistema shall supportare un catalogo chiuso di località costiere, gestito in un'unica fonte (FR-61; oggi `locations.json` nel repository), in cui ogni voce ha `slug`, `name`, `latitude`, `longitude`. Il catalogo deve poter contenere fino a ~500 località (NFR-19). Al 2026-10-20 contiene 13 località: Alghero, Arbatax, Cagliari, Carloforte, Chia, La Maddalena, Olbia, Oristano, Porto Torres, Santa Teresa Gallura, Siniscola, Torre dei Corsari, Villasimius. Slug e nomi esistenti restano invariati. | must | R, mod. 0.2, mod. 0.3 |
| FR-2 | Il job di aggiornamento shall rifiutare l'esecuzione (errore registrato, nessuna modifica al cache) se una voce del catalogo manca di uno dei campi `slug`, `name`, `latitude`, `longitude`. | should | D, mod. 0.2 |
| FR-3 | Per ogni località il sistema shall richiedere alla Open-Meteo Marine Weather API (`https://marine-api.open-meteo.com/v1/marine`) le variabili orarie `wave_height`, `wave_direction`, `wave_period`, `sea_surface_temperature` con `cell_selection=sea`, `models=best_match`, `timezone=Europe/Rome` e `forecast_days` pari al numero di giorni (FR-14). | must | T |
| FR-4 | Per ogni località il sistema shall richiedere alla Open-Meteo Weather Forecast API (`https://api.open-meteo.com/v1/forecast`) le variabili orarie `temperature_2m`, `wind_speed_10m`, `wind_direction_10m`, `wind_gusts_10m` e giornaliere `weather_code`, `temperature_2m_min`, `temperature_2m_max`, `wind_speed_10m_max`, `wind_gusts_10m_max`, con `cell_selection=land`, `models=best_match`, `timezone=Europe/Rome`. | must | T |
| FR-5 | Endpoint, variabili, selezione del modello e della cella, attribuzione, URL di documentazione e di licenza di ciascun provider shall essere dichiarati in un unico punto del codice backend (oggi `data_sources.py`) e da lì usati sia per costruire le richieste sia per la provenienza. | should | R, mod. 0.2 |
| FR-61 | *(v0.3)* Unica fonte del catalogo: il job di aggiornamento, la risoluzione della località in `/forecast` (FR-22) e `GET /locations` (FR-62) shall usare lo stesso catalogo; aggiungere, rimuovere o rinominare una località richiede una sola modifica, in un solo punto, e non richiede modifiche al codice dell'app. *(mod. 0.4, OQ-25 risolta)* La fonte è il file versionato `locations.json` nel repository: ogni modifica del catalogo passa da commit e deploy; non esiste una modifica del catalogo a runtime. | must | P, mod. 0.4 |

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
| FR-53 | *(v0.3)* Chiamate a blocchi: il job shall richiedere le previsioni a Open-Meteo con chiamate multi-coordinata, raggruppando le località in blocchi (una richiesta Marine e una Forecast per blocco, con gli stessi parametri di FR-3/FR-4). La dimensione massima del blocco è configurabile senza modificare il codice (valore: scelta dell'architect, entro il massimo ammesso dal provider). A parità di risposte del provider, la previsione prodotta per ogni località è identica a quella ottenuta con chiamate per singola località (FR-51). | must | P |
| FR-54 | *(v0.3)* Retry per blocco e fallback per località: ogni richiesta di blocco shall essere ritentata secondo FR-17; se un blocco fallisce dopo tutti i tentativi (o la risposta non contiene dati validi per alcune località), il job shall richiedere singolarmente, sempre secondo FR-17, le sole località interessate. Una località che fallisce anche singolarmente è trattata come in FR-18. Il fallback rispetta il budget di durata dell'esecuzione (NFR-5, NFR-15): le località non tentate per esaurimento del budget risultano fallite con un messaggio d'errore esplicito in `errors[<slug>]`. *(mod. 0.4)* **Interruttore per guasto diffuso:** se in un'esecuzione falliscono dopo tutti i tentativi **più del 50%** delle richieste di blocco (Marine e Forecast contate separatamente; soglia proposta, da confermare: OQ-28), il job shall saltare il fallback per singola località per l'intera esecuzione: non invia alcuna richiesta singola, ogni località interessata da un blocco fallito conserva il dato precedente (FR-18) e riceve in `errors[<slug>]` un messaggio che indica l'attivazione dell'interruttore; le località dei blocchi riusciti sono aggiornate normalmente. La condizione è valutata dopo che tutte le richieste di blocco hanno esaurito i tentativi e prima di qualunque richiesta singola; con esattamente il 50% di blocchi falliti il fallback si esegue. Un blocco con dati non validi solo per alcune località non conta come fallito. L'attivazione è registrata nell'esito dell'esecuzione (FR-52). | must | P, mod. 0.4 |
| FR-55 | *(v0.3)* Cache per località: il job shall memorizzare la previsione di ciascuna località come record indipendente e un record di metadati dell'esecuzione (`schema_version`, `generated_at`, `updated_locations`, `errors`, numero di località), così che l'aggiornamento o la lettura di una località non richieda di leggere o riscrivere le altre. Restano garantite FR-18 (dato precedente conservato), FR-19 (nessuna previsione di località parziale o mista) e NFR-14. Layout proposto dal task: Workers KV con chiavi `forecast:<slug>` e `meta`; alternativa: Cloudflare D1. Decisione demandata all'architect (ADR-0003). | must | P |
| FR-59 | *(v0.3)* Migrazione dal cache unico `latest`: durante e dopo il passaggio al cache per località (FR-55), ogni località presente in `latest` shall restare servita da `/forecast` con 200 (con il dato di `latest` finché la nuova esecuzione non l'ha aggiornata); in nessun momento del passaggio `/forecast` risponde 404 o 503 per una località che `latest` contiene. Meccanismo (seed da `latest` o lettura di ripiego): scelta dell'architect. *(mod. 0.4, OQ-27 risolta)* Dopo il passaggio il job shall non scrivere più `latest` (nessuna doppia scrittura): `latest` resta con il contenuto dell'ultima esecuzione precedente al passaggio. | must | P, mod. 0.4 |
| FR-60 | *(v0.3, mod. 0.4)* Rollback e dismissione di `latest`: la chiave `latest` shall restare presente e non modificata finché non sono soddisfatte entrambe le condizioni: (a) sono trascorsi almeno 14 giorni dal rilascio del cache per località senza alcun rollback (un rollback fa ripartire il conteggio dal rilascio successivo); (b) `/health` risponde `status = ok` al momento della cancellazione. Solo allora `latest` può essere cancellata. Finché `latest` esiste, il ritorno alla versione precedente del Worker (che legge `latest`) shall ripristinare un servizio funzionante senza interventi manuali sui dati; dopo il rollback `/health` può risultare `degraded` per età del dato (accettato, conseguenza dell'assenza di doppia scrittura, FR-59). Dopo la cancellazione di `latest` il rollback a quella versione non è più supportato. | must | P, mod. 0.4 |

### 5.5 API backend

| ID | Requirement | Priority | Fonte |
|---|---|---|---|
| FR-22 | `GET /forecast?localita=<valore>` shall restituire 200 con la previsione completa (FR-12, FR-13, giorni FR-6..FR-11) della località il cui slug o nome normalizzato coincide con il valore normalizzato (minuscole, accenti rimossi, spazi/underscore → trattino). Es.: "Torre dei Corsari" e "torre-dei-corsari" sono equivalenti. | must | T |
| FR-23 | Se la località non esiste nel cache, `/forecast` shall rispondere 404 con `detail.message` ("Localita '<valore>' non trovata") e `detail.available` = elenco ordinato dei nomi disponibili. *(mod. 0.3: con il catalogo fino a ~500 località `detail.available` è soggetto all'eccezione FR-58.)* | must | T (solo 404), mod. 0.3 |
| FR-24 | Se il cache non è ancora stato popolato, `/forecast` shall rispondere 503 con `detail` = "Previsioni non ancora disponibili"; se il contenuto del cache non è valido, 503 con descrizione dell'errore in `detail`. | must | D, mod. 0.2 |
| FR-25 | Un parametro `localita` assente o vuoto shall produrre un errore di validazione 422 con corpo JSON contenente il campo `detail`. | should | D, mod. 0.2 |
| FR-26 | `GET /health` shall rispondere sempre 200 con `status` = `ok` oppure `degraded`. Con cache valido riporta `generated_at`, `age_hours` (2 decimali), `stale`, `locations` (numero), `update_errors`. `status` è `degraded` se l'età supera la soglia configurata (FR-28), se `generated_at` manca, se `errors` non è vuoto, se il cache è assente o non valido (in questi ultimi due casi con `error` e un identificativo del cache, in v0.1 `cache_path`: vedi OQ-19). | must | T (solo caso `ok`), mod. 0.2 |
| FR-27 | Dopo il completamento di un aggiornamento, il backend shall servire i nuovi dati senza redeploy né riavvio, entro il ritardo di propagazione ammesso da NFR-16. | must | D, mod. 0.2 |
| FR-28 | Senza modificare il codice, il backend shall essere configurabile per: soglia di dati vecchi in ore (default 12) e origini CORS consentite (default `*`, lista). CORS consente solo il metodo `GET` (più le preflight necessarie). La configurazione del percorso del cache (`FORECAST_CACHE_PATH` in v0.1) è superata: il collegamento a KV è scelta dell'architect. Nomi dei parametri: scelta dell'architect. | should | R, mod. 0.2 |
| FR-29 | Il backend shall esporre la documentazione interattiva dell'API (in v0.1 OpenAPI generata da FastAPI su `/docs`). Mantenimento dopo la migrazione da confermare (OQ-20). | could | R, mod. 0.2 |
| FR-50 | Parità di contratto: per gli stessi dati in cache, le risposte di `/forecast` e `/health` del backend su Cloudflare shall avere gli stessi codici HTTP, nomi di campo, tipi, arrotondamenti e semantica dell'implementazione Python al commit `181c2f3`, così che l'app Flutter esistente funzioni senza modifiche. Eccezioni ammesse solo se elencate esplicitamente in questo PRD (oggi: identificativo del cache in `/health`, OQ-19; `detail.available` nel 404 di `/forecast`, FR-58). Nuovi endpoint additivi (FR-62) non costituiscono eccezione. | must | U, mod. 0.3 |
| FR-56 | *(v0.3)* `/health` shall ricavare `generated_at`, `age_hours`, `stale`, `locations` e `update_errors` dal solo record di metadati (FR-55), senza leggere le previsioni delle singole località; contratto e semantica restano quelli di FR-26 e FR-50. | must | P |
| FR-57 | *(v0.3)* `/forecast` shall servire una località leggendo solo il record di quella località (più, se necessario, il catalogo per risolvere nome → slug, FR-22), senza leggere le previsioni delle altre località; il numero di letture dello storage per richiesta non cresce con il numero di località. | must | P |
| FR-58 | *(v0.3, mod. 0.4, OQ-24 risolta)* Eccezione esplicita a FR-50 per il 404 di `/forecast`: `detail.message` resta invariato (FR-23), mentre `detail.available` shall contenere solo i **primi 50 nomi** dell'elenco ordinato di FR-23, nello stesso formato (array di stringhe, nessun campo aggiuntivo). Con un catalogo di 50 località o meno la risposta è identica a FR-23. La dimensione del corpo del 404 non cresce quindi al crescere del catalogo oltre 50 località. L'app non usa `detail.available` (FR-33 usa solo `detail.message`). | must | P, mod. 0.4 |
| FR-62 | *(v0.3)* `GET /locations` shall restituire 200 con l'intero catalogo (FR-61): per ogni località `slug`, `name`, `latitude`, `longitude`, ordinate per `name`. L'endpoint è in sola lettura (solo `GET`, più `HEAD` e le preflight necessarie), senza autenticazione, con la stessa configurazione CORS di FR-28, e non chiama mai i provider. Struttura dell'involucro JSON (es. campo di versione): scelta dell'architect. | must | P |
| FR-63 | *(v0.3)* Cache HTTP di `/locations`: la risposta 200 shall includere un `Cache-Control` pubblico di lunga durata (valore configurabile senza modificare il codice; proposta 24 h, OQ-13) e un `ETag` che cambia se e solo se cambia il contenuto del catalogo; una richiesta con `If-None-Match` uguale all'`ETag` corrente riceve 304 senza corpo. | should | P |
| FR-64 | *(v0.3)* Additività: l'introduzione di `/locations` shall lasciare invariati `/forecast` e `/health` (FR-50, salvo le eccezioni elencate). I test di parità esistenti restano verdi senza modifiche alle fixture. | must | P |
| FR-51 | Parità di aggregazione: a parità di risposte Open-Meteo in ingresso, il nuovo job shall produrre previsioni giornaliere identiche a quelle dell'implementazione Python (FR-6..FR-13, esclusi gli istanti `fetched_at`/`generated_at`). La tolleranza ammessa sugli arrotondamenti va confermata (OQ-21). | must | U |

### 5.6 App Flutter — previsione

| ID | Requirement | Priority | Fonte |
|---|---|---|---|
| FR-30 | L'app shall offrire un campo di ricerca con suggerimenti: digitando, mostra le località del catalogo (ottenuto dal repository, FR-67) il cui nome contiene il testo (senza distinzione maiuscole/minuscole); selezionando un suggerimento avvia la ricerca. | must | T |
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
| FR-43 | Dal pulsante "Apri mappa" l'app shall aprire una mappa (tile OpenStreetMap, attribuzione "OpenStreetMap contributors") con un pin per ciascuna località del catalogo ottenuto dal repository (FR-67), inquadrate tutte all'apertura (zoom 6–14), con raggruppamento dei pin vicini secondo FR-68. Se il testo di ricerca corrente coincide con nome o slug di una località, questa risulta già selezionata. *(mod. 0.3: in v0.2 "13 località" fisse nell'app.)* | must | T, mod. 0.3 |
| FR-44 | Toccando un pin, l'app shall evidenziarlo, centrare la mappa sulla località (zoom 10) e mostrare una scheda con il nome e il pulsante "Vedi meteo"; premendolo torna alla schermata previsioni e carica quella località. | must | T |
| FR-45 | La mappa shall offrire una ricerca con suggerimenti sulle località del catalogo ottenuto dal repository (FR-67); all'invio seleziona la località con nome/slug esatto o, in mancanza, la prima il cui nome contiene il testo; se nessuna corrisponde mostra "Località non trovata tra quelle disponibili." | should | D, mod. 0.3 |
| FR-46 | All'apertura della mappa e con il pulsante "La mia posizione", l'app shall tentare di localizzare l'utente: se i servizi di localizzazione sono spenti, il permesso è negato o la posizione non è ottenibile entro 15 s mostra un messaggio specifico; se il permesso è negato permanentemente offre il pulsante "Impostazioni"; se riesce mostra un marker "La tua posizione" e centra la mappa (zoom 12,5). | should | D |
| FR-47 | Il pulsante "Mostra tutte le località" shall reinquadrare la mappa su tutte le località. | could | D |
| FR-48 | L'URL del backend shall essere configurabile in fase di build con `--dart-define=API_BASE_URL=...` (default `http://localhost:8000`). | must | R |
| FR-68 | *(v0.3)* Con molte località la mappa shall raggruppare i pin vicini in cluster che mostrano il numero di località contenute; toccando un cluster la mappa si avvicina fino a separarne i pin; ai livelli di zoom in cui i pin non si sovrappongono sono mostrati i pin singoli, con il comportamento di FR-44. Con 500 località la mappa resta utilizzabile secondo NFR-22. | should | P |

### 5.9 App Flutter — catalogo località *(v0.3)*

| ID | Requirement | Priority | Fonte |
|---|---|---|---|
| FR-65 | *(mod. 0.4, OQ-26 risolta)* L'app shall ottenere il catalogo tramite un unico componente (LocationRepository) che: (1) fornisce **subito**, senza attendere la rete, l'ultima copia locale salvata sul dispositivo oppure, se non esiste, lo **snapshot del catalogo incluso nell'app** (aggiornato a ogni release); (2) contemporaneamente richiede `GET /locations` (FR-62) con timeout di 15 s (NFR-6); (3) se la risposta di rete arriva con successo, sostituisce la copia locale salvata e il catalogo in uso, e ricerca e mappa (FR-67) usano da quel momento il nuovo catalogo; (4) se la rete fallisce, continua a usare la copia locale o lo snapshot, senza mostrare errori bloccanti. Ricerca e mappa sono quindi sempre utilizzabili, anche al primo avvio senza rete. | must | P, mod. 0.4 |
| FR-66 | Quando possiede una copia locale con `ETag`, il LocationRepository shall inviare `If-None-Match`; su 304 mantiene la copia locale senza riscaricare il catalogo. | could | P |
| FR-67 | Suggerimenti di ricerca (FR-30, FR-45), pin e inquadratura della mappa (FR-43, FR-47) e l'eventuale individuazione della località più vicina alla posizione dell'utente (OQ-10) shall usare esclusivamente il catalogo fornito dal LocationRepository; l'app non contiene più un elenco di località scritto nel codice (risolve R-1). | must | P |

### 5.10 Storico giornaliero — scrittura *(v0.5)*

> Task `cmvfovcfd0003711so0tnk3gl`. Lo storico è su **Cloudflare D1** (C-8); schema, indici e
> modalità di scrittura sono scelta dell'architect. "Giorno 0" (d0) = il giorno della previsione la
> cui data (fuso Europe/Rome) coincide con la data di esecuzione del job nello stesso fuso.

| ID | Requirement | Priority | Fonte |
|---|---|---|---|
| FR-69 | Il sistema shall conservare al massimo un record di storico per coppia (slug località, data Europe/Rome), con i valori del giorno 0 della previsione: `air_temperature_mean_c`, `air_temperature_min_c`, `air_temperature_max_c` (da `weather`, FR-8), `water_temperature_mean_c`, `state` (stato del mare), `wave_height_mean_m`, `wave_height_max_m` (da `sea`, FR-7, FR-10). I valori sono identici, compresi arrotondamenti e `null`, a quelli che `/forecast` serve per quel giorno dopo la stessa esecuzione. | must | P |
| FR-70 | A ogni esecuzione del job (FR-49), per ogni località aggiornata con successo, il sistema shall scrivere il record del giorno 0 con semantica di upsert: se per (slug, data) esiste già un record, viene sostituito. Alla fine della giornata il record riflette quindi l'ultima esecuzione riuscita per quella località in quel giorno. Se la previsione non contiene il giorno 0, nessun record è scritto per quella località e il fatto è registrato nell'esito dell'esecuzione (FR-52). | must | P |
| FR-71 | Una località fallita nell'esecuzione (FR-18, inclusi i casi di interruttore e di budget esaurito di FR-54) shall non scrivere né modificare alcun record di storico; un eventuale record dello stesso giorno scritto da un'esecuzione precedente resta invariato. | must | P |
| FR-72 | Un errore di scrittura dello storico (parziale o totale) shall essere registrato nell'esito dell'esecuzione (FR-52, con numero di record non scritti e messaggio) e shall non impedire né annullare l'aggiornamento del cache delle previsioni (FR-19, FR-55): a parità di risposte dei provider, il contenuto servito da `/forecast` è lo stesso con o senza errore dello storico. *(Proposta, OQ-31:)* l'errore non è aggiunto a `errors[<slug>]`, quindi non cambia `/health` (FR-26, FR-50). | must | P |
| FR-73 | Lo storico shall essere scritto solo dal job di aggiornamento; nessun endpoint HTTP consente di scrivere, modificare o cancellare record di storico (NFR-11). | must | P |

### 5.11 Storico giornaliero — API `GET /history` *(v0.5)*

| ID | Requirement | Priority | Fonte |
|---|---|---|---|
| FR-74 | `GET /history?localita=<valore>&from=<YYYY-MM-DD>&to=<YYYY-MM-DD>&granularity=<day\|month>` shall risolvere `localita` come `/forecast` (slug o nome normalizzato, FR-22) e considerare l'intervallo di date Europe/Rome da `from` a `to`, estremi inclusi. `granularity` è facoltativo, default `day`. *(Proposta, OQ-30:)* `from` e `to` sono obbligatori. | must | P |
| FR-75 | Con `granularity=day`, la risposta 200 shall contenere slug e nome della località, `granularity`, `from`, `to` e l'elenco, ordinato per data crescente, dei record di storico (FR-69) della località con data nell'intervallo, ciascuno con la propria data `YYYY-MM-DD`. I giorni senza record sono omessi (nessun riempimento); senza alcun record l'elenco è vuoto e la risposta resta 200. Nomi dei campi dei valori: quelli di FR-69; struttura dell'involucro JSON: scelta dell'architect. | must | P |
| FR-76 | Con `granularity=month`, la risposta 200 shall contenere un elemento per ogni mese di calendario (`YYYY-MM`) che ha almeno un record nell'intervallo, ordinati per mese crescente, calcolato sui soli record con data in [`from`, `to`]: media di `air_temperature_mean_c`, minimo di `air_temperature_min_c`, massimo di `air_temperature_max_c`, media di `water_temperature_mean_c`, media di `wave_height_mean_m`, massimo di `wave_height_max_m`, `state` = moda degli stati giornalieri (a parità di frequenza vince lo stato più alto della scala Douglas di FR-10), `days` = numero di record aggregati. I valori `null` sono ignorati; se tutti i valori di un campo sono `null` il risultato è `null`. L'aggregazione è eseguita nello storage (SQL, C-8). *(Proposta, OQ-32:)* arrotondamento a 1 decimale per le temperature e a 2 decimali per le onde. | must | P |
| FR-77 | `/history` shall rispondere 422 con corpo JSON contenente `detail` (in italiano) quando: `localita` è assente o vuoto; `from` o `to` mancano o non sono date valide `YYYY-MM-DD`; `from` > `to`; `granularity` è diverso da `day` e `month`; con `day` l'intervallo supera 366 giorni (estremi inclusi); con `month` l'intervallo supera 10 anni, cioè tocca più di 120 mesi di calendario. | must | P |
| FR-78 | Se la località non è nel catalogo, `/history` shall rispondere 404 con lo stesso formato di `/forecast` (`detail.message` come FR-23, `detail.available` come FR-58). *(Proposta, OQ-31:)* se lo storage dello storico non è leggibile, 503 con descrizione in `detail`. | must | P |
| FR-79 | La risposta 200 di `/history` shall includere `Cache-Control` pubblico **breve** se `to` è uguale o successivo alla data odierna Europe/Rome, **lungo** se l'intervallo è interamente nel passato. Entrambe le durate sono configurabili senza modificare il codice (proposta: 15 min e 24 h, OQ-32). | should | P |
| FR-80 | `/history` shall essere in sola lettura (solo `GET`, più `HEAD` e le preflight necessarie, come FR-62), senza autenticazione, con la stessa configurazione CORS di FR-28, e non chiama mai i provider. | must | P |
| FR-81 | Additività: l'introduzione dello storico (scrittura e `/history`) shall lasciare invariati `/forecast`, `/health` e `/locations` (FR-50, FR-62, FR-64); i test di parità FR-50/FR-51 esistenti restano verdi senza modifiche alle fixture. | must | P |
| FR-82 | La documentazione dell'API per i client (README e, se mantenuta, FR-29) shall dichiarare che i valori di `/history` sono **previsioni del giorno stesso** (giorno 0, ultima esecuzione riuscita del giorno), non misure osservate, e che lo storico parte dalla data di attivazione senza backfill. | must | P |

### 5.12 App Flutter — storico *(v0.5)*

> Task `cmvfoytba0005711shtx2bdgj`. Layout, componenti grafici e libreria dei grafici sono scelta
> dell'architect (OQ-33). Le date dei preset sono calcolate nel fuso Europe/Rome (NFR-10).

| ID | Requirement | Priority | Fonte |
|---|---|---|---|
| FR-83 | Con una previsione caricata, la schermata previsioni shall offrire un comando "Storico" che apre la schermata storico della località mostrata (identificata dallo slug della previsione). Senza previsione caricata il comando non è disponibile. | must | P |
| FR-84 | La schermata storico shall offrire i preset "7 giorni", "30 giorni" e "12 mesi", che terminano oggi (incluso): rispettivamente da oggi − 6 giorni, da oggi − 29 giorni e dal giorno successivo alla stessa data di 12 mesi prima. *(Proposta, OQ-34:)* all'apertura è selezionato "7 giorni". | must | P |
| FR-85 | La schermata storico shall consentire un intervallo personalizzato scelto con un selettore di date (inizio e fine): la fine non può essere successiva a oggi, l'inizio non può essere successivo alla fine e l'intervallo non può superare il limite di FR-77 per la granularità `month`; selezioni che violano questi vincoli non sono confermabili. | must | P |
| FR-86 | Granularità: per intervalli fino a 366 giorni (estremi inclusi) l'app shall offrire un selettore giorno/mese, con default giorno; per intervalli più lunghi usa solo `month` e il selettore non consente "giorno". Ogni cambio di preset, intervallo o granularità invia una nuova richiesta `/history` con i parametri corrispondenti. | must | P |
| FR-87 | Con dati presenti, la schermata shall mostrare un grafico a linee con la temperatura media dell'aria, una banda fra minima e massima dell'aria e la temperatura media del mare, su un asse temporale per giorno o per mese; i valori `null` sono mostrati come interruzioni della linea, senza valori inventati. Shall mostrare inoltre lo stato del mare per ogni giorno o mese. | must | P |
| FR-88 | La schermata shall mostrare una tabella con una riga per giorno (o mese) e i valori di FR-69 (per i mesi anche `days`, FR-76), in ordine cronologico; i valori `null` sono mostrati come "n.d.". | must | P |
| FR-89 | Stati: durante il caricamento la schermata shall mostrare un indicatore di avanzamento; con risposta 200 ed elenco vuoto mostra un messaggio di assenza dati (proposta: "Nessun dato storico per il periodo selezionato"); in caso di errore (HTTP ≠ 200 incluso 404 e 422, timeout di 15 s, errore di rete, risposta non valida) mostra il messaggio estratto con le stesse regole di FR-33 (`detail` testuale o `detail.message`, altrimenti messaggio generico con il codice HTTP) e un pulsante "Riprova" che ripete l'ultima richiesta. | must | P |
| FR-90 | Quando sono mostrati dati storici, la schermata shall mostrare in modo sempre visibile la nota che i valori sono previsioni del giorno, non misure (proposta di testo: "Valori previsti per il giorno stesso, non misure osservate"). | must | P |
| FR-91 | L'app shall accedere a `/history` tramite un componente dedicato (HistoryApi) con `http.Client` iniettabile (NFR-13), che costruisce la richiesta di FR-74 sull'URL di FR-48 e converte la risposta nei modelli HistoryDay (granularità giorno) e HistoryMonth (granularità mese); i campi di valore `null` sono accettati senza errore (diversamente da R-2), mentre una risposta strutturalmente non valida produce l'errore "Risposta del server non valida". | must | P |

## 6. Non-functional requirements
Ogni target è marcato come **Vincolo** (imposto da decisione utente, provider o piattaforma: va
rispettato), **Attuale** (valore già presente nel prodotto, da preservare) o **Proposto**
(suggerito dall'analista, da confermare nella domanda aperta indicata).

| ID | Requirement | Target |
|---|---|---|
| NFR-1 | Freschezza dati: il cache è considerato vecchio oltre una soglia configurabile; `/health` lo segnala come `degraded`. | **Attuale**: età cache ≤ 12 h — R |
| NFR-2 | Frequenza di aggiornamento: il job gira automaticamente su Cloudflare (FR-49). *(mod. 0.2: in v0.1 era pianificato esternamente con cron.)* | **Attuale**: ogni 6 h (in v0.1 alle 02:30, 08:30, 14:30, 20:30); orari esatti e fuso: OQ-4 |
| NFR-3 | Resilienza: un guasto del provider o di una singola località non rende indisponibile il servizio né cancella dati validi; il cache non è mai osservabile in stato parziale. *(mod. 0.2)* | **Attuale**: 0 risposte servite da dati parziali; località fallita servita con l'ultimo dato valido (FR-18, FR-19) |
| NFR-4 | Prestazioni API: `/forecast` e `/health` servono dati letti dal cache, senza chiamare i provider. *(mod. 0.2)* | **Proposto**: p95 < 200 ms misurato dal client in Italia, invariato con 13 e con 500 località (FR-57) — da confermare (OQ-13) *(mod. 0.3)* |
| NFR-5 | Durata aggiornamento: 2 richieste provider per blocco di località (FR-53), più le eventuali richieste singole di fallback (FR-54). *(mod. 0.2, mod. 0.3)* | **Vincolo**: un'esecuzione completa deve stare nei limiti di durata/CPU della piattaforma (NFR-15). **Proposto**: < 5 min nel caso peggiore con retry (OQ-13) |
| NFR-6 | Timeout: chiamate upstream 30 s × max 3 tentativi; chiamata app → backend 15 s; geolocalizzazione 15 s. | **Attuale**: valori fissi come indicato — D |
| NFR-7 | Attribuzione e licenza: ogni risposta `/forecast` riporta attribuzione e URL licenza Open-Meteo; la mappa riporta l'attribuzione OpenStreetMap. | **Vincolo** (licenza Open-Meteo): 100% delle risposte `/forecast` con `sources.*.attribution` e `license_url` — T. Attribuzione Open-Meteo nell'UI dell'app: assente (OQ-9) |
| NFR-8 | Nessun segreto richiesto: i provider sono usati senza API key. | **Attuale**: 0 credenziali applicative nella configurazione — R |
| NFR-9 | Privacy: la posizione del dispositivo è usata solo localmente sulla mappa e non è inviata al backend; il permesso richiesto è "durante l'uso". La località iniziale è salvata solo sul dispositivo. | **Attuale**: 0 dati personali inviati al backend (solo il parametro `localita`) — D |
| NFR-10 | Localizzazione: interfaccia, messaggi d'errore e nomi (stato mare, venti) in italiano; date giornaliere nel fuso Europe/Rome; orario di aggiornamento in ora locale del dispositivo. | **Attuale**: 100% stringhe UI e messaggi API in italiano — D |
| NFR-11 | Sicurezza API: API in sola lettura (solo `GET`), nessuna autenticazione, CORS configurabile; servita solo via HTTPS tramite Cloudflare. *(mod. 0.2)* *(mod. 0.5: vale anche per `/history`; lo storico è scritto solo dal job, FR-73.)* | **Vincolo** (U): nessun endpoint pubblico di scrittura; HTTPS gestito da Cloudflare. Restrizione CORS in produzione: OQ-3 |
| NFR-12 | Piattaforme/runtime: backend su **Cloudflare Workers in TypeScript** con cache su **Workers KV** (sostituisce Python/FastAPI/uvicorn e `data/forecasts.json`); app Flutter 3.x, Dart SDK ^3.11.5, configurazioni Android e iOS presenti. *(mod. 0.2)* *(mod. 0.5: lo storico giornaliero è su **Cloudflare D1**, C-8; il cache delle previsioni resta come da ADR-0003.)* | **Vincolo** (U) per il backend. Piattaforme target ufficiali dell'app: OQ-3 |
| NFR-13 | Testabilità: backend e app hanno suite di test automatici eseguibili in locale senza accesso ai provider né all'account Cloudflare; client API, archivio preferenze e servizio di localizzazione dell'app restano iniettabili. Le suite coprono la parità FR-50/FR-51 con fixture. Test runner: scelta dell'architect. *(mod. 0.2)* *(mod. 0.5: scrittura dello storico, aggregazione mensile e `/history` sono testabili in locale con uno storage D1 locale o simulato; la HistoryApi dell'app è testabile con un `http.Client` finto, FR-91.)* | **Proposto**: suite backend e Flutter verdi su ogni modifica |
| NFR-14 | Concorrenza: una lettura concorrente a un aggiornamento restituisce o la previsione precedente o la nuova, mai un misto. *(mod. 0.2: in v0.1 lock + rename atomico del file)* | **Vincolo**: rispettare il limite KV di 1 scrittura/s sulla stessa chiave |
| NFR-15 | Limiti piattaforma Cloudflare: il job e l'API devono rispettare i limiti del piano Workers in uso per invocazione (subrequest, tempo CPU, durata, memoria 128 MB) e di Workers KV (valore ≤ 25 MiB, 1 scrittura/s per chiave, quote giornaliere di letture/scritture). Riferimento (doc Cloudflare, 2026-10): piano Free 50 subrequest e 10 ms CPU per invocazione, 1.000 scritture KV/giorno, 100.000 letture KV/giorno; piano Paid 10.000 subrequest, CPU fino a 30 s per cron con intervallo < 1 h e fino a 15 min con intervallo ≥ 1 h, durata cron max 15 min. Con 13 località e chiamate singole un'esecuzione richiede 26 chiamate provider nominali e fino a 78 con tutti i retry, cioè più del limite Free. *(v0.3)* Con 500 località e blocchi da 50 (esempio): 20 chiamate nominali, 60 con i retry dei blocchi, fino a ~3.000 nel caso peggiore di fallback totale (FR-54); con il cache per località (FR-55) ~501 scritture KV per esecuzione, ~2.004 al giorno, oltre la quota Free di 1.000/giorno. *(mod. 0.4, OQ-22 risolta: "Free ora, Paid alla soglia", C-5)* Il servizio resta sul piano Free finché le misure (NFR-21) rientrano nei limiti Free; il passaggio a Paid avviene **prima** che un limite Free venga superato. **Regola go/no-go per Paid** (coerente con E01-S07 AC-7/AC-9): si passa a Paid appena si verifica almeno una delle condizioni seguenti: (a) un'esecuzione del job fallisce per CPU, subrequest o quota KV; (b) un'esecuzione nominale misura **CPU > 7 ms** o **subrequest > 40** (margine ~30% sui limiti di 10 ms e 50); (c) le scritture KV giornaliere misurate o stimate superano **700/giorno** (stesso margine sulla quota di 1.000; soglia proposta: OQ-29); (d) nessuna esecuzione completa nelle ultime 24 h; (e) prima di aprire l'app ad altri utenti (decisione owner 2026-10-19, E01-S07); (f) in ogni caso prima che il catalogo arrivi a ~500 località (NFR-19). Una modifica che porterebbe a superare una soglia (es. aggiunta di località al catalogo, FR-61) si rilascia solo dopo il passaggio a Paid. *(mod. 0.5)* Lo storico (C-8) deve rispettare anche i limiti di **D1** (doc Cloudflare, 2026-10): dimensione database 500 MB (Free) / 10 GB (Paid); 50 query per invocazione (Free) / 1.000 (Paid); 100 parametri per query; 100 KB per istruzione SQL; 30 s per query; quote giornaliere di righe lette/scritte del piano (da verificare sulla pagina prezzi). Con 500 località una scrittura per località e per esecuzione supera le 50 query Free: il modo di raggruppare le scritture è scelta dell'architect; se le query D1 debbano entrare nella regola go/no-go: OQ-35. | **Vincolo** (piattaforma). **Vincolo** (U, 2026-10-20): piano Free con regola go/no-go per Paid come a sinistra |
| NFR-16 | Consistenza: Workers KV è a consistenza eventuale; dopo un aggiornamento alcune location di Cloudflare possono servire ancora il dato precedente per un breve intervallo (la doc Cloudflare indica tipicamente fino a ~60 s). Accettabile dato l'intervallo di 6 h e la soglia di 12 h. | **Vincolo** (piattaforma) accettato. **Proposto**: nuovi dati visibili ovunque entro 5 min dalla fine del job |
| NFR-17 | Uso corretto dei provider: il job limita le chiamate concorrenti verso Open-Meteo (sostituisce `--workers`, FR-16) e resta entro i limiti d'uso gratuiti di Open-Meteo. | **Attuale**: max 4 località in parallelo. *(v0.3: con FR-53 il limite si applica alle richieste di blocco e di fallback in volo.)* Quota con 500 località: NFR-20. Rischio limiti per IP condivisi Cloudflare: OQ-9 |
| NFR-18 | Osservabilità: esito e durata di ogni esecuzione del job e gli errori dell'API sono consultabili dall'operatore negli strumenti di log della piattaforma. *(mod. 0.5: l'esito include il numero di record di storico scritti e gli eventuali errori di scrittura, FR-70, FR-72.)* | **Proposto**: log conservati per almeno 7 giorni; allerting: OQ-4 |
| NFR-19 | *(v0.3)* Scala: il sistema (job, API, app) supporta un catalogo fino a ~500 località, decisione dell'owner del 2026-10-19. Il costo di `/forecast` e `/health` non cresce con il numero di località (FR-56, FR-57). *(mod. 0.4)* La crescita del catalogo verso 500 località è subordinata alla regola go/no-go di NFR-15: a quella scala il piano Paid è obbligatorio, e il passaggio avviene prima di raggiungerla. | **Vincolo** (U): 500 località, sul piano Paid (NFR-15). **Proposto**: esecuzione completa con 500 località < 5 min nominale e entro la durata massima cron del piano Paid (15 min, NFR-15) nel caso peggiore; ≤ 2 letture storage per richiesta API; `GET /locations` con 500 località < 100 KB non compresso |
| NFR-20 | *(v0.3)* Quota Open-Meteo gratuita: il job resta entro i limiti d'uso gratuiti (doc Open-Meteo, 2026-10: 600 chiamate/min, 5.000/h, 10.000/giorno, 300.000/mese). Le richieste multi-coordinata sono conteggiate in modo pesato (circa una chiamata per località, più per molte variabili o lunghi intervalli): stima analista con 500 località, 2 API e 4 esecuzioni/giorno ≈ 4.000 chiamate pesate/giorno nominali, oltre 10.000 con retry e fallback diffusi (R-6, R-8). | **Vincolo** (provider): mai oltre 600 chiamate pesate/min (il job distribuisce le richieste nel tempo). **Proposto**: consumo nominale ≤ 50% della quota giornaliera; piano a pagamento Open-Meteo: OQ-9 |
| NFR-21 | *(v0.3)* Misura prima del fan-out: ogni esecuzione del job registra durata, numero di blocchi, numero di fallback per località, subrequest totali e scritture sullo storage (estende NFR-18). Il fan-out su più invocazioni (es. Cloudflare Queues) è introdotto solo se la misura su 500 località supera la soglia indicata a destra. | **Proposto**: soglia = durata o CPU di un'esecuzione oltre il 50% del limite del piano (NFR-15) in almeno una esecuzione reale — da confermare (OQ-13) |
| NFR-22 | *(v0.3)* Prestazioni app con 500 località: apertura della mappa, spostamento/zoom con cluster (FR-68) e suggerimenti di ricerca restano fluidi; il catalogo dalla copia locale o dallo snapshot è disponibile senza attendere la rete (FR-65). *(mod. 0.4)* | **Proposto**: mappa visualizzata < 1 s dopo "Apri mappa" con catalogo locale; suggerimenti < 100 ms per carattere digitato, su dispositivo di riferimento da definire (OQ-13) |
| NFR-23 | *(v0.5)* Prestazioni di `/history`: la richiesta legge solo i record della località richiesta e il costo non cresce con il numero di località del catalogo; l'aggregazione mensile avviene nello storage (FR-76). | **Proposto**: p95 < 300 ms misurato dal client in Italia per 366 giorni (`day`) e per 120 mesi (`month`), con 500 località e 10 anni di storico — da confermare (OQ-13) |
| NFR-24 | *(v0.5)* Capacità dello storico: lo storage dello storico regge 500 località (NFR-19) × 10 anni di record giornalieri (≈ 1,83 milioni di record) entro i limiti D1 del piano in uso (NFR-15), senza cancellazioni. | **Vincolo** (piattaforma): dimensione del database entro il limite del piano. **Proposto**: occupazione stimata e misurata documentata dall'architect; politica di conservazione oltre 10 anni: OQ-36 |
| NFR-25 | *(v0.5)* Impatto sul job: la scrittura dello storico non compromette il budget dell'esecuzione (NFR-5, NFR-15) e il suo esito è misurato (NFR-21: query e righe D1 scritte per esecuzione). | **Proposto**: durata aggiuntiva < 5 s nominale con 500 località; numero di query D1 per esecuzione entro il limite per invocazione del piano (NFR-15) |
| NFR-26 | *(v0.5)* Prestazioni della schermata storico: grafico e tabella con il numero massimo di punti (366 giorni o 120 mesi) restano fluidi. | **Proposto**: grafico e tabella visualizzati < 1 s dopo la ricezione della risposta, scorrimento della tabella senza scatti percepibili, su dispositivo di riferimento da definire (OQ-13) |

## 7. Constraints and assumptions
**Decisioni utente (vincoli confermati, 2026-10-03)**
- C-1 Il backend (API + job di aggiornamento) gira su **Cloudflare Workers**, scritto in
  **TypeScript**, e sostituisce FastAPI/uvicorn.
- C-2 Il cache delle previsioni è su **Workers KV** e sostituisce `data/forecasts.json`.
- C-3 Hosting e HTTPS sono forniti da Cloudflare.
- Restano all'architect: framework HTTP, test runner, configurazione di deploy, layout delle chiavi
  KV, meccanismo di pianificazione, strategia di rilascio.

**Decisione owner (2026-10-19)**
- C-4 Il prodotto deve scalare a un catalogo di ~500 località (NFR-19). Layout del cache per
  località su KV o su D1: ADR-0003 (architect).

**Decisioni owner (2026-10-20)**
- C-5 Piano Cloudflare Workers: **Free ora, Paid alla soglia** secondo la regola go/no-go di
  NFR-15 (OQ-22).
- C-6 Catalogo località = file versionato `locations.json` nel repository (FR-61, OQ-25); l'app
  include uno snapshot del catalogo (FR-65, OQ-26).
- C-7 Nessuna doppia scrittura di `latest`; cancellazione dopo 14 giorni senza rollback e con
  `/health` ok (FR-59, FR-60, OQ-27). `detail.available` nel 404 troncato a 50 nomi (FR-58, OQ-24).

**Decisioni owner D-1..D-6 (task `cmvfovcfd0003711so0tnk3gl`, v0.5)**
- C-8 Storico giornaliero, decisioni già prese dall'owner e registrate come vincoli:
  - lo storico è memorizzato su **Cloudflare D1**;
  - contenuto: per località e per giorno, i valori del **giorno 0** della previsione (FR-69),
    scritti con **upsert** dall'ultima esecuzione riuscita del giorno, data locale **Europe/Rome**
    (FR-70); una località fallita non scrive (FR-71);
  - un errore D1 è registrato nell'esito dell'esecuzione e **non blocca** l'aggiornamento del
    cache (FR-72);
  - **nessun backfill** (sezione 3);
  - API **additiva** `GET /history` con granularità `day` (default, max 366 giorni) e `month`
    (max 10 anni), località risolta come `/forecast`, 404/422, aggregazione mensile **in SQL**
    con moda dello stato del mare e pareggio verso lo stato più alto Douglas (FR-74..FR-81);
  - scala fino a ~500 località (NFR-19); i valori sono previsioni, non misure, e va documentato
    (FR-82, FR-90).
  - *Nota dell'analista:* questa versione è redatta dal riassunto del task, senza accesso al testo
    originale di D-1..D-6; la corrispondenza puntuale fra D-n e le voci sopra va verificata (OQ-37).

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
- A-3 Il traffico API atteso è basso. *(mod. 0.3: la scala del catalogo è invece un requisito,
  NFR-19.)*
- A-4 La migrazione non richiede di conservare il contenuto dell'attuale `data/forecasts.json`:
  il primo aggiornamento su Cloudflare ricostruisce il cache (OQ-23).

**Incongruenze e rischi rilevati** (non sono requisiti, servono ad architect e planner)
- R-1 L'elenco località è duplicato: `locations.json` (backend) e `app/lib/models/coastal_location.dart` (app). Non esiste un endpoint che esponga il catalogo (OQ-5). *(v0.3: indirizzato da FR-61, FR-62, FR-65, FR-67.)*
- R-2 Il backend può emettere campi `null` (es. `state`, `water_temperature_mean_c`, direzioni) mentre il modello dati dell'app li richiede non nulli: una risposta con un `null` fa fallire la visualizzazione dell'intera località ("Risposta del server non valida"). Inoltre un giorno senza alcuna altezza d'onda valida fa fallire l'aggiornamento dell'intera località (OQ-6).
- R-3 `/forecast` non comunica se il dato è vecchio e l'app mostra sempre il badge "Live" (OQ-7).
- R-4 Molti campi calcolati (onda massima, periodo, direzione onde, raffiche, vento massimo, provenienza) non sono mostrati nell'app (OQ-11).
- R-5 (v0.2) Arrotondamenti: Python `round()` arrotonda a pari sulla rappresentazione binaria (es. `round(0.125, 2) = 0.12`), mentre i metodi JavaScript comuni si comportano diversamente; senza attenzione FR-51 fallisce sui valori al limite (OQ-21).
- R-6 (v0.2) Le chiamate in uscita da Cloudflare Workers partono da IP condivisi: i limiti per IP del piano gratuito Open-Meteo potrebbero essere raggiunti anche per traffico altrui, causando errori 429 (OQ-9). *(v0.3: rischio aggravato con 500 località, NFR-20.)*
- R-7 (v0.2) Con il piano Workers Free il job non rientra nei limiti di subrequest nel caso peggiore e il budget di CPU di 10 ms è a rischio (NFR-15, OQ-22). *(v0.3: con 500 località e cache per località anche la quota Free di scritture KV/giorno è superata.)* *(v0.4: mitigato dalla regola go/no-go di NFR-15, C-5: si resta su Free solo finché le misure restano sotto CPU 7 ms, 40 subrequest e 700 scritture KV/giorno; il rischio residuo è un superamento tra due misure, che si manifesta come esecuzione fallita, condizione (a), mentre `/forecast` continua a servire l'ultimo dato valido, FR-18.)*
- R-8 (v0.3) Il peso esatto con cui Open-Meteo conteggia le richieste multi-coordinata (per località, variabili, giorni) non è verificato: la stima di NFR-20 va confermata con una misura reale. Inoltre retry e fallback per località (FR-54), in caso di guasto diffuso del provider, moltiplicano il consumo di quota proprio quando il provider è in difficoltà. *(v0.4: la seconda parte è mitigata dall'interruttore di FR-54, che con più del 50% dei blocchi falliti salta il fallback per singola località; soglia da confermare, OQ-28. Resta da verificare il peso delle richieste multi-coordinata.)*
- R-9 (v0.3) Con record separati (FR-55) e consistenza eventuale (NFR-16), per un breve intervallo `/health` (dal record di metadati) e `/forecast` (dal record della località) possono riflettere esecuzioni diverse. Accettabile per lo stesso motivo di NFR-16, salvo diversa indicazione dell'owner.
- R-10 (v0.5) I valori dello storico sono previsioni del giorno 0 con modello `best_match` (che può cambiare nel tempo, sezione 7): confronti fra periodi diversi possono riflettere cambi di modello e non variazioni reali. Mitigazione: FR-82, FR-90.
- R-11 (v0.5) Il giorno 0 dipende dall'ultima esecuzione riuscita del giorno: con gli orari attuali (ultima alle 20:30, OQ-4) il record di un giorno si stabilizza solo dopo l'ultima esecuzione; se tutte le esecuzioni di un giorno falliscono per una località, quel giorno manca (nessun backfill). Un'esecuzione a cavallo della mezzanotte Europe/Rome scrive sul giorno della propria data di esecuzione (definizione in 5.10).
- R-12 (v0.5) Scrittura dello storico e cache delle previsioni sono storage distinti (D1 e quello di ADR-0003): dopo un errore D1 (FR-72) lo storico di un giorno può non corrispondere a quanto servito da `/forecast`; accettato dall'owner (C-8).

## 8. Open questions
| # | Question | Owner |
|---|---|---|
| OQ-1 | Chi sono i target user (bagnanti, diportisti, surfisti/kiter, pescatori, turisti, operatori turistici)? Ci sono esigenze diverse per gruppo che cambiano le priorità? | Product owner (Giuseppe Concas) |
| OQ-2 | Quali metriche di successo vogliamo (utenti attivi, ritenzione, sessioni/giorno, errori lato app, uptime)? Serve introdurre analytics/crash reporting nell'app? | Product owner |
| OQ-3 | **Risolta in parte (v0.2):** hosting = Cloudflare Workers + Workers KV, HTTPS tramite Cloudflare. Restano aperte: valore delle origini CORS in produzione; dominio pubblico dell'API; piattaforme ufficiali dell'app (Android, iOS, web, desktop) e pubblicazione sugli store. | Product owner + architect |
| OQ-4 | *(aggiornata v0.2)* L'aggiornamento ogni 6 h ora gira su Cloudflare (FR-49): gli orari attuali (02:30, 08:30, 14:30, 20:30) vanno mantenuti, e in quale fuso (UTC o Europe/Rome)? Chi viene avvisato, e come, quando `/health` è `degraded` o un'esecuzione ha località fallite? La soglia di 12 h è corretta? | Product owner (operatore) |
| OQ-5 | L'elenco località deve restare duplicato nell'app oppure l'app deve ottenerlo dal backend (nuovo endpoint)? È previsto aggiungere località (e con quale processo)? *(v0.3: proposta di risoluzione dal task `cmvfof5zz0005k8j3ga6i3hp1`: l'app lo ottiene da `GET /locations`, FR-62/FR-65; la crescita a ~500 località è decisa, C-4. Resta aperto il processo di aggiunta, legato a OQ-25.)* *(v0.4: con OQ-25 risolta, aggiungere una località = modificare `locations.json`, commit e deploy, rispettando la regola go/no-go di NFR-15; proposta di chiusura, da confermare dall'owner.)* | Product owner |
| OQ-6 | Comportamento atteso con dati mancanti dal provider: mostrare il giorno con "n.d." per i singoli campi, nascondere il giorno, o fallire come oggi? | Product owner |
| OQ-7 | L'utente deve essere avvisato quando i dati sono vecchi (es. età > 12 h)? Il badge "Live" deve riflettere lo stato reale? `/forecast` deve esporre un indicatore di freschezza? | Product owner |
| OQ-8 | Il pulsante "Notifiche" (oggi inattivo) va implementato (es. allerte mare mosso/vento), nascosto, o rimosso? | Product owner |
| OQ-9 | Il prodotto è commerciale? In tal caso servono piano a pagamento Open-Meteo (con API key, che toglierebbe anche il rischio R-6 dei limiti per IP condivisi Cloudflare) e un fornitore di tile diverso da `tile.openstreetmap.org`. L'attribuzione Open-Meteo va mostrata anche nell'interfaccia dell'app? *(v0.3: con 500 località il consumo stimato è ~40% della quota gratuita giornaliera in condizioni nominali e può superarla con retry/fallback diffusi, NFR-20, R-8: la scelta gratuito/a pagamento diventa più urgente.)* | Product owner |
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
| OQ-22 | **Risolta (v0.4, decisione owner 2026-10-20):** piano Workers **Free ora, Paid alla soglia**, con regola go/no-go in NFR-15 (C-5). Testo originale: *(nuova v0.2)* Piano Cloudflare: Workers Free o Paid? Con il piano Free il job rischia di superare i limiti di subrequest e di CPU (R-7). **Proposta di chiusura (v0.3, da confermare dall'owner): piano Workers Paid**, perché con 500 località il piano Free non regge né le subrequest del caso peggiore (FR-54) né le scritture KV giornaliere del cache per località (NFR-15), indipendentemente dalla scelta KV/D1 di ADR-0003 per quanto riguarda CPU e subrequest. | Product owner |
| OQ-23 | *(nuova v0.2)* Passaggio al nuovo backend: il backend Python resta attivo in parallelo durante la migrazione? Quando vanno rimossi `backend/`, `update_forecasts.py` e i test Python? Il cache attuale va migrato su KV o basta il primo aggiornamento (A-4)? | Product owner + architect |
| OQ-24 | **Risolta (v0.4, decisione owner 2026-10-20):** `detail.available` troncato ai primi 50 nomi, stesso formato (FR-58). Testo originale: *(nuova v0.3)* 404 di `/forecast` (FR-58): `detail.available` va **troncato** (es. primi N nomi in ordine, con N da definire, ed eventualmente il totale) oppure **rimosso**? In alternativa si possono suggerire le località più simili al testo cercato. L'app non usa il campo; eventuali client terzi sì. | Product owner + architect |
| OQ-25 | **Risolta (v0.4, decisione owner 2026-10-20):** file versionato `locations.json` (FR-61, C-6). Testo originale: *(nuova v0.3)* Fonte unica del catalogo (FR-61): **file versionato** nel repository (ogni modifica passa da commit e deploy, storico in git) oppure **tabella D1** (modifica senza deploy, serve un processo/strumento di modifica protetto, NFR-11)? Da coordinare con ADR-0003. | Product owner + architect |
| OQ-26 | **Risolta (v0.4, decisione owner 2026-10-20):** snapshot del catalogo incluso nell'app, mostrato subito e sostituito dal catalogo di rete quando arriva (FR-65, C-6). Testo originale: *(nuova v0.3)* Primo avvio dell'app senza rete e senza copia locale (FR-65): includere nell'app uno **snapshot** del catalogo (funziona subito ma può essere obsoleto; va aggiornato a ogni release) oppure mostrare il messaggio **"Connessione necessaria"** con "Riprova"? | Product owner |
| OQ-27 | **Risolta (v0.4, decisione owner 2026-10-20):** nessuna doppia scrittura di `latest`; cancellazione dopo 14 giorni senza rollback e con `/health` ok (FR-59, FR-60, C-7). Testo originale: *(nuova v0.3)* Migrazione da `latest` (FR-59, FR-60): durante la transizione il job deve continuare a scrivere anche `latest` (rollback con dati freschi) o basta conservarlo com'è (rollback con dati vecchi)? Dopo quanto tempo, o a quale condizione, `latest` può essere cancellato? | Product owner + architect |
| OQ-28 | *(nuova v0.4)* Interruttore del fallback (FR-54): la soglia proposta "più del 50% delle richieste di blocco fallite, Marine e Forecast contate separatamente" va bene? Deve essere configurabile senza modificare il codice? | Product owner |
| OQ-29 | *(nuova v0.4)* Regola go/no-go per Paid (NFR-15): la soglia proposta di **700 scritture KV/giorno** (stesso margine ~30% di CPU 7 ms e subrequest 40) va bene? Con il cache per località (FR-55) e 4 esecuzioni/giorno corrisponde a circa 170 località. | Product owner |
| OQ-30 | *(nuova v0.5)* `/history` (FR-74): `from` e `to` sono obbligatori (proposta, assenza → 422) o hanno un default (es. ultimi 7 giorni)? Un `to` nel futuro è ammesso (proposta: sì, senza dati oltre oggi) o è 422? Per `month`, `from`/`to` restano date `YYYY-MM-DD` (proposta, mesi parziali agli estremi con `days` che lo rivela) o diventano `YYYY-MM`? | Product owner + architect |
| OQ-31 | *(nuova v0.5)* Errori D1: un errore di scrittura dello storico deve rendere `/health` `degraded` (oggi proposto di no, per non alterare FR-26/FR-50, FR-72)? Con D1 non leggibile, `/history` risponde 503 (proposta FR-78)? | Product owner + architect |
| OQ-32 | *(nuova v0.5)* Arrotondamento degli aggregati mensili (proposta: 1 decimale temperature, 2 onde, FR-76) e durate di `Cache-Control` di `/history` (proposta: 15 min breve, 24 h lungo, FR-79): vanno bene? | Product owner + architect |
| OQ-33 | *(nuova v0.5, per l'architect)* App storico: libreria dei grafici (verificare prima `fl_chart`: banda min/max fra due linee, interruzioni sui `null`, prestazioni con 366 punti, licenza), rappresentazione dello stato del mare per giorno/mese (etichette, icone o fascia colorata) e layout della tabella su schermi stretti (8–9 colonne: scorrimento orizzontale, colonne ridotte o righe espandibili). | Architect |
| OQ-34 | *(nuova v0.5)* App storico: preset selezionato all'apertura (proposta "7 giorni", FR-84); il preset "12 mesi" deve usare per default la granularità mese invece di giorno (FR-86)? Il comando "Storico" va mostrato anche quando la previsione è in errore (località nota ma `/forecast` non disponibile)? | Product owner |
| OQ-35 | *(nuova v0.5, per l'architect)* Limiti D1 (NFR-15, NFR-24, NFR-25): come raggruppare le scritture per restare entro 50 query/invocazione (Free) e 100 parametri/query; occupazione stimata di 10 anni × 500 località rispetto ai 500 MB Free; le query/righe D1 vanno aggiunte alle soglie go/no-go per Paid? | Architect + Product owner |
| OQ-36 | *(nuova v0.5)* Conservazione dello storico: i record vanno conservati indefinitamente o cancellati oltre una certa età (es. 10 anni, il massimo interrogabile)? Cosa succede allo storico di una località rimossa o rinominata nel catalogo (FR-61): resta interrogabile, viene cancellato, segue il nuovo slug? | Product owner |
| OQ-37 | *(nuova v0.5)* Verificare che C-8 riporti fedelmente le decisioni D-1..D-6 del task `cmvfovcfd0003711so0tnk3gl` (redatto dal riassunto, non dal testo del task). | Product owner |

## Changelog
| Date | Version | Change | Reason |
|---|---|---|---|
| 2026-10-03 | 0.1 | Prima stesura brownfield: 48 FR, 14 NFR, 16 domande aperte, ricostruiti dal codice al commit `181c2f3`. | Documentare il prodotto esistente prima di pianificare evoluzioni con il flusso gyukit. |
| 2026-10-03 | 0.2 | Aggiunti FR-49 (aggiornamento automatico su Cloudflare ogni 6 h), FR-50 (parità contratto API), FR-51 (parità aggregazione), FR-52 (esito esecuzione osservabile); aggiunti NFR-15..NFR-18 (limiti Workers/KV, consistenza eventuale KV, concorrenza verso i provider, osservabilità). Riformulati in modo indipendente dal runtime FR-1, FR-2, FR-5, FR-14, FR-17, FR-19, FR-20, FR-24..FR-29 e NFR-2..NFR-5, NFR-11..NFR-14. Superati FR-15, FR-16, FR-21 (CLI Python). OQ-3 risolta in parte, OQ-4, OQ-9 e OQ-13 aggiornate, aggiunte OQ-17..OQ-23, rischi R-5..R-7, vincoli C-1..C-3, assunzione A-4, obiettivo G-6. | Migrazione a Cloudflare Workers, decisione utente 2026-10-03. |
| 2026-10-20 | 0.3 | Aggiunti FR-53..FR-60 (chiamate Open-Meteo a blocchi, retry per blocco e fallback per località, cache per località + metadati, `/health` dai metadati, `/forecast` a costo costante, eccezione FR-50 per `detail.available` nel 404, migrazione e rollback da `latest`), FR-61..FR-68 (catalogo a fonte unica, `GET /locations` con Cache-Control/ETag/304, additività, LocationRepository rete → copia locale → snapshot, revalidazione condizionale, uso esclusivo del repository in ricerca/mappa/località più vicina, clustering della mappa); aggiunti NFR-19..NFR-22 (scala 500 località, quota Open-Meteo, misura prima del fan-out, prestazioni app). Modificati FR-1, FR-23, FR-30, FR-43, FR-45, FR-50, NFR-4, NFR-5, NFR-15, NFR-17, G-1, non-goal (località, offline, fan-out), A-3, R-1, R-6, R-7, OQ-5, OQ-9; proposta di chiusura di OQ-22 (piano Paid, decide l'owner); aggiunti C-4, R-8, R-9, OQ-24..OQ-27. Nessun ID rinumerato. | Task my-planner `cmvfp0lzk0009711ssui58rjh` (scalabilità a ~500 località, decisione owner 2026-10-19) e `cmvfof5zz0005k8j3ga6i3hp1` (catalogo da `GET /locations`), il primo blocca il secondo. |
| 2026-10-20 | 0.4 | Risolte OQ-22, OQ-24, OQ-25, OQ-26, OQ-27. Modificati: NFR-15 (piano Free con regola go/no-go per Paid: esecuzione fallita, CPU > 7 ms, subrequest > 40, scritture KV > 700/giorno, nessuna run completa in 24 h, apertura ad altri utenti, prima di ~500 località), NFR-19 (500 località solo su Paid), NFR-22 (snapshot), FR-54 (interruttore: con > 50% dei blocchi falliti nessun fallback per località), FR-58 (`detail.available` = primi 50 nomi), FR-59 (nessuna scrittura di `latest`), FR-60 (cancellazione di `latest` dopo 14 giorni senza rollback e con `/health` ok), FR-61 (fonte = `locations.json` versionato), FR-65 (copia locale o snapshot subito, sostituita dal catalogo di rete). Aggiornati R-7, R-8, OQ-5. Aggiunti C-5..C-7, OQ-28, OQ-29. Nessun ID rinumerato. | Decisioni dell'owner del 2026-10-20 sulle domande aperte della v0.3. |
| 2026-10-20 | 0.5 | Aggiunti FR-69..FR-73 (storico giornaliero del giorno 0 su D1: contenuto, upsert Europe/Rome, località fallita non scrive, errore D1 non bloccante, sola scrittura dal job), FR-74..FR-82 (`GET /history`: parametri, granularità `day`/`month`, aggregazione mensile con moda dello stato del mare, 422/404, Cache-Control breve/lungo, sola lettura e CORS, additività, documentazione "previsioni, non misure"), FR-83..FR-91 (schermata storico nell'app: accesso, preset, intervallo personalizzato, granularità, grafico, tabella, stati, nota, HistoryApi con HistoryDay/HistoryMonth); aggiunti NFR-23..NFR-26 (prestazioni `/history`, capacità D1, impatto sul job, prestazioni schermata). Modificati: non-goal "Storico / osservazioni reali" (resta escluso solo l'osservato; aggiunti non-goal backfill, altre grandezze, cache offline dello storico), NFR-11, NFR-12, NFR-13, NFR-15 (limiti D1), NFR-18. Aggiunti G-7, S-7, C-8, R-10..R-12, OQ-30..OQ-37. Status riportato a `draft`. FR-50/FR-51 invariati. Nessun ID rinumerato. | Task my-planner `cmvfovcfd0003711so0tnk3gl` (storico su D1, decisioni owner D-1..D-6) e `cmvfoytba0005711shtx2bdgj` (schermata storico nell'app). |
