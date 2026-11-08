import type {
  OperationConversationListResponse,
  OperationMessageListResponse,
  OperationMessageResponse,
  OperationalNotificationListResponse,
  OperationalNotificationResponse,
} from '@elevant/api-client';
import { createMobileAgentApiClient } from '../config/elevant-api';
import { readOperationQueue, sendFlightReportCommand } from './flight-report';
import { getMobileSessionRequestContext, rejectMobileSessionRequest } from './mobile-auth';
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

/** Moves this account's read cursor to that message; the server never moves it backwards. */
export function markOperationalConversationRead(operationId: string, messageId: string, signal?: AbortSignal): Promise<void> {
  return authenticated(token => createMobileAgentApiClient({ getAccessToken: () => token })
    .markOperationalConversationRead(operationId, messageId, { signal }), signal);
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

/** A message to OCC still saved on the device (3-I): it goes out in its order when there is signal. */
export type PendingOperationMessage = Readonly<{
  idempotencyKey: string;
  content: string;
  /** «blocked» when ELEVANT refused it; the agent reviews it in «Sincronización». */
  state: 'pending' | 'blocked';
  createdAt: string;
  lastError?: string;
}>;

/** The messages of this operation's chat still on the device, oldest first. */
export async function readPendingOperationMessages(operationId: string): Promise<readonly PendingOperationMessage[]> {
  if (!uuidPattern.test(operationId)) throw new MobileServiceError('request_failed');
  try {
    return (await readOperationQueue(operationId)).messages.flatMap(item => item.command.kind === 'chatMessage'
      ? [{ idempotencyKey: item.idempotencyKey, content: item.command.content, state: item.state,
        createdAt: item.createdAt, ...(item.lastError ? { lastError: item.lastError } : {}) }]
      : []);
  } catch (error) { throw asMobileServiceError(error); }
}

/**
 * Sends a message to OCC through the device's queue (3-I): saved first with its stable key, so a lost answer or a
 * missing signal never loses nor doubles it. Answers ELEVANT's copy, or null while it waits on the device. A refusal
 * is thrown with its Problem Details code and leaves the queue.
 */
export async function sendOperationalMessage(
  operationId: string, content: string, _signal?: AbortSignal,
): Promise<OperationMessageResponse | null> {
  if (!uuidPattern.test(operationId) || !content.trim() || content.length > 2_000)
    throw new MobileServiceError('request_failed');
  const sent = await sendFlightReportCommand({ kind: 'chatMessage', operationId: operationId.toLowerCase(),
    content: content.trim() }, { discardRefused: true });
  return sent.state === 'sent' ? sent.result as OperationMessageResponse : null;
}
