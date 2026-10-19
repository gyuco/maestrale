#!/usr/bin/env node
// Confronto di parità tra due backend Maestrale (E01-S07, FR-50) e smoke test.
//
//   node scripts/compare_backends.mjs --old <urlA> --new <urlB> [--empty]
//   node scripts/compare_backends.mjs --smoke <url>
//
// Node >= 22, solo `fetch` globale, nessuna dipendenza. Exit code: 0 ok,
// 1 differenze/controlli falliti, 2 uso errato.
//
// Regole (vedi docs/stories/E01-S07-deploy-cutover.md):
// - status uguale sempre;
// - /forecast 200 e 404: corpo deep-equal;
// - 422: solo status e presenza di `detail` (il testo varia tra FastAPI e Hono);
// - /health: stesse chiavi, stessi tipi, stessi valori, tranne i VALORI di
//   `cache_path` (eccezione OQ-19) e `age_hours` (calcolato in istanti diversi);
// - --empty: scenario a cache vuota (entrambi i backend senza dati): /forecast
//   deve dare 503 con lo stesso `detail`, /health 200 `degraded`.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const IGNORED_HEALTH_VALUES = new Set(["cache_path", "age_hours"]);

function catalogSlugs() {
  const raw = JSON.parse(readFileSync(join(ROOT, "locations.json"), "utf8"));
  return raw.map((item) => item.slug);
}

/** Casi del confronto (dal Context della storia). */
export function buildCases() {
  const forecast = (name, localita) => ({
    name,
    path: localita === undefined ? "/forecast" : `/forecast?localita=${encodeURIComponent(localita)}`,
    kind: "forecast",
  });
  const cases = [
    { name: "health", path: "/health", kind: "health" },
    forecast("forecast Torre dei Corsari", "Torre dei Corsari"),
    forecast("forecast torre-dei-corsari", "torre-dei-corsari"),
    forecast("forecast Cagliari", "Cagliari"),
    forecast("forecast CAGLIARI", "CAGLIARI"),
    forecast("forecast '  cagliari ' (spazi)", "  cagliari "),
    ...catalogSlugs().map((slug) => forecast(`forecast slug ${slug}`, slug)),
    forecast("forecast Quartu Sant'Elena", "Quartu Sant'Elena"),
    forecast("forecast nome sconosciuto", "Atlantide"),
    forecast("forecast localita assente", undefined),
    forecast("forecast localita vuoto", ""),
  ];
  return cases;
}

async function fetchJson(base, path) {
  const response = await fetch(base.replace(/\/+$/, "") + path);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { __non_json__: text.slice(0, 200) };
  }
  return { status: response.status, body };
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Elenco dei percorsi in cui due valori JSON differiscono (deep-equal). */
export function deepDiff(a, b, path = "$") {
  const ta = typeOf(a);
  const tb = typeOf(b);
  if (ta !== tb) return [`${path}: tipo ${ta} != ${tb}`];
  if (ta === "array") {
    const diffs = [];
    if (a.length !== b.length) diffs.push(`${path}: lunghezza ${a.length} != ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) diffs.push(...deepDiff(a[i], b[i], `${path}[${i}]`));
    return diffs;
  }
  if (ta === "object") {
    const diffs = [];
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(key in a)) diffs.push(`${path}.${key}: presente solo in new`);
      else if (!(key in b)) diffs.push(`${path}.${key}: presente solo in old`);
      else diffs.push(...deepDiff(a[key], b[key], `${path}.${key}`));
    }
    return diffs;
  }
  return Object.is(a, b) ? [] : [`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`];
}

function compareHealth(oldBody, newBody) {
  const diffs = [];
  const keys = new Set([...Object.keys(oldBody), ...Object.keys(newBody)]);
  for (const key of keys) {
    if (!(key in oldBody)) diffs.push(`chiave '${key}' presente solo in new`);
    else if (!(key in newBody)) diffs.push(`chiave '${key}' presente solo in old`);
    else if (typeOf(oldBody[key]) !== typeOf(newBody[key])) {
      diffs.push(`tipo di '${key}': ${typeOf(oldBody[key])} != ${typeOf(newBody[key])}`);
    } else if (!IGNORED_HEALTH_VALUES.has(key)) {
      diffs.push(...deepDiff(oldBody[key], newBody[key], key));
    }
  }
  return diffs;
}

/** Confronta una coppia di risposte; restituisce l'elenco delle differenze. */
export function compareResponses(testCase, oldRes, newRes, { empty = false } = {}) {
  const diffs = [];
  if (oldRes.status !== newRes.status) {
    diffs.push(`status ${oldRes.status} != ${newRes.status}`);
    return diffs;
  }
  if (testCase.kind === "health") {
    diffs.push(...compareHealth(oldRes.body, newRes.body));
    if (oldRes.status !== 200) diffs.push(`/health non 200 (${oldRes.status})`);
    if (empty && (oldRes.body.status !== "degraded" || newRes.body.status !== "degraded")) {
      diffs.push("scenario cache vuota: /health deve essere 'degraded' in entrambi");
    }
    return diffs;
  }
  if (oldRes.status === 422) {
    if (!("detail" in oldRes.body)) diffs.push("old: 422 senza 'detail'");
    if (!("detail" in newRes.body)) diffs.push("new: 422 senza 'detail'");
    return diffs;
  }
  diffs.push(...deepDiff(oldRes.body, newRes.body));
  return diffs;
}

async function runCompare(oldUrl, newUrl, empty, log) {
  let cases = buildCases();
  if (empty) {
    // Con cache vuota ogni richiesta valida deve dare 503 con lo stesso detail.
    cases = cases.map((c) => ({ ...c, expectedEmpty: c.kind === "forecast" && /localita=.+/.test(c.path) }));
  }
  let failures = 0;
  for (const testCase of cases) {
    let result;
    try {
      const [oldRes, newRes] = await Promise.all([fetchJson(oldUrl, testCase.path), fetchJson(newUrl, testCase.path)]);
      result = compareResponses(testCase, oldRes, newRes, { empty });
      if (empty && testCase.expectedEmpty && oldRes.status === newRes.status && oldRes.status !== 503) {
        result.push(`scenario cache vuota: atteso 503, ottenuto ${oldRes.status}`);
      }
    } catch (error) {
      result = [`errore di rete: ${error.message}`];
    }
    if (result.length === 0) {
      log(`OK    ${testCase.name}`);
    } else {
      failures += 1;
      log(`DIFF  ${testCase.name} (${testCase.path})`);
      for (const line of result) log(`        - ${line}`);
    }
  }
  log(`\n${cases.length} casi, ${failures} differenze`);
  return failures === 0 ? 0 : 1;
}

// --- smoke -----------------------------------------------------------------

async function runSmoke(url, log) {
  const problems = [];
  const check = (condition, message) => {
    if (!condition) problems.push(message);
  };

  const health = await fetchJson(url, "/health");
  check(health.status === 200, `/health: status ${health.status} != 200`);
  const hb = health.body;
  check(["ok", "degraded"].includes(hb.status), `/health: 'status' inatteso (${JSON.stringify(hb.status)})`);
  if (typeof hb.error === "string") {
    check(typeof hb.cache_path === "string", "/health (degradato): 'cache_path' stringa mancante");
  } else {
    check(typeof hb.stale === "boolean", "/health: 'stale' booleano mancante");
    check(typeof hb.locations === "number", "/health: 'locations' numerico mancante");
    check(typeof hb.update_errors === "object" && hb.update_errors !== null, "/health: 'update_errors' oggetto mancante");
    check(["string", "null"].includes(typeOf(hb.generated_at)), "/health: 'generated_at' mancante");
    check(["number", "null"].includes(typeOf(hb.age_hours)), "/health: 'age_hours' mancante");
  }

  let branch = null;
  for (const name of ["cagliari", "torre-dei-corsari"]) {
    const res = await fetchJson(url, `/forecast?localita=${encodeURIComponent(name)}`);
    if (res.status === 200) {
      branch = 200;
      check(typeof res.body.location?.name === "string", `/forecast ${name}: location.name mancante`);
      check(Array.isArray(res.body.daily) && res.body.daily.length > 0, `/forecast ${name}: daily vuoto o assente`);
      break;
    }
    if (res.status === 503) {
      branch = 503;
      check(res.body.detail === "Previsioni non ancora disponibili", `/forecast: detail 503 inatteso (${JSON.stringify(res.body.detail)})`);
      break;
    }
    if (res.status !== 404) {
      problems.push(`/forecast ${name}: status inatteso ${res.status}`);
      break;
    }
  }
  check(branch !== null || problems.length > 0, "/forecast: nessuna località nota trovata (solo 404)");

  if (branch === 200) {
    const nf = await fetchJson(url, "/forecast?localita=Atlantide");
    check(nf.status === 404, `/forecast sconosciuta: status ${nf.status} != 404`);
    check(typeof nf.body.detail?.message === "string", "404: detail.message mancante");
    check(Array.isArray(nf.body.detail?.available), "404: detail.available mancante");
  }
  const missing = await fetchJson(url, "/forecast");
  check(missing.status === 422, `/forecast senza localita: status ${missing.status} != 422`);
  check("detail" in missing.body, "422: 'detail' mancante");

  log(branch === null ? "Esito: nessun ramo" : `Esito: ramo ${branch}: ${branch === 200 ? "cache con dati" : "cache vuota (503)"}`);
  if (problems.length === 0) {
    log("SMOKE OK");
    return 0;
  }
  for (const p of problems) log(`FAIL  ${p}`);
  return 1;
}

// --- CLI -------------------------------------------------------------------

function parseArgs(argv) {
  const args = { empty: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--empty") args.empty = true;
    else if (arg === "--old" || arg === "--new" || arg === "--smoke") args[arg.slice(2)] = argv[++i];
    else return null;
  }
  return args;
}

export async function main(argv, log = console.log) {
  const args = parseArgs(argv);
  const usage = "uso: compare_backends.mjs --old <url> --new <url> [--empty] | --smoke <url>";
  if (!args || (args.smoke === undefined && (!args.old || !args.new)) || (args.smoke !== undefined && !args.smoke)) {
    log(usage);
    return 2;
  }
  try {
    return args.smoke !== undefined ? await runSmoke(args.smoke, log) : await runCompare(args.old, args.new, args.empty, log);
  } catch (error) {
    log(`FAIL  ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
