export const DEMO_CREDENTIALS = Object.freeze({
  email: "operaciones@demo.elevant.test",
  password: "ElevantDemo2026!",
});

export const MOCK_ACCOUNTS_STORAGE_KEY = "elevant.mock-auth.accounts.v1";
export const MOCK_PERSISTENT_SESSION_KEY = "elevant.mock-auth.session.v1";
export const MOCK_TRANSIENT_SESSION_KEY = "elevant.mock-auth.session-tab.v1";

const SESSION_SCHEMA_VERSION = 1 as const;
const ACCOUNT_SCHEMA_VERSION = 1 as const;
const SESSION_DURATION_MS = 12 * 60 * 60 * 1_000;
const REMEMBERED_SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;
const PASSWORD_HASH_ITERATIONS = 120_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IATA_PATTERN = /^[A-Z0-9]{2}$/;
const ICAO_PATTERN = /^[A-Z0-9]{3}$/;
const STATION_PATTERN = /^[A-Z0-9]{3,4}$/;

export interface MockSignInInput {
  email: string;
  password: string;
  remember: boolean;
}

export interface MockRegistrationInput {
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
  password: string;
  passwordConfirmation: string;
  prototypeAcknowledged: boolean;
}

export const MOCK_SIGN_IN_FIELDS = ["email", "password"] as const;
export type MockSignInField = keyof MockSignInInput;

export const MOCK_REGISTRATION_FIELDS = [
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
  "password",
  "passwordConfirmation",
  "prototypeAcknowledged",
] as const;
export type MockRegistrationField =
  (typeof MOCK_REGISTRATION_FIELDS)[number];

export type MockSignInFieldErrors = Partial<
  Record<MockSignInField, string>
>;
export type MockRegistrationFieldErrors = Partial<
  Record<MockRegistrationField, string>
>;

export type MockValidationResult<TValue, TField extends string> =
  | { ok: true; value: TValue }
  | {
      ok: false;
      fieldErrors: Partial<Record<TField, string>>;
      firstInvalidField: TField;
    };

export type MockPermission =
  | "rotations:read"
  | "evidence:read"
  | "documents:read"
  | "reports:read";

export interface MockAirlineSession {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
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
  source: "demo" | "registration";
  issuedAt: string;
  expiresAt: string;
}

export type MockAuthActionResult<
  TField extends MockSignInField | MockRegistrationField =
    | MockSignInField
    | MockRegistrationField,
> =
  | { ok: true; session: MockAirlineSession }
  | {
      ok: false;
      message: string;
      fieldErrors?: Partial<Record<TField, string>>;
      firstInvalidField?: TField;
    };

export type MockSignInResult = MockAuthActionResult<MockSignInField>;
export type MockRegistrationResult =
  MockAuthActionResult<MockRegistrationField>;

interface StoredAirlineAccount {
  id: string;
  userId: string;
  email: string;
  passwordSalt: string;
  passwordDigest: string;
  legalName: string;
  displayName: string;
  iataCode: string | null;
  icaoCode: string | null;
  country: string;
  primaryStation: string;
  additionalStations: string[];
  fullName: string;
  title: string;
  phone: string;
  createdAt: string;
}

interface StoredAccountsDocument {
  schemaVersion: typeof ACCOUNT_SCHEMA_VERSION;
  accounts: StoredAirlineAccount[];
}

export interface MockAuthGatewayOptions {
  localStorage?: Storage | null;
  sessionStorage?: Storage | null;
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

function normalizeRegistration(
  input: MockRegistrationInput,
): MockRegistrationInput {
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
    password: input.password,
    passwordConfirmation: input.passwordConfirmation,
    prototypeAcknowledged: input.prototypeAcknowledged,
  };
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

  if (!value.password) {
    fieldErrors.password = "Ingresa tu contraseña.";
  }

  const firstInvalidField = MOCK_SIGN_IN_FIELDS.find(
    (field) => fieldErrors[field] !== undefined,
  );

  return firstInvalidField
    ? { ok: false, fieldErrors, firstInvalidField }
    : { ok: true, value };
}

export function validateRegistration(
  input: MockRegistrationInput,
): MockValidationResult<MockRegistrationInput, MockRegistrationField> {
  const value = normalizeRegistration(input);
  const fieldErrors: MockRegistrationFieldErrors = {};

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
    fieldErrors.country = "Selecciona o ingresa el país.";
  } else if (value.country.length > 80) {
    fieldErrors.country = "Usa un máximo de 80 caracteres.";
  }

  if (!value.primaryStation) {
    fieldErrors.primaryStation = "Ingresa la estación principal.";
  } else if (!STATION_PATTERN.test(value.primaryStation)) {
    fieldErrors.primaryStation = "Usa un código de estación de 3 o 4 caracteres.";
  }

  const additionalStations = splitStations(value.additionalStations);
  if (additionalStations.some((station) => !STATION_PATTERN.test(station))) {
    fieldErrors.additionalStations =
      "Separa códigos de estación válidos con comas.";
  }

  if (!value.fullName) {
    fieldErrors.fullName = "Ingresa el nombre del administrador.";
  } else if (value.fullName.length > 120) {
    fieldErrors.fullName = "Usa un máximo de 120 caracteres.";
  }

  if (!value.title) {
    fieldErrors.title = "Ingresa el cargo del administrador.";
  } else if (value.title.length > 120) {
    fieldErrors.title = "Usa un máximo de 120 caracteres.";
  }

  if (!value.email) {
    fieldErrors.email = "Ingresa un correo corporativo.";
  } else if (value.email.length > 254 || !EMAIL_PATTERN.test(value.email)) {
    fieldErrors.email = "Ingresa un correo corporativo válido.";
  }

  if (value.phone && !/^[+()\d\s.-]{7,30}$/.test(value.phone)) {
    fieldErrors.phone = "Ingresa un teléfono válido.";
  }

  if (!value.password) {
    fieldErrors.password = "Crea una contraseña.";
  } else if (
    value.password.length < 10 ||
    !/[a-z]/.test(value.password) ||
    !/[A-Z]/.test(value.password) ||
    !/\d/.test(value.password) ||
    !/[^\w\s]/.test(value.password)
  ) {
    fieldErrors.password =
      "Usa 10 caracteres con mayúscula, minúscula, número y símbolo.";
  }

  if (!value.passwordConfirmation) {
    fieldErrors.passwordConfirmation = "Confirma tu contraseña.";
  } else if (value.passwordConfirmation !== value.password) {
    fieldErrors.passwordConfirmation = "Las contraseñas no coinciden.";
  }

  if (!value.prototypeAcknowledged) {
    fieldErrors.prototypeAcknowledged =
      "Confirma que entiendes que este acceso es un prototipo local.";
  }

  const firstInvalidField = MOCK_REGISTRATION_FIELDS.find(
    (field) => fieldErrors[field] !== undefined,
  );

  return firstInvalidField
    ? { ok: false, fieldErrors, firstInvalidField }
    : { ok: true, value };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function derivePasswordDigest(
  cryptoApi: Crypto,
  password: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await cryptoApi.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await cryptoApi.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: PASSWORD_HASH_ITERATIONS,
      salt,
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function createPasswordRecord(
  cryptoApi: Crypto,
  password: string,
): Promise<{ passwordSalt: string; passwordDigest: string }> {
  const salt = new Uint8Array(new ArrayBuffer(16));
  cryptoApi.getRandomValues(salt);
  const digest = await derivePasswordDigest(cryptoApi, password, salt);
  return {
    passwordSalt: bytesToBase64(salt),
    passwordDigest: bytesToBase64(digest),
  };
}

async function verifyPassword(
  cryptoApi: Crypto,
  password: string,
  passwordSalt: string,
  expectedDigest: string,
): Promise<boolean> {
  try {
    const actual = await derivePasswordDigest(
      cryptoApi,
      password,
      base64ToBytes(passwordSalt),
    );
    const expected = base64ToBytes(expectedDigest);
    if (actual.length !== expected.length) return false;

    let difference = 0;
    for (let index = 0; index < actual.length; index += 1) {
      difference |= actual[index] ^ expected[index];
    }
    return difference === 0;
  } catch {
    return false;
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStoredAccount(value: unknown): value is StoredAirlineAccount {
  if (!value || typeof value !== "object") return false;
  const account = value as Partial<StoredAirlineAccount>;
  return (
    isString(account.id) &&
    isString(account.userId) &&
    isString(account.email) &&
    isString(account.passwordSalt) &&
    isString(account.passwordDigest) &&
    isString(account.legalName) &&
    isString(account.displayName) &&
    (account.iataCode === null || isString(account.iataCode)) &&
    (account.icaoCode === null || isString(account.icaoCode)) &&
    isString(account.country) &&
    isString(account.primaryStation) &&
    Array.isArray(account.additionalStations) &&
    account.additionalStations.every(isString) &&
    isString(account.fullName) &&
    isString(account.title) &&
    isString(account.phone) &&
    isString(account.createdAt)
  );
}

function isMockSession(value: unknown): value is MockAirlineSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<MockAirlineSession>;
  return (
    session.schemaVersion === SESSION_SCHEMA_VERSION &&
    isString(session.sessionId) &&
    isString(session.userId) &&
    isString(session.airlineId) &&
    session.role === "AIRLINE_ADMIN" &&
    session.source !== undefined &&
    ["demo", "registration"].includes(session.source) &&
    isString(session.issuedAt) &&
    isString(session.expiresAt) &&
    Boolean(session.user && isString(session.user.email)) &&
    Boolean(session.airline && isString(session.airline.legalName)) &&
    Boolean(
      session.stations &&
        isString(session.stations.primary) &&
        Array.isArray(session.stations.authorized),
    ) &&
    Array.isArray(session.permissions)
  );
}

function createId(cryptoApi: Crypto | undefined, prefix: string): string {
  if (cryptoApi?.randomUUID) return `${prefix}_${cryptoApi.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2)}`;
}

const READ_ONLY_PERMISSIONS: MockPermission[] = [
  "rotations:read",
  "evidence:read",
  "documents:read",
  "reports:read",
];

export class MockAuthGateway {
  readonly #options: MockAuthGatewayOptions;

  constructor(options: MockAuthGatewayOptions = {}) {
    this.#options = options;
  }

  #localStorage(): Storage | null {
    if ("localStorage" in this.#options) return this.#options.localStorage ?? null;
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

  #loadAccounts(): StoredAirlineAccount[] {
    const storage = this.#localStorage();
    if (!storage) return [];
    const raw = storage.getItem(MOCK_ACCOUNTS_STORAGE_KEY);
    if (!raw) return [];

    try {
      const document = JSON.parse(raw) as Partial<StoredAccountsDocument>;
      if (
        document.schemaVersion !== ACCOUNT_SCHEMA_VERSION ||
        !Array.isArray(document.accounts) ||
        !document.accounts.every(isStoredAccount)
      ) {
        throw new Error("Invalid account document");
      }
      return document.accounts;
    } catch {
      storage.removeItem(MOCK_ACCOUNTS_STORAGE_KEY);
      return [];
    }
  }

  #saveAccounts(accounts: StoredAirlineAccount[]): boolean {
    const storage = this.#localStorage();
    if (!storage) return false;
    try {
      const document: StoredAccountsDocument = {
        schemaVersion: ACCOUNT_SCHEMA_VERSION,
        accounts,
      };
      storage.setItem(MOCK_ACCOUNTS_STORAGE_KEY, JSON.stringify(document));
      return true;
    } catch {
      return false;
    }
  }

  #buildSession(
    account: Omit<StoredAirlineAccount, "passwordSalt" | "passwordDigest" | "createdAt" | "phone">,
    source: MockAirlineSession["source"],
    remember: boolean,
  ): MockAirlineSession {
    const now = this.#now();
    const cryptoApi = this.#crypto();
    const authorized = [
      account.primaryStation,
      ...account.additionalStations.filter(
        (station) => station !== account.primaryStation,
      ),
    ];

    return {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: createId(cryptoApi, "ses"),
      userId: account.userId,
      airlineId: account.id,
      role: "AIRLINE_ADMIN",
      user: {
        fullName: account.fullName,
        email: account.email,
        title: account.title,
      },
      airline: {
        legalName: account.legalName,
        displayName: account.displayName || account.legalName,
        iataCode: account.iataCode,
        icaoCode: account.icaoCode,
        country: account.country,
      },
      stations: {
        primary: account.primaryStation,
        authorized,
      },
      permissions: [...READ_ONLY_PERMISSIONS],
      source,
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
    const raw = storage.getItem(key);
    if (!raw) return null;
    try {
      const session = JSON.parse(raw) as unknown;
      if (
        !isMockSession(session) ||
        !Number.isFinite(Date.parse(session.expiresAt)) ||
        Date.parse(session.expiresAt) <= this.#now()
      ) {
        throw new Error("Invalid or expired session");
      }
      return session;
    } catch {
      storage.removeItem(key);
      return null;
    }
  }

  getSession(): MockAirlineSession | null {
    return (
      this.#readSession(
        this.#localStorage(),
        MOCK_PERSISTENT_SESSION_KEY,
      ) ??
      this.#readSession(
        this.#sessionStorage(),
        MOCK_TRANSIENT_SESSION_KEY,
      )
    );
  }

  async signIn(input: MockSignInInput): Promise<MockSignInResult> {
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
    let session: MockAirlineSession | null = null;

    if (
      email === DEMO_CREDENTIALS.email &&
      password === DEMO_CREDENTIALS.password
    ) {
      session = this.#buildSession(
        {
          id: "airline_demo",
          userId: "user_demo_operations",
          email: DEMO_CREDENTIALS.email,
          legalName: "ELEVANT Demo Airlines, S.A.",
          displayName: "ELEVANT Demo Airlines",
          iataCode: "EV",
          icaoCode: "ELV",
          country: "República Dominicana",
          primaryStation: "PUJ",
          additionalStations: ["SDQ", "STI"],
          fullName: "Centro de Operaciones Demo",
          title: "Administrador de aerolínea",
        },
        "demo",
        remember,
      );
    } else {
      const account = this.#loadAccounts().find(
        (candidate) => candidate.email === email,
      );
      const cryptoApi = this.#crypto();
      if (
        account &&
        cryptoApi?.subtle &&
        (await verifyPassword(
          cryptoApi,
          password,
          account.passwordSalt,
          account.passwordDigest,
        ))
      ) {
        session = this.#buildSession(account, "registration", remember);
      }
    }

    if (!session) {
      return {
        ok: false,
        message: "Correo o contraseña incorrectos.",
        fieldErrors: { password: "Revisa tus credenciales e inténtalo de nuevo." },
        firstInvalidField: "password",
      };
    }

    if (!this.#persistSession(session, remember)) {
      return {
        ok: false,
        message: "No fue posible guardar la sesión en este navegador.",
      };
    }

    return { ok: true, session };
  }

  async register(input: MockRegistrationInput): Promise<MockRegistrationResult> {
    const validation = validateRegistration(input);
    if (!validation.ok) {
      return {
        ok: false,
        message: "Revisa los campos indicados.",
        fieldErrors: validation.fieldErrors,
        firstInvalidField: validation.firstInvalidField,
      };
    }

    const value = validation.value;
    const accounts = this.#loadAccounts();
    if (
      value.email === DEMO_CREDENTIALS.email ||
      accounts.some((account) => account.email === value.email)
    ) {
      return {
        ok: false,
        message: "Ya existe una cuenta local con este correo.",
        fieldErrors: { email: "Este correo ya está registrado." },
        firstInvalidField: "email",
      };
    }

    const cryptoApi = this.#crypto();
    if (!cryptoApi?.subtle) {
      return {
        ok: false,
        message: "Este navegador no permite proteger la cuenta local.",
      };
    }

    try {
      const passwordRecord = await createPasswordRecord(
        cryptoApi,
        value.password,
      );
      const now = this.#now();
      const account: StoredAirlineAccount = {
        id: createId(cryptoApi, "airline"),
        userId: createId(cryptoApi, "user"),
        email: value.email,
        ...passwordRecord,
        legalName: value.legalName,
        displayName: value.displayName || value.legalName,
        iataCode: value.iataCode || null,
        icaoCode: value.icaoCode || null,
        country: value.country,
        primaryStation: value.primaryStation,
        additionalStations: splitStations(value.additionalStations),
        fullName: value.fullName,
        title: value.title,
        phone: value.phone,
        createdAt: new Date(now).toISOString(),
      };

      if (!this.#saveAccounts([...accounts, account])) {
        return {
          ok: false,
          message: "No fue posible guardar la cuenta en este navegador.",
        };
      }

      const session = this.#buildSession(account, "registration", false);
      if (!this.#persistSession(session, false)) {
        return {
          ok: false,
          message: "La cuenta se creó, pero no fue posible iniciar la sesión.",
        };
      }
      return { ok: true, session };
    } catch {
      return {
        ok: false,
        message: "No fue posible crear la cuenta local.",
      };
    }
  }

  signOut(): void {
    try {
      this.#localStorage()?.removeItem(MOCK_PERSISTENT_SESSION_KEY);
    } catch {
      // Storage can be disabled independently; still clear the other store.
    }
    try {
      this.#sessionStorage()?.removeItem(MOCK_TRANSIENT_SESSION_KEY);
    } catch {
      // The in-memory provider state is cleared even if storage is unavailable.
    }
  }
}
