import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("Worker scaffold", () => {
  it("GET / risponde 200 con status ok (Hono)", async () => {
    const response = await SELF.fetch("https://example.com/");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const body = (await response.json()) as { status?: string; service?: string };
    expect(body).toEqual({ status: "ok", service: "maestrale" });
  });

  it("il binding KV FORECASTS è disponibile e scrivibile", async () => {
    await env.FORECASTS.put("scaffold:probe", "ok");

    expect(await env.FORECASTS.get("scaffold:probe")).toBe("ok");
  });

  it("una route sconosciuta risponde 404", async () => {
    const response = await SELF.fetch("https://example.com/nope");

    expect(response.status).toBe(404);
  });
});
