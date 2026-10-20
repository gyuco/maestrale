import { env } from "cloudflare:test";

/** Cancella `latest`, `meta` e ogni `forecast:*` (le prove non devono dipendere dall'ordine). */
export async function clearKv(): Promise<void> {
  const listed = await env.FORECASTS.list({ limit: 1000 });
  await Promise.all(listed.keys.map((key) => env.FORECASTS.delete(key.name)));
}

export async function readJson(key: string): Promise<Record<string, any> | null> {
  const raw = await env.FORECASTS.get(key);
  return raw === null ? null : (JSON.parse(raw) as Record<string, any>);
}

export async function forecastKeys(): Promise<string[]> {
  const listed = await env.FORECASTS.list({ prefix: "forecast:", limit: 1000 });
  return listed.keys.map((key) => key.name).sort();
}
