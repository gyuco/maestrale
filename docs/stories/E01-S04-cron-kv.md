---
id: E01-S04
epic: E01
title: "Cron Trigger e scrittura KV con fallback"
type: feature
status: done
requirements: [FR-1, FR-2, FR-14, FR-18, FR-19, FR-20, FR-49, FR-52, NFR-14, NFR-15, NFR-17]
depends_on: [E01-S00, E01-S01, E01-S02, E01-S03, E01-S05]
verify:
  - cd worker && npm test
  - cd worker && npm run typecheck
  - python3 -m unittest discover -s tests -v
---

# E01-S04: Cron Trigger e scrittura KV con fallback

## Context

Dopo E01-S03 il Worker sa costruire la previsione di una località (`buildForecast`), dopo E01-S05
sa leggerla da KV (`readForecastCache`). Manca il pezzo che le collega: il **job di
aggiornamento** che in Python è `update_forecasts.py` (pianificato da cron/systemd) e che su
Cloudflare diventa un handler `scheduled` con un **Cron Trigger** ogni 6 ore (FR-49, NFR-12), senza
scheduler esterni. Il job aggiorna le 13 località del catalogo, fa merge con il cache precedente
(se una località fallisce resta l'ultima previsione valida) e scrive **una sola chiave KV**
(`latest`), così un lettore non vede mai un cache parziale (FR-19, NFR-14).

### Decisioni del product owner (2026-10-19)

1. **Cron**: confermato `"30 0,6,12,18 * * *"` (UTC) come scritto.
2. **Tutte le località falliscono**: il job **NON scrive** in KV (nessun `put`) se
   `updated_locations` è vuoto. `generated_at` resta quello vecchio, così `/health` diventa
   `stale` onestamente. Diverge deliberatamente da `update_forecasts.py` (che scrive comunque).
   `runUpdate` risolve (non lancia) restituendo `written: false`; l'handler `scheduled` **risolve**
   anch'esso, dopo un `console.error` con il riepilogo, perché un rigetto farebbe ritentare
   inutilmente il cron. Il fallimento resta visibile nei log e nello `stale` di `/health`.
3. **Workers Paid NON ancora confermato**: si procede; il README ("Aggiornamento programmato")
   avvisa esplicitamente che sul piano Free il cron fallirebbe (10 ms CPU, 50 subrequest contro
   26–78) e che Paid va abilitato prima del deploy di produzione (E01-S07).

### Requisiti (testo esatto dal PRD)

- **FR-1** — catalogo chiuso di località, versionato nel repo (`locations.json`), ogni voce con
  `slug`, `name`, `latitude`, `longitude`; 13 località; slug e nomi invariati.
- **FR-2** — il job *shall rifiutare l'esecuzione (errore registrato, nessuna modifica al cache)
  se una voce del catalogo manca di uno dei campi `slug`, `name`, `latitude`, `longitude`*.
- **FR-14** — ogni esecuzione *shall aggiornare tutte le località del catalogo con previsioni per
  7 giorni* (configurabilità dei giorni: OQ-18, qui **fisso a 7**).
- **FR-18** — se l'aggiornamento di una località fallisce, *conservare nel cache l'ultima
  previsione valida di quella località (se esiste) e registrare il messaggio d'errore in
  `errors[<slug>]`*.
- **FR-19** — il job *shall salvare il risultato nel cache su Workers KV in modo che un lettore non
  osservi mai una previsione di località parziale o mista fra due esecuzioni*. Dati logici:
  `schema_version` (1), `generated_at` (fine esecuzione, UTC ISO 8601), `updated_locations`,
  `errors`, `locations: {<slug>: previsione}`.
- **FR-20** — se il cache precedente è assente o non valido, il job *shall partire da un insieme
  vuoto di località invece di fallire*.
- **FR-49** — il job *shall essere eseguito automaticamente sulla piattaforma Cloudflare ogni 6
  ore, senza dipendere da server o scheduler esterni*.
- **FR-52** — ogni esecuzione *shall rendere osservabile il proprio esito*: località aggiornate,
  fallite con messaggio, istante di completamento; le fallite sono esposte da `/health` in
  `update_errors` (già fatto in E01-S05); l'esito complessivo va anche nei log della piattaforma.
- **NFR-14** — lettura concorrente a un aggiornamento: o il precedente o il nuovo, mai un misto;
  **vincolo**: max 1 scrittura/s sulla stessa chiave KV (qui 1 scrittura ogni 6 h).
- **NFR-15** — limiti di piattaforma. Riferimento PRD (2026-10): piano Free 50 subrequest e 10 ms
  CPU per invocazione; piano **Paid** 10.000 subrequest, CPU fino a 15 min per cron con intervallo
  ≥ 1 h, durata cron max 15 min. Un'esecuzione completa richiede **26** chiamate provider nominali
  (13 × 2) e fino a **78** con tutti i retry (3 tentativi): oltre il limite Free.
- **NFR-17** — il job limita le chiamate concorrenti verso Open-Meteo (sostituisce `--workers`,
  default Python 4): qui `MAX_CONCURRENCY = 6` (`worker/src/open_meteo.ts`).

### Riferimento di parità: `update_forecasts.py`

Il payload scritto in KV è quello di `update_forecasts.py:main` (e dell'unico snapshot esistente,
`tests/fixtures/golden_forecasts.json`), con questo ordine di chiavi e queste semantiche:

```
schema_version: 1
generated_at:   istante di FINE esecuzione (calcolato dopo aver atteso tutte le località)
updated_locations: slug aggiornati con successo in QUESTA esecuzione, ORDINATI
errors:         { <slug>: <messaggio> } solo delle località fallite in QUESTA esecuzione
                (non si ereditano gli errori del cache precedente)
locations:      { <slug>: previsione }  = cache precedente + sostituzioni
```

- `forecast.location.slug` **non** lo aggiunge `buildForecast`: lo aggiunge il job, **dopo**
  `name`, `latitude`, `longitude` (ordine: `name, latitude, longitude, slug`, come nel golden).
  `{ ...built, location: { ...built.location, slug } }` preserva l'ordine delle chiavi.
- Merge: si parte da una copia di `previous.locations` (ordine d'inserimento preservato; uno slug
  già presente mantiene la sua posizione quando viene sostituito, uno nuovo è accodato), poi si
  assegna `locations[slug] = forecast` per ogni successo.
- Cache precedente assente (`missing`) **o illeggibile** (`unreadable`) **o con `locations` non
  oggetto** → si parte da `{}` (FR-20, come `load_previous` che cattura `OSError`/`JSONDecodeError`).
- **Con tutte le località fallite il Python scrive comunque** (`updated_locations: []`, exit 1).
  **Decisione del PO (2026-10-19): il Worker NON scrive** in quel caso (vedi *Decisioni del product
  owner*). Il job scrive solo se almeno una località è stata aggiornata; nessuna scrittura anche
  per FR-2 (catalogo invalido). Conseguenza: `generated_at` invecchia e `/health` segnala `stale`.
- **Formato di `generated_at`**: il Python emette `datetime.now(timezone.utc).isoformat()`
  (`+00:00`, microsecondi); il Worker emette `new Date().toISOString()` (`Z`, millisecondi). Si
  **mantiene `toISOString()`**, già scelto in `forecast.ts:defaultNow` (E01-S03): è `format:
  date-time` valido per lo schema, `parseUtc` di `/health` (E01-S05) lo interpreta, e FR-51 esclude
  esplicitamente `fetched_at`/`generated_at` dalla parità. L'app non lo legge.
- **Messaggi d'errore**: `errors[slug]` = `error.message` (Python: `str(exc)`); il testo interno
  delle eccezioni può differire (stesso caso di E01-S05), il formato `Impossibile consultare
  <endpoint>: …` di `fetchJson` è identico.
- **Serializzazione**: `JSON.stringify(payload)` compatto (nessuna indentazione: il Python
  indenta solo per leggibilità del file; l'unico lettore è `readForecastCache`).

### Cron Trigger e ora legale

I Cron Trigger di Cloudflare sono **solo UTC**; non esiste fuso orario né gestione dell'ora legale.
v0.1 pianificava alle 02:30, 08:30, 14:30, 20:30 (NFR-2; il fuso desiderato è OQ-4). Europe/Rome è
UTC+1 (CET, inverno) e UTC+2 (CEST, ora legale). **Decisione**: espressione fissa

```
"30 0,6,12,18 * * *"     // UTC
```

che corrisponde a **02:30/08:30/14:30/20:30 con l'ora legale** (stagione turistica, quando
l'accuratezza è più utile) e a **01:30/07:30/13:30/19:30 in inverno**: l'intervallo di 6 h non
cambia, si sposta solo l'ora locale di 1 h due volte l'anno. Da documentare in `worker/README.md`
(sezione "Aggiornamento programmato") e come commento in `wrangler.jsonc`. Se il proprietario
vuole gli orari invernali (`30 1,7,13,19 * * *`) è una modifica a una stringa (OQ-4).

### CPU, subrequest e piano Cloudflare (OQ-22)

Con il piano Free (50 subrequest, 10 ms CPU) il job non può completare: 26–78 subrequest e 13
`buildForecast` (aggregazioni + JSON di ~2 × 13 risposte) superano i limiti. Il job **richiede
Workers Paid** (10.000 subrequest, CPU fino a 15 min per cron con intervallo ≥ 1 h). Questa storia
**non** aggiunge `limits.cpu_ms` a `wrangler.jsonc` (il default Paid basta; la CPU reale è dell'ordine
dei secondi) ma lo documenta nel README. La decisione sul piano resta del proprietario (OQ-22).
La concorrenza di 6 (≤ limite di 6 connessioni simultanee dei Workers) è già in
`mapWithConcurrency`.

### Interfacce esistenti da riusare (non riscrivere)

- `worker/src/forecast.ts` — `buildForecast(name, latitude, longitude, days, "Europe/Rome", deps)`
  con `deps: ForecastDeps { fetchImpl?, sleep?, now?, retries?, timeoutMs? }` → `BuiltForecast`
  (senza `slug`).
- `worker/src/open_meteo.ts` — `mapWithConcurrency(items, task, limit = MAX_CONCURRENCY)`,
  `MAX_CONCURRENCY = 6`, `FetchImpl`, `SleepFn`. Nota: `mapWithConcurrency` salta gli elementi
  `undefined` (R-5 di S03, nit): qui gli elementi sono oggetti, nessun effetto.
- `worker/src/store.ts` — `CACHE_KEY = "latest"`, `readForecastCache(kv)` →
  `CacheReadResult` (`ok | missing | unreadable`, mai lancia).
- `worker/src/types.ts` — `ForecastCache`, `Forecast`, `ForecastLocation`, `Timezone`.
- `worker/src/env.ts` — `Bindings extends Env` (binding `FORECASTS`).
- `worker/src/index.ts` — oggi `export default { fetch: app.fetch } satisfies ExportedHandler<Env>`
  con il commento-gancio `// E01-S04: handler scheduled`.
- `locations.json` (radice del repo, 13 voci) è il catalogo; importato con `resolveJsonModule`
  (già attivo in `tsconfig.json`; i test importano già da `../../tests/fixtures/*.json`, wrangler
  lo include nel bundle). **Nessuna copia** del catalogo dentro `worker/`.

### Differenze inevitabili da Python

1. Nessun filesystem/`write_json_atomic`: l'atomicità è quella di una singola `KV.put` (FR-19).
2. Nessun codice d'uscita (FR-21 superato da FR-52): l'esito è nel log e in `update_errors`.
   Il handler **non lancia** per fallimenti parziali di località; **lancia** (invocazione
   fallita, visibile nel dashboard) per catalogo invalido (FR-2) o `KV.put` fallita.
3. Concorrenza 6 invece di 4 (NFR-17).
4. Formato di `generated_at` (vedi sopra).

### File probabilmente toccati

- Nuovo `worker/src/update.ts` — logica del job, tutta iniettabile.
- `worker/src/index.ts` — aggiunge `scheduled`.
- `worker/src/forecast.ts` — solo `dailyNumber` (AC-8).
- `worker/wrangler.jsonc` — `triggers.crons`.
- `worker/README.md` — sezione "Aggiornamento programmato".
- Nuovi test: `worker/test/update.test.ts` (e un test su `wrangler.jsonc`); `worker/test/forecast.test.ts`
  (un test in più per AC-8).

### Vincoli

- **Nessuna nuova dipendenza** (né runtime né dev); nessuna modifica a `package.json`/lockfile.
- I **63 test esistenti** restano verdi; **non modificare** né rigenerare le fixture/golden in
  `tests/fixtures/` (solo leggerle). Il backend Python (`update_forecasts.py`, `previsioni_mare.py`,
  `backend/`) resta intatto.
- Nessun `any` e nessun `as` non necessario in `worker/src` (stesso criterio di S05).
- `worker/src/routes/**`, `store.ts`, `env.ts`, `slugify.ts`, `types.ts`: non toccati.

### Fuori scope (esplicito)

- **S05 R-3** (`FORECAST_MAX_AGE_HOURS=""` → trattare come non impostata, `routes/health.ts:18`):
  riguarda la lettura, non il job. **Lasciato fuori**; da assorbire nella prossima storia che tocca
  `routes/health.ts` (o nella storia di debito tecnico di fine epic).
- **S03 R-1/R-2/R-3/R-5**: test/fixture/typing di S03, nessun legame con il cron. Fuori.
- Aggiornamento manuale su richiesta / `--location` (FR-15 superato, OQ-17) e rimozione di
  `update_forecasts.py` (OQ-23, E01-S07).
- `/docs` (E01-S06), CI/deploy.

## Acceptance criteria

- **AC-1** — *Successo, KV vuota.* Given KV senza chiave `latest` e un `fetchImpl` che serve le
  fixture `open_meteo_{marine,weather}_torre-dei-corsari.json` per tutte le 13 località, when si
  esegue `runUpdate`, then `FORECASTS.get("latest")` è un JSON con chiavi **in quest'ordine**
  `schema_version, generated_at, updated_locations, errors, locations`; `schema_version === 1`;
  `generated_at` è il `now` iniettato (ISO UTC); `updated_locations` contiene i 13 slug di
  `locations.json` **ordinati**; `errors` è `{}`; `locations` ha 13 chiavi e ogni voce ha
  `location` con chiavi nell'ordine `name, latitude, longitude, slug` (slug = quello del catalogo).
  Il blocco di `torre-dei-corsari` è deep-equal a
  `tests/fixtures/golden_forecast_torre-dei-corsari.json` con lo stesso `now` di
  `forecast.test.ts`, e per i campi non temporali il payload è compatibile con
  `forecast.schema.json` (FR-19, FR-51).
- **AC-2** — *Fallimento parziale con cache precedente.* Given KV con `latest` = copia di
  `tests/fixtures/golden_forecasts.json` (contiene `cagliari` e `torre-dei-corsari`) e un
  `fetchImpl` che fallisce sempre per le coordinate di Cagliari (retry esauriti, `sleep` no-op),
  when si esegue `runUpdate`, then `locations.cagliari` è **identico** (deep-equal) alla
  previsione precedente, `errors.cagliari` è una stringa non vuota che inizia con
  `Impossibile consultare`, `updated_locations` ha 12 slug e **non** contiene `cagliari`, le altre
  12 località sono aggiornate, `generated_at` è il nuovo `now` (FR-18, FR-19).
- **AC-3** — *Fallimento senza dato precedente; cache precedente invalido.* Given KV vuota (o con
  `latest` = testo non JSON, o JSON senza `locations` oggetto) e una località che fallisce, when
  `runUpdate`, then il job **non lancia**, parte da `locations: {}` (FR-20), la località fallita
  è assente da `locations` ma presente in `errors`, e le altre 12 sono scritte.
- **AC-4** — *Tutte le località falliscono (decisione PO: nessuna scrittura).* Given `fetchImpl`
  che rifiuta sempre e KV con un `latest` preesistente (o vuota), when `runUpdate`, then **non**
  viene chiamata `KV.put` e il valore di `latest` resta byte-identico (o la chiave resta assente);
  il job non lancia e restituisce `written: false` con `updated_locations: []` e `errors` con i 13
  slug. L'handler `scheduled` risolve (non rigetta), emette `console.error` per ogni località e il
  `console.log` di riepilogo `forecast_update` con `updated: 0`, `failed: 13`.
- **AC-5** — *Catalogo invalido (FR-2).* Given un catalogo in cui una voce manca di `slug`,
  `name`, `latitude` o `longitude`, when `runUpdate`, then rifiuta con un errore
  `Localita non valida, campi mancanti: [...]` (campi in ordine alfabetico), **non** chiama
  `fetchImpl` e **non** modifica KV (un `latest` preesistente resta byte-identico).
- **AC-6** — *Concorrenza e subrequest.* Given 13 località e un `fetchImpl` che conta le chiamate
  in volo, when `runUpdate` va a buon fine, then le chiamate in volo non superano **6** (NFR-17)
  e il totale è **26** (2 per località, FR-3/FR-4); l'aggiornamento di una località non attende
  le altre oltre il limite (il tempo non è asserito, solo il picco).
- **AC-7** — *Handler `scheduled` e osservabilità.* Given il default export di `src/index.ts`,
  when si invoca `scheduled(controller, env, ctx)` (con `createScheduledController`,
  `createExecutionContext`, `waitOnExecutionContext` di `cloudflare:test`, e `fetch` globale
  sostituito con le fixture) then la chiave `latest` viene scritta con le 13 località; il handler
  **attende** il job (nessun `waitUntil` non atteso) e **rifiuta** (rigetta la promise) se il
  catalogo è invalido o `KV.put` fallisce; per ogni località fallita emette `console.error` con
  slug e messaggio, e a fine run un `console.log` JSON con `event: "forecast_update"`, `updated`,
  `failed`, `generated_at`, `duration_ms` (FR-52, NFR-18). `fetch` (le route HTTP di E01-S05)
  continua a funzionare.
- **AC-8** — *Cron in `wrangler.jsonc`.* Given `worker/wrangler.jsonc`, when lo si legge nel test
  (import `?raw`, rimozione dei commenti `//` a riga intera, `JSON.parse`), then
  `triggers.crons` è esattamente `["30 0,6,12,18 * * *"]` (ogni 6 h, UTC; 02:30/08:30/14:30/20:30
  con ora legale, 01:30/07:30/13:30/19:30 in inverno), il commento accanto spiega l'effetto
  dell'ora legale, e `worker/README.md` ha la sezione "Aggiornamento programmato" con: espressione
  e conversione UTC↔Europe/Rome, requisito **Workers Paid** con avviso esplicito che sul piano Free il cron fallirebbe (10 ms CPU,
  50 subrequest vs 26–78) e che Paid va abilitato prima del deploy di produzione (E01-S07; NFR-15,
  OQ-22), come provarlo in locale (`wrangler dev --test-scheduled`, poi `curl
  "http://localhost:8787/__scheduled?cron=30+0+*+*+*"`).
- **AC-9** — *S03 R-4 assorbito.* Given una risposta meteo in cui un campo `daily.*` richiesto è
  **assente** (chiave mancante o serie più corta di `time`, in Python `KeyError`/`IndexError`),
  when `buildForecast`, then **lancia** (la località fallisce e finisce in `errors`); un valore
  `null` presente continua a produrre `null` nel campo. Il golden resta deep-equal (nessuna
  fixture modificata: il test deriva la risposta alterata da quella committata, in memoria).
- **AC-10** — Tutti i comandi di `verify` passano: `npm test` (i 63 test esistenti **più** i
  nuovi), `npm run typecheck` (0 errori), suite Python verde; `git diff --stat` non mostra
  modifiche a `tests/fixtures/**`, `package.json`, `package-lock.json`.

## Tasks

- [x] Scrivere `worker/test/update.test.ts` con helper condivisi (fake `fetchImpl` per URL: host
      `marine-api.open-meteo.com` → fixture marine, `api.open-meteo.com` → fixture meteo; fallimento
      per `latitude=…` della località scelta; contatore di chiamate in volo; `sleep` no-op;
      `now` fisso) e vederlo fallire: AC-1 (KV vuota), AC-2 (fallimento parziale), AC-3
      (fallimento senza precedente + cache non valido), AC-4 (tutte falliscono), AC-5 (catalogo
      invalido), AC-6 (concorrenza ≤ 6, 26 chiamate)
- [x] Scrivere il test dell'handler `scheduled` (AC-7) e il test su `wrangler.jsonc`/README (AC-8);
      vederli fallire
- [x] Scrivere in `worker/test/forecast.test.ts` il test di `daily` incompleto (AC-9) e vederlo
      fallire
- [x] Implementare `worker/src/update.ts`: `validateLocations`, `runUpdate(kv, locations, deps)`
      con `deps { fetchImpl?, sleep?, now?, days? }` (default 7, `"Europe/Rome"`), lettura via
      `readForecastCache`, `mapWithConcurrency` con task che cattura l'errore e restituisce un
      risultato `{ slug, forecast } | { slug, error }`, merge, `JSON.stringify`, `kv.put(CACHE_KEY, …)`
      una sola volta; `generated_at = now()` calcolato dopo `mapWithConcurrency` (AC-1..AC-6)
- [x] Cablare `scheduled` in `worker/src/index.ts` (import di `../../locations.json`, `await
      runUpdate(...)`, log di esito e di ogni errore), `satisfies ExportedHandler<Bindings>` (AC-7)
- [x] Correggere `dailyNumber` in `worker/src/forecast.ts` (AC-9)
- [x] Aggiungere `triggers.crons` e il commento sull'ora legale in `worker/wrangler.jsonc`;
      documentare in `worker/README.md` (AC-8)
- [x] Eseguire tutti i comandi di `verify` e `git diff --stat` (AC-10)
- [x] Compilare Dev notes (decisioni: sempre-scrivi, `generated_at`, cron :30 UTC)

## Domande aperte

Risolte dal product owner il 2026-10-19 (vedi *Decisioni del product owner* in Context): 1 cron
invariato; 2 nessuna scrittura se tutte falliscono; 3 (OQ-22) Paid non ancora confermato, avviso
nel README.

## Dev notes
- **Decisioni PO applicate** (2026-10-19): cron invariato; nessuna `put` se `updated_locations` è
  vuoto (AC-4 riscritta); avviso Free/Paid nel README.
- `runUpdate` restituisce `UpdateResult { written, generated_at, updated_locations, errors }`;
  `scheduled` risolve anche quando tutte falliscono (`console.error` per località + riepilogo,
  poi `console.log` JSON `forecast_update`), rigetta per catalogo invalido o `KV.put` fallita.
- `validateLocations` formatta l'errore come la repr Python: `['latitude', 'name']`.
- Cache precedente: `readForecastCache` non valida il payload, quindi `update.ts` lo tratta come
  `unknown` (copre anche JSON `null`) e parte da `{}` se `locations` non è un oggetto (FR-20).
- AC-9: `dailyNumber` lancia se il valore è `undefined` (chiave assente o serie corta), `null` resta `null`.
- AC-1: la compatibilità con `forecast.schema.json` è verificata via deep-equal e ordine chiavi
  col golden (nessun validatore JSON Schema, niente nuove dipendenze).
- `worker/test/raw.d.ts`: dichiarazione tipi per gli import `?raw` usati dal test AC-8.
- File: `worker/src/update.ts` (nuovo), `worker/src/index.ts`, `worker/src/forecast.ts`,
  `worker/wrangler.jsonc`, `worker/README.md`, `worker/test/update.test.ts` (nuovo, 24 test),
  `worker/test/forecast.test.ts` (+3), `worker/test/raw.d.ts`.
- Test: 90 (63 esistenti + 27 nuovi).

## Run log
<!-- Autopilot: iteration | command | result | note -->
1 | cd worker && npm test | 90 passed (prima dell'implementazione: 2 falliti + update.test non caricabile) | ok
1 | cd worker && npm run typecheck | 0 errori | ok
1 | python3 -m unittest discover -s tests -v | 19 OK | ok
1 | git diff --stat | nessuna modifica a tests/fixtures, package.json, lockfile | ok

## Review log
<!-- Reviewer: date, verdict, findings R-1… (blocker/should/nit) with file:line. -->

### 2026-10-19 — Reviewer — verdict: **done**

Verify: `npm test` 90/90 passed; `npm run typecheck` 0 errori; `python3 -m unittest discover -s tests` 19 OK.
`git diff 9342486..HEAD --stat`: nessuna modifica a `tests/fixtures/**`, `package.json`, lockfile.
Parità con `update_forecasts.py` verificata (ordine chiavi, merge, `errors` solo del run corrente,
`updated_locations` ordinati, `slug` dopo `longitude`, cache assente/illeggibile/`locations` non
oggetto → `{}`, catalogo invalido → nessuna fetch né scrittura). Decisione PO "nessuna `put` se tutte
falliscono" rispettata; `scheduled` risolve e logga.
Mutation check (tutti rilevati, poi ripristinati, albero pulito): M1 merge col cache precedente rimosso
→ 2 fail; M2 scrittura anche se tutte falliscono → 3 fail; M3 `dailyNumber` `undefined` → `null` → 2 fail;
M4 concorrenza 13 → 1 fail; M5 `slug` prima di `name` → 1 fail.

Findings (nessun blocker):
- **R-1** (nit) `worker/src/update.ts:91` — `as Record<string, Forecast>` dopo `isRecord`: accettabile,
  è lo stesso confine di fiducia di `store.ts` (payload non validato, come `json.load`). Nessuna azione;
  eventualmente un commento che rimandi a `store.ts`.
- **R-2** (nit) `worker/src/update.ts:57-62` — `String()`/`Number()` accettano in silenzio valori di
  tipo errato (`latitude: "abc"` → `NaN` finisce nell'URL; `slug: null` → `"null"`). In Python `float()`
  lancia in `update_one` e la località va in `errors`. Catalogo versionato, impatto basso; se si tocca
  di nuovo, far fallire la località se `!Number.isFinite(...)`.
- **R-3** (nit) `worker/test/update.test.ts:297` — AC-4 chiede `console.error` *per ogni località*; il test
  verifica solo `toHaveBeenCalled()`. Asserire che ognuno dei 13 slug compaia nelle righe d'errore.
- **R-4** (nit) `worker/test/update.test.ts:123-132` — il test su `generated_at` dipende dal numero di
  chiamate a `now` dentro `buildForecast` (≥ 39); fragile se `buildForecast` cambia. Alternativa: `now`
  che restituisce `T-end` solo dopo che il fake fetch ha servito la 26ª chiamata.
- **R-5** (nit) `worker/src/update.ts:143` — `summary()` senza tipo di ritorno esplicito; usare
  `Omit<UpdateResult, "written">`.
- **R-6** (nit) AC-7 "rigetta con catalogo invalido" non è testato a livello di handler (catalogo importato
  staticamente); coperto da AC-5 su `runUpdate`, che `scheduled` attende senza catch. Accettabile.
