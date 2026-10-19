import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Da 0.18 il package esporta il plugin `cloudflareTest`; `defineWorkersConfig`
// (citato nella storia) è stato rimosso. Il Worker viene caricato dalla stessa
// configurazione usata dal deploy, così i binding (KV `FORECASTS`) sono quelli
// reali, simulati in locale con Miniflare.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        kvNamespaces: ["FORECASTS"],
      },
    }),
  ],
});
