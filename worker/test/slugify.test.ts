import { describe, expect, it } from "vitest";

import slugCases from "../../tests/fixtures/slug_cases.json";
import { slugify } from "../src/slugify";

// La fixture è generata da `tests/fixtures/gen_domain_fixtures.py`, che chiama
// il vero `backend.main.slugify`: questi test verificano la parità del port TS
// con il dominio Python, non un'aspettativa scritta a mano.
describe("slugify — port di backend/main.py", () => {
  it("coincide con la fixture generata dal codice Python", () => {
    for (const { input, expected } of slugCases.cases) {
      expect(slugify(input), `input: ${JSON.stringify(input)}`).toBe(expected);
    }
  });

  it("copre i comportamenti non ovvi documentati dalla fixture", () => {
    // Apostrofi conservati (non sono ASCII-rimossi) — nota: lo slug che ne
    // risulta non rispetta il pattern dello schema, esattamente come in Python.
    expect(slugify("Sant'Antioco")).toBe("sant'antioco");
    // Carattere non-ASCII non scomponibile eliminato del tutto.
    expect(slugify("Łeba")).toBe("eba");
    // Accenti scomponibili rimossi da NFKD + filtro ASCII.
    expect(slugify("Cagliarì")).toBe("cagliari");
    // Spazi multipli e ai bordi → un solo trattino, niente trattini ai bordi.
    expect(slugify("  Chia  ")).toBe("chia");
    expect(slugify("A  B")).toBe("a-b");
    // Underscore → trattino (anche consecutivi).
    expect(slugify("Porto_Torres")).toBe("porto-torres");
    expect(slugify("under__score")).toBe("under--score");
    // Stringa vuota o di soli spazi → stringa vuota.
    expect(slugify("")).toBe("");
    expect(slugify("   ")).toBe("");
  });
});
