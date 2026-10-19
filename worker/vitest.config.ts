import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Da 0.18 il package esporta il plugin `cloudflareTest`; `defineWorkersConfig`
// (citato nella storia) è stato rimosso. Il Worker viene caricato dalla stessa
// configurazione usata dal deploy, così i binding (KV `FORECASTS`) sono quelli
// reali, simulati in locale con Miniflare.
export default defineConfig({
  plugins: [
    // Il binding KV `FORECASTS` arriva da `wrangler.jsonc`: non va duplicato qui,
    // altrimenti i test resterebbero verdi anche rimuovendo il binding dal Worker.
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
});
