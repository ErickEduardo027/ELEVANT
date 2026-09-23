import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const ENVELOPE_SCHEMA_VERSION = 1 as const;
const RAMP_EXECUTION_COMMAND_SCHEMA_VERSION = 1 as const;
const SESSION_CREDENTIAL_KEY = 'elevant.mobile.session-credential.v1';
const MOBILE_INSTALLATION_ID_KEY = 'elevant.mobile.installation-id.v1';
const SESSION_METADATA_KEY = 'elevant:mobile:session-metadata:v1';
const ASSIGNED_OPERATIONS_CACHE_PREFIX =
  'elevant:mobile:assigned-operations:v1:';
const RAMP_START_COMMAND_PREFIX = 'elevant:mobile:ramp-start-command:v1:';
const RAMP_CHECKLIST_DRAFT_PREFIX =
  'elevant:mobile:ramp-checklist-draft:v1:';
const RAMP_CHECKLIST_SUBMIT_COMMAND_PREFIX =
  'elevant:mobile:ramp-checklist-submit-command:v1:';
const RAMP_SERVICE_TRANSITION_COMMAND_PREFIX =
  'elevant:mobile:ramp-service-transition-command:v1:';

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

export type CurrentRampStartCommand =
  | Readonly<{ kind: 'current'; idempotencyKey: string }>
  | Readonly<{ kind: 'not-current' }>;

export type CurrentRampExecutionValue =
  | Readonly<{ kind: 'current'; value: string | null }>
  | Readonly<{ kind: 'not-current' }>;

export type CurrentRampExecutionCommand =
  | Readonly<{
      kind: 'current';
      idempotencyKey: string;
      payload: string;
    }>
  | Readonly<{ kind: 'not-current' }>;

export type CurrentRampExecutionCommandRead =
  | Readonly<{
      kind: 'current';
      command: Readonly<{
        idempotencyKey: string;
        payload: string;
      }> | null;
    }>
  | Readonly<{ kind: 'not-current' }>;

type StoredRampExecutionCommand = Readonly<{
  schemaVersion: typeof RAMP_EXECUTION_COMMAND_SCHEMA_VERSION;
  idempotencyKey: string;
  payload: string;
}>;

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

function allRampStartCommandKeys(appKeys: readonly string[]) {
  return appKeys.filter((key) => key.startsWith(RAMP_START_COMMAND_PREFIX));
}

function allRampExecutionKeys(appKeys: readonly string[]) {
  return appKeys.filter(
    (key) =>
      key.startsWith(RAMP_CHECKLIST_DRAFT_PREFIX) ||
      key.startsWith(RAMP_CHECKLIST_SUBMIT_COMMAND_PREFIX) ||
      key.startsWith(RAMP_SERVICE_TRANSITION_COMMAND_PREFIX),
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
      ...allRampStartCommandKeys(appKeys),
      ...allRampExecutionKeys(appKeys),
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

async function currentAccountSessionUnlocked(
  expectedSessionId: string,
  expectedAccountId: string,
) {
  const state = await readStoredMobileSessionUnlocked();
  return (
    state.kind === 'active' &&
    state.sessionId === expectedSessionId &&
    safeAccountId(state.metadata)?.toLowerCase() ===
      expectedAccountId.toLowerCase()
  );
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

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    uuidPattern.test(value) &&
    value.toLowerCase() !== '00000000-0000-0000-0000-000000000000'
  );
}

function rampStartCommandKey(accountId: string, operationId: string) {
  if (!isUuid(accountId) || !isUuid(operationId)) {
    throw new MobileSessionStorageError();
  }

  return `${RAMP_START_COMMAND_PREFIX}${accountId.toLowerCase()}:${operationId.toLowerCase()}`;
}

function rampChecklistDraftKey(
  accountId: string,
  operationId: string,
  checklistId: string,
) {
  assertRampExecutionIds(accountId, operationId, checklistId);
  return `${RAMP_CHECKLIST_DRAFT_PREFIX}${accountId.toLowerCase()}:${operationId.toLowerCase()}:${checklistId.toLowerCase()}`;
}

function rampChecklistSubmitCommandKey(
  accountId: string,
  operationId: string,
  checklistId: string,
) {
  assertRampExecutionIds(accountId, operationId, checklistId);
  return `${RAMP_CHECKLIST_SUBMIT_COMMAND_PREFIX}${accountId.toLowerCase()}:${operationId.toLowerCase()}:${checklistId.toLowerCase()}`;
}

function rampServiceTransitionCommandKey(
  accountId: string,
  operationId: string,
  serviceId: string,
  targetStatus: string,
) {
  assertRampExecutionIds(accountId, operationId, serviceId);
  if (!/^[A-Za-z][A-Za-z0-9]{1,31}$/.test(targetStatus)) {
    throw new MobileSessionStorageError();
  }
  return `${RAMP_SERVICE_TRANSITION_COMMAND_PREFIX}${accountId.toLowerCase()}:${operationId.toLowerCase()}:${serviceId.toLowerCase()}:${targetStatus.toLowerCase()}`;
}

function assertRampExecutionIds(...values: readonly string[]) {
  if (!values.every(isUuid)) throw new MobileSessionStorageError();
}

function isJsonObjectString(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 524_288) {
    return false;
  }
  const parsed = parseJson(value);
  return isRecord(parsed);
}

function parseRampExecutionCommand(
  raw: string | null,
): StoredRampExecutionCommand | undefined {
  const candidate = parseJson(raw);
  if (
    !isRecord(candidate) ||
    !hasExactKeys(candidate, ['schemaVersion', 'idempotencyKey', 'payload']) ||
    candidate.schemaVersion !== RAMP_EXECUTION_COMMAND_SCHEMA_VERSION ||
    !isUuid(candidate.idempotencyKey) ||
    !isJsonObjectString(candidate.payload)
  ) {
    return undefined;
  }
  return {
    schemaVersion: RAMP_EXECUTION_COMMAND_SCHEMA_VERSION,
    idempotencyKey: candidate.idempotencyKey.toLowerCase(),
    payload: candidate.payload,
  };
}

async function readRampExecutionValueIfCurrent(
  sessionId: string,
  accountId: string,
  key: string,
): Promise<CurrentRampExecutionValue> {
  return withStorageLock(async () => {
    try {
      if (!(await currentAccountSessionUnlocked(sessionId, accountId))) {
        return { kind: 'not-current' };
      }
      return { kind: 'current', value: await AsyncStorage.getItem(key) };
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
}

async function getOrCreateRampExecutionCommandIfCurrent(
  sessionId: string,
  accountId: string,
  key: string,
  payload: string,
): Promise<CurrentRampExecutionCommand> {
  if (!isJsonObjectString(payload)) throw new MobileSessionStorageError();
  return withStorageLock(async () => {
    try {
      if (!(await currentAccountSessionUnlocked(sessionId, accountId))) {
        return { kind: 'not-current' };
      }

      const rawStored = await AsyncStorage.getItem(key);
      const stored = parseRampExecutionCommand(rawStored);
      if (stored) {
        return {
          kind: 'current',
          idempotencyKey: stored.idempotencyKey,
          payload: stored.payload,
        };
      }
      if (rawStored !== null) throw new MobileSessionStorageError();

      const command: StoredRampExecutionCommand = {
        schemaVersion: RAMP_EXECUTION_COMMAND_SCHEMA_VERSION,
        idempotencyKey: Crypto.randomUUID().toLowerCase(),
        payload,
      };
      await AsyncStorage.setItem(key, serializeEnvelope(command));
      return {
        kind: 'current',
        idempotencyKey: command.idempotencyKey,
        payload: command.payload,
      };
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
}

async function removeRampExecutionCommandIfCurrent(
  sessionId: string,
  accountId: string,
  key: string,
  expectedIdempotencyKey: string,
): Promise<'removed' | 'changed' | 'not-current'> {
  if (!isUuid(expectedIdempotencyKey)) throw new MobileSessionStorageError();
  return withStorageLock(async () => {
    try {
      if (!(await currentAccountSessionUnlocked(sessionId, accountId))) {
        return 'not-current';
      }
      const stored = parseRampExecutionCommand(await AsyncStorage.getItem(key));
      if (
        !stored ||
        stored.idempotencyKey !== expectedIdempotencyKey.toLowerCase()
      ) {
        return 'changed';
      }
      await AsyncStorage.removeItem(key);
      return 'removed';
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
}

export function assignedOperationsCacheKey(accountId: string) {
  return `${ASSIGNED_OPERATIONS_CACHE_PREFIX}${accountId}`;
}

export async function readOrCreateMobileInstallationId() {
  return withStorageLock(async () => {
    try {
      await ensureSecureStoreAvailable();
      const current = await SecureStore.getItemAsync(MOBILE_INSTALLATION_ID_KEY);
      if (isUuid(current)) return current.toLowerCase();

      const installationId = Crypto.randomUUID().toLowerCase();
      await SecureStore.setItemAsync(
        MOBILE_INSTALLATION_ID_KEY,
        installationId,
        secureStoreOptions,
      );
      return installationId;
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
}

export async function getOrCreateRampStartCommandIfCurrent(
  sessionId: string,
  accountId: string,
  operationId: string,
): Promise<CurrentRampStartCommand> {
  const key = rampStartCommandKey(accountId, operationId);
  return withStorageLock(async () => {
    try {
      if (!(await currentAccountSessionUnlocked(sessionId, accountId))) {
        return { kind: 'not-current' };
      }

      const stored = await AsyncStorage.getItem(key);
      if (isUuid(stored)) {
        return { kind: 'current', idempotencyKey: stored.toLowerCase() };
      }
      if (stored !== null) throw new MobileSessionStorageError();

      const idempotencyKey = Crypto.randomUUID().toLowerCase();
      await AsyncStorage.setItem(key, idempotencyKey);
      return { kind: 'current', idempotencyKey };
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
}

export async function readRampChecklistDraftIfCurrent(
  sessionId: string,
  accountId: string,
  operationId: string,
  checklistId: string,
): Promise<CurrentRampExecutionValue> {
  const key = rampChecklistDraftKey(accountId, operationId, checklistId);
  return readRampExecutionValueIfCurrent(sessionId, accountId, key);
}

export async function writeRampChecklistDraftIfCurrent(
  sessionId: string,
  accountId: string,
  operationId: string,
  checklistId: string,
  value: string,
): Promise<'written' | 'not-current'> {
  const key = rampChecklistDraftKey(accountId, operationId, checklistId);
  if (!isJsonObjectString(value)) throw new MobileSessionStorageError();
  return withStorageLock(async () => {
    try {
      if (!(await currentAccountSessionUnlocked(sessionId, accountId))) {
        return 'not-current';
      }
      await AsyncStorage.setItem(key, value);
      return 'written';
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
}

export async function removeRampChecklistDraftIfCurrent(
  sessionId: string,
  accountId: string,
  operationId: string,
  checklistId: string,
): Promise<'removed' | 'not-current'> {
  const key = rampChecklistDraftKey(accountId, operationId, checklistId);
  return withStorageLock(async () => {
    try {
      if (!(await currentAccountSessionUnlocked(sessionId, accountId))) {
        return 'not-current';
      }
      await AsyncStorage.removeItem(key);
      return 'removed';
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
}

export async function readRampChecklistSubmitCommandIfCurrent(
  sessionId: string,
  accountId: string,
  operationId: string,
  checklistId: string,
): Promise<CurrentRampExecutionCommandRead> {
  const key = rampChecklistSubmitCommandKey(
    accountId,
    operationId,
    checklistId,
  );
  const result = await readRampExecutionValueIfCurrent(
    sessionId,
    accountId,
    key,
  );
  if (result.kind !== 'current') return result;
  const command = parseRampExecutionCommand(result.value);
  if (result.value !== null && !command) throw new MobileSessionStorageError();
  return {
    kind: 'current',
    command: command
      ? {
          idempotencyKey: command.idempotencyKey,
          payload: command.payload,
        }
      : null,
  };
}

export async function getOrCreateRampChecklistSubmitCommandIfCurrent(
  sessionId: string,
  accountId: string,
  operationId: string,
  checklistId: string,
  payload: string,
): Promise<CurrentRampExecutionCommand> {
  return getOrCreateRampExecutionCommandIfCurrent(
    sessionId,
    accountId,
    rampChecklistSubmitCommandKey(accountId, operationId, checklistId),
    payload,
  );
}

export async function removeRampChecklistSubmitCommandIfCurrent(
  sessionId: string,
  accountId: string,
  operationId: string,
  checklistId: string,
  expectedIdempotencyKey: string,
) {
  return removeRampExecutionCommandIfCurrent(
    sessionId,
    accountId,
    rampChecklistSubmitCommandKey(accountId, operationId, checklistId),
    expectedIdempotencyKey,
  );
}

export async function readRampServiceTransitionCommandIfCurrent(
  sessionId: string,
  accountId: string,
  operationId: string,
  serviceId: string,
  targetStatus: string,
): Promise<CurrentRampExecutionCommandRead> {
  const result = await readRampExecutionValueIfCurrent(
    sessionId,
    accountId,
    rampServiceTransitionCommandKey(
      accountId,
      operationId,
      serviceId,
      targetStatus,
    ),
  );
  if (result.kind !== 'current') return result;
  const command = parseRampExecutionCommand(result.value);
  if (result.value !== null && !command) throw new MobileSessionStorageError();
  return {
    kind: 'current',
    command: command
      ? {
          idempotencyKey: command.idempotencyKey,
          payload: command.payload,
        }
      : null,
  };
}

export async function getOrCreateRampServiceTransitionCommandIfCurrent(
  sessionId: string,
  accountId: string,
  operationId: string,
  serviceId: string,
  targetStatus: string,
  payload: string,
): Promise<CurrentRampExecutionCommand> {
  return getOrCreateRampExecutionCommandIfCurrent(
    sessionId,
    accountId,
    rampServiceTransitionCommandKey(
      accountId,
      operationId,
      serviceId,
      targetStatus,
    ),
    payload,
  );
}

export async function removeRampServiceTransitionCommandIfCurrent(
  sessionId: string,
  accountId: string,
  operationId: string,
  serviceId: string,
  targetStatus: string,
  expectedIdempotencyKey: string,
) {
  return removeRampExecutionCommandIfCurrent(
    sessionId,
    accountId,
    rampServiceTransitionCommandKey(
      accountId,
      operationId,
      serviceId,
      targetStatus,
    ),
    expectedIdempotencyKey,
  );
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
