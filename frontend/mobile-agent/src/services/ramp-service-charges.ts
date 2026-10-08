import type {
  RampOperationChargesResponse,
  RampServiceChargesResponse,
} from '@elevant/api-client';
import { createMobileAgentApiClient } from '../config/elevant-api';
import {
  getOrCreateRampServiceChargeCommandIfCurrent,
  readRampOperationChargesCacheIfCurrent,
  removeRampServiceChargeCommandIfCurrent,
  writeRampOperationChargesCacheIfCurrent,
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

export type RampServiceChargeAction = 'Apply' | 'Remove';

export type RampOperationCharges = Readonly<{
  charges: RampOperationChargesResponse;
  /** True when the server could not be reached and the last saved copy is shown. */
  fromCache: boolean;
}>;

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    uuidPattern.test(value) &&
    value.toLowerCase() !== '00000000-0000-0000-0000-000000000000'
  );
}

function apiClient(accessToken: string) {
  return createMobileAgentApiClient({ getAccessToken: () => accessToken });
}

function parseCached(value: string | null, operationId: string): RampOperationChargesResponse | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as RampOperationChargesResponse;
    return parsed?.operationId?.toLowerCase() === operationId.toLowerCase() &&
      Array.isArray(parsed.services)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

async function confirmSameSession(sessionId: string) {
  const confirmed = await getMobileSessionRequestContext();
  if (confirmed.sessionId !== sessionId) throw new MobileServiceError('cancelled');
  return confirmed;
}

/**
 * Charge types the agent may mark on each service and the marks already applied.
 * The list carries no prices; the server values charges for Finance. When the
 * network fails the last saved copy is returned, flagged as cached.
 */
export async function getRampOperationCharges(
  operationId: string,
  options: { signal?: AbortSignal } = {},
): Promise<RampOperationCharges> {
  if (!isUuid(operationId)) throw new MobileServiceError('request_failed');
  const context = await getMobileSessionRequestContext();
  const accountId = context.session.actor.accountId;
  try {
    const charges = await apiClient(context.accessToken).getRampOperationCharges(
      operationId,
      { signal: options.signal },
    );
    await confirmSameSession(context.sessionId);
    await writeRampOperationChargesCacheIfCurrent(
      context.sessionId, accountId, operationId, JSON.stringify(charges),
    ).catch(() => undefined);
    return { charges, fromCache: false };
  } catch (error) {
    const normalized = asMobileServiceError(error);
    if (normalized.code === 'unauthenticated' || normalized.code === 'forbidden') {
      const cleared = await rejectMobileSessionRequest(context.sessionId);
      if (!cleared) throw new MobileServiceError('cancelled');
      throw normalized;
    }
    if (normalized.code !== 'network_unavailable' && normalized.code !== 'request_timeout') throw normalized;
    const cached = await readRampOperationChargesCacheIfCurrent(
      context.sessionId, accountId, operationId,
    ).catch(() => null);
    const value = cached && cached.kind === 'current' ? parseCached(cached.value, operationId) : null;
    if (!value) throw normalized;
    return { charges: value, fromCache: true };
  }
}

/**
 * Marks or unmarks one charge. The idempotency key is reserved per service,
 * charge and action before sending, so retrying after a lost response replays
 * the same command instead of adding a second mark.
 */
export async function changeRampServiceCharge(
  operationId: string,
  serviceId: string,
  chargeId: string,
  action: RampServiceChargeAction,
  options: { signal?: AbortSignal } = {},
): Promise<RampServiceChargesResponse> {
  if (!isUuid(operationId) || !isUuid(serviceId) || !isUuid(chargeId) ||
    (action !== 'Apply' && action !== 'Remove')) {
    throw new MobileServiceError('request_failed');
  }
  const context = await getMobileSessionRequestContext();
  const accountId = context.session.actor.accountId;
  const payload = JSON.stringify({ chargeId: chargeId.toLowerCase(), action });
  let reservedKey: string | undefined;
  try {
    const command = await getOrCreateRampServiceChargeCommandIfCurrent(
      context.sessionId, accountId, operationId, serviceId, chargeId, action, payload,
    );
    if (command.kind !== 'current') throw new MobileServiceError('cancelled');
    reservedKey = command.idempotencyKey;
    const device = await registerCurrentMobileDevice({ accessToken: context.accessToken }, options);
    const confirmed = await confirmSameSession(context.sessionId);
    const response = await apiClient(confirmed.accessToken).applyRampServiceCharge(
      operationId,
      serviceId,
      { chargeId: chargeId.toLowerCase(), action },
      device.installationId,
      command.idempotencyKey,
      { signal: options.signal },
    );
    await confirmSameSession(context.sessionId);
    const removed = await removeRampServiceChargeCommandIfCurrent(
      context.sessionId, accountId, operationId, serviceId, chargeId, action, command.idempotencyKey,
    );
    if (removed === 'not-current') throw new MobileServiceError('cancelled');
    return response.service;
  } catch (error) {
    const normalized = asMobileServiceError(error);
    if (reservedKey && (normalized.code === 'not_found' || normalized.code === 'conflict' ||
      normalized.status === 400)) {
      await removeRampServiceChargeCommandIfCurrent(
        context.sessionId, accountId, operationId, serviceId, chargeId, action, reservedKey,
      ).catch(() => undefined);
    }
    if (normalized.code === 'unauthenticated' || normalized.code === 'forbidden') {
      const cleared = await rejectMobileSessionRequest(context.sessionId);
      if (!cleared) throw new MobileServiceError('cancelled');
    }
    throw normalized;
  }
}
