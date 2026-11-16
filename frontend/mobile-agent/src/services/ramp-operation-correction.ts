import type { RampOperationCorrectionResponse } from '@elevant/api-client';
import { createMobileAgentApiClient } from '../config/elevant-api';
import {
  getOrCreateRampCorrectionCommandIfCurrent,
  readRampCorrectionCommandIfCurrent,
  removeRampCorrectionCommandIfCurrent,
} from '../storage/mobile-session';
import { getAssignedOperations } from './assigned-operations';
import {
  getMobileSessionRequestContext,
  MobileServiceError,
  rejectMobileSessionRequest,
} from './mobile-auth';
import { registerCurrentMobileDevice } from './mobile-device';
import { asMobileServiceError } from './mobile-service-error';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value) &&
    value.toLowerCase() !== '00000000-0000-0000-0000-000000000000';
}

export async function readPendingRampCorrection(operationId: string) {
  if (!isUuid(operationId)) throw new MobileServiceError('request_failed');
  const context = await getMobileSessionRequestContext();
  try {
    const stored = await readRampCorrectionCommandIfCurrent(
      context.sessionId, context.session.actor.accountId, operationId);
    if (stored.kind !== 'current') throw new MobileServiceError('cancelled');
    return stored.command !== null;
  } catch (error) {
    throw asMobileServiceError(error);
  }
}

/** An uncertain response replays the same reserved command and never opens a second revision. */
export async function reopenRampOperationCorrection(
  operationId: string, options: { signal?: AbortSignal } = {},
): Promise<RampOperationCorrectionResponse> {
  if (!isUuid(operationId)) throw new MobileServiceError('request_failed');
  const context = await getMobileSessionRequestContext();
  const accountId = context.session.actor.accountId;
  let reservedKey: string | undefined;
  try {
    const pending = await readRampCorrectionCommandIfCurrent(
      context.sessionId, accountId, operationId);
    if (pending.kind !== 'current') throw new MobileServiceError('cancelled');
    if (!pending.command) {
      const snapshot = await getAssignedOperations({ signal: options.signal });
      const operation = snapshot.operations.find(item => item.operation.id === operationId);
      if (!operation) throw new MobileServiceError('not_found');
      if (snapshot.source !== 'network' || operation.operation.status !== 'Returned' ||
          operation.review?.status !== 'Returned' ||
          !operation.review.returnReason)
        throw new MobileServiceError('conflict');
      const current = await getMobileSessionRequestContext();
      if (current.sessionId !== context.sessionId) throw new MobileServiceError('cancelled');
    }

    const command = await getOrCreateRampCorrectionCommandIfCurrent(
      context.sessionId, accountId, operationId);
    if (command.kind !== 'current') throw new MobileServiceError('cancelled');
    reservedKey = command.idempotencyKey;
    const device = await registerCurrentMobileDevice(
      { accessToken: context.accessToken }, options);
    const current = await getMobileSessionRequestContext();
    if (current.sessionId !== context.sessionId) throw new MobileServiceError('cancelled');
    const result = await createMobileAgentApiClient({
      getAccessToken: () => current.accessToken,
    }).reopenRampOperationCorrection(
      operationId, device.installationId, command.idempotencyKey,
      { signal: options.signal });
    const final = await getMobileSessionRequestContext();
    if (final.sessionId !== context.sessionId) throw new MobileServiceError('cancelled');
    const removed = await removeRampCorrectionCommandIfCurrent(
      context.sessionId, accountId, operationId, command.idempotencyKey);
    if (removed === 'not-current') throw new MobileServiceError('cancelled');
    return result;
  } catch (error) {
    const issue = asMobileServiceError(error);
    if (reservedKey && (issue.code === 'not_found' || issue.code === 'conflict' ||
        issue.status === 400 || issue.status === 413 || issue.status === 415)) {
      try {
        const removed = await removeRampCorrectionCommandIfCurrent(
          context.sessionId, accountId, operationId, reservedKey);
        if (removed === 'not-current') throw new MobileServiceError('cancelled');
      } catch (storageError) {
        throw asMobileServiceError(storageError);
      }
    }
    if (issue.code === 'unauthenticated' || issue.code === 'forbidden') {
      const cleared = await rejectMobileSessionRequest(context.sessionId);
      if (!cleared) throw new MobileServiceError('cancelled');
    }
    throw issue;
  }
}
