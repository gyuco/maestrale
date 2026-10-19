---
id: RUNBOOK
status: draft
updated: 2026-10-19
---

# Runbook — Maestrale (Cloudflare Worker)

Operatività del backend in `worker/`. Tutti i comandi `wrangler` si lanciano da `worker/` (con
`npx`); quelli marcati **[account]** agiscono sull'account Cloudflare. I comandi sono stati controllati
con `--help` o `--dry-run` (wrangler 4.151.2), mai eseguiti contro il remoto da chi ha scritto il
documento. URL di esempio: `https://maestrale.<sottodominio-account>.workers.dev` (il sottodominio
dipende dall'account).

## Deploy

Prerequisiti: Node.js 22+, `cd worker && npm ci`, account Cloudflare (piano **Free** per lo
sviluppo; nessun custom domain).

1. **[account]** `npx wrangler login` (autorizzazione nel browser).
2. **[account]** Crea i namespace KV e annota i due id (non sono segreti):
   `npx wrangler kv namespace create FORECASTS` e `npx wrangler kv namespace create FORECASTS --preview`.
3. Scrivi gli id in `worker/wrangler.jsonc` (`id` e `preview_id`, oggi
   `00000000000000000000000000000000`). Se aggiungi commenti usa solo righe intere che iniziano con
   `//` (il test `worker/test/update.test.ts` legge il file così). Poi `cd worker && npm test`.
4. Prova di build senza pubblicare: `npx wrangler deploy --dry-run --outdir dist` (`dist/` non si committa).
5. **[account]** `npx wrangler deploy`. Al primo deploy wrangler può chiedere di **registrare il
   sottodominio `workers.dev`** dell'account; annota l'URL stampato.
6. Verifica: `curl https://maestrale.<sottodominio-account>.workers.dev/` deve rispondere 200
   `{"status":"ok","service":"maestrale"}`; `npx wrangler deployments list` mostra la versione;
   smoke test: `node scripts/compare_backends.mjs --smoke https://maestrale.<sottodominio-account>.workers.dev`
   (dice se ha trovato il ramo 200 con dati o 503 a cache vuota).

Non ci sono `routes` né `vars` in `wrangler.jsonc`. Il deploy automatico da GitHub non è configurato
(vedi *Passi futuri*).

## Cron

Espressione (UTC): `30 0,6,12,18 * * *`, definita in `triggers.crons`.

| UTC | Europe/Rome, ora legale (CEST) | Europe/Rome, inverno (CET) |
|---|---|---|
| 00:30 | 02:30 | 01:30 |
| 06:30 | 08:30 | 07:30 |
| 12:30 | 14:30 | 13:30 |
| 18:30 | 20:30 | 19:30 |

Il cron non conosce fusi orari: l'intervallo resta di 6 h. Ad ogni slot gira l'handler `scheduled`
(`worker/src/index.ts`): aggiorna le 13 località, fa merge con il cache precedente e scrive la KV
`latest`. Se **nessuna** località si aggiorna la KV non viene toccata e l'handler risolve comunque
(nessun ritentativo del cron).

Lancio manuale, in ordine di praticità:

- **Attendere lo slot** UTC con `npx wrangler tail --format json` aperto **[account]**.
- **In locale**: `npx wrangler dev --test-scheduled` poi
  `curl "http://localhost:8787/__scheduled?cron=30+0+*+*+*"` (usa la KV simulata locale e scarica
  davvero da Open-Meteo). Non misura i limiti Free.
- **Remoto**: `npx wrangler dev --remote --test-scheduled` esegue il codice sulla rete Cloudflare
  **[account]**. Quale KV usa (`preview_id` o `id` di produzione) **non è verificabile offline**:
  per i namespace con `preview_id` la documentazione indica la KV di anteprima, quindi
  **non** popola la KV di produzione. Controllare la tabella dei binding stampata all'avvio.
- **Dashboard** (Workers & Pages -> maestrale -> Settings -> Triggers): se offre un lancio manuale del
  cron, usarlo; da verificare, il repository non lo può provare.
- Non modificare temporaneamente il cron a ogni minuto (il test di S04 lo vieta e peggiora le misure).

## Rigenerazione della cache

- **Produzione**: far girare il cron (sopra). Il primo aggiornamento ricostruisce tutto (OQ-23).
- **Sviluppo, KV vuota o cron fallito sul piano Free**: seminare dallo snapshot di esempio
  **[account]**:

  ```bash
  npx wrangler kv key put --binding FORECASTS latest --path ../tests/fixtures/golden_forecasts.json --remote --preview false
  ```

  I dati sono **vecchi** (`generated_at` 2026-10-19T09:00Z): `/health` risulterà `degraded` e
  `stale: true` dopo 12 h, e l'app mostrerà quella data in "Aggiornato". `--preview false` è
  obbligatorio perché `id` e `preview_id` sono entrambi configurati (altrimenti wrangler si rifiuta).
  In locale lo stesso comando con `--local` al posto di `--remote`.
- **Leggere il cache**: `npx wrangler kv key get --binding FORECASTS latest --remote --preview false --text`.
- Ripristino alla baseline: stesso `kv key put` dal golden, oppure aspettare il prossimo cron riuscito.

## Rollback

1. `npx wrangler deployments list` **[account]**: elenca le ultime 10 versioni distribuite.
2. `npx wrangler rollback [version-id] -m "motivo"` **[account]**: riporta il codice a una versione
   precedente (senza argomento torna alla precedente).
3. Il rollback ripristina **solo il codice**, non la **KV**: il cache resta quello attuale. Se i dati
   sono sbagliati, riseminare dal golden (sopra) o attendere il prossimo cron.

## Osservabilità (con ciò che esiste)

`observability.enabled` è attivo (Workers Logs). Il Worker scrive con `console.*`:

- `console.error("Aggiornamento fallito per <slug>: <messaggio>")` per ogni località fallita;
- `console.error("Nessuna località aggiornata: cache KV non modificato")` se non scrive la KV;
- `console.log` di un riepilogo JSON per ogni esecuzione, formato esatto:

  ```json
  {"event":"forecast_update","updated":13,"failed":0,"generated_at":"2026-10-19T12:30:05+00:00","duration_ms":4210}
  ```

  **`duration_ms` è tempo di orologio** (`Date.now()`), attesa di rete inclusa: **non è il CPU time**.

Dove guardare:

- `npx wrangler tail --format json` **[account]**: log in tempo reale (cron compreso).
- Dashboard Cloudflare -> Workers & Pages -> maestrale -> Logs / Metrics: Workers Logs e invocazioni;
  **CPU time** e **subrequest** per invocazione si leggono qui (il job non logga il numero di
  subrequest).
- `GET /health` (sempre 200): `status` (`ok`|`degraded`), `stale` (dati più vecchi di 12 h),
  `update_errors` (località fallite con messaggio), `generated_at`, `locations`. Cache assente o
  illeggibile: `error` e `cache_path` (`kv:FORECASTS`).

## Limiti piano Free e misure

| Limite | Free | Paid |
|---|---|---|
| CPU per invocazione | 10 ms | fino a 15 min per cron con intervallo >= 1 h |
| Subrequest per invocazione | 50 | 10.000 |

Fabbisogno del job: 26 subrequest nominali (13 località x 2 chiamate Open-Meteo), fino a 78 con i
retry (3 tentativi), più 1 `get` e 1 `put` KV (2) se la piattaforma li conta come subrequest
(da verificare con la misura). Con 2 tentativi: 52 + 2 = 54 (oltre 50); con 1 solo: 28.

**I retry restano a 3** (`DEFAULT_RETRIES = 3`, FR-17 "fino a 3 tentativi"): portare il caso peggiore
sotto 50 richiede eliminare i retry, cioè cambiare un requisito, e renderli configurabili richiederebbe
una variabile `vars`. Fuori scope di E01-S07; il numero è un input per la decisione su Paid.

Misure su Free (da compilare dopo il deploy; il cron su Free probabilmente non completa, ed è una
misura valida):

| Data/ora UTC | Modo di invocazione | Esito (`forecast_update` o errore) | CPU time | Subrequest | Fonte |
|---|---|---|---|---|---|
| da misurare | da misurare | da misurare | da misurare | da misurare | da misurare |

## Regola go/no-go per Paid

Si passa a **Workers Paid prima di aprire l'app ad altri utenti**, e in ogni caso se almeno una misura
su Free mostra:

- (a) esecuzione fallita per CPU o subrequest; oppure
- (b) CPU > 7 ms o subrequest > 40 su una run nominale (margine ~30% sui limiti); oppure
- (c) nessuna run completa nelle ultime 24 h.

Se tutte le misure rientrano e l'app resta personale si può restare su Free monitorando `/health`.
Decisione del proprietario (2026-10-19): sul Free un cron che fallisce si **tollera e si misura**
(nessuna disattivazione; ogni 6 h una run fallita nei log, `/health` diventa `stale` dopo 12 h).

## Passi futuri

- Custom domain (`routes`) invece di `workers.dev`.
- Workers Builds (deploy da GitHub dal dashboard) e una CI con `npm test`, `npm run typecheck`,
  `node --test scripts/*.test.mjs` e Flutter. Il remoto `origin` (github.com/gyuco/maestrale) esiste,
  la CI non è ancora configurata.
- CORS ristretto: oggi `CORS_ORIGINS` vale `*` (nessuna `vars` definita).
- Passaggio a Workers Paid secondo la regola sopra.

## Rigenerare le fixture / baseline Python

Il codice Python rimosso è nel tag git **locale** `python-baseline` (non pubblicato). Ricetta completa
in [`tests/fixtures/README.md`](../tests/fixtures/README.md): `git checkout python-baseline`, poi
`python3 tests/fixtures/regenerate.py [--fetch]`.

## Dismissione lato host del backend Python storico (una tantum)

Riferimenti **storici** alla v0.1. Sul computer/server del proprietario, se esisteva il cron v0.1 (`update_forecasts.py`) o un `uvicorn`:
rimuovere la riga da `crontab -l`/launchd/systemd, fermare ogni `uvicorn backend.main:app` e cancellare
il vecchio `data/forecasts.json`. Controllo: `pgrep -fl "uvicorn|update_forecasts"` senza risultati.
