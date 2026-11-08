import type {
  RampOperationServiceExecutionResponse as ApiRampOperationServiceExecutionResponse,
  RampOperationServiceTransitionResponse as ApiRampOperationServiceTransitionResponse,
  TransitionRampOperationServiceOptions,
  TransitionRampOperationServiceRequest as ApiTransitionRampOperationServiceRequest,
} from '@elevant/api-client';
import { serverNow } from '../synchronization/server-clock';
import { sendFlightReportCommand } from './flight-report';
import { MobileServiceError } from './mobile-service-error';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maximumExecutedQuantityExclusive = 100_000_000_000_000;

export type RampOperationServiceTargetStatus =
  | 'InProgress'
  | 'Completed'
  | 'NotPerformed'
  | 'Exception';

/** What a screen asks for; the queue adds the tapped time (3-I). */
export type TransitionRampOperationServiceRequest = Readonly<Omit<
  ApiTransitionRampOperationServiceRequest,
  'targetStatus' | 'executedQuantity' | 'note' | 'occurredAt'
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
  /** Kept for the screens' request lifecycle; a transition saved on the device is never cancelled by leaving. */
  signal?: AbortSignal;
  /** Display only: how «Sincronización» names the service and in which time zone it shows the tapped time. */
  serviceName?: string;
  timeZone?: string;
}>;

export type RampServicePendingTransition = Readonly<{
  idempotencyKey: string;
  request: TransitionRampOperationServiceRequest;
}>;

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

/**
 * What happened to a service transition (3-I): ELEVANT confirmed it, or it is saved on the device with the tapped time
 * and goes out on its own, after the operation's earlier commands. A refusal is thrown with its Problem Details code
 * and leaves the queue, because the agent saw it on this screen.
 */
export type RampServiceTransitionOutcome =
  | Readonly<{ state: 'confirmed'; response: RampOperationServiceTransitionResponse }>
  | Readonly<{ state: 'queued'; issue?: MobileServiceError }>;

/**
 * Starts, completes, marks not performed or as an exception one service. The tap is stamped with ELEVANT's clock
 * (3-N18) and saved in the device's queue before anything is sent (3-I): the server keeps that time, so a transition
 * sent from the queue minutes later still measures the service.
 */
export async function transitionRampOperationService(
  operationId: string,
  serviceId: string,
  request: TransitionRampOperationServiceRequest,
  options: RampServiceTransitionOptions = {},
): Promise<RampServiceTransitionOutcome> {
  if (!isUuid(operationId) || !isUuid(serviceId)) {
    throw new MobileServiceError('request_failed');
  }
  const validatedRequest = parseRequest(request);
  if (!validatedRequest) throw new MobileServiceError('request_failed');
  const sent = await sendFlightReportCommand({
    kind: 'serviceTransition',
    operationId: operationId.toLowerCase(),
    serviceId: serviceId.toLowerCase(),
    targetStatus: validatedRequest.targetStatus,
    executedQuantity: validatedRequest.executedQuantity ?? null,
    note: validatedRequest.note ?? null,
    occurredAt: serverNow().toISOString(),
    ...(options.serviceName ? { serviceName: options.serviceName } : {}),
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  }, { discardRefused: true });
  if (sent.state === 'queued') return { state: 'queued', ...(sent.issue ? { issue: sent.issue } : {}) };
  return { state: 'confirmed', response: parseResponse(sent.result, serviceId, validatedRequest.targetStatus) };
}
