#!/usr/bin/env node
// Genera il seed D1 del catalogo (FR-104) da locations.json:
//   node scripts/seed_catalog.mjs           scrive worker/migrations-core/0002_seed_locations.sql
//   node scripts/seed_catalog.mjs --check   esce con 1 se il file non e' allineato
// Il seed e' una tantum: dopo l'attivazione locations.json non e' piu' una fonte.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "locations.json");
const outputPath = resolve(root, "worker/migrations-core/0002_seed_locations.sql");

/** Istante fisso del seed: un valore variabile renderebbe il diff instabile. */
export const SEEDED_AT = "2026-11-02T00:00:00Z";

const FIELDS = ["slug", "name", "latitude", "longitude"];

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** SQL del seed, deterministico, a partire dalle voci di locations.json. */
export function buildSeedSql(rawText, { seededAt = SEEDED_AT } = {}) {
  const list = JSON.parse(rawText);
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("locations.json deve contenere un elenco non vuoto");
  }
  const rows = list.map((item, index) => {
    for (const field of FIELDS) {
      if (!(field in item)) throw new Error(`voce ${index}: campo mancante '${field}'`);
    }
    const { slug, name, latitude, longitude } = item;
    if (
      typeof slug !== "string" ||
      slug.trim() === "" ||
      typeof name !== "string" ||
      name.trim() === "" ||
      typeof latitude !== "number" ||
      !Number.isFinite(latitude) ||
      typeof longitude !== "number" ||
      !Number.isFinite(longitude)
    ) {
      throw new Error(`voce ${index}: valori non validi`);
    }
    return `  (${quote(slug)}, ${quote(name)}, ${latitude}, ${longitude}, 1, 1, ${quote(seededAt)}, ${quote(seededAt)})`;
  });
  return [
    "-- Seed del catalogo (FR-104): generato da scripts/seed_catalog.mjs.",
    "-- Non modificare a mano: rigenerare con `node scripts/seed_catalog.mjs`.",
    "INSERT OR REPLACE INTO locations",
    "  (slug, name, latitude, longitude, active, version, created_at, updated_at)",
    "VALUES",
    `${rows.join(",\n")};`,
    "",
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sql = buildSeedSql(readFileSync(sourcePath, "utf8"));
  if (process.argv.includes("--check")) {
    const current = readFileSync(outputPath, "utf8");
    if (current !== sql) {
      console.error("seed non allineato: eseguire node scripts/seed_catalog.mjs");
      process.exit(1);
    }
    console.log("seed allineato");
  } else {
    writeFileSync(outputPath, sql);
    console.log(`scritto ${outputPath}`);
  }
}
