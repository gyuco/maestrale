/**
 * Port di `previsioni_mare.py`: aggregazioni giornaliere e arrotondamenti.
 *
 * Il modulo riproduce il comportamento **numerico** del codice Python, non solo
 * la formula. Tre dettagli non ovvi, tutti verificati contro il Python reale
 * dalle fixture (`round_cases.json`, `agg_cases.json`):
 *
 * 1. `round()` di Python è *half-to-even* sulla rappresentazione decimale del
 *    double (`round(0.125, 2) == 0.12`, `round(2.675, 2) == 2.67`). `toFixed` e
 *    `Math.round` non lo riproducono: l'arrotondamento è fatto con aritmetica
 *    esatta su `BigInt` (`roundHalfEven`).
 * 2. `sum()` di CPython ≥ 3.12 usa la **sommatoria compensata di Neumaier** per i
 *    float; `mean`/`circular_mean` riproducono `pySum` per parità all'ultimo
 *    bit (senza di esso `mean` differisce sui valori al limite).
 * 3. `%` in Python è il modulo *floored* (segno del divisore) e `math.radians`/
 *    `math.degrees` moltiplicano per le costanti `π/180` e `180/π`. `pyMod`,
 *    `DEG_TO_RAD` e `RAD_TO_DEG` replicano esattamente questi tre punti: con la
 *    formula `((x % 360) + 360) % 360` il caso `[350, 10]` darebbe `0` invece di
 *    `360` come il Python.
 */

/** Valore orario grezzo di Open-Meteo: numero, oppure assente. */
export type MaybeNumber = number | null | undefined;

/** Raggruppamento orario per data (`timestamp[:10]`). */
export type HourlyByDate = Record<string, Record<string, MaybeNumber[]>>;

/** Valori giornalieri ufficiali del provider, indicizzati per data. */
export type DailyLookup = Record<string, Record<string, unknown>>;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Scala Douglas/WMO (FR-10). */
const SEA_STATE_LIMITS: readonly (readonly [number, string])[] = [
  [0.0, "Calmo"],
  [0.1, "Quasi calmo"],
  [0.5, "Poco mosso"],
  [1.25, "Mosso"],
  [2.5, "Molto mosso"],
  [4.0, "Agitato"],
  [6.0, "Molto agitato"],
  [9.0, "Grosso"],
  [14.0, "Molto grosso"],
];

/** Rosa dei venti a 8 settori (FR-11). */
const WIND_ROSE: readonly string[] = [
  "Tramontana",
  "Grecale",
  "Levante",
  "Scirocco",
  "Ostro",
  "Libeccio",
  "Ponente",
  "Maestrale",
];

/**
 * Somma di una serie di float identica a `sum()` di CPython ≥ 3.12, che per i
 * float usa la sommatoria compensata di Neumaier (`bltinmodule.c`).
 */
function pySum(values: Iterable<number>): number {
  let result = 0;
  let correction = 0;
  for (const value of values) {
    const total = result + value;
    if (Math.abs(result) >= Math.abs(value)) {
      correction += result - total + value;
    } else {
      correction += value - total + result;
    }
    result = total;
  }
  return result + correction;
}

/** Modulo *floored* di Python (`float % float`), non il resto troncato di `%` in JS. */
function pyMod(dividend: number, divisor: number): number {
  const remainder = dividend % divisor;
  if (remainder === 0) {
    return divisor < 0 ? -0 : 0;
  }
  if (divisor < 0 !== remainder < 0) {
    return remainder + divisor;
  }
  return remainder;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** `previsioni_mare.valid_numbers`: tiene i numeri finiti, scarta null/undefined e non finiti. */
export function validNumbers(values: Iterable<MaybeNumber>): number[] {
  const numbers: number[] = [];
  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }
    if (!Number.isFinite(value)) {
      continue;
    }
    numbers.push(value);
  }
  return numbers;
}

/** `previsioni_mare.mean`: media dei valori validi, `null` su serie vuota. */
export function mean(values: Iterable<MaybeNumber>): number | null {
  const numbers = validNumbers(values);
  return numbers.length > 0 ? pySum(numbers) / numbers.length : null;
}

/** `previsioni_mare.circular_mean`: media circolare in gradi, `null` su serie vuota. */
export function circularMean(values: Iterable<MaybeNumber>): number | null {
  const numbers = validNumbers(values);
  if (numbers.length === 0) {
    return null;
  }
  const sine = pySum(numbers.map((value) => Math.sin(value * DEG_TO_RAD))) / numbers.length;
  const cosine = pySum(numbers.map((value) => Math.cos(value * DEG_TO_RAD))) / numbers.length;
  return pyMod(Math.atan2(sine, cosine) * RAD_TO_DEG, 360);
}

function decompose(value: number): {
  readonly negative: boolean;
  readonly mantissa: bigint;
  readonly exponent: number;
} {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const high = view.getUint32(0);
  const low = view.getUint32(4);
  const exponentBits = (high >>> 20) & 0x7ff;
  let mantissa = (BigInt(high & 0xfffff) << 32n) + BigInt(low);
  let exponent: number;
  if (exponentBits === 0) {
    // Subnormale: il bit implicito è 0.
    exponent = -1074;
  } else {
    mantissa += 1n << 52n;
    exponent = exponentBits - 1075;
  }
  return { negative: value < 0, mantissa, exponent };
}

/** Divide due `BigInt` arrotondando half-to-even (usata da `roundHalfEven`). */
function roundHalfEvenFraction(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const doubled = remainder * 2n;
  if (doubled > denominator) {
    return quotient + 1n;
  }
  if (doubled < denominator) {
    return quotient;
  }
  return quotient % 2n === 0n ? quotient : quotient + 1n;
}

/**
 * `round(value, digits)` di Python: arrotondamento half-to-even sulla
 * rappresentazione decimale **esatta** del double. Aritmetica intera (`BigInt`)
 * sulla decomposizione binaria `value = m * 2^e`, poi conversione con
 * `Number("...e-...")` per ottenere il double correttamente arrotondato.
 */
export function roundHalfEven(value: number, digits: number): number {
  if (Number.isNaN(value)) {
    throw new RangeError("roundHalfEven: NaN non arrotondabile");
  }
  if (!Number.isFinite(value)) {
    throw new RangeError("roundHalfEven: valore non finito");
  }
  if (value === 0) {
    // Preserva lo zero con segno, come `round(-0.0, n)`.
    return value;
  }
  const { negative, mantissa, exponent } = decompose(value);
  let numerator = mantissa;
  let denominator = 1n;
  const powerOfTwo = exponent + digits;
  if (powerOfTwo >= 0) {
    numerator *= 2n ** BigInt(powerOfTwo);
  } else {
    denominator *= 2n ** BigInt(-powerOfTwo);
  }
  if (digits >= 0) {
    numerator *= 5n ** BigInt(digits);
  } else {
    denominator *= 5n ** BigInt(-digits);
  }
  const rounded = roundHalfEvenFraction(numerator, denominator);
  const magnitude = Number(`${rounded}e${digits >= 0 ? "-" : ""}${Math.abs(digits)}`);
  return negative ? -magnitude : magnitude;
}

/** `previsioni_mare.rounded`: arrotonda se il valore c'è, altrimenti `null`. */
export function rounded(value: MaybeNumber, digits = 2): number | null {
  return value === null || value === undefined ? null : roundHalfEven(value, digits);
}

/**
 * `max(valid_numbers(...))` di Python: massimo dei valori validi. Su serie vuota
 * il Python solleva `ValueError: max() arg is an empty sequence`: qui l'analogo
 * `RangeError`, perché questo caso non deve passare silenziosamente.
 */
export function maxOfValidNumbers(values: Iterable<MaybeNumber>): number {
  const numbers = validNumbers(values);
  if (numbers.length === 0) {
    throw new RangeError("max() arg is an empty sequence");
  }
  return numbers.reduce((maximum, value) => (value > maximum ? value : maximum));
}

/** `previsioni_mare.sea_state`: classificazione Douglas/WMO dall'altezza media. */
export function seaState(waveHeight: MaybeNumber): string | null {
  if (waveHeight === null || waveHeight === undefined) {
    return null;
  }
  for (const [upperBound, label] of SEA_STATE_LIMITS) {
    if (waveHeight <= upperBound) {
      return label;
    }
  }
  return "Tempestoso";
}

/** `previsioni_mare.direction_name`: nome del vento a 8 settori. */
export function directionName(degrees: MaybeNumber): string | null {
  if (degrees === null || degrees === undefined) {
    return null;
  }
  const index = pyMod(Math.floor((degrees + 22.5) / 45), 8);
  return WIND_ROSE[index] ?? null;
}

function readSeriesValue(
  hourly: Record<string, unknown>,
  field: string,
  index: number,
): MaybeNumber {
  const raw = hourly[field];
  if (!isUnknownArray(raw)) {
    throw new TypeError(`Serie oraria mancante: ${field}`);
  }
  const value = raw[index];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return value;
  }
  throw new TypeError(`Valore orario non numerico in '${field}': ${String(value)}`);
}

/** `previsioni_mare.hourly_by_date`: raggruppa le serie orarie per `timestamp[:10]`. */
export function hourlyByDate(
  payload: Record<string, unknown>,
  fields: readonly string[],
): HourlyByDate {
  const hourly = payload["hourly"];
  if (!isRecord(hourly)) {
    throw new TypeError("Risposta Open-Meteo senza blocco 'hourly'");
  }
  const times = hourly["time"];
  if (!isUnknownArray(times)) {
    throw new TypeError("Blocco 'hourly' senza serie 'time'");
  }
  const grouped = new Map<string, Map<string, MaybeNumber[]>>();
  for (let index = 0; index < times.length; index += 1) {
    const timestamp = times[index];
    if (typeof timestamp !== "string") {
      throw new TypeError("Timestamp orario non testuale");
    }
    const date = timestamp.slice(0, 10);
    let byField = grouped.get(date);
    if (byField === undefined) {
      byField = new Map<string, MaybeNumber[]>();
      grouped.set(date, byField);
    }
    for (const field of fields) {
      let series = byField.get(field);
      if (series === undefined) {
        series = [];
        byField.set(field, series);
      }
      series.push(readSeriesValue(hourly, field, index));
    }
  }
  const result: HourlyByDate = {};
  for (const [date, byField] of grouped) {
    const entry: Record<string, MaybeNumber[]> = {};
    for (const [field, series] of byField) {
      entry[field] = series;
    }
    result[date] = entry;
  }
  return result;
}

/** `previsioni_mare.daily_lookup`: valori giornalieri ufficiali, esclusa `time`. */
export function dailyLookup(payload: Record<string, unknown>): DailyLookup {
  const daily = payload["daily"];
  if (!isRecord(daily)) {
    throw new TypeError("Risposta Open-Meteo senza blocco 'daily'");
  }
  const times = daily["time"];
  if (!isUnknownArray(times)) {
    throw new TypeError("Blocco 'daily' senza serie 'time'");
  }
  const result: DailyLookup = {};
  for (let index = 0; index < times.length; index += 1) {
    const date = times[index];
    if (typeof date !== "string") {
      throw new TypeError("Data giornaliera non testuale");
    }
    const entry: Record<string, unknown> = {};
    for (const [field, values] of Object.entries(daily)) {
      if (field === "time" || !isUnknownArray(values)) {
        continue;
      }
      entry[field] = values[index];
    }
    result[date] = entry;
  }
  return result;
}
