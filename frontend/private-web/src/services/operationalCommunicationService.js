import { ElevantApiError } from '@elevant/api-client';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

function safeError(error) {
  if (error?.name === 'AbortError') return error;
  if (error instanceof ElevantApiError) {
    if (error.status === 401) {
      handleUnauthorizedResponse({ status: 401 });
      return new Error('La sesión expiró. Inicia sesión nuevamente.');
    }
    if (error.status === 403) return new Error('No tienes acceso a esta conversación o notificación.');
    if (error.status === 404) return new Error('La operación ya no está disponible para tu cuenta.');
    if (error.status === 409) return new Error('El mensaje entró en conflicto. Actualiza la conversación.');
  }
  return new Error('No fue posible completar la solicitud. Comprueba la conexión e intenta nuevamente.');
}

async function guarded(request) {
  try { return await request(); } catch (error) { throw safeError(error); }
}

export const loadOperationalConversations = (stationId, { signal } = {}) =>
  guarded(() => client().getOperationalConversations(stationId, { signal }));

export const loadOperationalMessages = (operationId, { signal } = {}) =>
  guarded(() => client().getOperationalMessages(operationId, { signal }));

export const sendOperationalMessage = (operationId, content, idempotencyKey, { signal } = {}) =>
  guarded(() => client().sendOperationalMessage(operationId, { content }, idempotencyKey, undefined, { signal }));

export const loadOperationalNotifications = ({ signal } = {}) =>
  guarded(() => client().getOperationalNotifications({ signal }));

export const setOperationalNotificationRead = (notificationId, read, { signal } = {}) =>
  guarded(() => client().setOperationalNotificationRead(notificationId, read, { signal }));
