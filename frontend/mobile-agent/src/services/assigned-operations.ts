import type {
  RampAssignedOperationResponse,
  RampAssignedOperationsResponse,
} from '@elevant/api-client';
import { createMobileAgentApiClient } from '../config/elevant-api';
import {
  assignedOperationsCacheKey,
  readAssignedOperationsCacheIfCurrent,
  removeAssignedOperationsCacheIfCurrent,
  writeAssignedOperationsCacheIfCurrent,
} from '../storage/mobile-session';
import {
  getMobileSessionRequestContext,
  MobileServiceError,
  rejectMobileSessionRequest,
  type MobileSessionRequestContext,
} from './mobile-auth';
import { asMobileServiceError } from './mobile-service-error';

const CACHE_SCHEMA_VERSION = 1 as const;
export const ASSIGNED_OPERATIONS_CACHE_MAX_AGE_MS = 15 * 60 * 1_000;
const CACHE_FUTURE_CLOCK_SKEW_MS = 60 * 1_000;
const MAX_ASSIGNED_OPERATIONS = 100;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AssignedOperationsSource = 'network' | 'cache';

export type AssignedOperationsSnapshot = Readonly<{
  operations: readonly RampAssignedOperationResponse[];
  source: AssignedOperationsSource;
  updatedAt: string;
}>;

export type GetAssignedOperationsOptions = Readonly<{
  signal?: AbortSignal;
}>;

type AssignedOperationsCache = Readonly<{
  schemaVersion: typeof CACHE_SCHEMA_VERSION;
  sessionId: string;
  accountId: string;
  updatedAt: string;
  response: RampAssignedOperationsResponse;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && hasOnlyKeys(value, keys);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    uuidPattern.test(value) &&
    value.toLowerCase() !== '00000000-0000-0000-0000-000000000000'
  );
}

function isDateOnly(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith('0000-')
  ) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  );
}

function isDateTimeOffset(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match =
    /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,7})?([zZ]|[+-](\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match || !isDateOnly(match[1])) return false;

  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (match[5]?.toLowerCase() !== 'z') {
    const offsetHour = Number(match[6]);
    const offsetMinute = Number(match[7]);
    if (
      offsetHour > 14 ||
      offsetMinute > 59 ||
      (offsetHour === 14 && offsetMinute !== 0)
    ) {
      return false;
    }
  }

  return !Number.isNaN(Date.parse(value));
}

function isInt32(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= -2_147_483_648 &&
    value <= 2_147_483_647
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOptionalNullable(
  value: unknown,
  predicate: (candidate: unknown) => boolean,
) {
  return value === undefined || value === null || predicate(value);
}

function isPosition(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['id', 'code', 'name']) &&
    isUuid(value.id) &&
    isString(value.code) &&
    isString(value.name)
  );
}

function isAssignment(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'id',
      'agentId',
      'position',
      'assignmentRole',
      'assignedAt',
    ]) &&
    isUuid(value.id) &&
    isUuid(value.agentId) &&
    isOptionalNullable(value.position, isPosition) &&
    isString(value.assignmentRole) &&
    isDateTimeOffset(value.assignedAt)
  );
}

function isGroundOperation(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'id',
      'status',
      'plannedStartAt',
      'plannedEndAt',
      'actualStartAt',
      'actualEndAt',
    ]) &&
    isUuid(value.id) &&
    isString(value.status) &&
    isOptionalNullable(value.plannedStartAt, isDateTimeOffset) &&
    isOptionalNullable(value.plannedEndAt, isDateTimeOffset) &&
    isOptionalNullable(value.actualStartAt, isDateTimeOffset) &&
    isOptionalNullable(value.actualEndAt, isDateTimeOffset)
  );
}

function isStation(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['id', 'code', 'name', 'ianaTimeZone']) &&
    isUuid(value.id) &&
    isString(value.code) &&
    isString(value.name) &&
    isString(value.ianaTimeZone)
  );
}

function isTerminal(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['id', 'code', 'name']) &&
    isUuid(value.id) &&
    isString(value.code) &&
    isString(value.name)
  );
}

function isStand(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['id', 'code', 'terminal']) &&
    isUuid(value.id) &&
    isString(value.code) &&
    isOptionalNullable(value.terminal, isTerminal)
  );
}

function isAirport(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['id', 'iataCode', 'icaoCode', 'name']) &&
    isUuid(value.id) &&
    isString(value.iataCode) &&
    isString(value.icaoCode) &&
    isString(value.name)
  );
}

function isFlightLeg(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'id',
      'flightNumber',
      'origin',
      'destination',
      'scheduledAt',
      'estimatedAt',
      'actualAt',
    ]) &&
    isUuid(value.id) &&
    isString(value.flightNumber) &&
    isAirport(value.origin) &&
    isAirport(value.destination) &&
    isDateTimeOffset(value.scheduledAt) &&
    isOptionalNullable(value.estimatedAt, isDateTimeOffset) &&
    isOptionalNullable(value.actualAt, isDateTimeOffset)
  );
}

function isAirline(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['id', 'iataCode', 'icaoCode', 'name']) &&
    isUuid(value.id) &&
    isString(value.iataCode) &&
    isString(value.icaoCode) &&
    isString(value.name)
  );
}

function isAircraft(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'id',
      'icaoCode',
      'iataCode',
      'manufacturer',
      'model',
      'registration',
    ]) &&
    isUuid(value.id) &&
    isString(value.icaoCode) &&
    isOptionalNullable(value.iataCode, isString) &&
    isString(value.manufacturer) &&
    isString(value.model) &&
    isOptionalNullable(value.registration, isString)
  );
}

function isTurnaround(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'id',
      'operationCode',
      'operationDate',
      'status',
      'station',
      'airline',
      'aircraft',
      'stand',
      'arrival',
      'departure',
    ]) &&
    isUuid(value.id) &&
    isString(value.operationCode) &&
    isDateOnly(value.operationDate) &&
    isString(value.status) &&
    isStation(value.station) &&
    isAirline(value.airline) &&
    isOptionalNullable(value.aircraft, isAircraft) &&
    isOptionalNullable(value.stand, isStand) &&
    isOptionalNullable(value.arrival, isFlightLeg) &&
    isOptionalNullable(value.departure, isFlightLeg)
  );
}

function isOperationService(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'id',
      'lineNumber',
      'serviceDefinitionId',
      'code',
      'name',
      'contractedQuantity',
      'executedQuantity',
      'billingUnit',
      'status',
    ]) &&
    isUuid(value.id) &&
    isInt32(value.lineNumber) &&
    isUuid(value.serviceDefinitionId) &&
    isString(value.code) &&
    isString(value.name) &&
    isFiniteNumber(value.contractedQuantity) &&
    isFiniteNumber(value.executedQuantity) &&
    isString(value.billingUnit) &&
    isString(value.status)
  );
}

function isAssignedOperation(
  value: unknown,
): value is RampAssignedOperationResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['assignment', 'operation', 'turnaround', 'services', 'review']) &&
    isAssignment(value.assignment) &&
    isGroundOperation(value.operation) &&
    isTurnaround(value.turnaround) &&
    Array.isArray(value.services) &&
    value.services.every(isOperationService) &&
    (value.review === undefined || value.review === null || (
      isRecord(value.review) &&
      hasOnlyKeys(value.review, ['submissionId', 'revisionNumber', 'status', 'returnReason']) &&
      isUuid(value.review.submissionId) &&
      isInt32(value.review.revisionNumber) &&
      value.review.revisionNumber > 0 &&
      ['PendingReview', 'InReview', 'Approved', 'Returned'].includes(String(value.review.status)) &&
      (value.review.returnReason === undefined || value.review.returnReason === null ||
        (isString(value.review.returnReason) && value.review.returnReason.length >= 8 &&
          value.review.returnReason.length <= 2000)) &&
      (value.review.status !== 'Returned' || isString(value.review.returnReason))
    ))
  );
}

function isAssignedOperationsResponse(
  value: unknown,
): value is RampAssignedOperationsResponse {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['operations']) &&
    Array.isArray(value.operations) &&
    value.operations.length <= MAX_ASSIGNED_OPERATIONS &&
    value.operations.every(isAssignedOperation)
  );
}

function isCacheForSession(
  value: unknown,
  context: MobileSessionRequestContext,
): value is AssignedOperationsCache {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schemaVersion',
      'sessionId',
      'accountId',
      'updatedAt',
      'response',
    ]) ||
    value.schemaVersion !== CACHE_SCHEMA_VERSION ||
    value.sessionId !== context.sessionId ||
    value.accountId !== context.session.actor.accountId ||
    !isDateTimeOffset(value.updatedAt) ||
    !isAssignedOperationsResponse(value.response)
  ) {
    return false;
  }

  const updatedAt = Date.parse(value.updatedAt);
  const now = Date.now();
  if (
    updatedAt > now + CACHE_FUTURE_CLOCK_SKEW_MS ||
    now - updatedAt > ASSIGNED_OPERATIONS_CACHE_MAX_AGE_MS
  ) {
    return false;
  }

  const allowedStations = new Set(
    context.session.actor.stationScopes.map((scope) => scope.stationId),
  );
  return value.response.operations.every((item) =>
    allowedStations.has(item.turnaround.station.id),
  );
}

function snapshot(
  cache: AssignedOperationsCache,
  source: AssignedOperationsSource,
): AssignedOperationsSnapshot {
  return {
    operations: cache.response.operations,
    source,
    updatedAt: cache.updatedAt,
  };
}

async function removeInvalidCache(
  context: MobileSessionRequestContext,
  key: string,
  raw: string,
  retryChangedCache: boolean,
): Promise<AssignedOperationsCache | null> {
  const removal = await removeAssignedOperationsCacheIfCurrent(
    context.sessionId,
    key,
    raw,
  );
  if (removal === 'not-current') throw new MobileServiceError('cancelled');
  if (removal === 'changed' && retryChangedCache) {
    return readCache(context, false);
  }
  return null;
}

async function readCache(
  context: MobileSessionRequestContext,
  retryChangedCache = true,
): Promise<AssignedOperationsCache | null> {
  const key = assignedOperationsCacheKey(context.session.actor.accountId);
  const stored = await readAssignedOperationsCacheIfCurrent(
    context.sessionId,
    key,
  );
  if (stored.kind === 'not-current') {
    throw new MobileServiceError('cancelled');
  }
  const raw = stored.value;
  if (!raw) return null;

  let candidate: unknown;
  try {
    candidate = JSON.parse(raw) as unknown;
  } catch {
    return removeInvalidCache(context, key, raw, retryChangedCache);
  }

  if (!isCacheForSession(candidate, context)) {
    return removeInvalidCache(context, key, raw, retryChangedCache);
  }
  return candidate;
}

async function cacheResponse(
  context: MobileSessionRequestContext,
  response: RampAssignedOperationsResponse,
  updatedAt: string,
) {
  const cache: AssignedOperationsCache = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    sessionId: context.sessionId,
    accountId: context.session.actor.accountId,
    updatedAt,
    response,
  };

  if (!isCacheForSession(cache, context)) {
    throw new MobileServiceError('malformed_response');
  }

  try {
    const result = await writeAssignedOperationsCacheIfCurrent(
      context.sessionId,
      assignedOperationsCacheKey(context.session.actor.accountId),
      JSON.stringify(cache),
    );
    if (result === 'not-current') throw new MobileServiceError('cancelled');
    // A cache-only write failure does not hide the canonical network response.
    // Session validation failures still escape as storage errors above.
  } catch (error) {
    throw asMobileServiceError(error);
  }

  return cache;
}

export async function getAssignedOperations(
  options: GetAssignedOperationsOptions = {},
): Promise<AssignedOperationsSnapshot> {
  const context = await getMobileSessionRequestContext();

  try {
    const response = await createMobileAgentApiClient({
      getAccessToken: () => context.accessToken,
    }).getRampAssignedOperations({ signal: options.signal });
    const confirmedContext = await getMobileSessionRequestContext();
    if (confirmedContext.sessionId !== context.sessionId) {
      throw new MobileServiceError('cancelled');
    }

    const updatedAt = new Date().toISOString();
    const cache = await cacheResponse(
      confirmedContext,
      response,
      updatedAt,
    );
    return snapshot(cache, 'network');
  } catch (error) {
    const normalized = asMobileServiceError(error);
    if (
      normalized.code === 'unauthenticated' ||
      normalized.code === 'forbidden'
    ) {
      const cleared = await rejectMobileSessionRequest(context.sessionId);
      if (!cleared) throw new MobileServiceError('cancelled');
      throw normalized;
    }
    if (
      normalized.code !== 'network_unavailable' &&
      normalized.code !== 'request_timeout'
    ) {
      throw normalized;
    }

    const confirmedContext = await getMobileSessionRequestContext();
    if (confirmedContext.sessionId !== context.sessionId) {
      throw new MobileServiceError('cancelled');
    }
    const cached = await readCache(confirmedContext);
    if (cached) return snapshot(cached, 'cache');
    throw normalized;
  }
}

export async function getCachedAssignedOperations(): Promise<AssignedOperationsSnapshot | null> {
  try {
    const context = await getMobileSessionRequestContext();
    const cache = await readCache(context);
    return cache ? snapshot(cache, 'cache') : null;
  } catch (error) {
    const normalized = asMobileServiceError(error);
    if (
      normalized.code === 'unauthenticated' ||
      normalized.code === 'session_expired'
    ) {
      return null;
    }
    throw normalized;
  }
}

export async function getAssignedOperation(
  operationId: string,
): Promise<RampAssignedOperationResponse | undefined> {
  if (!isUuid(operationId)) return undefined;
  const cached = await getCachedAssignedOperations();
  return cached?.operations.find((item) => item.operation.id === operationId);
}
