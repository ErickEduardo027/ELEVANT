import type { MockValidationResult } from "./mock-auth";

export const MOCK_AFFILIATION_REQUESTS_STORAGE_KEY =
  "elevant.mock-affiliation.requests.v1";
export const MOCK_AFFILIATION_SCHEMA_VERSION = 1 as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IATA_PATTERN = /^[A-Z0-9]{2}$/;
const ICAO_PATTERN = /^[A-Z0-9]{3}$/;
const STATION_PATTERN = /^[A-Z0-9]{3,4}$/;

export interface MockAffiliationInput {
  legalName: string;
  displayName: string;
  iataCode: string;
  icaoCode: string;
  country: string;
  primaryStation: string;
  additionalStations: string;
  fullName: string;
  title: string;
  email: string;
  phone: string;
  servicesOfInterest: string;
  prototypeAcknowledged: boolean;
}

export const MOCK_AFFILIATION_FIELDS = [
  "legalName",
  "displayName",
  "iataCode",
  "icaoCode",
  "country",
  "primaryStation",
  "additionalStations",
  "fullName",
  "title",
  "email",
  "phone",
  "servicesOfInterest",
  "prototypeAcknowledged",
] as const;

export type MockAffiliationField =
  (typeof MOCK_AFFILIATION_FIELDS)[number];
export type MockAffiliationFieldErrors = Partial<
  Record<MockAffiliationField, string>
>;

export interface MockAffiliationRequest {
  schemaVersion: typeof MOCK_AFFILIATION_SCHEMA_VERSION;
  id: string;
  reference: string;
  status: "received";
  submittedAt: string;
  airline: {
    legalName: string;
    displayName: string;
    iataCode: string | null;
    icaoCode: string | null;
    country: string;
  };
  stations: {
    primary: string;
    requested: string[];
  };
  representative: {
    fullName: string;
    title: string;
    email: string;
    phone: string;
  };
  servicesOfInterest: string;
}

export type MockAffiliationResult =
  | { ok: true; request: MockAffiliationRequest }
  | {
      ok: false;
      message: string;
      fieldErrors?: MockAffiliationFieldErrors;
      firstInvalidField?: MockAffiliationField;
    };

interface StoredAffiliationDocument {
  schemaVersion: typeof MOCK_AFFILIATION_SCHEMA_VERSION;
  requests: MockAffiliationRequest[];
}

export interface MockAffiliationGatewayOptions {
  localStorage?: Storage | null;
  crypto?: Crypto;
  now?: () => number;
}

function cleanText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase("es");
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

function splitStations(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,;\n]+/)
        .map(normalizeCode)
        .filter(Boolean),
    ),
  ];
}

function normalizeAffiliation(
  input: MockAffiliationInput,
): MockAffiliationInput {
  const primaryStation = normalizeCode(input.primaryStation);
  const additionalStations = splitStations(input.additionalStations).filter(
    (station) => station !== primaryStation,
  );
  return {
    legalName: cleanText(input.legalName),
    displayName: cleanText(input.displayName),
    iataCode: normalizeCode(input.iataCode),
    icaoCode: normalizeCode(input.icaoCode),
    country: cleanText(input.country),
    primaryStation,
    additionalStations: additionalStations.join(", "),
    fullName: cleanText(input.fullName),
    title: cleanText(input.title),
    email: normalizeEmail(input.email),
    phone: cleanText(input.phone),
    servicesOfInterest: input.servicesOfInterest.trim().replace(/[ \t]+/g, " "),
    prototypeAcknowledged: Boolean(input.prototypeAcknowledged),
  };
}

export function validateAffiliation(
  input: MockAffiliationInput,
): MockValidationResult<MockAffiliationInput, MockAffiliationField> {
  const value = normalizeAffiliation(input);
  const fieldErrors: MockAffiliationFieldErrors = {};

  if (!value.legalName) {
    fieldErrors.legalName = "Ingresa la razón social de la aerolínea.";
  } else if (value.legalName.length > 160) {
    fieldErrors.legalName = "Usa un máximo de 160 caracteres.";
  }
  if (value.displayName.length > 120) {
    fieldErrors.displayName = "Usa un máximo de 120 caracteres.";
  }

  if (!value.iataCode && !value.icaoCode) {
    fieldErrors.iataCode = "Ingresa al menos un código IATA o ICAO.";
  } else {
    if (value.iataCode && !IATA_PATTERN.test(value.iataCode)) {
      fieldErrors.iataCode = "El código IATA debe tener 2 caracteres.";
    }
    if (value.icaoCode && !ICAO_PATTERN.test(value.icaoCode)) {
      fieldErrors.icaoCode = "El código ICAO debe tener 3 caracteres.";
    }
  }

  if (!value.country) {
    fieldErrors.country = "Ingresa el país de la aerolínea.";
  } else if (value.country.length > 80) {
    fieldErrors.country = "Usa un máximo de 80 caracteres.";
  }

  if (!value.primaryStation) {
    fieldErrors.primaryStation = "Ingresa la estación principal.";
  } else if (!STATION_PATTERN.test(value.primaryStation)) {
    fieldErrors.primaryStation =
      "Usa un código de estación de 3 o 4 caracteres.";
  }
  const additionalStations = splitStations(value.additionalStations);
  if (additionalStations.some((station) => !STATION_PATTERN.test(station))) {
    fieldErrors.additionalStations =
      "Separa códigos de estación válidos con comas.";
  }

  if (!value.fullName) {
    fieldErrors.fullName = "Ingresa el nombre del representante.";
  } else if (value.fullName.length > 120) {
    fieldErrors.fullName = "Usa un máximo de 120 caracteres.";
  }
  if (!value.title) {
    fieldErrors.title = "Ingresa el cargo del representante.";
  } else if (value.title.length > 120) {
    fieldErrors.title = "Usa un máximo de 120 caracteres.";
  }
  if (!value.email) {
    fieldErrors.email = "Ingresa un correo corporativo.";
  } else if (value.email.length > 254 || !EMAIL_PATTERN.test(value.email)) {
    fieldErrors.email = "Ingresa un correo corporativo válido.";
  }
  if (!value.phone) {
    fieldErrors.phone = "Ingresa un teléfono de contacto.";
  } else if (!/^[+()\d\s.-]{7,30}$/.test(value.phone)) {
    fieldErrors.phone = "Ingresa un teléfono válido.";
  }
  if (!value.servicesOfInterest) {
    fieldErrors.servicesOfInterest =
      "Describe los servicios que necesita la aerolínea.";
  } else if (value.servicesOfInterest.length > 800) {
    fieldErrors.servicesOfInterest = "Usa un máximo de 800 caracteres.";
  }
  if (!value.prototypeAcknowledged) {
    fieldErrors.prototypeAcknowledged =
      "Confirma que entiendes el alcance de esta solicitud local.";
  }

  const firstInvalidField = MOCK_AFFILIATION_FIELDS.find(
    (field) => fieldErrors[field] !== undefined,
  );
  return firstInvalidField
    ? { ok: false, fieldErrors, firstInvalidField }
    : { ok: true, value };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRequest(value: unknown): value is MockAffiliationRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<MockAffiliationRequest>;
  return (
    request.schemaVersion === MOCK_AFFILIATION_SCHEMA_VERSION &&
    isString(request.id) &&
    isString(request.reference) &&
    request.status === "received" &&
    isString(request.submittedAt) &&
    Number.isFinite(Date.parse(request.submittedAt)) &&
    Boolean(
      request.airline &&
        isString(request.airline.legalName) &&
        isString(request.airline.displayName) &&
        (request.airline.iataCode === null ||
          isString(request.airline.iataCode)) &&
        (request.airline.icaoCode === null ||
          isString(request.airline.icaoCode)) &&
        isString(request.airline.country),
    ) &&
    Boolean(
      request.stations &&
        isString(request.stations.primary) &&
        Array.isArray(request.stations.requested) &&
        request.stations.requested.every(isString),
    ) &&
    Boolean(
      request.representative &&
        isString(request.representative.fullName) &&
        isString(request.representative.title) &&
        isString(request.representative.email) &&
        isString(request.representative.phone),
    ) &&
    isString(request.servicesOfInterest)
  );
}

function createId(cryptoApi: Crypto | undefined, prefix: string): string {
  if (cryptoApi?.randomUUID) return `${prefix}_${cryptoApi.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2)}`;
}

function createReference(now: number, cryptoApi: Crypto | undefined): string {
  const date = new Date(now).toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = (cryptoApi?.randomUUID?.() ?? Math.random().toString(36))
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 6)
    .toUpperCase();
  return `ELV-AFL-${date}-${suffix}`;
}

export class MockAffiliationGateway {
  readonly #options: MockAffiliationGatewayOptions;

  constructor(options: MockAffiliationGatewayOptions = {}) {
    this.#options = options;
  }

  #storage(): Storage | null {
    if ("localStorage" in this.#options) {
      return this.#options.localStorage ?? null;
    }
    try {
      return typeof window === "undefined" ? null : window.localStorage;
    } catch {
      return null;
    }
  }

  #crypto(): Crypto | undefined {
    return this.#options.crypto ?? globalThis.crypto;
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }

  getRequests(): MockAffiliationRequest[] {
    const storage = this.#storage();
    if (!storage) return [];
    try {
      const raw = storage.getItem(MOCK_AFFILIATION_REQUESTS_STORAGE_KEY);
      if (!raw) return [];
      const document = JSON.parse(raw) as Partial<StoredAffiliationDocument>;
      if (
        document.schemaVersion !== MOCK_AFFILIATION_SCHEMA_VERSION ||
        !Array.isArray(document.requests) ||
        !document.requests.every(isRequest)
      ) {
        throw new Error("Invalid affiliation document");
      }
      return document.requests;
    } catch {
      try {
        storage.removeItem(MOCK_AFFILIATION_REQUESTS_STORAGE_KEY);
      } catch {
        // A restricted store remains unavailable; expose an empty local queue.
      }
      return [];
    }
  }

  submit(input: MockAffiliationInput): MockAffiliationResult {
    const validation = validateAffiliation(input);
    if (!validation.ok) {
      return {
        ok: false,
        message: "Revisa los campos indicados.",
        fieldErrors: validation.fieldErrors,
        firstInvalidField: validation.firstInvalidField,
      };
    }

    const storage = this.#storage();
    if (!storage) {
      return {
        ok: false,
        message:
          "Este navegador no permitió guardar la solicitud. Habilita el almacenamiento local e inténtalo de nuevo.",
      };
    }

    const value = validation.value;
    const now = this.#now();
    const requestedStations = [
      value.primaryStation,
      ...splitStations(value.additionalStations),
    ];
    const request: MockAffiliationRequest = {
      schemaVersion: MOCK_AFFILIATION_SCHEMA_VERSION,
      id: createId(this.#crypto(), "aff"),
      reference: createReference(now, this.#crypto()),
      status: "received",
      submittedAt: new Date(now).toISOString(),
      airline: {
        legalName: value.legalName,
        displayName: value.displayName || value.legalName,
        iataCode: value.iataCode || null,
        icaoCode: value.icaoCode || null,
        country: value.country,
      },
      stations: {
        primary: value.primaryStation,
        requested: requestedStations,
      },
      representative: {
        fullName: value.fullName,
        title: value.title,
        email: value.email,
        phone: value.phone,
      },
      servicesOfInterest: value.servicesOfInterest,
    };

    try {
      const document: StoredAffiliationDocument = {
        schemaVersion: MOCK_AFFILIATION_SCHEMA_VERSION,
        requests: [...this.getRequests(), request],
      };
      storage.setItem(
        MOCK_AFFILIATION_REQUESTS_STORAGE_KEY,
        JSON.stringify(document),
      );
      return { ok: true, request };
    } catch {
      return {
        ok: false,
        message:
          "No pudimos conservar la solicitud en este navegador. Libera espacio e inténtalo de nuevo.",
      };
    }
  }
}
