import type {
  OperationConversationListResponse,
  OperationMessageListResponse,
  OperationMessageResponse,
  OperationalNotificationListResponse,
  OperationalNotificationResponse,
} from '@elevant/api-client';
import { createMobileAgentApiClient } from '../config/elevant-api';
import {
  clearOperationChatCommandIfCurrent,
  readOperationChatCommandIfCurrent,
  reserveOperationChatCommandIfCurrent,
  type CurrentOperationChatCommand,
} from '../storage/mobile-session';
import { getMobileSessionRequestContext, rejectMobileSessionRequest } from './mobile-auth';
import { registerCurrentMobileDevice } from './mobile-device';
import { asMobileServiceError, MobileServiceError } from './mobile-service-error';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authenticated<T>(request: (accessToken: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const context = await getMobileSessionRequestContext();
  try {
    const result = await request(context.accessToken);
    if (signal?.aborted) throw new MobileServiceError('cancelled');
    const current = await getMobileSessionRequestContext();
    if (current.sessionId !== context.sessionId) throw new MobileServiceError('cancelled');
    return result;
  } catch (error) {
    const normalized = asMobileServiceError(error);
    if (normalized.code === 'unauthenticated' || normalized.code === 'forbidden') {
      const cleared = await rejectMobileSessionRequest(context.sessionId);
      if (!cleared) throw new MobileServiceError('cancelled');
    }
    throw normalized;
  }
}

export function getOperationalConversations(signal?: AbortSignal): Promise<OperationConversationListResponse> {
  return authenticated(token => createMobileAgentApiClient({ getAccessToken: () => token })
    .getOperationalConversations(undefined, { signal }), signal);
}

export function getOperationalMessages(operationId: string, signal?: AbortSignal): Promise<OperationMessageListResponse> {
  return authenticated(token => createMobileAgentApiClient({ getAccessToken: () => token })
    .getOperationalMessages(operationId, { signal }), signal);
}

export function getOperationalNotifications(signal?: AbortSignal): Promise<OperationalNotificationListResponse> {
  return authenticated(token => createMobileAgentApiClient({ getAccessToken: () => token })
    .getOperationalNotifications({ signal }), signal);
}

export function setOperationalNotificationRead(
  notificationId: string, read: boolean, signal?: AbortSignal,
): Promise<OperationalNotificationResponse> {
  return authenticated(token => createMobileAgentApiClient({ getAccessToken: () => token })
    .setOperationalNotificationRead(notificationId, read, { signal }), signal);
}

export async function readPendingOperationMessage(operationId: string): Promise<CurrentOperationChatCommand> {
  if (!uuidPattern.test(operationId)) throw new MobileServiceError('request_failed');
  const context = await getMobileSessionRequestContext();
  try {
    return await readOperationChatCommandIfCurrent(context.sessionId,
      context.session.actor.accountId, operationId);
  } catch (error) { throw asMobileServiceError(error); }
}

export async function sendOperationalMessage(
  operationId: string, content: string, signal?: AbortSignal,
): Promise<OperationMessageResponse> {
  if (!uuidPattern.test(operationId) || !content.trim() || content.length > 2_000)
    throw new MobileServiceError('request_failed');
  const context = await getMobileSessionRequestContext();
  try {
    const reserved = await reserveOperationChatCommandIfCurrent(context.sessionId,
      context.session.actor.accountId, operationId, content);
    if (reserved.kind !== 'current' || !reserved.command) throw new MobileServiceError('cancelled');
    const device = await registerCurrentMobileDevice({ accessToken: context.accessToken }, { signal });
    const current = await getMobileSessionRequestContext();
    if (current.sessionId !== context.sessionId) throw new MobileServiceError('cancelled');
    const response = await createMobileAgentApiClient({ getAccessToken: () => current.accessToken })
      .sendOperationalMessage(operationId, { content: reserved.command.content },
        reserved.command.idempotencyKey, device.installationId, { signal });
    const after = await getMobileSessionRequestContext();
    if (after.sessionId !== context.sessionId) throw new MobileServiceError('cancelled');
    const cleared = await clearOperationChatCommandIfCurrent(context.sessionId,
      context.session.actor.accountId, operationId, reserved.command.idempotencyKey);
    if (cleared !== 'cleared') throw new MobileServiceError('storage_unavailable');
    return response;
  } catch (error) {
    const normalized = asMobileServiceError(error);
    if (normalized.code === 'unauthenticated' || normalized.code === 'forbidden') {
      const cleared = await rejectMobileSessionRequest(context.sessionId);
      if (!cleared) throw new MobileServiceError('cancelled');
    }
    throw normalized;
  }
}
