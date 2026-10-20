import { describe, expect, it } from "vitest";

import locations from "../../locations.json";
import {
  CatalogError,
  loadCatalog,
  locationsDocument,
  resolve,
  validateLocations,
} from "../src/catalog";
import { slugify } from "../src/slugify";
import { syntheticCatalog } from "./helpers/provider";

describe("locations.json reale (ADR-0004: validazione prima del deploy)", () => {
  it("ha slug univoci", () => {
    const slugs = locations.map((item) => item.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("ha slug uguale a slugify(slug)", () => {
    for (const item of locations) {
      expect(slugify(item.slug), item.slug).toBe(item.slug);
    }
  });

  it("nessun nome normalizzato collide con un altro nome o con lo slug altrui", () => {
    const normalized = locations.map((item) => slugify(item.name));
    expect(new Set(normalized).size).toBe(normalized.length);
    for (const item of locations) {
      const other = locations.filter((candidate) => candidate !== item);
      for (const candidate of other) {
        expect(slugify(item.name), `${item.name} vs ${candidate.slug}`).not.toBe(candidate.slug);
      }
    }
  });

  it("ha coordinate nell'intervallo e nomi di al più 60 caratteri", () => {
    for (const item of locations) {
      expect(item.latitude).toBeGreaterThanOrEqual(-90);
      expect(item.latitude).toBeLessThanOrEqual(90);
      expect(item.longitude).toBeGreaterThanOrEqual(-180);
      expect(item.longitude).toBeLessThanOrEqual(180);
      expect(item.name.length).toBeLessThanOrEqual(60);
    }
  });

  it("passa la validazione a runtime", () => {
    expect(validateLocations(locations)).toHaveLength(locations.length);
  });
});

describe("validateLocations (FR-2)", () => {
  it("rifiuta una voce con campi mancanti, elencandoli", () => {
    expect(() => validateLocations([{ slug: "a", name: "A" }])).toThrow(
      "Localita non valida, campi mancanti: ['latitude', 'longitude']",
    );
  });

  it("rifiuta coordinate non numeriche o slug/nome vuoti", () => {
    const base = { slug: "a", name: "A", latitude: 1, longitude: 2 };
    expect(() => validateLocations([{ ...base, latitude: "x" }])).toThrow(CatalogError);
    expect(() => validateLocations([{ ...base, slug: "" }])).toThrow(CatalogError);
    expect(() => validateLocations([{ ...base, name: "  " }])).toThrow(CatalogError);
  });

  it("rifiuta un catalogo che non è una lista", () => {
    expect(() => loadCatalog({} as never)).toThrow(CatalogError);
  });
});

describe("resolve (FR-22)", () => {
  const catalog = loadCatalog(locations);

  it("risolve per slug esatto", () => {
    expect(resolve(catalog, "la-maddalena")?.name).toBe("La Maddalena");
  });

  it("risolve per nome normalizzato (maiuscole, spazi, accenti)", () => {
    expect(resolve(catalog, "  LA  Maddalena ")?.slug).toBe("la-maddalena");
    expect(resolve(catalog, "Torre dei Corsari")?.slug).toBe("torre-dei-corsari");
  });

  it("restituisce null fuori catalogo", () => {
    expect(resolve(catalog, "Atlantide")).toBeNull();
  });
});

describe("locationsDocument (FR-62, FR-63)", () => {
  it("ordina per name, ha involucro e version uguale all'ETag senza virgolette", async () => {
    const raw = [
      { slug: "b", name: "Beta", latitude: 1, longitude: 2 },
      { slug: "a", name: "Alfa", latitude: 3, longitude: 4 },
    ];
    const doc = await locationsDocument(raw);
    const body = JSON.parse(doc.body);
    expect(body.schema_version).toBe(1);
    expect(body.count).toBe(2);
    expect(body.locations.map((item: { slug: string }) => item.slug)).toEqual(["a", "b"]);
    expect(doc.etag).toMatch(/^"[0-9a-f]{16}"$/);
    expect(body.version).toBe(doc.etag.slice(1, -1));
  });

  it("l'ETag cambia se e solo se cambia il contenuto", async () => {
    const a = await locationsDocument(syntheticCatalog(5));
    const same = await locationsDocument(syntheticCatalog(5));
    const other = await locationsDocument(syntheticCatalog(6));
    expect(same.etag).toBe(a.etag);
    expect(other.etag).not.toBe(a.etag);
  });

  it("l'ordine di ingresso non cambia l'ETag", async () => {
    const list = syntheticCatalog(5);
    const reversed = [...list].reverse();
    expect((await locationsDocument(reversed)).etag).toBe((await locationsDocument(list)).etag);
  });

  it("con 500 voci il corpo resta sotto 100 KB (NFR-19)", async () => {
    const doc = await locationsDocument(syntheticCatalog(500));
    expect(new TextEncoder().encode(doc.body).length).toBeLessThan(100_000);
  });
});
