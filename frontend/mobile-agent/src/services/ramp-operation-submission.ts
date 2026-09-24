import type {
  RampOperationSubmissionResponse,
  SubmitRampOperationRequest,
} from '@elevant/api-client';
import { createMobileAgentApiClient } from '../config/elevant-api';
import {
  getOrCreateRampOperationSubmitCommandIfCurrent,
  readRampOperationSubmitCommandIfCurrent,
  removeRampOperationSubmitCommandIfCurrent,
} from '../storage/mobile-session';
import { getAssignedOperations } from './assigned-operations';
import {
  getMobileSessionRequestContext,
  MobileServiceError,
  rejectMobileSessionRequest,
} from './mobile-auth';
import { registerCurrentMobileDevice } from './mobile-device';
import { getRampOperationChecklist } from './ramp-operation-checklist';
import { loadRampIncidentCenter } from './ramp-incidents';
import { asMobileServiceError } from './mobile-service-error';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RampOperationPendingSubmission = Readonly<{
  idempotencyKey: string;
  request: SubmitRampOperationRequest;
}>;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value) &&
    value.toLowerCase() !== '00000000-0000-0000-0000-000000000000';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRequest(value: unknown): SubmitRampOperationRequest | null {
  if (!isRecord(value) || Object.keys(value).some(key => key !== 'agentNote')) return null;
  if (value.agentNote === undefined || value.agentNote === null) return {};
  if (typeof value.agentNote !== 'string' || value.agentNote.length > 2000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.agentNote)) return null;
  const note = value.agentNote.trim();
  return note ? { agentNote: note } : {};
}

async function confirmSession(sessionId: string) {
  const current = await getMobileSessionRequestContext();
  if (current.sessionId !== sessionId) throw new MobileServiceError('cancelled');
  return current;
}

export async function readRampOperationPendingSubmission(
  operationId: string,
): Promise<RampOperationPendingSubmission | null> {
  if (!isUuid(operationId)) throw new MobileServiceError('request_failed');
  const context = await getMobileSessionRequestContext();
  try {
    const stored = await readRampOperationSubmitCommandIfCurrent(
      context.sessionId, context.session.actor.accountId, operationId);
    if (stored.kind !== 'current') throw new MobileServiceError('cancelled');
    if (!stored.command) return null;
    let payload: unknown;
    try {
      payload = JSON.parse(stored.command.payload) as unknown;
    } catch {
      throw new MobileServiceError('storage_unavailable');
    }
    const request = parseRequest(payload);
    if (!request || !isUuid(stored.command.idempotencyKey)) {
      throw new MobileServiceError('storage_unavailable');
    }
    return { idempotencyKey: stored.command.idempotencyKey, request };
  } catch (error) {
    throw asMobileServiceError(error);
  }
}

async function assertCanonicalReadiness(operationId: string, signal?: AbortSignal) {
  const snapshot = await getAssignedOperations({ signal });
  const operation = snapshot.operations.find(item => item.operation.id === operationId);
  if (!operation) throw new MobileServiceError('not_found');
  if (snapshot.source !== 'network' || operation.operation.status !== 'InProgress' ||
      operation.services.length === 0 ||
      operation.services.some(service =>
        !['Completed', 'NotPerformed', 'Exception'].includes(service.status))) {
    throw new MobileServiceError('conflict');
  }
  const checklist = await getRampOperationChecklist(operationId, { signal });
  if (checklist.checklist.status !== 'Submitted') throw new MobileServiceError('conflict');

  // A local report must reach the server before closing the execution window.
  const incidents = await loadRampIncidentCenter(operationId, { signal });
  if (!incidents.online || incidents.issue || incidents.outbox.length > 0) {
    throw incidents.issue ?? new MobileServiceError('conflict');
  }
}

/** Reserves the full payload before POST; uncertain responses replay the exact key. */
export async function submitRampOperation(
  operationId: string,
  request: SubmitRampOperationRequest,
  options: { signal?: AbortSignal } = {},
): Promise<RampOperationSubmissionResponse> {
  if (!isUuid(operationId)) throw new MobileServiceError('request_failed');
  const validated = parseRequest(request);
  if (!validated) throw new MobileServiceError('request_failed');
  const context = await getMobileSessionRequestContext();
  const accountId = context.session.actor.accountId;
  let reservedKey: string | undefined;

  try {
    const pending = await readRampOperationSubmitCommandIfCurrent(
      context.sessionId, accountId, operationId);
    if (pending.kind !== 'current') throw new MobileServiceError('cancelled');
    if (!pending.command) {
      await assertCanonicalReadiness(operationId, options.signal);
      await confirmSession(context.sessionId);
    }

    const command = await getOrCreateRampOperationSubmitCommandIfCurrent(
      context.sessionId, accountId, operationId, JSON.stringify(validated));
    if (command.kind !== 'current') throw new MobileServiceError('cancelled');
    reservedKey = command.idempotencyKey;
    let payload: unknown;
    try {
      payload = JSON.parse(command.payload) as unknown;
    } catch {
      throw new MobileServiceError('storage_unavailable');
    }
    const frozen = parseRequest(payload);
    if (!frozen) throw new MobileServiceError('storage_unavailable');

    const device = await registerCurrentMobileDevice(
      { accessToken: context.accessToken }, options);
    const current = await confirmSession(context.sessionId);
    const response = await createMobileAgentApiClient({
      getAccessToken: () => current.accessToken,
    }).submitRampOperation(
      operationId,
      frozen,
      device.installationId,
      command.idempotencyKey,
      { signal: options.signal },
    );
    await confirmSession(context.sessionId);
    const removed = await removeRampOperationSubmitCommandIfCurrent(
      context.sessionId, accountId, operationId, command.idempotencyKey);
    if (removed === 'not-current') throw new MobileServiceError('cancelled');
    return response;
  } catch (error) {
    const issue = asMobileServiceError(error);
    if (isDeterministicRejection(issue) && reservedKey) {
      try {
        const removed = await removeRampOperationSubmitCommandIfCurrent(
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

function isDeterministicRejection(issue: MobileServiceError) {
  return issue.code === 'not_found' || issue.code === 'conflict' ||
    issue.status === 400 || issue.status === 413 || issue.status === 415;
}
