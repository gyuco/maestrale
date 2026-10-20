#!/usr/bin/env node
// Genera lo snapshot del catalogo incluso nell'app (FR-65, ADR-0004/0005):
//   node scripts/sync_app_catalog.mjs          scrive app/assets/locations.json
//   node scripts/sync_app_catalog.mjs --check  esce con 1 se lo snapshot non e' allineato
// La sola fonte modificata a mano resta locations.json alla radice (FR-61).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "locations.json");
const snapshotPath = resolve(root, "app/assets/locations.json");

export function render(rawText) {
  const list = JSON.parse(rawText);
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("locations.json deve contenere un elenco non vuoto");
  }
  const fields = ["slug", "name", "latitude", "longitude"];
  const entries = list.map((item, index) => {
    for (const field of fields) {
      if (!(field in item)) throw new Error(`voce ${index}: campo mancante '${field}'`);
    }
    const { slug, name, latitude, longitude } = item;
    if (typeof slug !== "string" || typeof name !== "string" || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error(`voce ${index}: valori non validi`);
    }
    return { slug, name, latitude, longitude };
  });
  return `${JSON.stringify(entries, null, 2)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = render(readFileSync(sourcePath, "utf8"));
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(snapshotPath, "utf8");
    } catch {
      // snapshot assente: non allineato
    }
    if (current !== output) {
      console.error("Snapshot non allineato: eseguire node scripts/sync_app_catalog.mjs");
      process.exit(1);
    }
    console.log("Snapshot allineato");
  } else {
    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, output);
    console.log(`Scritto ${snapshotPath} (${JSON.parse(output).length} località)`);
  }
}
