import type { RampOperationStartResponse } from '@elevant/api-client';
import { createMobileAgentApiClient } from '../config/elevant-api';
import { getOrCreateRampStartCommandIfCurrent } from '../storage/mobile-session';
import {
  getMobileSessionRequestContext,
  MobileServiceError,
  rejectMobileSessionRequest,
} from './mobile-auth';
import { registerCurrentMobileDevice } from './mobile-device';
import { asMobileServiceError } from './mobile-service-error';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StartAssignedRampOperationOptions = Readonly<{
  signal?: AbortSignal;
}>;

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    uuidPattern.test(value) &&
    value.toLowerCase() !== '00000000-0000-0000-0000-000000000000'
  );
}

export async function startAssignedRampOperation(
  operationId: string,
  options: StartAssignedRampOperationOptions = {},
): Promise<RampOperationStartResponse> {
  if (!isUuid(operationId)) throw new MobileServiceError('request_failed');

  const context = await getMobileSessionRequestContext();

  try {
    const command = await getOrCreateRampStartCommandIfCurrent(
      context.sessionId,
      context.session.actor.accountId,
      operationId,
    );
    if (command.kind !== 'current') {
      throw new MobileServiceError('cancelled');
    }

    const device = await registerCurrentMobileDevice(
      { accessToken: context.accessToken },
      options,
    );
    const confirmedContext = await getMobileSessionRequestContext();
    if (confirmedContext.sessionId !== context.sessionId) {
      throw new MobileServiceError('cancelled');
    }

    const response = await createMobileAgentApiClient({
      getAccessToken: () => confirmedContext.accessToken,
    }).startRampOperation(
      operationId,
      device.installationId,
      command.idempotencyKey,
      { signal: options.signal },
    );
    const finalContext = await getMobileSessionRequestContext();
    if (finalContext.sessionId !== context.sessionId) {
      throw new MobileServiceError('cancelled');
    }
    if (response.operation.id.toLowerCase() !== operationId.toLowerCase()) {
      throw new MobileServiceError('malformed_response');
    }

    return response;
  } catch (error) {
    const normalized = asMobileServiceError(error);
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
