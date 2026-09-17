import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const ENVELOPE_SCHEMA_VERSION = 1 as const;
const SESSION_CREDENTIAL_KEY = 'elevant.mobile.session-credential.v1';
const SESSION_METADATA_KEY = 'elevant:mobile:session-metadata:v1';
const ASSIGNED_OPERATIONS_CACHE_PREFIX =
  'elevant:mobile:assigned-operations:v1:';

const LEGACY_ATOMIC_ENVELOPE_KEY = 'elevant.mobile.session.v1';
const LEGACY_ACCESS_TOKEN_KEY = 'elevant.mobile.access_token.v1';
const LEGACY_METADATA_KEY = 'elevant:mobile:session:v1';
const LEGACY_SESSION_KEY = 'elevant:mobile-session';
const LEGACY_ASSIGNED_FLIGHTS_KEY = 'elevant:assigned-flights';
const LEGACY_OUTBOX_KEY = 'elevant:outbox';
const LEGACY_CHAT_KEY = 'elevant:chat:occ';
const LEGACY_CHECKLIST_PREFIX = 'elevant:checklist:';
const LEGACY_FLIGHT_STATE_PREFIX = 'elevant:flight:';
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

type StoredCredentialEnvelope = Readonly<{
  schemaVersion: typeof ENVELOPE_SCHEMA_VERSION;
  sessionId: string;
  accessToken: string;
}>;

type StoredMetadataEnvelope = Readonly<{
  schemaVersion: typeof ENVELOPE_SCHEMA_VERSION;
  sessionId: string;
  metadata: unknown;
}>;

export class MobileSessionStorageError extends Error {
  constructor() {
    super('Mobile session storage is unavailable.');
    this.name = 'MobileSessionStorageError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type StoredMobileSessionState =
  | Readonly<{ kind: 'missing' }>
  | Readonly<{ kind: 'expired'; accountId?: string }>
  | Readonly<{
      kind: 'active';
      sessionId: string;
      accessToken: string;
      metadata: unknown;
    }>;

export type CurrentMobileCacheRead =
  | Readonly<{ kind: 'current'; value: string | null }>
  | Readonly<{ kind: 'not-current' }>;

export type ConditionalMobileCacheRemoval =
  | 'removed'
  | 'changed'
  | 'not-current';

export type CurrentMobileCacheWrite =
  | 'written'
  | 'cache-unavailable'
  | 'not-current';

let storageQueue: Promise<void> = Promise.resolve();

async function withStorageLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = storageQueue;
  let release: () => void = () => undefined;
  storageQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function safeAccountId(metadata: unknown) {
  if (!isRecord(metadata) || !isRecord(metadata.actor)) return undefined;
  const accountId = metadata.actor.accountId;
  return typeof accountId === 'string' && uuidPattern.test(accountId)
    ? accountId
    : undefined;
}

function safeExpiry(metadata: unknown) {
  if (!isRecord(metadata) || typeof metadata.expiresAt !== 'string') {
    return undefined;
  }

  const timestamp = Date.parse(metadata.expiresAt);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function isValidAccessToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function parseJson(raw: string | null) {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function parseCredentialEnvelope(
  raw: string | null,
): StoredCredentialEnvelope | undefined {
  const candidate = parseJson(raw);
  if (
    !isRecord(candidate) ||
    !hasExactKeys(candidate, ['schemaVersion', 'sessionId', 'accessToken']) ||
    candidate.schemaVersion !== ENVELOPE_SCHEMA_VERSION ||
    typeof candidate.sessionId !== 'string' ||
    !uuidPattern.test(candidate.sessionId) ||
    !isValidAccessToken(candidate.accessToken)
  ) {
    return undefined;
  }

  return {
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    sessionId: candidate.sessionId,
    accessToken: candidate.accessToken,
  };
}

function parseMetadataEnvelope(
  raw: string | null,
): StoredMetadataEnvelope | undefined {
  const candidate = parseJson(raw);
  if (
    !isRecord(candidate) ||
    !hasExactKeys(candidate, ['schemaVersion', 'sessionId', 'metadata']) ||
    candidate.schemaVersion !== ENVELOPE_SCHEMA_VERSION ||
    typeof candidate.sessionId !== 'string' ||
    !uuidPattern.test(candidate.sessionId) ||
    !('metadata' in candidate)
  ) {
    return undefined;
  }

  return {
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    sessionId: candidate.sessionId,
    metadata: candidate.metadata,
  };
}

function serializeEnvelope(envelope: object) {
  try {
    return JSON.stringify(envelope);
  } catch {
    throw new MobileSessionStorageError();
  }
}

async function ensureSecureStoreAvailable() {
  if (!(await SecureStore.isAvailableAsync())) {
    throw new MobileSessionStorageError();
  }
}

function prototypeSensitiveKeys(appKeys: readonly string[]) {
  return appKeys.filter(
    (key) =>
      key === LEGACY_OUTBOX_KEY ||
      key === LEGACY_CHAT_KEY ||
      key.startsWith(LEGACY_CHECKLIST_PREFIX) ||
      key.startsWith(LEGACY_FLIGHT_STATE_PREFIX),
  );
}

function allAssignedOperationCacheKeys(appKeys: readonly string[]) {
  return appKeys.filter((key) =>
    key.startsWith(ASSIGNED_OPERATIONS_CACHE_PREFIX),
  );
}

function staleAsyncKeys(appKeys: readonly string[]) {
  return [
    LEGACY_METADATA_KEY,
    LEGACY_SESSION_KEY,
    LEGACY_ASSIGNED_FLIGHTS_KEY,
    LEGACY_OUTBOX_KEY,
    LEGACY_CHAT_KEY,
    ...prototypeSensitiveKeys(appKeys),
    ...allAssignedOperationCacheKeys(appKeys),
  ];
}

async function removeSessionAndCaches(appKeys: readonly string[]) {
  const results = await Promise.allSettled([
    SecureStore.deleteItemAsync(SESSION_CREDENTIAL_KEY),
    SecureStore.deleteItemAsync(LEGACY_ATOMIC_ENVELOPE_KEY),
    SecureStore.deleteItemAsync(LEGACY_ACCESS_TOKEN_KEY),
    AsyncStorage.multiRemove([
      SESSION_METADATA_KEY,
      ...new Set(staleAsyncKeys(appKeys)),
    ]),
  ]);

  if (results.some((result) => result.status === 'rejected')) {
    throw new MobileSessionStorageError();
  }
}

async function clearStoredMobileSessionUnlocked() {
  let appKeys: readonly string[] = [];
  let discoveryFailed = false;
  try {
    appKeys = await AsyncStorage.getAllKeys();
  } catch {
    discoveryFailed = true;
  }

  await removeSessionAndCaches(appKeys);
  if (discoveryFailed) throw new MobileSessionStorageError();
}

async function readStoredMobileSessionUnlocked(): Promise<StoredMobileSessionState> {
  try {
    await ensureSecureStoreAvailable();
    const [rawCredential, rawMetadata] = await Promise.all([
      SecureStore.getItemAsync(SESSION_CREDENTIAL_KEY),
      AsyncStorage.getItem(SESSION_METADATA_KEY),
    ]);
    const credential = parseCredentialEnvelope(rawCredential);
    const metadataEnvelope = parseMetadataEnvelope(rawMetadata);

    if (
      !credential ||
      !metadataEnvelope ||
      credential.sessionId !== metadataEnvelope.sessionId
    ) {
      await clearStoredMobileSessionUnlocked();
      return { kind: 'missing' };
    }

    const accountId = safeAccountId(metadataEnvelope.metadata);
    const expiry = safeExpiry(metadataEnvelope.metadata);
    if (expiry === undefined) {
      await clearStoredMobileSessionUnlocked();
      return { kind: 'missing' };
    }

    if (expiry <= Date.now()) {
      await clearStoredMobileSessionUnlocked();
      return { kind: 'expired', ...(accountId ? { accountId } : {}) };
    }

    return {
      kind: 'active',
      sessionId: credential.sessionId,
      accessToken: credential.accessToken,
      metadata: metadataEnvelope.metadata,
    };
  } catch (error) {
    if (error instanceof MobileSessionStorageError) throw error;
    throw new MobileSessionStorageError();
  }
}

async function currentSessionUnlocked(expectedSessionId: string) {
  const state = await readStoredMobileSessionUnlocked();
  return state.kind === 'active' && state.sessionId === expectedSessionId;
}

async function persistSessionUnlocked(
  accessToken: string,
  metadata: unknown,
  sessionId: string,
) {
  let appKeys: readonly string[];
  try {
    await ensureSecureStoreAvailable();
    appKeys = await AsyncStorage.getAllKeys();
  } catch {
    throw new MobileSessionStorageError();
  }

  const credential: StoredCredentialEnvelope = {
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    sessionId,
    accessToken,
  };
  const metadataEnvelope: StoredMetadataEnvelope = {
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    sessionId,
    metadata,
  };

  try {
    await AsyncStorage.setItem(
      SESSION_METADATA_KEY,
      serializeEnvelope(metadataEnvelope),
    );
    await SecureStore.setItemAsync(
      SESSION_CREDENTIAL_KEY,
      serializeEnvelope(credential),
      secureStoreOptions,
    );
    const cleanupResults = await Promise.allSettled([
      SecureStore.deleteItemAsync(LEGACY_ATOMIC_ENVELOPE_KEY),
      SecureStore.deleteItemAsync(LEGACY_ACCESS_TOKEN_KEY),
      AsyncStorage.multiRemove([...new Set(staleAsyncKeys(appKeys))]),
    ]);
    if (cleanupResults.some((result) => result.status === 'rejected')) {
      throw new MobileSessionStorageError();
    }
  } catch {
    try {
      await removeSessionAndCaches(appKeys);
    } catch {
      // The persistence error is normalized below; cleanup is best effort.
    }
    throw new MobileSessionStorageError();
  }
}

function assertAssignedOperationsCacheKey(key: string) {
  if (!key.startsWith(ASSIGNED_OPERATIONS_CACHE_PREFIX)) {
    throw new MobileSessionStorageError();
  }
}

export function assignedOperationsCacheKey(accountId: string) {
  return `${ASSIGNED_OPERATIONS_CACHE_PREFIX}${accountId}`;
}

export async function clearStoredMobileSession() {
  return withStorageLock(async () => {
    try {
      await clearStoredMobileSessionUnlocked();
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
}

export async function clearStoredMobileSessionIfCurrent(sessionId: string) {
  return withStorageLock(async () => {
    try {
      const current = await readStoredMobileSessionUnlocked();
      if (current.kind !== 'active' || current.sessionId !== sessionId) {
        return false;
      }
      await clearStoredMobileSessionUnlocked();
      return true;
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
}

export async function readStoredMobileSession(): Promise<StoredMobileSessionState> {
  return withStorageLock(readStoredMobileSessionUnlocked);
}

export async function readValidMobileAccessToken() {
  const state = await readStoredMobileSession();
  return state.kind === 'active' ? state.accessToken : undefined;
}

export async function writeStoredMobileSession(
  accessToken: string,
  metadata: unknown,
) {
  if (!isValidAccessToken(accessToken)) {
    throw new MobileSessionStorageError();
  }

  return withStorageLock(async () => {
    const sessionId = Crypto.randomUUID();
    await persistSessionUnlocked(accessToken, metadata, sessionId);
    return sessionId;
  });
}

export async function updateStoredMobileSessionMetadata(
  metadata: unknown,
  expectedSessionId: string,
) {
  return withStorageLock(async () => {
    try {
      const state = await readStoredMobileSessionUnlocked();
      if (state.kind !== 'active' || state.sessionId !== expectedSessionId) {
        return false;
      }

      const nextSessionId = Crypto.randomUUID();
      await persistSessionUnlocked(
        state.accessToken,
        metadata,
        nextSessionId,
      );
      return nextSessionId;
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
}

export async function readAssignedOperationsCacheIfCurrent(
  sessionId: string,
  key: string,
): Promise<CurrentMobileCacheRead> {
  assertAssignedOperationsCacheKey(key);
  return withStorageLock(async () => {
    try {
      if (!(await currentSessionUnlocked(sessionId))) {
        return { kind: 'not-current' };
      }
      return { kind: 'current', value: await AsyncStorage.getItem(key) };
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
}

export async function writeAssignedOperationsCacheIfCurrent(
  sessionId: string,
  key: string,
  value: string,
): Promise<CurrentMobileCacheWrite> {
  assertAssignedOperationsCacheKey(key);
  return withStorageLock(async () => {
    try {
      if (!(await currentSessionUnlocked(sessionId))) return 'not-current';
      try {
        await AsyncStorage.setItem(key, value);
        return 'written';
      } catch {
        return 'cache-unavailable';
      }
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
}

export async function removeAssignedOperationsCacheIfCurrent(
  sessionId: string,
  key: string,
  expectedValue: string,
): Promise<ConditionalMobileCacheRemoval> {
  assertAssignedOperationsCacheKey(key);
  return withStorageLock(async () => {
    try {
      if (!(await currentSessionUnlocked(sessionId))) return 'not-current';
      if ((await AsyncStorage.getItem(key)) !== expectedValue) return 'changed';
      await AsyncStorage.removeItem(key);
      return 'removed';
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
}
