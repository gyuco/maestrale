import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:test";

// Applica le migrazioni di `worker/migrations-core/` alla D1 `CORE` locale.
const testEnv = env as unknown as {
  TEST_MIGRATIONS_CORE: Parameters<typeof applyD1Migrations>[1];
};

await applyD1Migrations(env.CORE, testEnv.TEST_MIGRATIONS_CORE);
