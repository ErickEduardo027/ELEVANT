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
  getMobileSessionRequestContext,
  rejectMobileSessionRequest,
  type MobileSessionRequestContext,
} from './mobile-auth';
import { registerCurrentMobileDevice } from './mobile-device';
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

async function normalizeFailure(error: unknown, context: MobileSessionRequestContext) {
  const normalized = asMobileServiceError(error);
  if (normalized.code === 'unauthenticated' || normalized.code === 'forbidden') {
    try {
      if (!(await rejectMobileSessionRequest(context.sessionId))) {
        return new MobileServiceError('cancelled');
      }
    }
    catch { /* Never replace the original authorization failure. */ }
  }
  return normalized;
}

export async function readRampAttendanceDraft(
  operationId: string, assignmentId: string, options: Options = {},
): Promise<AttendanceDraftSnapshotResponse> {
  const context = await getMobileSessionRequestContext();
  try {
    const { installationId } = await registerCurrentMobileDevice(
      { accessToken: context.accessToken }, options);
    if (!(await sameIdentity(context))) throw new MobileServiceError('cancelled');
    const snapshot = await createMobileAgentApiClient({
      getAccessToken: () => context.accessToken,
    }).getOperationAttendanceDraft(operationId, assignmentId,
      { signal: options.signal, installationId });
    if (!(await sameIdentity(context))) throw new MobileServiceError('cancelled');
    return snapshot;
  } catch (error) {
    throw await normalizeFailure(error, context);
  }
}

export async function saveRampAttendanceDraft(
  operationId: string, assignmentId: string, request: SaveAttendanceDraftRequest,
  options: Options = {},
): Promise<AttendanceDraftWriteResponse> {
  const context = await getMobileSessionRequestContext();
  try {
    const existing = await readPendingAttendanceDraft(operationId, assignmentId);
    if (existing && JSON.stringify(existing.request) !== JSON.stringify(request)) {
      throw new MobileServiceError('conflict', { retryable: false });
    }
    const pending = existing ?? await reservePendingAttendanceDraft(
      operationId, assignmentId, request);
    const { installationId } = await registerCurrentMobileDevice(
      { accessToken: context.accessToken }, options);
    if (!(await sameIdentity(context))) throw new MobileServiceError('cancelled');
    const receipt = await createMobileAgentApiClient({
      getAccessToken: () => context.accessToken,
    }).saveRampAttendanceDraft(operationId, assignmentId, pending.request,
      pending.idempotencyKey, installationId, { signal: options.signal });
    if (!(await sameIdentity(context))) throw new MobileServiceError('cancelled');
    const cleared = await clearPendingAttendanceDraft(
      operationId, assignmentId, pending.idempotencyKey);
    if (!cleared) throw new MobileServiceError('cancelled');
    return receipt;
  } catch (error) {
    throw await normalizeFailure(error, context);
  }
}
