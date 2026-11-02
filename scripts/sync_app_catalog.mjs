#!/usr/bin/env node
// Genera lo snapshot del catalogo incluso nell'app (FR-65, ADR-0010):
//   node scripts/sync_app_catalog.mjs --from catalogo.json   (output di `wrangler d1 execute --json`)
//   node scripts/sync_app_catalog.mjs --check                esce con 1 se non allineato
//   node scripts/sync_app_catalog.mjs                        sviluppo: usa locations.json (seed)
// In release la fonte e' il database; locations.json non e' piu' una fonte (FR-104).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seedPath = resolve(root, "locations.json");
const snapshotPath = resolve(root, "app/assets/locations.json");

const FIELDS = ["slug", "name", "latitude", "longitude"];

function rowsOf(parsed) {
  if (Array.isArray(parsed)) {
    if (
      parsed.length > 0 &&
      parsed.every((item) => item && typeof item === "object" && Array.isArray(item.results))
    ) {
      return parsed.flatMap((item) => item.results);
    }
    return parsed;
  }
  if (parsed && Array.isArray(parsed.results)) return parsed.results;
  if (parsed && Array.isArray(parsed.locations)) return parsed.locations;
  throw new Error("input non riconosciuto: attesi risultati di d1 execute, {locations: [...]} o un elenco");
}

/** Voci attive, validate e ordinate per nome, dalla forma accettata in input. */
export function normalizeCatalog(input) {
  const parsed = typeof input === "string" ? JSON.parse(input) : input;
  const rows = rowsOf(parsed);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("catalogo vuoto: nessuna localita da includere");
  }
  const seen = new Set();
  return rows
    .filter((row) => !("active" in row) || Number(row.active) === 1)
    .map((row, index) => {
      for (const field of FIELDS) {
        if (!(field in row)) throw new Error(`voce ${index}: campo mancante '${field}'`);
      }
      const { slug, name, latitude, longitude } = row;
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
      if (seen.has(slug)) throw new Error(`slug duplicato: ${slug}`);
      seen.add(slug);
      return { slug, name, latitude, longitude };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.slug < b.slug ? -1 : 1));
}

/** Corpo dello snapshot: stesso involucro di `GET /locations` (FR-62, FR-65). */
export function render(input) {
  const locations = normalizeCatalog(input);
  const content = { schema_version: 1, count: locations.length, locations };
  const version = createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 16);
  return `${JSON.stringify({ schema_version: 1, version, count: locations.length, locations }, null, 2)}\n`;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const from = argument("--from");
  const source = from ?? seedPath;
  if (from === undefined) {
    console.warn(
      "avviso: nessun --from, uso locations.json (sviluppo). In release la fonte e' il database (FR-104).",
    );
  }
  const output = render(readFileSync(source, "utf8"));
  const out = argument("--out") ?? snapshotPath;
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(out, "utf8");
    } catch {
      // snapshot assente: non allineato
    }
    if (current !== output) {
      console.error("snapshot non allineato: eseguire node scripts/sync_app_catalog.mjs --from <file>");
      process.exit(1);
    }
    console.log("snapshot allineato");
  } else {
    writeFileSync(out, output);
    console.log(`scritto ${out}`);
  }
}
