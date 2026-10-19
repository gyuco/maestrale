import { describe, expect, it } from "vitest";

import aggCases from "../../tests/fixtures/agg_cases.json";
import roundCases from "../../tests/fixtures/round_cases.json";
import {
  circularMean,
  dailyLookup,
  directionName,
  hourlyByDate,
  maxOfValidNumbers,
  mean,
  rounded,
  roundHalfEven,
  seaState,
  validNumbers,
} from "../src/aggregate";

describe("roundHalfEven — parità con round() di Python (FR-51)", () => {
  it("riproduce ogni caso di round_cases.json", () => {
    expect(roundCases.cases.length).toBeGreaterThan(1000);
    for (const testCase of roundCases.cases) {
      expect(
        roundHalfEven(testCase.value, testCase.digits),
        `${testCase.value} arrotondato a ${testCase.digits} cifre`,
      ).toBe(testCase.expected);
    }
  });

  it("arrotonda half-to-even, non half-away da zero", () => {
    expect(roundHalfEven(0.125, 2)).toBe(0.12);
    expect(roundHalfEven(2.675, 2)).toBe(2.67);
    expect(roundHalfEven(1.005, 2)).toBe(1);
    expect(roundHalfEven(2.5, 0)).toBe(2);
    expect(roundHalfEven(3.5, 0)).toBe(4);
    expect(roundHalfEven(-0.125, 2)).toBe(-0.12);
    expect(Object.is(roundHalfEven(-0, 2), -0)).toBe(true);
  });

  it("rounded propaga null/undefined e applica le cifre", () => {
    expect(rounded(null)).toBeNull();
    expect(rounded(undefined)).toBeNull();
    expect(rounded(23.849, 1)).toBe(23.8);
    expect(rounded(23.849)).toBe(23.85);
  });
});

describe("validNumbers — filtro dei valori orari (FR-7)", () => {
  it("scarta null/undefined e i non finiti", () => {
    expect(
      validNumbers([
        1,
        null,
        undefined,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        2,
        -3,
      ]),
    ).toEqual([1, 2, -3]);
  });

  it("serie vuota o senza valori validi", () => {
    expect(validNumbers([])).toEqual([]);
    expect(validNumbers([null, undefined, Number.NaN])).toEqual([]);
  });
});

describe("mean / circularMean — parità con previsioni_mare.py", () => {
  it("mean riproduce agg_cases.mean", () => {
    for (const testCase of aggCases.mean) {
      expect(mean(testCase.input), JSON.stringify(testCase.input)).toBe(testCase.expected);
    }
  });

  it("mean di serie vuota o nulla è null", () => {
    expect(mean([])).toBeNull();
    expect(mean([null, undefined])).toBeNull();
  });

  // `atan2` di V8 differisce da quello di libm (macOS) di 1 ulp: il valore grezzo
  // è confrontato con tolleranza, mentre l'output osservabile del contratto
  // (gradi interi + nome del vento) è parità esatta su tutti i casi.
  it("circularMean: parità dell'output osservabile e ≤1 ulp sul valore grezzo", () => {
    for (const testCase of aggCases.circular_mean) {
      const got = circularMean(testCase.input);
      if (testCase.expected === null || got === null) {
        expect(got, JSON.stringify(testCase.input)).toBe(testCase.expected);
        continue;
      }
      expect(Math.abs(got - testCase.expected), JSON.stringify(testCase.input)).toBeLessThanOrEqual(
        1e-9,
      );
      expect(roundHalfEven(got, 0)).toBe(roundHalfEven(testCase.expected, 0));
      expect(directionName(got)).toBe(directionName(testCase.expected));
    }
  });

  it("riproduce il modulo floored di Python sull'esempio 350/10", () => {
    expect(circularMean([0, 90, 180, 270])).toBe(135);
    expect(circularMean([350, 10])).toBe(360);
    expect(circularMean([359, 1])).toBe(360);
  });

  it("circularMean di serie vuota è null", () => {
    expect(circularMean([])).toBeNull();
    expect(circularMean([null])).toBeNull();
  });
});

describe("seaState / directionName — soglie Douglas/WMO e rosa dei venti", () => {
  it("seaState riproduce agg_cases.sea_state", () => {
    for (const testCase of aggCases.sea_state) {
      expect(seaState(testCase.input), String(testCase.input)).toBe(testCase.expected);
    }
  });

  it("directionName riproduce agg_cases.direction_name", () => {
    for (const testCase of aggCases.direction_name) {
      expect(directionName(testCase.input), String(testCase.input)).toBe(testCase.expected);
    }
  });
});

describe("maxOfValidNumbers", () => {
  it("massimo dei valori validi", () => {
    expect(maxOfValidNumbers([1, null, 5, Number.NaN, 3])).toBe(5);
  });

  it("lancia su serie vuota, come max() di Python", () => {
    expect(() => maxOfValidNumbers([null, Number.NaN])).toThrow(/empty sequence/);
  });
});

describe("hourlyByDate / dailyLookup", () => {
  it("raggruppa le serie orarie per data (timestamp[:10])", () => {
    const payload = {
      hourly: {
        time: ["2026-10-19T00:00", "2026-10-19T01:00", "2026-10-20T00:00"],
        wave_height: [1, 2, 3],
        wave_direction: [10, null, 30],
      },
    };

    const grouped = hourlyByDate(payload, ["wave_height", "wave_direction"]);

    expect(grouped).toEqual({
      "2026-10-19": { wave_height: [1, 2], wave_direction: [10, null] },
      "2026-10-20": { wave_height: [3], wave_direction: [30] },
    });
    expect(Object.keys(grouped)).toEqual(["2026-10-19", "2026-10-20"]);
  });

  it("dailyLookup indicizza per data ed esclude 'time'", () => {
    const payload = {
      daily: {
        time: ["2026-10-19", "2026-10-20"],
        weather_code: [3, 1],
        temperature_2m_min: [20.7, 19.9],
      },
    };

    const lookup = dailyLookup(payload);

    expect(lookup).toEqual({
      "2026-10-19": { weather_code: 3, temperature_2m_min: 20.7 },
      "2026-10-20": { weather_code: 1, temperature_2m_min: 19.9 },
    });
    expect(Object.keys(lookup["2026-10-19"]!)).toEqual(["weather_code", "temperature_2m_min"]);
  });
});
