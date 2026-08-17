import { webcrypto } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  DEMO_CREDENTIALS,
  MOCK_AIRLINE_PERMISSIONS,
  MOCK_PERSISTENT_SESSION_KEY,
  MOCK_SESSION_SCHEMA_VERSION,
  MOCK_TRANSIENT_SESSION_KEY,
  MockAuthGateway,
  resolveSafeReturnTo,
  validateSignIn,
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

describe("validación y retorno del acceso", () => {
  it("normaliza el correo sin modificar la contraseña", () => {
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

  it("devuelve errores estables para un formulario vacío", () => {
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

  it("acepta únicamente destinos internos del portal", () => {
    expect(resolveSafeReturnTo("/portal/vuelos?estado=activo#hoy")).toBe(
      "/portal/vuelos?estado=activo#hoy",
    );
    expect(resolveSafeReturnTo("https://example.com/portal")).toBe("/portal");
    expect(resolveSafeReturnTo("//example.com/portal")).toBe("/portal");
    expect(resolveSafeReturnTo("/login")).toBe("/portal");
    expect(resolveSafeReturnTo("/portal\\@example.com")).toBe("/portal");
    expect(resolveSafeReturnTo(["/portal/documentos", "/portal"])).toBe(
      "/portal/documentos",
    );
  });
});

describe("MockAuthGateway v2", () => {
  it("autentica la demo con contrato v2 y todos los permisos del portal", async () => {
    const { gateway, localStorage, sessionStorage } = createGateway();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await gateway.signIn({
      ...DEMO_CREDENTIALS,
      remember: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected demo authentication");
    expect(result.session).toMatchObject({
      schemaVersion: MOCK_SESSION_SCHEMA_VERSION,
      role: "AIRLINE_ADMIN",
      source: "demo",
      airlineId: "airline_demo",
      stations: { primary: "PUJ", authorized: ["PUJ", "SDQ", "STI"] },
      permissions: [...MOCK_AIRLINE_PERMISSIONS],
    });
    expect(
      Date.parse(result.session.expiresAt) - Date.parse(result.session.issuedAt),
    ).toBe(12 * 60 * 60 * 1_000);
    expect(sessionStorage.getItem(MOCK_TRANSIENT_SESSION_KEY)).not.toBeNull();
    expect(localStorage.getItem(MOCK_PERSISTENT_SESSION_KEY)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("persiste una sesión recordada durante siete días", async () => {
    const { gateway, localStorage, sessionStorage } = createGateway();
    const result = await gateway.signIn({ ...DEMO_CREDENTIALS, remember: true });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected demo authentication");
    expect(
      Date.parse(result.session.expiresAt) - Date.parse(result.session.issuedAt),
    ).toBe(7 * 24 * 60 * 60 * 1_000);
    expect(localStorage.getItem(MOCK_PERSISTENT_SESSION_KEY)).not.toBeNull();
    expect(sessionStorage.getItem(MOCK_TRANSIENT_SESSION_KEY)).toBeNull();
  });

  it("rechaza cuentas locales antiguas y elimina documentos v1", async () => {
    const context = createGateway();
    context.localStorage.setItem(
      "elevant.mock-auth.accounts.v1",
      JSON.stringify({ schemaVersion: 1, accounts: [{ email: "old@test" }] }),
    );
    context.localStorage.setItem(
      "elevant.mock-auth.session.v1",
      JSON.stringify({ schemaVersion: 1 }),
    );
    context.sessionStorage.setItem(
      "elevant.mock-auth.session-tab.v1",
      JSON.stringify({ schemaVersion: 1 }),
    );

    expect(context.gateway.getSession()).toBeNull();
    expect(context.localStorage.getItem("elevant.mock-auth.accounts.v1")).toBeNull();
    expect(context.localStorage.getItem("elevant.mock-auth.session.v1")).toBeNull();
    expect(
      context.sessionStorage.getItem("elevant.mock-auth.session-tab.v1"),
    ).toBeNull();

    const result = await context.gateway.signIn({
      email: "old@test.example",
      password: "OldPassword2026!",
      remember: false,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it("limpia sesiones corruptas o expiradas y ambos stores al cerrar", async () => {
    const context = createGateway();
    context.localStorage.setItem(MOCK_PERSISTENT_SESSION_KEY, "{broken");
    context.sessionStorage.setItem(
      MOCK_TRANSIENT_SESSION_KEY,
      JSON.stringify({ schemaVersion: 1 }),
    );
    expect(context.gateway.getSession()).toBeNull();
    expect(context.localStorage.getItem(MOCK_PERSISTENT_SESSION_KEY)).toBeNull();
    expect(context.sessionStorage.getItem(MOCK_TRANSIENT_SESSION_KEY)).toBeNull();

    await context.gateway.signIn({ ...DEMO_CREDENTIALS, remember: false });
    context.advanceBy(12 * 60 * 60 * 1_000 + 1);
    expect(context.gateway.getSession()).toBeNull();

    await context.gateway.signIn({ ...DEMO_CREDENTIALS, remember: true });
    context.gateway.signOut();
    expect(context.localStorage.getItem(MOCK_PERSISTENT_SESSION_KEY)).toBeNull();
    expect(context.sessionStorage.getItem(MOCK_TRANSIENT_SESSION_KEY)).toBeNull();
  });
});
