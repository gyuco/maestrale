# Maestrale — Worker (Cloudflare)

Backend Maestrale su **Cloudflare Workers** (TypeScript), con router [Hono](https://hono.dev)
e cache su **Workers KV** (binding `FORECASTS`).

> Stato: **scaffold** (E01-S01). Qui c'è solo la route di prova `GET /`; le API `/forecast` e
> `/health` e il job di aggiornamento arrivano nelle storie successive di E01.

## Requisiti

- Node.js 22+ (verificato con v22.16.0) e npm 10+
- Per `dev`, `test`, `typecheck` e build dry-run **non** servono credenziali Cloudflare

## Comandi

| Comando | Cosa fa |
|---|---|
| `npm ci` | Installazione riproducibile dal `package-lock.json` (consigliata) |
| `npm install` | Installa/aggiorna le dipendenze (scarica il binario `workerd` per i test) |
| `npm run dev` | Avvia `wrangler dev` su <http://localhost:8787> (KV simulata in locale) |
| `npm test` | Esegue Vitest dentro `workerd` (Miniflare), senza rete né account Cloudflare |
| `npm run test:watch` | Vitest in watch mode |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run cf-typegen` | Rigenera `worker-configuration.d.ts` da `wrangler.jsonc` (`wrangler types`) |
| `npm run deploy` | Deploy **reale** (richiede login Cloudflare) |
| `npx wrangler deploy --dry-run --outdir dist` | Prova di build: genera il bundle in `dist/` senza pubblicare |

## Struttura

```text
worker/
├── src/index.ts              # app Hono + export default { fetch } (gancio scheduled: E01-S04)
├── src/types.ts              # tipi del payload congelato (forecast.schema.json)
├── src/slugify.ts            # port di backend/main.py:slugify (FR-22)
├── src/data_sources.ts       # port di data_sources.py: catalogo sorgenti (FR-5)
├── test/app.test.ts          # test con SELF.fetch e binding KV
├── test/types.test.ts        # golden assegnati ai tipi (E01-S02)
├── test/slugify.test.ts      # parità con tests/fixtures/slug_cases.json (E01-S02)
├── test/data_sources.test.ts # parità parametri/provenienza con la baseline Python (E01-S02)
├── worker-configuration.d.ts # tipi generati da `wrangler types` (Env + runtime)
├── wrangler.jsonc            # nome Worker, main, compatibility_date, KV FORECASTS
├── vitest.config.ts          # plugin cloudflareTest + kvNamespaces
└── tsconfig.json
```

I test dei moduli di dominio leggono le fixture di `tests/fixtures/` (generate dal codice Python
in E01-S00/E01-S02), quindi il confronto è con la baseline reale, non con valori copiati a mano.

## Passi manuali (account Cloudflare)

Questi passi **non** sono automatizzati: richiedono l'account Cloudflare del proprietario e non
girano in CI. Il `wrangler.jsonc` committato contiene un **placeholder** per l'id del namespace KV.

1. Login (una volta sola, apre il browser):

   ```bash
   npx wrangler login
   ```

2. Crea il namespace KV e annota l'`id` restituito:

   ```bash
   npx wrangler kv namespace create FORECASTS
   ```

   Wrangler stampa l'`id` e propone il frammento di configurazione: il progetto usa
   `wrangler.jsonc`, quindi va inserito in JSONC nell'array già presente in `wrangler.jsonc`
   (sostituendo il placeholder):

   ```jsonc
   "kv_namespaces": [
     {
       "binding": "FORECASTS",
       "id": "<32 caratteri esadecimali>"
     }
   ]
   ```

   Per il namespace di anteprima (usato da `wrangler dev` remoto e dalle preview):

   ```bash
   npx wrangler kv namespace create FORECASTS --preview
   ```

3. Sostituisci in `wrangler.jsonc` i due placeholder
   `00000000000000000000000000000000` con gli id reali (`id` e `preview_id`).

4. Deploy:

   ```bash
   npm run deploy
   ```

   Il deploy reale va fatto solo dopo aver completato i passi 1–3. Per verificare il bundle
   senza pubblicare: `npx wrangler deploy --dry-run --outdir dist`.

## Note

- `compatibility_date` è fissata a `2026-08-22`: è la data più recente supportata dal runtime
  `workerd` incluso in `@cloudflare/vitest-pool-workers` 0.23.0 (usato dai test). Va alzata solo
  dopo aver aggiornato quel pacchetto.
- `worker-configuration.d.ts` è generato da `npx wrangler types` ed è **committato**: contiene
  l'interfaccia `Env` (binding `FORECASTS`) e i tipi del runtime, così `npm run typecheck` gira
  offline. Rigeneralo con `npm run cf-typegen` dopo ogni modifica a `wrangler.jsonc`.
- I test usano `SELF.fetch("https://example.com/...")`: il Worker viene eseguito da Miniflare con
  la configurazione di `wrangler.jsonc`, quindi il binding `FORECASTS` è quello vero, simulato in
  locale.
- Non committare `node_modules/`, `.wrangler/` né `dist/` (sono in `.gitignore` alla radice).
