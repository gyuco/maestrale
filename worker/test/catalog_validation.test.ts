import { describe, expect, it } from "vitest";

import {
  DEFAULT_BOUNDS,
  MAX_LOCATIONS,
  validateCatalogInput,
  type ExistingLocation,
} from "../src/catalog_validation";

const others: ExistingLocation[] = [
  { slug: "alghero", name: "Alghero", latitude: 40.56, longitude: 8.26, active: true },
  { slug: "chia", name: "Chia", latitude: 38.89, longitude: 8.88, active: true },
  { slug: "vecchia", name: "Vecchia Baia", latitude: 39, longitude: 9, active: false },
];

function input(overrides: Partial<Parameters<typeof validateCatalogInput>[0]> = {}) {
  return {
    slug: "porto-pino",
    name: "Porto Pino",
    latitude: 38.98,
    longitude: 8.42,
    ...overrides,
  };
}

describe("validateCatalogInput (FR-98)", () => {
  it("accetta una voce valida e ripulisce gli spazi", () => {
    const result = validateCatalogInput(input({ slug: " porto-pino ", name: " Porto Pino " }), others);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual({});
    expect(result.normalized).toEqual({
      slug: "porto-pino",
      name: "Porto Pino",
      latitude: 38.98,
      longitude: 8.42,
    });
  });

  it("rifiuta campi mancanti o vuoti con un messaggio per campo", () => {
    const result = validateCatalogInput(input({ slug: "", name: "" }), others);
    expect(result.ok).toBe(false);
    expect(result.errors.slug).toBeTruthy();
    expect(result.errors.name).toBeTruthy();
  });

  it("rifiuta uno slug non normalizzato (maiuscole, spazi, accenti)", () => {
    for (const slug of ["Porto-Pino", "porto pino", "porto_pino", "porto-pinò", "porto--pino"]) {
      const result = validateCatalogInput(input({ slug }), others);
      expect(result.errors.slug, slug).toBeTruthy();
    }
  });

  it("rifiuta uno slug duplicato anche rispetto a una località disattivata", () => {
    expect(validateCatalogInput(input({ slug: "alghero" }), others).errors.slug).toBeTruthy();
    expect(validateCatalogInput(input({ slug: "vecchia" }), others).errors.slug).toBeTruthy();
  });

  it("rifiuta un nome che normalizzato collide con un altro nome o slug", () => {
    expect(validateCatalogInput(input({ name: "ALGHERO" }), others).errors.name).toBeTruthy();
    expect(validateCatalogInput(input({ name: "Vecchia Baia" }), others).errors.name).toBeTruthy();
    expect(validateCatalogInput(input({ name: "chia" }), others).errors.name).toBeTruthy();
  });

  it("rifiuta uno slug che coincide con il nome normalizzato di un'altra località", () => {
    const result = validateCatalogInput(input({ slug: "alghero" }), others);
    expect(result.errors.slug).toBeTruthy();
  });

  it("accetta le coordinate ai limiti e rifiuta quelle fuori area", () => {
    const bounds = DEFAULT_BOUNDS;
    const inside = input({
      latitude: bounds.minLatitude,
      longitude: bounds.maxLongitude,
    });
    expect(validateCatalogInput(inside, others).ok).toBe(true);

    const outsideLat = validateCatalogInput(input({ latitude: bounds.maxLatitude + 0.01 }), others);
    expect(outsideLat.errors.latitude).toBeTruthy();

    const outsideLon = validateCatalogInput(input({ longitude: bounds.minLongitude - 0.01 }), others);
    expect(outsideLon.errors.longitude).toBeTruthy();
  });

  it("segnala coordinate non numeriche", () => {
    const result = validateCatalogInput(
      input({ latitude: Number.NaN, longitude: Number.POSITIVE_INFINITY }),
      others,
    );
    expect(result.errors.latitude).toBeTruthy();
    expect(result.errors.longitude).toBeTruthy();
  });

  it("avvisa oltre 500 località attive ma non blocca (FR-98)", () => {
    const many: ExistingLocation[] = Array.from({ length: MAX_LOCATIONS }, (_, index) => ({
      slug: `localita-${index}`,
      name: `Località ${index}`,
      latitude: 39,
      longitude: 8,
      active: true,
    }));
    const result = validateCatalogInput(input(), many, { isNew: true });
    expect(result.ok).toBe(true);
    expect(result.warning).toContain(String(MAX_LOCATIONS));

    const below = validateCatalogInput(input(), many.slice(0, MAX_LOCATIONS - 1), { isNew: true });
    expect(below.warning).toBeUndefined();
  });

  it("non avvisa per una modifica (isNew assente)", () => {
    const many: ExistingLocation[] = Array.from({ length: MAX_LOCATIONS }, (_, index) => ({
      slug: `localita-${index}`,
      name: `Località ${index}`,
      latitude: 39,
      longitude: 8,
      active: true,
    }));
    expect(validateCatalogInput(input(), many).warning).toBeUndefined();
  });
});
