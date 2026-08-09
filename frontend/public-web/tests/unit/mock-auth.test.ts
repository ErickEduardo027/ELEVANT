import { webcrypto } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  DEMO_CREDENTIALS,
  MOCK_ACCOUNTS_STORAGE_KEY,
  MOCK_PERSISTENT_SESSION_KEY,
  MOCK_TRANSIENT_SESSION_KEY,
  MockAuthGateway,
  validateRegistration,
  validateSignIn,
  type MockRegistrationInput,
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

const VALID_REGISTRATION: MockRegistrationInput = {
  legalName: "  Aerolínea Prueba, S.A.  ",
  displayName: "  Aerolínea Prueba  ",
  iataCode: " ap ",
  icaoCode: " apt ",
  country: "  República Dominicana ",
  primaryStation: " puj ",
  additionalStations: "sdq, STI; puj\nsdq",
  fullName: "  Ana   Pérez  ",
  title: "  Gerente de Operaciones  ",
  email: "  ANA@AIRLINE.EXAMPLE ",
  phone: "+1 809 555 0199",
  password: "ElevantLocal2026!",
  passwordConfirmation: "ElevantLocal2026!",
  prototypeAcknowledged: true,
};

function createGateway(now = Date.parse("2026-08-09T12:00:00.000Z")) {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  let currentTime = now;
  const gateway = new MockAuthGateway({
    localStorage,
    sessionStorage,
    crypto: webcrypto as unknown as Crypto,
    now: () => currentTime,
  });

  return {
    gateway,
    localStorage,
    sessionStorage,
    advanceBy(milliseconds: number) {
      currentTime += milliseconds;
    },
  };
}

describe("mock auth validation", () => {
  it("normalizes sign-in data without changing the password", () => {
    expect(
      validateSignIn({
        email: "  ADMIN@AIRLINE.EXAMPLE ",
        password: " Keep Spaces ",
        remember: true,
      }),
    ).toEqual({
      ok: true,
      value: {
        email: "admin@airline.example",
        password: " Keep Spaces ",
        remember: true,
      },
    });
  });

  it("returns stable field errors for an empty sign-in", () => {
    expect(
      validateSignIn({ email: "", password: "", remember: false }),
    ).toEqual({
      ok: false,
      fieldErrors: {
        email: "Ingresa tu correo corporativo.",
        password: "Ingresa tu contraseña.",
      },
      firstInvalidField: "email",
    });
  });

  it("normalizes airline codes, stations, names and email", () => {
    const result = validateRegistration(VALID_REGISTRATION);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected a valid registration");

    expect(result.value).toMatchObject({
      legalName: "Aerolínea Prueba, S.A.",
      displayName: "Aerolínea Prueba",
      iataCode: "AP",
      icaoCode: "APT",
      primaryStation: "PUJ",
      additionalStations: "SDQ, STI",
      fullName: "Ana Pérez",
      email: "ana@airline.example",
    });
    expect(VALID_REGISTRATION.iataCode).toBe(" ap ");
  });

  it("requires one airline code and enforces password confirmation", () => {
    const result = validateRegistration({
      ...VALID_REGISTRATION,
      iataCode: "",
      icaoCode: "",
      password: "weak",
      passwordConfirmation: "different",
      prototypeAcknowledged: false,
    });

    expect(result).toMatchObject({
      ok: false,
      firstInvalidField: "iataCode",
      fieldErrors: {
        iataCode: "Ingresa al menos un código IATA o ICAO.",
        password:
          "Usa 10 caracteres con mayúscula, minúscula, número y símbolo.",
        passwordConfirmation: "Las contraseñas no coinciden.",
        prototypeAcknowledged:
          "Confirma que entiendes que este acceso es un prototipo local.",
      },
    });
  });
});

describe("MockAuthGateway", () => {
  it("authenticates the demo account for 12 hours in sessionStorage", async () => {
    const { gateway, localStorage, sessionStorage } = createGateway();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await gateway.signIn({
      ...DEMO_CREDENTIALS,
      remember: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected demo authentication");
    expect(result.session).toMatchObject({
      role: "AIRLINE_ADMIN",
      source: "demo",
      stations: { primary: "PUJ", authorized: ["PUJ", "SDQ", "STI"] },
      permissions: [
        "rotations:read",
        "evidence:read",
        "documents:read",
        "reports:read",
      ],
    });
    expect(
      Date.parse(result.session.expiresAt) - Date.parse(result.session.issuedAt),
    ).toBe(12 * 60 * 60 * 1_000);
    expect(sessionStorage.getItem(MOCK_TRANSIENT_SESSION_KEY)).not.toBeNull();
    expect(localStorage.getItem(MOCK_PERSISTENT_SESSION_KEY)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("persists a remembered demo session for seven days", async () => {
    const { gateway, localStorage, sessionStorage } = createGateway();
    const result = await gateway.signIn({
      ...DEMO_CREDENTIALS,
      remember: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected demo authentication");
    expect(
      Date.parse(result.session.expiresAt) - Date.parse(result.session.issuedAt),
    ).toBe(7 * 24 * 60 * 60 * 1_000);
    expect(localStorage.getItem(MOCK_PERSISTENT_SESSION_KEY)).not.toBeNull();
    expect(sessionStorage.getItem(MOCK_TRANSIENT_SESSION_KEY)).toBeNull();
  });

  it("registers locally, stores only a salted digest and signs in immediately", async () => {
    const { gateway, localStorage, sessionStorage } = createGateway();
    const result = await gateway.register(VALID_REGISTRATION);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected local registration");
    expect(result.session).toMatchObject({
      source: "registration",
      role: "AIRLINE_ADMIN",
      user: { email: "ana@airline.example", fullName: "Ana Pérez" },
      airline: { iataCode: "AP", icaoCode: "APT" },
      stations: { primary: "PUJ", authorized: ["PUJ", "SDQ", "STI"] },
    });

    const stored = localStorage.getItem(MOCK_ACCOUNTS_STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(stored).not.toContain(VALID_REGISTRATION.password);
    expect(stored).not.toContain("passwordConfirmation");
    expect(stored).toContain("passwordSalt");
    expect(stored).toContain("passwordDigest");
    expect(sessionStorage.getItem(MOCK_TRANSIENT_SESSION_KEY)).not.toBeNull();
    expect(gateway.getSession()?.sessionId).toBe(result.session.sessionId);
  });

  it("authenticates a registered account and rejects duplicate email", async () => {
    const { gateway } = createGateway();
    expect((await gateway.register(VALID_REGISTRATION)).ok).toBe(true);
    gateway.signOut();

    const duplicate = await gateway.register({
      ...VALID_REGISTRATION,
      email: "ANA@AIRLINE.EXAMPLE",
    });
    expect(duplicate).toMatchObject({
      ok: false,
      firstInvalidField: "email",
      fieldErrors: { email: "Este correo ya está registrado." },
    });

    const signIn = await gateway.signIn({
      email: "ANA@AIRLINE.EXAMPLE",
      password: VALID_REGISTRATION.password,
      remember: true,
    });
    expect(signIn).toMatchObject({
      ok: true,
      session: { source: "registration" },
    });
  });

  it("cleans corrupt account and session documents", async () => {
    const { gateway, localStorage, sessionStorage } = createGateway();
    localStorage.setItem(MOCK_ACCOUNTS_STORAGE_KEY, "not-json");
    localStorage.setItem(MOCK_PERSISTENT_SESSION_KEY, "{broken");
    sessionStorage.setItem(
      MOCK_TRANSIENT_SESSION_KEY,
      JSON.stringify({ schemaVersion: 99 }),
    );

    expect(gateway.getSession()).toBeNull();
    await gateway.signIn({
      email: "unknown@airline.example",
      password: "UnknownPassword2026!",
      remember: false,
    });

    expect(localStorage.getItem(MOCK_ACCOUNTS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(MOCK_PERSISTENT_SESSION_KEY)).toBeNull();
    expect(sessionStorage.getItem(MOCK_TRANSIENT_SESSION_KEY)).toBeNull();
  });

  it("removes expired sessions and clears both stores on sign out", async () => {
    const context = createGateway();
    const transient = await context.gateway.signIn({
      ...DEMO_CREDENTIALS,
      remember: false,
    });
    expect(transient.ok).toBe(true);

    context.advanceBy(12 * 60 * 60 * 1_000 + 1);
    expect(context.gateway.getSession()).toBeNull();
    expect(
      context.sessionStorage.getItem(MOCK_TRANSIENT_SESSION_KEY),
    ).toBeNull();

    await context.gateway.signIn({ ...DEMO_CREDENTIALS, remember: true });
    context.gateway.signOut();
    expect(context.localStorage.getItem(MOCK_PERSISTENT_SESSION_KEY)).toBeNull();
    expect(context.sessionStorage.getItem(MOCK_TRANSIENT_SESSION_KEY)).toBeNull();
  });
});
