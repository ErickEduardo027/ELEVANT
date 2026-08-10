import { webcrypto } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  MOCK_AFFILIATION_REQUESTS_STORAGE_KEY,
  MockAffiliationGateway,
  validateAffiliation,
  type MockAffiliationInput,
} from "@/lib/mock-affiliation";
import {
  MOCK_PERSISTENT_SESSION_KEY,
  MOCK_TRANSIENT_SESSION_KEY,
} from "@/lib/mock-auth";

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();
  get length() {
    return this.#values.size;
  }
  clear() {
    this.#values.clear();
  }
  getItem(key: string) {
    return this.#values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.#values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.#values.delete(key);
  }
  setItem(key: string, value: string) {
    this.#values.set(key, String(value));
  }
}

const VALID_REQUEST: MockAffiliationInput = {
  legalName: "  Aerolínea Horizonte, S.A.  ",
  displayName: " Horizonte ",
  iataCode: " zz ",
  icaoCode: " hzt ",
  country: " República Dominicana ",
  primaryStation: " puj ",
  additionalStations: "sdq, STI; puj\nsdq",
  fullName: " Ana   Pérez ",
  title: " Gerente de Operaciones ",
  email: " ANA@HORIZONTE.TEST ",
  phone: "+1 809 555 0199",
  servicesOfInterest: "  Asistencia en rampa y conciliación documental.  ",
  prototypeAcknowledged: true,
};

describe("solicitud mock de afiliación", () => {
  it("normaliza identidad, estaciones y contacto sin pedir contraseña", () => {
    const result = validateAffiliation(VALID_REQUEST);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid affiliation");
    expect(result.value).toMatchObject({
      legalName: "Aerolínea Horizonte, S.A.",
      displayName: "Horizonte",
      iataCode: "ZZ",
      icaoCode: "HZT",
      primaryStation: "PUJ",
      additionalStations: "SDQ, STI",
      fullName: "Ana Pérez",
      email: "ana@horizonte.test",
    });
    expect(Object.keys(result.value)).not.toContain("password");
  });

  it("exige los datos operativos y la confirmación del alcance local", () => {
    const result = validateAffiliation({
      ...VALID_REQUEST,
      iataCode: "",
      icaoCode: "",
      phone: "",
      servicesOfInterest: "",
      prototypeAcknowledged: false,
    });
    expect(result).toMatchObject({
      ok: false,
      firstInvalidField: "iataCode",
      fieldErrors: {
        iataCode: "Ingresa al menos un código IATA o ICAO.",
        phone: "Ingresa un teléfono de contacto.",
        servicesOfInterest: "Describe los servicios que necesita la aerolínea.",
        prototypeAcknowledged:
          "Confirma que entiendes el alcance de esta solicitud local.",
      },
    });
  });

  it("genera referencia, persiste la solicitud y no inicia sesión", () => {
    const localStorage = new MemoryStorage();
    const gateway = new MockAffiliationGateway({
      localStorage,
      crypto: webcrypto as unknown as Crypto,
      now: () => Date.parse("2026-08-09T12:00:00.000Z"),
    });
    const result = gateway.submit(VALID_REQUEST);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected persisted affiliation");
    expect(result.request).toMatchObject({
      status: "received",
      submittedAt: "2026-08-09T12:00:00.000Z",
      airline: { displayName: "Horizonte", iataCode: "ZZ" },
      stations: { primary: "PUJ", requested: ["PUJ", "SDQ", "STI"] },
      representative: { email: "ana@horizonte.test" },
    });
    expect(result.request.reference).toMatch(/^ELV-AFL-20260809-[A-Z0-9]{6}$/);
    const document = localStorage.getItem(
      MOCK_AFFILIATION_REQUESTS_STORAGE_KEY,
    );
    expect(document).toContain(result.request.reference);
    expect(document).not.toContain("password");
    expect(localStorage.getItem(MOCK_PERSISTENT_SESSION_KEY)).toBeNull();
    expect(localStorage.getItem(MOCK_TRANSIENT_SESSION_KEY)).toBeNull();
    expect(gateway.getRequests()).toHaveLength(1);
  });

  it("limpia documentos corruptos y falla de forma dirigida sin storage", () => {
    const localStorage = new MemoryStorage();
    const gateway = new MockAffiliationGateway({ localStorage });
    localStorage.setItem(MOCK_AFFILIATION_REQUESTS_STORAGE_KEY, "{broken");
    expect(gateway.getRequests()).toEqual([]);
    expect(
      localStorage.getItem(MOCK_AFFILIATION_REQUESTS_STORAGE_KEY),
    ).toBeNull();

    const unavailable = new MockAffiliationGateway({ localStorage: null });
    expect(unavailable.submit(VALID_REQUEST)).toMatchObject({ ok: false });
  });
});
