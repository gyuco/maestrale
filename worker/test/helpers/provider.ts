/**
 * Provider Open-Meteo finto per i test del job (blocchi, fallback, budget) e
 * orologio finto. Nessun test attende tempo reale: `sleep` fa avanzare l'orologio.
 */

import marineResponse from "../../../tests/fixtures/open_meteo_marine_torre-dei-corsari.json";
import weatherResponse from "../../../tests/fixtures/open_meteo_weather_torre-dei-corsari.json";
import { MARINE_SOURCE, WEATHER_SOURCE } from "../../src/data_sources";
import type { FetchImpl } from "../../src/open_meteo";

export type ProviderName = "marine" | "weather";

export interface ProviderRequest {
  provider: ProviderName;
  /** Latitudini richieste (una sola = chiamata singola o blocco da 1). */
  lats: number[];
  lons: number[];
  /** `true` se l'URL contiene una virgola (multi-coordinata). */
  isBlock: boolean;
  atMs: number;
}

export interface FakeProviderOptions {
  /** Orologio in ms usato per `atMs`. */
  nowMs?: () => number;
  /** Decide se una richiesta fallisce (errore di rete = retry, apiError = immediato). */
  fail?: (request: ProviderRequest) => "network" | "apiError" | undefined;
  /** Latitudini il cui elemento, nelle risposte a blocco, è restituito come `{}`. */
  invalidLats?: number[];
  /** Per le risposte a blocco di questo provider, restituisce un elemento in meno. */
  shortList?: ProviderName;
  /** Se `true`, lat/lon risolte della risposta = coordinate richieste (test di mappatura). */
  deriveCoordinates?: boolean;
  /** Ritardo reale (ms) per misurare la concorrenza. */
  delayMs?: number;
  stats?: { total: number; inFlight: number; peak: number };
}

export interface FakeProvider {
  fetchImpl: FetchImpl;
  requests: ProviderRequest[];
}

function element(
  base: Record<string, unknown>,
  lat: number,
  lon: number,
  derive: boolean,
): Record<string, unknown> {
  const copy = structuredClone(base);
  if (derive) {
    copy["latitude"] = lat;
    copy["longitude"] = lon;
  }
  return copy;
}

export function fakeProvider(options: FakeProviderOptions = {}): FakeProvider {
  const requests: ProviderRequest[] = [];
  const nowMs = options.nowMs ?? ((): number => 0);
  const stats = options.stats;

  const fetchImpl: FetchImpl = async (input) => {
    const url = new URL(String(input));
    const base = `${url.origin}${url.pathname}`;
    let provider: ProviderName;
    let fixture: Record<string, unknown>;
    if (base === MARINE_SOURCE.endpoint) {
      provider = "marine";
      fixture = marineResponse as Record<string, unknown>;
    } else if (base === WEATHER_SOURCE.endpoint) {
      provider = "weather";
      fixture = weatherResponse as Record<string, unknown>;
    } else {
      throw new Error(`Endpoint inatteso: ${String(input)}`);
    }
    const lats = (url.searchParams.get("latitude") ?? "").split(",").map(Number);
    const lons = (url.searchParams.get("longitude") ?? "").split(",").map(Number);
    const request: ProviderRequest = {
      provider,
      lats,
      lons,
      isBlock: (url.searchParams.get("latitude") ?? "").includes(","),
      atMs: nowMs(),
    };
    requests.push(request);
    if (stats) {
      stats.total += 1;
      stats.inFlight += 1;
      stats.peak = Math.max(stats.peak, stats.inFlight);
    }
    try {
      if (options.delayMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      const failure = options.fail?.(request);
      if (failure === "network") {
        throw new Error("rete assente");
      }
      if (failure === "apiError") {
        return new Response(JSON.stringify({ error: true, reason: "provider KO" }));
      }
      const derive = options.deriveCoordinates === true;
      const elements = lats.map((lat, index) =>
        (options.invalidLats ?? []).includes(lat) && lats.length > 1
          ? {}
          : element(fixture, lat, lons[index]!, derive),
      );
      // Una sola coordinata: oggetto (come Open-Meteo); più coordinate: lista.
      if (lats.length === 1) {
        return new Response(JSON.stringify(elements[0]));
      }
      if (options.shortList === provider) {
        elements.pop();
      }
      return new Response(JSON.stringify(elements));
    } finally {
      if (stats) {
        stats.inFlight -= 1;
      }
    }
  };

  return { fetchImpl, requests };
}

/** Orologio in ms il cui `sleep` lo fa avanzare (nessuna attesa reale). */
export function fakeClock(startMs = 1_000_000_000_000) {
  const clock = {
    ms: startMs,
    nowMs: (): number => clock.ms,
    // Attese concorrenti si sovrappongono (come nella realtà): il tempo arriva
    // alla scadenza più lontana, non alla somma.
    sleep: async (milliseconds: number): Promise<void> => {
      const target = clock.ms + milliseconds;
      await Promise.resolve();
      clock.ms = Math.max(clock.ms, target);
    },
  };
  return clock;
}

/** Catalogo sintetico di `count` località con coordinate distinte e deterministiche. */
export function syntheticCatalog(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    slug: `loc-${String(index).padStart(3, "0")}`,
    name: `Localita ${String(index).padStart(3, "0")}`,
    latitude: Number((36 + index * 0.01).toFixed(2)),
    longitude: Number((8 + index * 0.005).toFixed(3)),
  }));
}
