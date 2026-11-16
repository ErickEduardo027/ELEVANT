export const DEMO_CREDENTIALS = Object.freeze({
  email: "operaciones@demo.elevant.test",
  password: "ElevantDemo2026!",
});

export const MOCK_SESSION_SCHEMA_VERSION = 2 as const;
export const MOCK_PERSISTENT_SESSION_KEY = "elevant.mock-auth.session.v2";
export const MOCK_TRANSIENT_SESSION_KEY = "elevant.mock-auth.session-tab.v2";

const LEGACY_STORAGE_KEYS = [
  "elevant.mock-auth.accounts.v1",
  "elevant.mock-auth.session.v1",
  "elevant.mock-auth.session-tab.v1",
] as const;
const SESSION_DURATION_MS = 12 * 60 * 60 * 1_000;
const REMEMBERED_SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface MockSignInInput {
  email: string;
  password: string;
  remember: boolean;
}

export const MOCK_SIGN_IN_FIELDS = ["email", "password"] as const;
export type MockSignInField = (typeof MOCK_SIGN_IN_FIELDS)[number];
export type MockSignInFieldErrors = Partial<Record<MockSignInField, string>>;

export type MockValidationResult<TValue, TField extends string> =
  | { ok: true; value: TValue }
  | {
      ok: false;
      fieldErrors: Partial<Record<TField, string>>;
      firstInvalidField: TField;
    };

export const MOCK_AIRLINE_PERMISSIONS = [
  "portal:access",
  "flights:read",
  "operations:read",
  "contracts:read",
  "evidence:read",
  "documents:read",
  "billing:read",
  "billing:respond",
  "reports:read",
  "reports:export",
  "service-requests:read",
  "service-requests:create",
  "service-requests:cancel",
  "notifications:read",
] as const;

export type MockPermission = (typeof MOCK_AIRLINE_PERMISSIONS)[number];

export interface MockAirlineSession {
  schemaVersion: typeof MOCK_SESSION_SCHEMA_VERSION;
  sessionId: string;
  userId: string;
  airlineId: string;
  role: "AIRLINE_ADMIN";
  user: {
    fullName: string;
    email: string;
    title: string;
  };
  airline: {
    legalName: string;
    displayName: string;
    iataCode: string | null;
    icaoCode: string | null;
    country: string;
  };
  stations: {
    primary: string;
    authorized: string[];
  };
  permissions: MockPermission[];
  source: "demo";
  issuedAt: string;
  expiresAt: string;
}

export type MockSignInResult =
  | { ok: true; session: MockAirlineSession }
  | {
      ok: false;
      message: string;
      fieldErrors?: MockSignInFieldErrors;
      firstInvalidField?: MockSignInField;
    };

export interface MockAuthGatewayOptions {
  localStorage?: Storage | null;
  sessionStorage?: Storage | null;
  crypto?: Crypto;
  now?: () => number;
}

function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase("es");
}

export function validateSignIn(
  input: MockSignInInput,
): MockValidationResult<MockSignInInput, MockSignInField> {
  const value: MockSignInInput = {
    email: normalizeEmail(input.email),
    password: input.password,
    remember: Boolean(input.remember),
  };
  const fieldErrors: MockSignInFieldErrors = {};

  if (!value.email) {
    fieldErrors.email = "Ingresa tu correo corporativo.";
  } else if (value.email.length > 254 || !EMAIL_PATTERN.test(value.email)) {
    fieldErrors.email = "Ingresa un correo corporativo válido.";
  }
  if (!value.password) fieldErrors.password = "Ingresa tu contraseña.";

  const firstInvalidField = MOCK_SIGN_IN_FIELDS.find(
    (field) => fieldErrors[field] !== undefined,
  );
  return firstInvalidField
    ? { ok: false, fieldErrors, firstInvalidField }
    : { ok: true, value };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isPermission(value: unknown): value is MockPermission {
  return (
    isString(value) &&
    (MOCK_AIRLINE_PERMISSIONS as readonly string[]).includes(value)
  );
}

function isMockSession(value: unknown): value is MockAirlineSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<MockAirlineSession>;
  return (
    session.schemaVersion === MOCK_SESSION_SCHEMA_VERSION &&
    isString(session.sessionId) &&
    isString(session.userId) &&
    isString(session.airlineId) &&
    session.role === "AIRLINE_ADMIN" &&
    session.source === "demo" &&
    isString(session.issuedAt) &&
    isString(session.expiresAt) &&
    Boolean(
      session.user &&
        isString(session.user.fullName) &&
        isString(session.user.email) &&
        isString(session.user.title),
    ) &&
    Boolean(
      session.airline &&
        isString(session.airline.legalName) &&
        isString(session.airline.displayName) &&
        (session.airline.iataCode === null ||
          isString(session.airline.iataCode)) &&
        (session.airline.icaoCode === null ||
          isString(session.airline.icaoCode)) &&
        isString(session.airline.country),
    ) &&
    Boolean(
      session.stations &&
        isString(session.stations.primary) &&
        isStringArray(session.stations.authorized) &&
        session.stations.authorized.includes(session.stations.primary),
    ) &&
    Array.isArray(session.permissions) &&
    session.permissions.every(isPermission) &&
    session.permissions.includes("portal:access")
  );
}

function createId(cryptoApi: Crypto | undefined, prefix: string): string {
  if (cryptoApi?.randomUUID) return `${prefix}_${cryptoApi.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2)}`;
}

/**
 * Accepts only local portal destinations. This prevents protocol-relative,
 * absolute and login-loop redirects from being supplied through `returnTo`.
 */
export function resolveSafeReturnTo(
  candidate: string | string[] | undefined,
  fallback = "/portal",
): string {
  const value = Array.isArray(candidate) ? candidate[0] : candidate;
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001F\u007F]/.test(value)
  ) {
    return fallback;
  }

  try {
    const url = new URL(value, "https://portal.elevant.local");
    const destination = `${url.pathname}${url.search}${url.hash}`;
    if (
      url.origin !== "https://portal.elevant.local" ||
      !(url.pathname === "/portal" || url.pathname.startsWith("/portal/"))
    ) {
      return fallback;
    }
    return destination;
  } catch {
    return fallback;
  }
}

export class MockAuthGateway {
  readonly #options: MockAuthGatewayOptions;

  constructor(options: MockAuthGatewayOptions = {}) {
    this.#options = options;
  }

  #localStorage(): Storage | null {
    if ("localStorage" in this.#options) {
      return this.#options.localStorage ?? null;
    }
    try {
      return typeof window === "undefined" ? null : window.localStorage;
    } catch {
      return null;
    }
  }

  #sessionStorage(): Storage | null {
    if ("sessionStorage" in this.#options) {
      return this.#options.sessionStorage ?? null;
    }
    try {
      return typeof window === "undefined" ? null : window.sessionStorage;
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

  #clearLegacyDocuments(): void {
    const local = this.#localStorage();
    const transient = this.#sessionStorage();
    for (const key of LEGACY_STORAGE_KEYS) {
      try {
        local?.removeItem(key);
        transient?.removeItem(key);
      } catch {
        // Storage can be unavailable in private or restricted browser modes.
      }
    }
  }

  #buildDemoSession(remember: boolean): MockAirlineSession {
    const now = this.#now();
    return {
      schemaVersion: MOCK_SESSION_SCHEMA_VERSION,
      sessionId: createId(this.#crypto(), "ses"),
      userId: "user_demo_operations",
      airlineId: "airline_demo",
      role: "AIRLINE_ADMIN",
      user: {
        fullName: "María Rodríguez",
        email: DEMO_CREDENTIALS.email,
        title: "Gerente de Operaciones",
      },
      airline: {
        legalName: "ELEVANT Demo Airlines, S.A.",
        displayName: "ELEVANT Demo Airlines",
        iataCode: "EV",
        icaoCode: "ELV",
        country: "República Dominicana",
      },
      stations: {
        primary: "PUJ",
        authorized: ["PUJ", "SDQ", "STI"],
      },
      permissions: [...MOCK_AIRLINE_PERMISSIONS],
      source: "demo",
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(
        now +
          (remember ? REMEMBERED_SESSION_DURATION_MS : SESSION_DURATION_MS),
      ).toISOString(),
    };
  }

  #persistSession(session: MockAirlineSession, remember: boolean): boolean {
    const local = this.#localStorage();
    const transient = this.#sessionStorage();
    try {
      local?.removeItem(MOCK_PERSISTENT_SESSION_KEY);
      transient?.removeItem(MOCK_TRANSIENT_SESSION_KEY);
      const target = remember ? local : transient;
      if (!target) return false;
      target.setItem(
        remember ? MOCK_PERSISTENT_SESSION_KEY : MOCK_TRANSIENT_SESSION_KEY,
        JSON.stringify(session),
      );
      return true;
    } catch {
      return false;
    }
  }

  #readSession(storage: Storage | null, key: string): MockAirlineSession | null {
    if (!storage) return null;
    try {
      const raw = storage.getItem(key);
      if (!raw) return null;
      const session = JSON.parse(raw) as unknown;
      if (
        !isMockSession(session) ||
        !Number.isFinite(Date.parse(session.issuedAt)) ||
        !Number.isFinite(Date.parse(session.expiresAt)) ||
        Date.parse(session.expiresAt) <= this.#now()
      ) {
        throw new Error("Invalid or expired session");
      }
      return session;
    } catch {
      try {
        storage.removeItem(key);
      } catch {
        // A restricted store remains unusable; treat it as anonymous.
      }
      return null;
    }
  }

  getSession(): MockAirlineSession | null {
    this.#clearLegacyDocuments();
    return (
      this.#readSession(this.#localStorage(), MOCK_PERSISTENT_SESSION_KEY) ??
      this.#readSession(this.#sessionStorage(), MOCK_TRANSIENT_SESSION_KEY)
    );
  }

  async signIn(input: MockSignInInput): Promise<MockSignInResult> {
    this.#clearLegacyDocuments();
    const validation = validateSignIn(input);
    if (!validation.ok) {
      return {
        ok: false,
        message: "Revisa los campos indicados.",
        fieldErrors: validation.fieldErrors,
        firstInvalidField: validation.firstInvalidField,
      };
    }

    const { email, password, remember } = validation.value;
    if (
      email !== DEMO_CREDENTIALS.email ||
      password !== DEMO_CREDENTIALS.password
    ) {
      return {
        ok: false,
        message:
          "Las credenciales no coinciden con el acceso de demostración.",
      };
    }

    const session = this.#buildDemoSession(remember);
    if (!this.#persistSession(session, remember)) {
      return {
        ok: false,
        message:
          "Este navegador no permitió guardar la sesión. Habilita el almacenamiento local e inténtalo de nuevo.",
      };
    }
    return { ok: true, session };
  }

  signOut(): void {
    const targets: Array<[Storage | null, string]> = [
      [this.#localStorage(), MOCK_PERSISTENT_SESSION_KEY],
      [this.#sessionStorage(), MOCK_TRANSIENT_SESSION_KEY],
    ];
    for (const [storage, key] of targets) {
      try {
        storage?.removeItem(key);
      } catch {
        // Continue clearing the other storage when one store is restricted.
      }
    }
    this.#clearLegacyDocuments();
  }
}
