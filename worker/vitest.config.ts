import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Da 0.18 il package esporta il plugin `cloudflareTest`; `defineWorkersConfig`
// (citato nella storia) è stato rimosso. Il Worker viene caricato dalla stessa
// configurazione usata dal deploy, così i binding (KV `FORECASTS`) sono quelli
// reali, simulati in locale con Miniflare.
//
// TODO(E01-S08): migrare da `@cloudflare/vitest-pool-workers` (deprecato) a
// `@cloudflare/vitest-plugin` (codemod `vitest:pool-workers-to-vitest-plugin`).
// Motivo del rinvio: la `compatibility_date` è oggi bloccata a `2026-08-22`
// perché è la data più recente supportata dal binario `workerd` incluso nel
// pool 0.23.0; il nuovo plugin usa il `wrangler`/`workerd` di progetto e
// sbloccherebbe anche l'aggiornamento della data. Migrazione non in scope qui.
// Migrazioni di `migrations/` lette in Node e passate ai test come binding di
// sola prova `TEST_MIGRATIONS`; le applica `test/setup/apply-migrations.ts`.
const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  test: {
    setupFiles: ["./test/setup/apply-migrations.ts"],
  },
  plugins: [
    // Il binding KV `FORECASTS` arriva da `wrangler.jsonc`: non va duplicato qui,
    // altrimenti i test resterebbero verdi anche rimuovendo il binding dal Worker.
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Il binding D1 `HISTORY` arriva da `wrangler.jsonc`; qui solo le migrazioni.
      miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
    }),
  ],
});
