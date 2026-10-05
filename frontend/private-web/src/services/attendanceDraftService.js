import { ElevantApiError } from '@elevant/api-client';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

class AttendanceDraftServiceError extends Error {
  constructor(message, { status = null, code = 'request-failed', recoverable = true } = {}) {
    super(message);
    this.name = 'AttendanceDraftServiceError';
    this.status = status;
    this.code = code;
    this.recoverable = recoverable;
  }
}

function cancelledIfSessionChanged(token) {
  return readSession()?.token === token ? null : new AttendanceDraftServiceError(
    'La sesión cambió. Actualiza esta vista antes de continuar.',
    { code: 'cancelled', recoverable: false }
  );
}

function safeError(error, writing, token) {
  const cancelled = cancelledIfSessionChanged(token);
  if (cancelled) return cancelled;
  if (error?.name === 'AbortError' && !writing) return error;
  const status = error instanceof ElevantApiError ? error.status : null;
  if (status === 401) {
    handleUnauthorizedResponse({ status: 401 });
    return new AttendanceDraftServiceError('La sesión expiró. Inicia sesión nuevamente.', {
      status, code: 'unauthorized', recoverable: false,
    });
  }
  if (status === 403) return new AttendanceDraftServiceError(
    'No tienes permiso para consultar o registrar esta asistencia.',
    { status, code: 'forbidden', recoverable: false }
  );
  if (status === 404) return new AttendanceDraftServiceError(
    'La asignación ya no está disponible. Actualiza la operación.',
    { status, code: 'not-found' }
  );
  if (status === 409) return new AttendanceDraftServiceError(
    'Este aporte cambió. Revisa la versión actual antes de guardar de nuevo.',
    { status, code: 'stale-revision' }
  );
  if (writing && (status === null || status >= 500)) return new AttendanceDraftServiceError(
    'No fue posible confirmar si se guardó. Reintenta la misma intención.',
    { status, code: 'unknown-outcome' }
  );
  return new AttendanceDraftServiceError(
    writing ? 'No fue posible guardar este aporte.' : 'No fue posible consultar la asistencia.',
    { status, code: 'request-failed', recoverable: status !== 400 && status !== 422 }
  );
}

function client(token) {
  return createPrivateWebApiClient({ getAccessToken: () => token });
}

export async function readAttendanceDraft(operationId, assignmentId, { signal } = {}) {
  const token = readSession()?.token;
  try {
    const result = await client(token).getOperationAttendanceDraft(operationId, assignmentId, { signal });
    const cancelled = cancelledIfSessionChanged(token);
    if (cancelled) throw cancelled;
    return result;
  } catch (error) {
    throw safeError(error, false, token);
  }
}

export async function saveOccAttendanceDraft(
  operationId, assignmentId, request, key, { signal } = {}
) {
  const token = readSession()?.token;
  try {
    const result = await client(token).saveOccAttendanceDraft(
      operationId, assignmentId, request, key, { signal }
    );
    const cancelled = cancelledIfSessionChanged(token);
    if (cancelled) throw cancelled;
    return result;
  } catch (error) {
    throw safeError(error, true, token);
  }
}
