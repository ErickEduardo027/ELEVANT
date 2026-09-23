import type {
  RampOperationServiceExecutionResponse as ApiRampOperationServiceExecutionResponse,
  RampOperationServiceTransitionResponse as ApiRampOperationServiceTransitionResponse,
  TransitionRampOperationServiceOptions,
  TransitionRampOperationServiceRequest as ApiTransitionRampOperationServiceRequest,
} from '@elevant/api-client';
import { createMobileAgentApiClient } from '../config/elevant-api';
import {
  getOrCreateRampServiceTransitionCommandIfCurrent,
  readRampServiceTransitionCommandIfCurrent,
  removeRampServiceTransitionCommandIfCurrent,
} from '../storage/mobile-session';
import {
  getMobileSessionRequestContext,
  MobileServiceError,
  rejectMobileSessionRequest,
} from './mobile-auth';
import { registerCurrentMobileDevice } from './mobile-device';
import { asMobileServiceError } from './mobile-service-error';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maximumExecutedQuantityExclusive = 100_000_000_000_000;

export type RampOperationServiceTargetStatus =
  | 'InProgress'
  | 'Completed'
  | 'NotPerformed'
  | 'Exception';

export type TransitionRampOperationServiceRequest = Readonly<Omit<
  ApiTransitionRampOperationServiceRequest,
  'targetStatus' | 'executedQuantity' | 'note'
> & {
  targetStatus: RampOperationServiceTargetStatus;
  executedQuantity?: number;
  note?: string;
}>;

export type RampOperationServiceExecutionResponse = Readonly<Omit<
  ApiRampOperationServiceExecutionResponse,
  'status'
> & {
  status: RampOperationServiceTargetStatus;
}>;

export type RampOperationServiceTransitionResponse = Readonly<Omit<
  ApiRampOperationServiceTransitionResponse,
  'service'
> & {
  service: RampOperationServiceExecutionResponse;
}>;

export type RampServiceTransitionOptions = Readonly<Omit<
  TransitionRampOperationServiceOptions,
  'signal'
> & {
  signal?: AbortSignal;
}>;

export type RampServicePendingTransition = Readonly<{
  idempotencyKey: string;
  request: TransitionRampOperationServiceRequest;
}>;

function apiClient(accessToken: string) {
  return createMobileAgentApiClient({
    getAccessToken: () => accessToken,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    uuidPattern.test(value) &&
    value.toLowerCase() !== '00000000-0000-0000-0000-000000000000'
  );
}

function isTargetStatus(value: unknown): value is RampOperationServiceTargetStatus {
  return (
    value === 'InProgress' ||
    value === 'Completed' ||
    value === 'NotPerformed' ||
    value === 'Exception'
  );
}

function isSafeNote(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 1_000 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  );
}

function hasSupportedQuantity(value: unknown): value is number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value >= maximumExecutedQuantityExclusive
  ) {
    return false;
  }
  const scaled = value * 10_000;
  return Math.abs(scaled - Math.round(scaled)) < 0.000_001;
}

function parseRequest(value: unknown): TransitionRampOperationServiceRequest | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['targetStatus', 'executedQuantity', 'note']) ||
    !isTargetStatus(value.targetStatus) ||
    (value.executedQuantity !== undefined && !hasSupportedQuantity(value.executedQuantity)) ||
    (value.note !== undefined && !isSafeNote(value.note))
  ) {
    return undefined;
  }
  if (value.targetStatus === 'InProgress' && value.executedQuantity !== undefined) {
    return undefined;
  }
  if (
    value.targetStatus !== 'InProgress' &&
    !hasSupportedQuantity(value.executedQuantity)
  ) {
    return undefined;
  }
  if (
    value.targetStatus === 'NotPerformed' &&
    (value.executedQuantity !== 0 || !isSafeNote(value.note))
  ) {
    return undefined;
  }
  if (value.targetStatus === 'Exception' && !isSafeNote(value.note)) {
    return undefined;
  }
  return {
    targetStatus: value.targetStatus,
    ...(typeof value.executedQuantity === 'number'
      ? { executedQuantity: value.executedQuantity }
      : {}),
    ...(typeof value.note === 'string' ? { note: value.note } : {}),
  };
}

function parseResponse(
  value: unknown,
  expectedServiceId: string,
  expectedStatus: RampOperationServiceTargetStatus,
): RampOperationServiceTransitionResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['receiptId', 'service']) ||
    !isUuid(value.receiptId) ||
    !isRecord(value.service) ||
    !hasOnlyKeys(value.service, [
      'id',
      'status',
      'contractedQuantity',
      'executedQuantity',
      'billingUnit',
    ]) ||
    !isUuid(value.service.id) ||
    value.service.id.toLowerCase() !== expectedServiceId.toLowerCase() ||
    typeof value.service.status !== 'string' ||
    value.service.status !== expectedStatus ||
    typeof value.service.contractedQuantity !== 'number' ||
    !Number.isFinite(value.service.contractedQuantity) ||
    value.service.contractedQuantity < 0 ||
    typeof value.service.executedQuantity !== 'number' ||
    !Number.isFinite(value.service.executedQuantity) ||
    value.service.executedQuantity < 0 ||
    typeof value.service.billingUnit !== 'string' ||
    value.service.billingUnit.trim().length === 0
  ) {
    throw new MobileServiceError('malformed_response');
  }
  return {
    receiptId: value.receiptId.toLowerCase(),
    service: {
      id: value.service.id.toLowerCase(),
      status: value.service.status,
      contractedQuantity: value.service.contractedQuantity,
      executedQuantity: value.service.executedQuantity,
      billingUnit: value.service.billingUnit,
    },
  };
}

async function confirmSameSession(sessionId: string) {
  const confirmed = await getMobileSessionRequestContext();
  if (confirmed.sessionId !== sessionId) {
    throw new MobileServiceError('cancelled');
  }
  return confirmed;
}

export async function readRampOperationServicePendingTransition(
  operationId: string,
  serviceId: string,
  targetStatus: RampOperationServiceTargetStatus,
): Promise<RampServicePendingTransition | null> {
  if (!isUuid(operationId) || !isUuid(serviceId)) {
    throw new MobileServiceError('request_failed');
  }
  const context = await getMobileSessionRequestContext();
  try {
    const result = await readRampServiceTransitionCommandIfCurrent(
      context.sessionId,
      context.session.actor.accountId,
      operationId,
      serviceId,
      targetStatus,
    );
    if (result.kind !== 'current') throw new MobileServiceError('cancelled');
    if (!result.command) return null;
    const request = parseRequest(JSON.parse(result.command.payload) as unknown);
    if (!request || request.targetStatus !== targetStatus) {
      throw new MobileServiceError('storage_unavailable');
    }
    return { idempotencyKey: result.command.idempotencyKey, request };
  } catch (error) {
    throw asMobileServiceError(error);
  }
}

export async function transitionRampOperationService(
  operationId: string,
  serviceId: string,
  request: TransitionRampOperationServiceRequest,
  options: RampServiceTransitionOptions = {},
): Promise<RampOperationServiceTransitionResponse> {
  if (!isUuid(operationId) || !isUuid(serviceId)) {
    throw new MobileServiceError('request_failed');
  }
  const validatedRequest = parseRequest(request);
  if (!validatedRequest) throw new MobileServiceError('request_failed');
  const context = await getMobileSessionRequestContext();
  let reservedIdempotencyKey: string | undefined;

  try {
    const command = await getOrCreateRampServiceTransitionCommandIfCurrent(
      context.sessionId,
      context.session.actor.accountId,
      operationId,
      serviceId,
      validatedRequest.targetStatus,
      JSON.stringify(validatedRequest),
    );
    if (command.kind !== 'current') throw new MobileServiceError('cancelled');
    reservedIdempotencyKey = command.idempotencyKey;
    const frozenRequest = parseRequest(JSON.parse(command.payload) as unknown);
    if (!frozenRequest || frozenRequest.targetStatus !== validatedRequest.targetStatus) {
      throw new MobileServiceError('storage_unavailable');
    }

    const device = await registerCurrentMobileDevice(
      { accessToken: context.accessToken },
      options,
    );
    const confirmed = await confirmSameSession(context.sessionId);
    const value = await apiClient(confirmed.accessToken).transitionRampOperationService(
      operationId,
      serviceId,
      frozenRequest,
      device.installationId,
      command.idempotencyKey,
      { signal: options.signal },
    );
    await confirmSameSession(context.sessionId);
    const response = parseResponse(value, serviceId, frozenRequest.targetStatus);
    const commandRemoved = await removeRampServiceTransitionCommandIfCurrent(
      context.sessionId,
      context.session.actor.accountId,
      operationId,
      serviceId,
      frozenRequest.targetStatus,
      command.idempotencyKey,
    );
    if (commandRemoved === 'not-current') {
      throw new MobileServiceError('cancelled');
    }
    return response;
  } catch (error) {
    const normalized = asMobileServiceError(error);
    if (isDeterministicWriteRejection(normalized) && reservedIdempotencyKey) {
      try {
        const removed = await removeRampServiceTransitionCommandIfCurrent(
          context.sessionId,
          context.session.actor.accountId,
          operationId,
          serviceId,
          validatedRequest.targetStatus,
          reservedIdempotencyKey,
        );
        if (removed === 'not-current') throw new MobileServiceError('cancelled');
      } catch (removalError) {
        throw asMobileServiceError(removalError);
      }
    }
    if (
      normalized.code === 'unauthenticated' ||
      normalized.code === 'forbidden'
    ) {
      const cleared = await rejectMobileSessionRequest(context.sessionId);
      if (!cleared) throw new MobileServiceError('cancelled');
    }
    throw normalized;
  }
}

function isDeterministicWriteRejection(error: MobileServiceError) {
  return (
    error.code === 'not_found' ||
    error.code === 'conflict' ||
    error.status === 400 ||
    error.status === 413 ||
    error.status === 415
  );
}
