import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import {
  flightReportOutboxAccount,
  parseFlightReportOutbox,
} from '../synchronization/flight-report-outbox';

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
const RAMP_SERVICE_CHARGE_COMMAND_PREFIX =
  'elevant:mobile:ramp-service-charge-command:v1:';
const RAMP_OPERATION_CHARGES_CACHE_PREFIX =
  'elevant:mobile:ramp-operation-charges:v1:';
const RAMP_OPERATION_SUBMIT_COMMAND_PREFIX =
  'elevant:mobile:ramp-operation-submit-command:v1:';
const RAMP_CORRECTION_COMMAND_PREFIX =
  'elevant:mobile:ramp-correction-command:v1:';
const RAMP_INCIDENT_OUTBOX_PREFIX = 'elevant:mobile:ramp-incident-outbox:v1:';
const OPERATION_CHAT_COMMAND_PREFIX = 'elevant:mobile:operation-chat-command:v1:';
/** Last server copy of an operation's checklist, so the agent opens it without signal (3-I); a cache only. */
const RAMP_CHECKLIST_CACHE_PREFIX = 'elevant:mobile:ramp-checklist-cache:v1:';
const ATTENDANCE_DRAFT_PENDING_PREFIX = 'elevant:mobile:attendance-draft-pending:v1:';
const RAMP_INCIDENT_OUTBOX_SCHEMA_VERSION = 1 as const;
const MAXIMUM_INCIDENT_OUTBOX_ITEMS = 25;

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

export type CurrentOperationChatCommand =
  | Readonly<{ kind: 'current'; command: Readonly<{ idempotencyKey: string; content: string }> | null }>
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

export type StoredRampIncidentOutboxItem = Readonly<{
  idempotencyKey: string;
  payload: string;
  createdAt: string;
  state: 'pending' | 'blocked';
}>;

export type CurrentRampIncidentOutbox =
  | Readonly<{ kind: 'current'; items: readonly StoredRampIncidentOutboxItem[] }>
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

/** Copies of ELEVANT's data for one operation: they leave with the session, they are not the agent's records. */
function allRampCacheKeys(appKeys: readonly string[]) {
  return appKeys.filter(
    (key) =>
      key.startsWith(RAMP_OPERATION_CHARGES_CACHE_PREFIX) ||
      key.startsWith(RAMP_CHECKLIST_CACHE_PREFIX),
  );
}

/**
 * What the agent recorded and ELEVANT has not confirmed yet, keyed by `<prefix><accountId>:…` (3-N12): commands an
 * older version reserved, the hand-off and correction commands and the incident reports. They survive the end of the
 * session; only the same account reads and sends them when it signs in again.
 */
const ACCOUNT_EVIDENCE_PREFIXES = [
  RAMP_START_COMMAND_PREFIX,
  RAMP_CHECKLIST_SUBMIT_COMMAND_PREFIX,
  RAMP_SERVICE_TRANSITION_COMMAND_PREFIX,
  RAMP_SERVICE_CHARGE_COMMAND_PREFIX,
  RAMP_OPERATION_SUBMIT_COMMAND_PREFIX,
  RAMP_CORRECTION_COMMAND_PREFIX,
  RAMP_INCIDENT_OUTBOX_PREFIX,
  OPERATION_CHAT_COMMAND_PREFIX,
] as const;

/** The account that owns an unsent record kept on the device, or undefined for any other key (3-N12). */
function evidenceOwner(key: string): string | undefined {
  const queueOwner = flightReportOutboxAccount(key);
  if (queueOwner) return queueOwner;
  const prefix = ACCOUNT_EVIDENCE_PREFIXES.find(candidate => key.startsWith(candidate));
  if (prefix) {
    const accountId = key.slice(prefix.length).split(':')[0];
    return isUuid(accountId) ? accountId.toLowerCase() : undefined;
  }
  // An attendance observation is keyed by the session that reserved it, then by its account.
  if (key.startsWith(ATTENDANCE_DRAFT_PENDING_PREFIX)) {
    const accountId = key.slice(ATTENDANCE_DRAFT_PENDING_PREFIX.length).split(':')[1];
    return isUuid(accountId) ? accountId.toLowerCase() : undefined;
  }
  return undefined;
}

/** How many unsent records one kept key holds: every queued item, otherwise the one command it reserves. */
function evidenceRecords(key: string, raw: string | null) {
  if (raw === null) return 0;
  if (flightReportOutboxAccount(key)) return parseFlightReportOutbox(raw).length;
  if (key.startsWith(RAMP_INCIDENT_OUTBOX_PREFIX)) {
    try {
      return parseRampIncidentOutbox(raw).length;
    } catch {
      // Unreadable, yet still on the device: it is not hidden from the count.
      return 1;
    }
  }
  return 1;
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

/**
 * Removes the credential, its metadata, what the prototype left behind and the copies of ELEVANT's data. What the
 * agent recorded and ELEVANT has not confirmed stays on the device bound to its account (3-N12): a revoked or expired
 * session and a sign-out never lose unsent evidence (the Flight Report queue, the incident reports, the reserved
 * commands, the drafts and the attendance observations), and only the same account reads and sends it again.
 */
async function removeSessionAndCaches(appKeys: readonly string[]) {
  const results = await Promise.allSettled([
    SecureStore.deleteItemAsync(SESSION_CREDENTIAL_KEY),
    SecureStore.deleteItemAsync(LEGACY_ATOMIC_ENVELOPE_KEY),
    SecureStore.deleteItemAsync(LEGACY_ACCESS_TOKEN_KEY),
    AsyncStorage.multiRemove([
      SESSION_METADATA_KEY,
      ...new Set(staleAsyncKeys(appKeys)),
      ...allRampCacheKeys(appKeys),
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

function operationChatCommandKey(accountId: string, operationId: string) {
  assertRampExecutionIds(accountId, operationId);
  return `${OPERATION_CHAT_COMMAND_PREFIX}${accountId.toLowerCase()}:${operationId.toLowerCase()}`;
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

function rampServiceChargeCommandKey(
  accountId: string,
  operationId: string,
  serviceId: string,
  chargeId: string,
  action: string,
) {
  assertRampExecutionIds(accountId, operationId, serviceId, chargeId);
  if (action !== 'Apply' && action !== 'Remove') throw new MobileSessionStorageError();
  return `${RAMP_SERVICE_CHARGE_COMMAND_PREFIX}${accountId.toLowerCase()}:${operationId.toLowerCase()}:${serviceId.toLowerCase()}:${chargeId.toLowerCase()}:${action.toLowerCase()}`;
}

function rampOperationChargesCacheKey(accountId: string, operationId: string) {
  assertRampExecutionIds(accountId, operationId);
  return `${RAMP_OPERATION_CHARGES_CACHE_PREFIX}${accountId.toLowerCase()}:${operationId.toLowerCase()}`;
}

function rampIncidentOutboxKey(accountId: string, operationId: string) {
  assertRampExecutionIds(accountId, operationId);
  return `${RAMP_INCIDENT_OUTBOX_PREFIX}${accountId.toLowerCase()}:${operationId.toLowerCase()}`;
}

function rampOperationSubmitCommandKey(accountId: string, operationId: string) {
  assertRampExecutionIds(accountId, operationId);
  return `${RAMP_OPERATION_SUBMIT_COMMAND_PREFIX}${accountId.toLowerCase()}:${operationId.toLowerCase()}`;
}

function rampCorrectionCommandKey(accountId: string, operationId: string) {
  assertRampExecutionIds(accountId, operationId);
  return `${RAMP_CORRECTION_COMMAND_PREFIX}${accountId.toLowerCase()}:${operationId.toLowerCase()}`;
}

function parseRampIncidentOutbox(raw: string | null): StoredRampIncidentOutboxItem[] {
  if (raw === null) return [];
  const value = parseJson(raw);
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['schemaVersion', 'items']) ||
    value.schemaVersion !== RAMP_INCIDENT_OUTBOX_SCHEMA_VERSION ||
    !Array.isArray(value.items) ||
    value.items.length > MAXIMUM_INCIDENT_OUTBOX_ITEMS
  ) throw new MobileSessionStorageError();

  const items: StoredRampIncidentOutboxItem[] = [];
  const keys = new Set<string>();
  for (const item of value.items) {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ['idempotencyKey', 'payload', 'createdAt', 'state']) ||
      !isUuid(item.idempotencyKey) ||
      !isJsonObjectString(item.payload) ||
      typeof item.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(item.createdAt)) ||
      (item.state !== 'pending' && item.state !== 'blocked') ||
      keys.has(item.idempotencyKey.toLowerCase())
    ) throw new MobileSessionStorageError();
    keys.add(item.idempotencyKey.toLowerCase());
    items.push({
      idempotencyKey: item.idempotencyKey.toLowerCase(),
      payload: item.payload,
      createdAt: item.createdAt,
      state: item.state,
    });
  }
  return items;
}

export async function readRampIncidentOutboxIfCurrent(
  sessionId: string,
  accountId: string,
  operationId: string,
): Promise<CurrentRampIncidentOutbox> {
  const key = rampIncidentOutboxKey(accountId, operationId);
  return withStorageLock(async () => {
    try {
      if (!(await currentAccountSessionUnlocked(sessionId, accountId))) return { kind: 'not-current' };
      return { kind: 'current', items: parseRampIncidentOutbox(await AsyncStorage.getItem(key)) };
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
}

export async function reserveRampIncidentOutboxItemIfCurrent(
  sessionId: string,
  accountId: string,
  operationId: string,
  payload: string,
): Promise<CurrentRampIncidentOutbox> {
  if (!isJsonObjectString(payload) || payload.length > 16_384) throw new MobileSessionStorageError();
  const key = rampIncidentOutboxKey(accountId, operationId);
  return withStorageLock(async () => {
    try {
      if (!(await currentAccountSessionUnlocked(sessionId, accountId))) return { kind: 'not-current' };
      const items = parseRampIncidentOutbox(await AsyncStorage.getItem(key));
      if (items.length >= MAXIMUM_INCIDENT_OUTBOX_ITEMS) throw new MobileSessionStorageError();
      items.push({
        idempotencyKey: Crypto.randomUUID().toLowerCase(),
        payload,
        createdAt: new Date().toISOString(),
        state: 'pending',
      });
      await AsyncStorage.setItem(key, serializeEnvelope({
        schemaVersion: RAMP_INCIDENT_OUTBOX_SCHEMA_VERSION, items,
      }));
      return { kind: 'current', items };
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
}

export async function updateRampIncidentOutboxItemIfCurrent(
  sessionId: string,
  accountId: string,
  operationId: string,
  idempotencyKey: string,
  action: 'block' | 'remove',
): Promise<CurrentRampIncidentOutbox> {
  if (!isUuid(idempotencyKey)) throw new MobileSessionStorageError();
  const key = rampIncidentOutboxKey(accountId, operationId);
  return withStorageLock(async () => {
    try {
      if (!(await currentAccountSessionUnlocked(sessionId, accountId))) return { kind: 'not-current' };
      const items = parseRampIncidentOutbox(await AsyncStorage.getItem(key));
      const index = items.findIndex(item => item.idempotencyKey === idempotencyKey.toLowerCase());
      if (index < 0) return { kind: 'current', items };
      if (action === 'remove') items.splice(index, 1);
      else items[index] = { ...items[index], state: 'blocked' };
      await AsyncStorage.setItem(key, serializeEnvelope({
        schemaVersion: RAMP_INCIDENT_OUTBOX_SCHEMA_VERSION, items,
      }));
      return { kind: 'current', items };
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
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

/**
 * The installation ID already stored on this device, or null when it never registered. Signing out releases the
 * tablet with it (2-N02); unlike {@link readOrCreateMobileInstallationId} it never creates one.
 */
export async function readMobileInstallationId() {
  return withStorageLock(async () => {
    try {
      await ensureSecureStoreAvailable();
      const current = await SecureStore.getItemAsync(MOBILE_INSTALLATION_ID_KEY);
      return isUuid(current) ? current.toLowerCase() : null;
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
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

export async function reserveOperationChatCommandIfCurrent(
  sessionId: string, accountId: string, operationId: string, content: string,
): Promise<CurrentOperationChatCommand> {
  const key = operationChatCommandKey(accountId, operationId);
  if (content.trim().length === 0 || content.length > 2_000) throw new MobileSessionStorageError();
  return withStorageLock(async () => {
    try {
      if (!(await currentAccountSessionUnlocked(sessionId, accountId))) return { kind: 'not-current' };
      const stored = await AsyncStorage.getItem(key);
      if (stored !== null) {
        const parsed = parseJson(stored);
        if (!isRecord(parsed) || !hasExactKeys(parsed, ['idempotencyKey', 'content']) ||
            !isUuid(parsed.idempotencyKey) || typeof parsed.content !== 'string' ||
            parsed.content.length === 0 || parsed.content.length > 2_000)
          throw new MobileSessionStorageError();
        return { kind: 'current', command: {
          idempotencyKey: parsed.idempotencyKey.toLowerCase(), content: parsed.content,
        } };
      }
      const command = { idempotencyKey: Crypto.randomUUID().toLowerCase(), content: content.trim() };
      await AsyncStorage.setItem(key, JSON.stringify(command));
      return { kind: 'current', command };
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
}

export async function readOperationChatCommandIfCurrent(
  sessionId: string, accountId: string, operationId: string,
): Promise<CurrentOperationChatCommand> {
  const key = operationChatCommandKey(accountId, operationId);
  return withStorageLock(async () => {
    try {
      if (!(await currentAccountSessionUnlocked(sessionId, accountId))) return { kind: 'not-current' };
      const stored = await AsyncStorage.getItem(key);
      if (stored === null) return { kind: 'current', command: null };
      const parsed = parseJson(stored);
      if (!isRecord(parsed) || !hasExactKeys(parsed, ['idempotencyKey', 'content']) ||
          !isUuid(parsed.idempotencyKey) || typeof parsed.content !== 'string' ||
          parsed.content.length === 0 || parsed.content.length > 2_000)
        throw new MobileSessionStorageError();
      return { kind: 'current', command: {
        idempotencyKey: parsed.idempotencyKey.toLowerCase(), content: parsed.content,
      } };
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
}

export async function clearOperationChatCommandIfCurrent(
  sessionId: string, accountId: string, operationId: string, idempotencyKey: string,
): Promise<'cleared' | 'changed' | 'not-current'> {
  const key = operationChatCommandKey(accountId, operationId);
  if (!isUuid(idempotencyKey)) throw new MobileSessionStorageError();
  return withStorageLock(async () => {
    try {
      if (!(await currentAccountSessionUnlocked(sessionId, accountId))) return 'not-current';
      const stored = await AsyncStorage.getItem(key);
      if (stored === null) return 'cleared';
      const parsed = parseJson(stored);
      if (!isRecord(parsed) || parsed.idempotencyKey !== idempotencyKey.toLowerCase()) return 'changed';
      await AsyncStorage.removeItem(key);
      return 'cleared';
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

/** One stable key per service, charge and action, so a retry never doubles a mark. */
export async function getOrCreateRampServiceChargeCommandIfCurrent(
  sessionId: string,
  accountId: string,
  operationId: string,
  serviceId: string,
  chargeId: string,
  action: string,
  payload: string,
): Promise<CurrentRampExecutionCommand> {
  return getOrCreateRampExecutionCommandIfCurrent(
    sessionId,
    accountId,
    rampServiceChargeCommandKey(accountId, operationId, serviceId, chargeId, action),
    payload,
  );
}

export async function removeRampServiceChargeCommandIfCurrent(
  sessionId: string,
  accountId: string,
  operationId: string,
  serviceId: string,
  chargeId: string,
  action: string,
  expectedIdempotencyKey: string,
) {
  return removeRampExecutionCommandIfCurrent(
    sessionId,
    accountId,
    rampServiceChargeCommandKey(accountId, operationId, serviceId, chargeId, action),
    expectedIdempotencyKey,
  );
}

/** Last server copy of an operation's charge options and marks; a cache only. */
export async function readRampOperationChargesCacheIfCurrent(
  sessionId: string,
  accountId: string,
  operationId: string,
): Promise<CurrentRampExecutionValue> {
  return readRampExecutionValueIfCurrent(
    sessionId,
    accountId,
    rampOperationChargesCacheKey(accountId, operationId),
  );
}

export async function writeRampOperationChargesCacheIfCurrent(
  sessionId: string,
  accountId: string,
  operationId: string,
  value: string,
): Promise<'written' | 'not-current'> {
  const key = rampOperationChargesCacheKey(accountId, operationId);
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

export async function readRampOperationSubmitCommandIfCurrent(
  sessionId: string,
  accountId: string,
  operationId: string,
): Promise<CurrentRampExecutionCommandRead> {
  const result = await readRampExecutionValueIfCurrent(
    sessionId, accountId, rampOperationSubmitCommandKey(accountId, operationId));
  if (result.kind !== 'current') return result;
  const command = parseRampExecutionCommand(result.value);
  if (result.value !== null && !command) throw new MobileSessionStorageError();
  return {
    kind: 'current',
    command: command
      ? { idempotencyKey: command.idempotencyKey, payload: command.payload }
      : null,
  };
}

export async function getOrCreateRampOperationSubmitCommandIfCurrent(
  sessionId: string,
  accountId: string,
  operationId: string,
  payload: string,
): Promise<CurrentRampExecutionCommand> {
  return getOrCreateRampExecutionCommandIfCurrent(
    sessionId, accountId, rampOperationSubmitCommandKey(accountId, operationId), payload);
}

export async function removeRampOperationSubmitCommandIfCurrent(
  sessionId: string,
  accountId: string,
  operationId: string,
  expectedIdempotencyKey: string,
) {
  return removeRampExecutionCommandIfCurrent(
    sessionId,
    accountId,
    rampOperationSubmitCommandKey(accountId, operationId),
    expectedIdempotencyKey,
  );
}

export async function readRampCorrectionCommandIfCurrent(
  sessionId: string, accountId: string, operationId: string,
): Promise<CurrentRampExecutionCommandRead> {
  const result = await readRampExecutionValueIfCurrent(
    sessionId, accountId, rampCorrectionCommandKey(accountId, operationId));
  if (result.kind !== 'current') return result;
  const command = parseRampExecutionCommand(result.value);
  if (result.value !== null && !command) throw new MobileSessionStorageError();
  return { kind: 'current', command: command
    ? { idempotencyKey: command.idempotencyKey, payload: command.payload }
    : null };
}

export async function getOrCreateRampCorrectionCommandIfCurrent(
  sessionId: string, accountId: string, operationId: string,
): Promise<CurrentRampExecutionCommand> {
  return getOrCreateRampExecutionCommandIfCurrent(
    sessionId, accountId, rampCorrectionCommandKey(accountId, operationId), '{}');
}

export async function removeRampCorrectionCommandIfCurrent(
  sessionId: string, accountId: string, operationId: string,
  expectedIdempotencyKey: string,
) {
  return removeRampExecutionCommandIfCurrent(
    sessionId, accountId, rampCorrectionCommandKey(accountId, operationId),
    expectedIdempotencyKey);
}

function rampChecklistCacheKey(accountId: string, operationId: string) {
  assertRampExecutionIds(accountId, operationId);
  return `${RAMP_CHECKLIST_CACHE_PREFIX}${accountId.toLowerCase()}:${operationId.toLowerCase()}`;
}

/** Last server copy of an operation's checklist (3-I): the agent opens it without signal; a cache only. */
export async function readRampChecklistCacheIfCurrent(
  sessionId: string,
  accountId: string,
  operationId: string,
): Promise<CurrentRampExecutionValue> {
  return readRampExecutionValueIfCurrent(sessionId, accountId, rampChecklistCacheKey(accountId, operationId));
}

export async function writeRampChecklistCacheIfCurrent(
  sessionId: string,
  accountId: string,
  operationId: string,
  value: string,
): Promise<'written' | 'not-current'> {
  const key = rampChecklistCacheKey(accountId, operationId);
  if (!isJsonObjectString(value)) throw new MobileSessionStorageError();
  return withStorageLock(async () => {
    try {
      if (!(await currentAccountSessionUnlocked(sessionId, accountId))) return 'not-current';
      await AsyncStorage.setItem(key, value);
      return 'written';
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
}

/** The operations of this account with incident reports still on the device (3-I sends them when signal returns). */
export async function listRampIncidentOutboxOperationsIfCurrent(
  sessionId: string,
  accountId: string,
): Promise<Readonly<{ kind: 'current'; operationIds: readonly string[] }> | Readonly<{ kind: 'not-current' }>> {
  assertRampExecutionIds(accountId);
  const prefix = `${RAMP_INCIDENT_OUTBOX_PREFIX}${accountId.toLowerCase()}:`;
  return withStorageLock(async () => {
    try {
      if (!(await currentAccountSessionUnlocked(sessionId, accountId))) return { kind: 'not-current' };
      const operationIds = (await AsyncStorage.getAllKeys())
        .filter(key => key.startsWith(prefix))
        .map(key => key.slice(prefix.length))
        .filter(isUuid)
        .map(operationId => operationId.toLowerCase());
      return { kind: 'current', operationIds };
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
}

/** A command an older version reserved in its own key, before 3-I moved it into the Flight Report queue. */
export type LegacyRampCommand = Readonly<{
  storageKey: string;
  idempotencyKey: string;
  kind: 'start' | 'serviceTransition' | 'serviceCharge' | 'checklistSubmit' | 'chatMessage';
  operationId: string;
  /** The service of a transition or a charge. */
  serviceId?: string;
  /** The reserved body (JSON) of a transition, a charge or a checklist, or the content of a chat message. */
  payload?: string;
}>;

export type CurrentLegacyRampCommands =
  | Readonly<{ kind: 'current'; commands: readonly LegacyRampCommand[] }>
  | Readonly<{ kind: 'not-current' }>;

function legacyRampCommand(accountId: string, key: string, raw: string | null): LegacyRampCommand | null {
  const account = accountId.toLowerCase();
  const parts = (prefix: string, count: number) => {
    if (!key.startsWith(`${prefix}${account}:`)) return null;
    const values = key.slice(prefix.length + account.length + 1).split(':');
    return values.length === count ? values : null;
  };
  const start = parts(RAMP_START_COMMAND_PREFIX, 1);
  if (start) {
    return isUuid(start[0]) && isUuid(raw)
      ? { storageKey: key, idempotencyKey: raw.toLowerCase(), kind: 'start', operationId: start[0].toLowerCase() }
      : null;
  }
  const chat = parts(OPERATION_CHAT_COMMAND_PREFIX, 1);
  if (chat) {
    const parsed = parseJson(raw);
    return isUuid(chat[0]) && isRecord(parsed) && isUuid(parsed.idempotencyKey) && typeof parsed.content === 'string' &&
      parsed.content.trim().length > 0 && parsed.content.length <= 2_000
      ? { storageKey: key, idempotencyKey: parsed.idempotencyKey.toLowerCase(), kind: 'chatMessage',
        operationId: chat[0].toLowerCase(), payload: parsed.content }
      : null;
  }
  const command = (kind: LegacyRampCommand['kind'], ids: readonly string[] | null) => {
    if (!ids || !ids.slice(0, kind === 'checklistSubmit' ? 2 : kind === 'serviceTransition' ? 2 : 3).every(isUuid)) return null;
    const stored = parseRampExecutionCommand(raw);
    if (!stored) return null;
    return {
      storageKey: key, idempotencyKey: stored.idempotencyKey, kind, operationId: ids[0].toLowerCase(),
      ...(kind === 'checklistSubmit' ? {} : { serviceId: ids[1].toLowerCase() }), payload: stored.payload,
    } satisfies LegacyRampCommand;
  };
  if (key.startsWith(RAMP_SERVICE_TRANSITION_COMMAND_PREFIX))
    return command('serviceTransition', parts(RAMP_SERVICE_TRANSITION_COMMAND_PREFIX, 3));
  if (key.startsWith(RAMP_SERVICE_CHARGE_COMMAND_PREFIX))
    return command('serviceCharge', parts(RAMP_SERVICE_CHARGE_COMMAND_PREFIX, 4));
  if (key.startsWith(RAMP_CHECKLIST_SUBMIT_COMMAND_PREFIX))
    return command('checklistSubmit', parts(RAMP_CHECKLIST_SUBMIT_COMMAND_PREFIX, 2));
  return null;
}

const LEGACY_COMMAND_PREFIXES = [RAMP_START_COMMAND_PREFIX, RAMP_SERVICE_TRANSITION_COMMAND_PREFIX,
  RAMP_SERVICE_CHARGE_COMMAND_PREFIX, RAMP_CHECKLIST_SUBMIT_COMMAND_PREFIX, OPERATION_CHAT_COMMAND_PREFIX];

/**
 * The start, service transitions, charges, checklist submissions and chat messages of this account that an older
 * version reserved in their own keys (3-I moves them into the Flight Report queue once, with the same key, so the
 * queue sends exactly what was reserved). A malformed reservation is left where it is.
 */
export async function readLegacyRampCommandsIfCurrent(
  sessionId: string,
  accountId: string,
): Promise<CurrentLegacyRampCommands> {
  assertRampExecutionIds(accountId);
  return withStorageLock(async () => {
    try {
      if (!(await currentAccountSessionUnlocked(sessionId, accountId))) return { kind: 'not-current' };
      const account = accountId.toLowerCase();
      const keys = (await AsyncStorage.getAllKeys()).filter(key =>
        LEGACY_COMMAND_PREFIXES.some(prefix => key.startsWith(`${prefix}${account}:`)));
      const commands: LegacyRampCommand[] = [];
      for (const key of keys) {
        const command = legacyRampCommand(account, key, await AsyncStorage.getItem(key));
        if (command) commands.push(command);
      }
      return { kind: 'current', commands };
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
}

/** Forgets a legacy reservation once the Flight Report queue holds it (3-I); only if it still has that key. */
export async function removeLegacyRampCommandIfCurrent(
  sessionId: string,
  accountId: string,
  storageKey: string,
  idempotencyKey: string,
): Promise<'removed' | 'changed' | 'not-current'> {
  assertRampExecutionIds(accountId);
  if (!isUuid(idempotencyKey)) throw new MobileSessionStorageError();
  return withStorageLock(async () => {
    try {
      if (!(await currentAccountSessionUnlocked(sessionId, accountId))) return 'not-current';
      const command = legacyRampCommand(accountId, storageKey, await AsyncStorage.getItem(storageKey));
      if (!command || command.idempotencyKey !== idempotencyKey.toLowerCase()) return 'changed';
      await AsyncStorage.removeItem(storageKey);
      return 'removed';
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
}

export type PendingEvidenceCount = Readonly<{
  /** Unsent records of the account signed in on this tablet (none without a session). */
  current: number;
  /** Unsent records of other accounts: kept for them, never shown, sent or discarded by this one. */
  others: number;
}>;

/**
 * How many records this tablet keeps that ELEVANT has not confirmed (3-N12): the Flight Report queue, the incident
 * reports, the hand-off and correction commands, the attendance observations and the commands an older version
 * reserved, split between the account signed in now and the others. A checklist draft is not counted: nothing was
 * sent from it yet. It answers numbers only: nothing of another account's records leaves the storage.
 */
export async function countPendingEvidence(): Promise<PendingEvidenceCount> {
  return withStorageLock(async () => {
    try {
      const state = await readStoredMobileSessionUnlocked();
      const signedIn = state.kind === 'active' ? safeAccountId(state.metadata)?.toLowerCase() : undefined;
      let current = 0;
      let others = 0;
      for (const key of await AsyncStorage.getAllKeys()) {
        const owner = evidenceOwner(key);
        if (!owner) continue;
        const records = evidenceRecords(key, await AsyncStorage.getItem(key));
        if (owner === signedIn) current += records;
        else others += records;
      }
      return { current, others };
    } catch (error) {
      if (error instanceof MobileSessionStorageError) throw error;
      throw new MobileSessionStorageError();
    }
  });
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
