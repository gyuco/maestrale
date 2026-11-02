import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

import seedLocations from "../locations.json";

// Progetto di test del Worker `maestrale-admin` (ADR-0007): config separata,
// binding `CORE`/`FORECASTS` dal file wrangler.admin.jsonc e migrazioni del
// catalogo applicate nel setup. I test del Worker pubblico usano vitest.config.ts.
const coreMigrations = await readD1Migrations("./migrations-core");

export default defineConfig({
  test: {
    include: ["test-admin/**/*.test.ts"],
    setupFiles: ["./test-admin/setup/apply-core-migrations.ts"],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.admin.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS_CORE: coreMigrations,
          TEST_LOCATIONS_JSON: JSON.stringify(seedLocations),
        },
      },
    }),
  ],
});
