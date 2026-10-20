/**
 * Funzioni pure dello storico giornaliero (ADR-0002 §2; FR-69, FR-70).
 */

import { SEA_STATE_LABELS } from "./aggregate";
import type { HistoryCacheConfig } from "./config";
import type { Forecast } from "./types";

/** Una riga di `daily_history` (FR-69): chiave più i 7 valori del giorno 0. */
export interface HistoryRow {
  location_slug: string;
  date: string;
  air_temperature_mean_c: number | null;
  air_temperature_min_c: number | null;
  air_temperature_max_c: number | null;
  water_temperature_mean_c: number | null;
  state: string | null;
  wave_height_mean_m: number | null;
  wave_height_max_m: number | null;
}

const ROME_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Rome",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Data `YYYY-MM-DD` dell'istante nel fuso Europe/Rome (ora legale inclusa). */
export function romeDate(instant: Date): string {
  const parts = ROME_DATE.formatToParts(instant);
  const pick = (type: string): string => parts.find((part) => part.type === type)!.value;
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/**
 * Riga del giorno 0 copiata, senza trasformazioni, dall'elemento di `daily` con
 * `date` = `date`; `null` se la previsione non lo contiene (FR-70).
 */
export function dayZeroRow(slug: string, forecast: Forecast, date: string): HistoryRow | null {
  const day = forecast.daily.find((item) => item.date === date);
  if (day === undefined) {
    return null;
  }
  return {
    location_slug: slug,
    date,
    air_temperature_mean_c: day.weather.air_temperature_mean_c,
    air_temperature_min_c: day.weather.air_temperature_min_c,
    air_temperature_max_c: day.weather.air_temperature_max_c,
    water_temperature_mean_c: day.sea.water_temperature_mean_c,
    state: day.sea.state,
    wave_height_mean_m: day.sea.wave_height_mean_m,
    wave_height_max_m: day.sea.wave_height_max_m,
  };
}

/** Limiti dell'intervallo richiesto (FR-77). */
export const MAX_HISTORY_DAYS = 366;
export const MAX_HISTORY_MONTHS = 120;

export type HistoryGranularity = "day" | "month";

export interface HistoryParams {
  localita: string;
  granularity: HistoryGranularity;
  from: string;
  to: string;
}

export type ParsedHistoryParams = { ok: true; value: HistoryParams } | { ok: false; detail: string };

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Millisecondi UTC della data di calendario `YYYY-MM-DD`, o `null` se non valida. */
function calendarMs(value: string | undefined): number | null {
  const match = value === undefined ? null : DATE_PATTERN.exec(value);
  if (match === null) {
    return null;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? ms
    : null;
}

/**
 * Validazione pura dei parametri di `GET /history` (ADR-0002 §3, FR-74, FR-77),
 * nell'ordine dell'ADR; `detail` è in italiano.
 */
export function parseHistoryParams(query: {
  localita?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  granularity?: string | undefined;
}): ParsedHistoryParams {
  const fail = (detail: string): ParsedHistoryParams => ({ ok: false, detail });
  const { localita, from, to } = query;
  if (localita === undefined || localita === "") {
    return fail("Il parametro 'localita' è obbligatorio");
  }
  const granularity = query.granularity ?? "day";
  if (granularity !== "day" && granularity !== "month") {
    return fail("Il parametro 'granularity' deve essere 'day' o 'month'");
  }
  const fromMs = calendarMs(from);
  if (fromMs === null || from === undefined) {
    return fail("Il parametro 'from' è obbligatorio e deve essere una data valida YYYY-MM-DD");
  }
  const toMs = calendarMs(to);
  if (toMs === null || to === undefined) {
    return fail("Il parametro 'to' è obbligatorio e deve essere una data valida YYYY-MM-DD");
  }
  if (fromMs > toMs) {
    return fail("Il parametro 'from' non può essere successivo a 'to'");
  }
  if (granularity === "day") {
    if ((toMs - fromMs) / DAY_MS + 1 > MAX_HISTORY_DAYS) {
      return fail(`Con granularity=day l'intervallo non può superare ${MAX_HISTORY_DAYS} giorni`);
    }
  } else {
    const months = (y: string, m: string): number => Number(y) * 12 + Number(m);
    const touched = months(to.slice(0, 4), to.slice(5, 7)) - months(from.slice(0, 4), from.slice(5, 7)) + 1;
    if (touched > MAX_HISTORY_MONTHS) {
      return fail(`Con granularity=month l'intervallo non può toccare più di ${MAX_HISTORY_MONTHS} mesi`);
    }
  }
  return { ok: true, value: { localita, granularity, from, to } };
}

/** `CASE state WHEN 'Calmo' THEN 0 … END`, generato dalla lista FR-10 (ADR-0002 §3). */
export function stateRankCase(): string {
  const whens = SEA_STATE_LABELS.map((label, rank) => `WHEN '${label.replace(/'/g, "''")}' THEN ${rank}`);
  return `CASE state ${whens.join(" ")} END`;
}

/**
 * `Cache-Control` della 200 di `/history` (FR-79): breve se `to` >= oggi
 * Europe/Rome (`today`), lungo se l'intervallo è interamente nel passato.
 */
export function cacheControlFor(to: string, today: string, config: HistoryCacheConfig): string {
  const seconds = to >= today ? config.shortSeconds : config.longSeconds;
  return `public, max-age=${seconds}`;
}
