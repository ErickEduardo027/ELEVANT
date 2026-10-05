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

function safeError(error, writing) {
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

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

export async function readAttendanceDraft(operationId, assignmentId, { signal } = {}) {
  try {
    return await client().getOperationAttendanceDraft(operationId, assignmentId, { signal });
  } catch (error) {
    throw safeError(error, false);
  }
}

export async function saveOccAttendanceDraft(
  operationId, assignmentId, request, key, { signal } = {}
) {
  try {
    return await client().saveOccAttendanceDraft(
      operationId, assignmentId, request, key, { signal }
    );
  } catch (error) {
    throw safeError(error, true);
  }
}
