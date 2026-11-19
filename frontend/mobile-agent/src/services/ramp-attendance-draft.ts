import type {
  AttendanceDraftSnapshotResponse,
  AttendanceDraftWriteResponse,
  SaveAttendanceDraftRequest,
} from '@elevant/api-client';
import { createMobileAgentApiClient } from '../config/elevant-api';
import {
  clearPendingAttendanceDraft,
  readPendingAttendanceDraft,
  reservePendingAttendanceDraft,
} from '../storage/attendance-draft';
import {
  getMobileSessionIdentity,
  getMobileSessionRequestContext,
  rejectMobileSessionRequest,
  type MobileSessionRequestContext,
} from './mobile-auth';
import {
  forgetConfirmedMobileDevice,
  hasConfirmedMobileDevice,
  registerCurrentMobileDevice,
} from './mobile-device';
import { asMobileServiceError, MobileServiceError } from './mobile-service-error';

type Options = Readonly<{ signal?: AbortSignal }>;

async function sameIdentity(context: MobileSessionRequestContext) {
  try {
    const latest = await getMobileSessionRequestContext();
    return latest.sessionId === context.sessionId &&
      latest.session.actor.accountId === context.session.actor.accountId;
  } catch {
    return false;
  }
}

/**
 * The failure a request ends with. ELEVANT's refusal of the credential goes to the session first: 'retry' when the
 * same session holds a renewed credential (S3). A renewal that cannot finish now is the failure, so the screen says why
 * instead of signing the agent out; a storage failure never replaces the original authorization failure.
 */
async function normalizeFailure(
  error: unknown, context: MobileSessionRequestContext, retried: boolean,
): Promise<MobileServiceError | 'retry'> {
  const normalized = asMobileServiceError(error);
  if (normalized.code === 'unauthenticated' || normalized.code === 'forbidden') {
    try {
      const rejected = await rejectMobileSessionRequest(context, normalized);
      if (rejected === 'retry' && !retried) return 'retry';
      if (!rejected) return new MobileServiceError('cancelled');
    } catch (failure) {
      const renewal = asMobileServiceError(failure);
      if (renewal.code !== 'storage_unavailable') return renewal;
    }
  }
  return normalized;
}

export function readRampAttendanceDraft(
  operationId: string, assignmentId: string, options: Options = {},
): Promise<AttendanceDraftSnapshotResponse> {
  return readAttendanceDraft(operationId, assignmentId, options, false);
}

async function readAttendanceDraft(
  operationId: string, assignmentId: string, options: Options, retried: boolean,
): Promise<AttendanceDraftSnapshotResponse> {
  const context = await getMobileSessionRequestContext();
  try {
    const reused = hasConfirmedMobileDevice(context.sessionId);
    try {
      return await readWithDevice(operationId, assignmentId, context, options, true);
    } catch (error) {
      // «Liberar» in OCC closes the binding the session confirmed and keeps the session (ADR-0046), so ELEVANT refuses
      // the read (403). The read registers the tablet again, as a write does, and reads once more: only a refusal after
      // a new registration goes to the session. A session that ended meanwhile never binds the tablet again.
      if (!reused || asMobileServiceError(error).code !== 'forbidden') throw error;
      if (!(await sameIdentity(context))) throw new MobileServiceError('cancelled');
      forgetConfirmedMobileDevice();
      return await readWithDevice(operationId, assignmentId, context, options, false);
    }
  } catch (error) {
    const failure = await normalizeFailure(error, context, retried);
    if (failure === 'retry') return readAttendanceDraft(operationId, assignmentId, options, true);
    throw failure;
  }
}

/** One read with the tablet registered: the registration the session confirmed (`reuseForSession`) or a new one. */
async function readWithDevice(
  operationId: string, assignmentId: string, context: MobileSessionRequestContext, options: Options,
  reuseForSession: boolean,
): Promise<AttendanceDraftSnapshotResponse> {
  const { installationId } = await registerCurrentMobileDevice(
    context, { signal: options.signal, reuseForSession });
  if (!(await sameIdentity(context))) throw new MobileServiceError('cancelled');
  const snapshot = await createMobileAgentApiClient({
    getAccessToken: () => context.accessToken,
  }).getOperationAttendanceDraft(operationId, assignmentId,
    { signal: options.signal, installationId });
  if (!(await sameIdentity(context))) throw new MobileServiceError('cancelled');
  return snapshot;
}

export function saveRampAttendanceDraft(
  operationId: string, assignmentId: string, request: SaveAttendanceDraftRequest,
  options: Options = {},
): Promise<AttendanceDraftWriteResponse> {
  return saveAttendanceDraft(operationId, assignmentId, request, options, false);
}

async function saveAttendanceDraft(
  operationId: string, assignmentId: string, request: SaveAttendanceDraftRequest,
  options: Options, retried: boolean,
): Promise<AttendanceDraftWriteResponse> {
  // The observation is reserved on the device with the session's identity only: neither signal nor a renewal of the
  // access token is needed to keep it (S3).
  const identity = await getMobileSessionIdentity();
  let context: MobileSessionRequestContext | undefined;
  try {
    const existing = await readPendingAttendanceDraft(operationId, assignmentId);
    if (existing && JSON.stringify(existing.request) !== JSON.stringify(request)) {
      throw new MobileServiceError('conflict', { retryable: false });
    }
    const pending = existing ?? await reservePendingAttendanceDraft(
      operationId, assignmentId, request);
    context = await getMobileSessionRequestContext();
    if (context.sessionId !== identity.sessionId) throw new MobileServiceError('cancelled');
    const { installationId } = await registerCurrentMobileDevice(context, options);
    if (!(await sameIdentity(context))) throw new MobileServiceError('cancelled');
    const sending = context;
    const receipt = await createMobileAgentApiClient({
      getAccessToken: () => sending.accessToken,
    }).saveRampAttendanceDraft(operationId, assignmentId, pending.request,
      pending.idempotencyKey, installationId, { signal: options.signal });
    if (!(await sameIdentity(context))) throw new MobileServiceError('cancelled');
    const cleared = await clearPendingAttendanceDraft(
      operationId, assignmentId, pending.idempotencyKey);
    if (!cleared) throw new MobileServiceError('cancelled');
    return receipt;
  } catch (error) {
    if (!context) throw asMobileServiceError(error);
    const failure = await normalizeFailure(error, context, retried);
    if (failure === 'retry') return saveAttendanceDraft(operationId, assignmentId, request, options, true);
    throw failure;
  }
}
