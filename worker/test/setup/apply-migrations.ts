import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:test";

// Applica le migrazioni di `worker/migrations/` alla D1 locale (Miniflare) prima
// di ogni file di test (E02-S01, AC-6). `TEST_MIGRATIONS` è letta da
// `vitest.config.ts` con `readD1Migrations`; è idempotente (tabella d1_migrations).
await applyD1Migrations(env.HISTORY, (env as unknown as { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }).TEST_MIGRATIONS);
