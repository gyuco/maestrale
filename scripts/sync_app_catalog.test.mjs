import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeCatalog, render } from "./sync_app_catalog.mjs";

const rows = [
  { slug: "chia", name: "Chia", latitude: 38.89, longitude: 8.88, active: 1 },
  { slug: "alghero", name: "Alghero", latitude: 40.56, longitude: 8.26, active: 1 },
  { slug: "vecchia", name: "Vecchia", latitude: 39, longitude: 9, active: 0 },
];

test("accetta l'output di d1 execute --json e scarta le disattivate", () => {
  const input = JSON.stringify([{ results: rows, success: true, meta: {} }]);
  const locations = normalizeCatalog(input);
  assert.deepEqual(locations.map((item) => item.slug), ["alghero", "chia"]);
});

test("accetta {locations: [...]} e un elenco nudo", () => {
  assert.equal(normalizeCatalog({ locations: rows }).length, 2);
  assert.equal(normalizeCatalog(rows).length, 2);
});

test("genera l'involucro di /locations con hash deterministico", () => {
  const body = render(rows);
  const parsed = JSON.parse(body);
  assert.equal(parsed.schema_version, 1);
  assert.equal(parsed.count, 2);
  assert.equal(parsed.version.length, 16);
  assert.deepEqual(parsed.locations.map((item) => item.slug), ["alghero", "chia"]);
  assert.equal(render(rows), body);
});

test("rifiuta catalogo vuoto, campi mancanti e slug duplicati", () => {
  assert.throws(() => render([]));
  assert.throws(() => render([{ slug: "x", name: "X" }]));
  assert.throws(() => render([...rows, { ...rows[0], name: "Altra" }]));
});
