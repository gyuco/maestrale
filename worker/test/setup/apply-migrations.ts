import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:test";

// Applica le migrazioni di `worker/migrations/` alla D1 locale (Miniflare) prima
// di ogni file di test (E02-S01, AC-6). `TEST_MIGRATIONS` è letta da
// `vitest.config.ts` con `readD1Migrations`; è idempotente (tabella d1_migrations).
type TestEnv = {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
  TEST_MIGRATIONS_CORE: Parameters<typeof applyD1Migrations>[1];
};

const testEnv = env as unknown as TestEnv;

await applyD1Migrations(env.HISTORY, testEnv.TEST_MIGRATIONS);
// Catalogo, registri e richieste "Esegui ora" (ADR-0006/0008/0009).
await applyD1Migrations(env.CORE, testEnv.TEST_MIGRATIONS_CORE);
