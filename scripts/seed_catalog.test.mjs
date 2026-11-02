import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildSeedSql, SEEDED_AT } from "./seed_catalog.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const locationsText = readFileSync(resolve(root, "locations.json"), "utf8");
const generatedPath = resolve(root, "worker/migrations-core/0002_seed_locations.sql");

test("il seed generato coincide con il file versionato", () => {
  const sql = buildSeedSql(locationsText);
  assert.equal(readFileSync(generatedPath, "utf8"), sql);
});

test("il seed contiene una riga per ogni località, tutte attive", () => {
  const locations = JSON.parse(locationsText);
  const sql = buildSeedSql(locationsText);
  const values = sql.split("\n").filter((line) => line.startsWith("  ('"));
  assert.equal(values.length, locations.length);
  for (const location of locations) {
    assert.ok(sql.includes(`('${location.slug}', '${location.name}'`), location.slug);
  }
  assert.ok(sql.includes(SEEDED_AT));
});

test("sfugge gli apostrofi nei valori", () => {
  const sql = buildSeedSql(
    JSON.stringify([
      { slug: "sant-antioco", name: "Sant'Antioco", latitude: 39.07, longitude: 8.45 },
    ]),
  );
  assert.ok(sql.includes("'Sant''Antioco'"));
});

test("rifiuta un elenco vuoto o voci senza campi", () => {
  assert.throws(() => buildSeedSql("[]"));
  assert.throws(() => buildSeedSql(JSON.stringify([{ slug: "x", name: "X" }])));
});
