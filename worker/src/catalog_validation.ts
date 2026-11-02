/**
 * Validazione del catalogo (FR-98) condivisa fra backoffice, seed e test.
 *
 * Regole (PRD v0.7, FR-98): campi obbligatori; `slug` già normalizzato secondo
 * FR-22 e unico su **tutte** le voci (attive e disattivate); `name` non vuoto e
 * la sua forma normalizzata non coincide con lo slug o il nome normalizzato di
 * un'altra località; lo slug non coincide con il nome normalizzato di un'altra;
 * coordinate nell'area della Sardegna e del mare circostante.
 */

import { slugify } from "./slugify";

export interface CatalogInput {
  slug: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface ExistingLocation extends CatalogInput {
  active: boolean;
}

export interface CoordinateBounds {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

/** FR-98, OQ-46: Sardegna e mare circostante (estremi inclusi). */
export const DEFAULT_BOUNDS: CoordinateBounds = {
  minLatitude: 38.5,
  maxLatitude: 41.5,
  minLongitude: 7.5,
  maxLongitude: 10.2,
};

/** NFR-19, FR-98: oltre questa soglia si avvisa ma non si blocca. */
export const MAX_LOCATIONS = 500;

export type CatalogField = "slug" | "name" | "latitude" | "longitude";

export type ValidationErrors = Partial<Record<CatalogField, string>>;

export interface ValidationResult {
  ok: boolean;
  errors: ValidationErrors;
  /** Avviso non bloccante (oltre 500 località attive, FR-98). */
  warning?: string;
  /** Valori ripuliti dagli spazi ai bordi. */
  normalized: CatalogInput;
}

export interface ValidationOptions {
  bounds?: CoordinateBounds;
  maxLocations?: number;
  /** `true` per un'aggiunta: abilita l'avviso oltre la soglia. */
  isNew?: boolean;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function formatBound(value: number): string {
  return String(value).replace(".", ",");
}

function isInside(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

/**
 * Valida una voce. `others` sono tutte le altre località del catalogo (attive e
 * disattivate): per una modifica va esclusa la voce stessa.
 */
export function validateCatalogInput(
  input: CatalogInput,
  others: readonly ExistingLocation[],
  options: ValidationOptions = {},
): ValidationResult {
  const bounds = options.bounds ?? DEFAULT_BOUNDS;
  const maxLocations = options.maxLocations ?? MAX_LOCATIONS;
  const isNew = options.isNew ?? false;
  const errors: ValidationErrors = {};

  const slug = input.slug.trim();
  const name = input.name.trim();
  const latitude = input.latitude;
  const longitude = input.longitude;

  if (slug === "") {
    errors.slug = "Lo slug è obbligatorio.";
  } else if (slugify(slug) !== slug) {
    errors.slug =
      "Lo slug deve essere in minuscolo, senza accenti, con trattini al posto di spazi e underscore.";
  } else if (!SLUG_PATTERN.test(slug)) {
    errors.slug = "Lo slug può contenere solo lettere, cifre e trattino.";
  } else if (others.some((other) => other.slug === slug)) {
    errors.slug = "Slug già usato da un'altra località.";
  } else if (others.some((other) => slugify(other.name) === slug)) {
    errors.slug = "Lo slug coincide con il nome di un'altra località.";
  }

  if (name === "") {
    errors.name = "Il nome è obbligatorio.";
  } else {
    const normalizedName = slugify(name);
    if (
      normalizedName === "" ||
      others.some(
        (other) => other.slug === normalizedName || slugify(other.name) === normalizedName,
      )
    ) {
      errors.name = "Il nome coincide con un'altra località.";
    }
  }

  if (!Number.isFinite(latitude)) {
    errors.latitude = "La latitudine deve essere un numero.";
  } else if (!isInside(latitude, bounds.minLatitude, bounds.maxLatitude)) {
    errors.latitude = `La latitudine deve essere tra ${formatBound(bounds.minLatitude)} e ${formatBound(bounds.maxLatitude)}.`;
  }

  if (!Number.isFinite(longitude)) {
    errors.longitude = "La longitudine deve essere un numero.";
  } else if (!isInside(longitude, bounds.minLongitude, bounds.maxLongitude)) {
    errors.longitude = `La longitudine deve essere tra ${formatBound(bounds.minLongitude)} e ${formatBound(bounds.maxLongitude)}.`;
  }

  let warning: string | undefined;
  if (isNew && Object.keys(errors).length === 0) {
    const active = others.filter((other) => other.active).length;
    if (active >= maxLocations) {
      warning = `Attenzione: con questa aggiunta le località attive superano ${maxLocations}.`;
    }
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    ...(warning === undefined ? {} : { warning }),
    normalized: { slug, name, latitude, longitude },
  };
}
