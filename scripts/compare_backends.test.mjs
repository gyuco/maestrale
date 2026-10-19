// Test dello script di confronto (E01-S07, AC-1): server HTTP finti con
// node:http, lo script è lanciato come processo figlio (exit code reale).
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "compare_backends.mjs");

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .join("-")
    .replaceAll("_", "-");
}

/** Backend finto che imita il contratto; `opts` permette di alterarlo. */
function fakeBackend(opts = {}) {
  const locations = opts.locations ?? {
    cagliari: { location: { name: "Cagliari", slug: "cagliari" }, daily: [{ wave_height_max: 1.2 }] },
    "torre-dei-corsari": {
      location: { name: "Torre dei Corsari", slug: "torre-dei-corsari" },
      daily: [{ wave_height_max: 0.8 }],
    },
  };
  const empty = opts.empty ?? false;
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/health") {
      if (opts.health) return send(200, opts.health);
      if (empty) {
        return send(200, {
          status: "degraded",
          error: "Cache forecast non ancora generato",
          cache_path: opts.cachePath ?? "data/forecasts.json",
          locations: 0,
        });
      }
      return send(200, {
        status: "degraded",
        generated_at: "2026-10-19T09:00:00+00:00",
        age_hours: opts.ageHours ?? 10.5,
        stale: true,
        locations: Object.keys(locations).length,
        update_errors: {},
        ...(opts.healthExtra ?? {}),
      });
    }
    if (url.pathname === "/forecast") {
      const q = url.searchParams.get("localita");
      if (q === null || q === "") {
        return send(422, { detail: opts.detail422 ?? [{ loc: ["query", "localita"], msg: "x" }] });
      }
      if (empty) return send(opts.status503 ?? 503, { detail: "Previsioni non ancora disponibili" });
      const key = slugify(q);
      const found = locations[key] ?? Object.values(locations).find((l) => slugify(l.location.name) === key);
      if (!found) {
        const available = Object.values(locations)
          .map((l) => l.location.name)
          .sort();
        return send(404, { detail: { message: `Localita '${q}' non trovata`, available, ...(opts.extra404 ?? {}) } });
      }
      return send(200, found);
    }
    return send(404, { detail: "Not Found" });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

const open = [];
async function start(opts) {
  const backend = await fakeBackend(opts);
  open.push(backend.server);
  return backend.url;
}
after(() => open.forEach((s) => s.close()));

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

function withHealth(overrides) {
  return {
    status: "degraded",
    generated_at: "2026-10-19T09:00:00+00:00",
    age_hours: 10.5,
    stale: true,
    locations: 2,
    update_errors: {},
    ...overrides,
  };
}

describe("--old / --new", () => {
  test("risposte identiche: exit 0", async () => {
    const a = await start({ health: withHealth({}) });
    const b = await start({ health: withHealth({}) });
    const { code, out } = await run(["--old", a, "--new", b]);
    assert.equal(code, 0, out);
    assert.match(out, /0 differenze/);
  });

  test("cache_path e age_hours (valori) sono ignorati", async () => {
    const a = await start({ health: withHealth({ cache_path: "/srv/data/forecasts.json", age_hours: 1.5 }) });
    const b = await start({ health: withHealth({ cache_path: "kv:FORECASTS", age_hours: 99.25 }) });
    const { code, out } = await run(["--old", a, "--new", b]);
    assert.equal(code, 0, out);
  });

  test("tipo di cache_path diverso: differenza", async () => {
    const a = await start({ health: withHealth({ cache_path: "x" }) });
    const b = await start({ health: withHealth({ cache_path: 3 }) });
    const { code } = await run(["--old", a, "--new", b]);
    assert.notEqual(code, 0);
  });

  test("campo di /forecast diverso: exit != 0 con caso e differenza", async () => {
    const a = await start({ health: withHealth({}) });
    const altered = {
      cagliari: { location: { name: "Cagliari", slug: "cagliari" }, daily: [{ wave_height_max: 1.2 }] },
      "torre-dei-corsari": {
        location: { name: "Torre dei Corsari", slug: "torre-dei-corsari" },
        daily: [{ wave_height_max: 0.9 }],
      },
    };
    const b = await start({ health: withHealth({}), locations: altered });
    const { code, out } = await run(["--old", a, "--new", b]);
    assert.notEqual(code, 0);
    assert.match(out, /torre-dei-corsari/);
    assert.match(out, /wave_height_max/);
  });

  test("status diverso: differenza", async () => {
    const a = await start({ health: withHealth({}), empty: true });
    const b = await start({ health: withHealth({}), empty: true, status503: 500 });
    const { code, out } = await run(["--old", a, "--new", b, "--empty"]);
    assert.notEqual(code, 0);
    assert.match(out, /status/);
  });

  test("chiave di /health mancante: differenza", async () => {
    const a = await start({ health: withHealth({}) });
    const { stale: _s, ...rest } = withHealth({});
    const b = await start({ health: rest });
    const { code, out } = await run(["--old", a, "--new", b]);
    assert.notEqual(code, 0);
    assert.match(out, /stale/);
  });

  test("tipo di un campo di /health diverso: differenza", async () => {
    const a = await start({ health: withHealth({}) });
    const b = await start({ health: withHealth({ locations: "2" }) });
    const { code, out } = await run(["--old", a, "--new", b]);
    assert.notEqual(code, 0);
    assert.match(out, /locations/);
  });

  test("detail.available del 404 diverso: differenza", async () => {
    const a = await start({ health: withHealth({}) });
    const b = await start({ health: withHealth({}), extra404: { available: ["Altro"] } });
    const { code, out } = await run(["--old", a, "--new", b]);
    assert.notEqual(code, 0);
    assert.match(out, /available/);
  });

  test("422: contano solo status e presenza di detail", async () => {
    const a = await start({ health: withHealth({}) });
    const b = await start({ health: withHealth({}), detail422: "testo diverso" });
    const { code, out } = await run(["--old", a, "--new", b]);
    assert.equal(code, 0, out);
  });

  test("scenario cache vuota: identico passa, 503 con detail diverso fallisce", async () => {
    const a = await start({ empty: true });
    const b = await start({ empty: true, cachePath: "kv:FORECASTS" });
    const ok = await run(["--old", a, "--new", b, "--empty"]);
    assert.equal(ok.code, 0, ok.out);
    const c = await start({ empty: true, health: undefined, status503: 503 });
    // detail diverso: server con locations vuote ma risposta 200 su /forecast
    const d = await start({ locations: {} });
    const ko = await run(["--old", c, "--new", d, "--empty"]);
    assert.notEqual(ko.code, 0);
  });

  test("argomenti mancanti: exit 2", async () => {
    const { code } = await run([]);
    assert.equal(code, 2);
  });
});

describe("--smoke", () => {
  test("ramo 200", async () => {
    const url = await start({ health: withHealth({ cache_path: "kv:FORECASTS" }) });
    const { code, out } = await run(["--smoke", url]);
    assert.equal(code, 0, out);
    assert.match(out, /ramo 200/);
  });

  test("ramo 503 (cache vuota)", async () => {
    const url = await start({ empty: true });
    const { code, out } = await run(["--smoke", url]);
    assert.equal(code, 0, out);
    assert.match(out, /ramo 503/);
  });

  test("forma di /health errata: exit != 0", async () => {
    const url = await start({ health: { status: "ok" } });
    const { code, out } = await run(["--smoke", url]);
    assert.notEqual(code, 0);
    assert.match(out, /health/);
  });

  test("server irraggiungibile: exit != 0", async () => {
    const { code } = await run(["--smoke", "http://127.0.0.1:1"]);
    assert.notEqual(code, 0);
  });
});
