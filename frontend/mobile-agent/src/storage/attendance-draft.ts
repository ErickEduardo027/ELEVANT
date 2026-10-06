import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import type { SaveAttendanceDraftRequest } from '@elevant/api-client';
import { MobileSessionStorageError, readStoredMobileSession } from './mobile-session';

export const ATTENDANCE_DRAFT_PENDING_PREFIX = 'elevant:mobile:attendance-draft-pending:v1:';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const offsetInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/;

export type PendingAttendanceDraft = Readonly<{
  idempotencyKey: string;
  request: SaveAttendanceDraftRequest;
}>;
type StoredIntent = PendingAttendanceDraft & Readonly<{ schemaVersion: 1 }>;
type Identity = { sessionId: string; accountId: string };

let queue: Promise<void> = Promise.resolve();
async function locked<T>(task: () => Promise<T>): Promise<T> {
  const previous = queue;
  let release = () => {};
  queue = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try { return await task(); }
  finally { release(); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validUuid(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value) &&
    value.toLowerCase() !== '00000000-0000-0000-0000-000000000000';
}
function validInstant(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && offsetInstant.test(value) &&
    Number.isFinite(Date.parse(value)));
}
function validRequest(value: unknown): value is SaveAttendanceDraftRequest {
  if (!isRecord(value) || Object.keys(value).some(key => ![
    'expectedRevision', 'observedStartAt', 'observedEndAt', 'incidentNote',
  ].includes(key)) || !Number.isSafeInteger(value.expectedRevision) ||
    (value.expectedRevision as number) < 0) return false;
  const start = value.observedStartAt ?? null;
  const end = value.observedEndAt ?? null;
  const note = value.incidentNote ?? null;
  return validInstant(start) && validInstant(end) &&
    (note === null || (typeof note === 'string' && note.length > 0 &&
      note.length <= 2_000 && note.trim() === note &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note))) &&
    (start !== null || end !== null || note !== null) &&
    (start === null || end === null || Date.parse(end) >= Date.parse(start));
}
function parseStored(raw: string | null): StoredIntent | null {
  if (raw === null) return null;
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new MobileSessionStorageError(); }
  if (!isRecord(value) || Object.keys(value).length !== 3 ||
    value.schemaVersion !== 1 || !validUuid(value.idempotencyKey) ||
    !validRequest(value.request)) throw new MobileSessionStorageError();
  return value as StoredIntent;
}
async function currentIdentity(): Promise<Identity | null> {
  const stored = await readStoredMobileSession();
  if (stored.kind !== 'active') return null;
  const actor = isRecord(stored.metadata) && isRecord(stored.metadata.actor)
    ? stored.metadata.actor : null;
  const accountId = actor?.accountId;
  if (!validUuid(stored.sessionId) || !validUuid(accountId)) {
    throw new MobileSessionStorageError();
  }
  return { sessionId: stored.sessionId.toLowerCase(), accountId: accountId.toLowerCase() };
}
function keyFor(identity: Identity, operationId: string, assignmentId: string) {
  if (!validUuid(operationId) || !validUuid(assignmentId)) throw new MobileSessionStorageError();
  return `${ATTENDANCE_DRAFT_PENDING_PREFIX}${identity.sessionId}:${identity.accountId}:${operationId.toLowerCase()}:${assignmentId.toLowerCase()}`;
}
async function stillCurrent(identity: Identity) {
  const latest = await currentIdentity();
  return latest?.sessionId === identity.sessionId && latest.accountId === identity.accountId;
}
function safeStorageError(error: unknown): never {
  if (error instanceof MobileSessionStorageError) throw error;
  throw new MobileSessionStorageError();
}

export async function readPendingAttendanceDraft(operationId: string,
  assignmentId: string): Promise<PendingAttendanceDraft | null> {
  return locked(async () => {
    try {
      const identity = await currentIdentity();
      if (!identity) return null;
      const stored = parseStored(await AsyncStorage.getItem(keyFor(identity, operationId, assignmentId)));
      if (!(await stillCurrent(identity))) return null;
      return stored ? { idempotencyKey: stored.idempotencyKey, request: stored.request } : null;
    } catch (error) { return safeStorageError(error); }
  });
}

export async function reservePendingAttendanceDraft(operationId: string,
  assignmentId: string, request: SaveAttendanceDraftRequest): Promise<PendingAttendanceDraft> {
  // Snapshot the intent before the first asynchronous boundary. A form may be
  // edited while the session or AsyncStorage is being read.
  const frozenRequest = Object.freeze({ ...request });
  return locked(async () => {
    try {
      const identity = await currentIdentity();
      if (!identity || !validRequest(frozenRequest)) throw new MobileSessionStorageError();
      const key = keyFor(identity, operationId, assignmentId);
      const existing = parseStored(await AsyncStorage.getItem(key));
      if (existing) return { idempotencyKey: existing.idempotencyKey, request: existing.request };
      const stored: StoredIntent = { schemaVersion: 1,
        idempotencyKey: Crypto.randomUUID(), request: frozenRequest };
      await AsyncStorage.setItem(key, JSON.stringify(stored));
      if (!(await stillCurrent(identity))) {
        await AsyncStorage.removeItem(key);
        throw new MobileSessionStorageError();
      }
      return { idempotencyKey: stored.idempotencyKey, request: stored.request };
    } catch (error) { return safeStorageError(error); }
  });
}

export async function clearPendingAttendanceDraft(operationId: string,
  assignmentId: string, idempotencyKey: string): Promise<boolean> {
  return locked(async () => {
    try {
      const identity = await currentIdentity();
      if (!identity || !validUuid(idempotencyKey)) return false;
      const key = keyFor(identity, operationId, assignmentId);
      const existing = parseStored(await AsyncStorage.getItem(key));
      if (existing?.idempotencyKey !== idempotencyKey || !(await stillCurrent(identity))) return false;
      await AsyncStorage.removeItem(key);
      return true;
    } catch (error) { return safeStorageError(error); }
  });
}
