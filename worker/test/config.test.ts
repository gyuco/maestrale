import { describe, expect, it } from "vitest";

import { DEFAULT_UPDATE_CONFIG, resolveUpdateConfig, updateConfigFromEnv } from "../src/config";
import { MARINE_SOURCE } from "../src/data_sources";
import { buildUrl, fetchJsonList } from "../src/open_meteo";

describe("configurazione del job", () => {
  it("default dell'ADR-0003 e del PRD", () => {
    expect(resolveUpdateConfig()).toMatchObject({
      blockSize: 50,
      breakerThreshold: 0.5,
      maxSubrequests: 45,
      budgetSeconds: 720,
      concurrency: 4,
      maxWeightPerMin: 300,
      paidAlertSubrequests: 40,
      paidAlertKvWritesPerDay: 700,
    });
  });

  it("legge le variabili d'ambiente e ignora i valori non numerici", () => {
    const config = resolveUpdateConfig(
      updateConfigFromEnv({
        OPEN_METEO_BLOCK_SIZE: "25",
        FALLBACK_BREAKER_THRESHOLD: "0.3",
        UPDATE_MAX_SUBREQUESTS: "9000",
        PAID_ALERT_KV_WRITES_PER_DAY: "900",
        UPDATE_BUDGET_SECONDS: "abc",
        UPDATE_CONCURRENCY: "",
      }),
    );
    expect(config.blockSize).toBe(25);
    expect(config.breakerThreshold).toBe(0.3);
    expect(config.maxSubrequests).toBe(9000);
    expect(config.paidAlertKvWritesPerDay).toBe(900);
    expect(config.budgetSeconds).toBe(DEFAULT_UPDATE_CONFIG.budgetSeconds);
    expect(config.concurrency).toBe(DEFAULT_UPDATE_CONFIG.concurrency);
  });

  it.each([
    [0, 1],
    [-5, 1],
    [1, 1],
    [100, 100],
    [101, 100],
    [7.9, 7],
  ])("la dimensione del blocco %s è riportata a %s (1..100)", (input, expected) => {
    expect(resolveUpdateConfig({ blockSize: input }).blockSize).toBe(expected);
  });
});

describe("richieste a blocco", () => {
  it("l'URL multi-coordinata separa le coordinate con virgola codificata e conserva gli altri parametri", () => {
    const url = buildUrl(
      MARINE_SOURCE.endpoint,
      MARINE_SOURCE.requestParams("40.56,39.92", "8.26,9.72", 7, "Europe/Rome"),
    );
    expect(url).toContain("latitude=40.56%2C39.92&longitude=8.26%2C9.72&");
    expect(url).toContain("cell_selection=sea");
    expect(url).toContain("forecast_days=7");
  });

  it("fetchJsonList accetta liste, avvolge un oggetto singolo e fallisce su error", async () => {
    const respond = (body: unknown) => async () => new Response(JSON.stringify(body));
    const params = MARINE_SOURCE.requestParams("1,2", "3,4", 7, "Europe/Rome");
    const sleep = async () => {};
    expect(
      await fetchJsonList(MARINE_SOURCE.endpoint, params, {
        fetchImpl: respond([{ a: 1 }, { a: 2 }]),
        sleep,
      }),
    ).toEqual([{ a: 1 }, { a: 2 }]);
    expect(
      await fetchJsonList(MARINE_SOURCE.endpoint, params, { fetchImpl: respond({ a: 1 }), sleep }),
    ).toEqual([{ a: 1 }]);
    await expect(
      fetchJsonList(MARINE_SOURCE.endpoint, params, {
        fetchImpl: respond({ error: true, reason: "boom" }),
        sleep,
      }),
    ).rejects.toThrow("boom");
  });

  it("beforeAttempt è chiamato per ogni tentativo e un suo errore non è ritentato", async () => {
    let attempts = 0;
    const calls: number[] = [];
    const fetchImpl = async (): Promise<Response> => {
      attempts += 1;
      throw new Error("rete");
    };
    const params = MARINE_SOURCE.requestParams("1,2", "3,4", 7, "Europe/Rome");
    await expect(
      fetchJsonList(MARINE_SOURCE.endpoint, params, {
        fetchImpl,
        sleep: async () => {},
        beforeAttempt: () => {
          calls.push(attempts);
          if (calls.length === 3) {
            throw new Error("budget");
          }
        },
      }),
    ).rejects.toThrow("budget");
    expect(attempts).toBe(2);
    expect(calls).toEqual([0, 1, 2]);
  });
});
