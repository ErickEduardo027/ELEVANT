import { ElevantApiError } from '@elevant/api-client';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

export class OccReviewServiceError extends Error {
  constructor(message, { status = null, code = 'request-failed' } = {}) {
    super(message);
    this.name = 'OccReviewServiceError';
    this.status = status;
    this.code = code;
  }
}

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

function safeError(error, action) {
  if (error?.name === 'AbortError') return error;
  if (error instanceof ElevantApiError) {
    if (error.status === 401) {
      handleUnauthorizedResponse({ status: 401 });
      return new OccReviewServiceError('La sesión expiró. Inicia sesión nuevamente.', {
        status: 401, code: 'unauthorized',
      });
    }
    if (error.status === 403) {
      return new OccReviewServiceError('No tienes permiso para revisar esta operación.', {
        status: 403, code: 'forbidden',
      });
    }
    if (error.status === 404) {
      return new OccReviewServiceError('La operación ya no está disponible en tu estación.', {
        status: 404, code: 'not-found',
      });
    }
    if (error.status === 409 || error.status === 412) {
      return new OccReviewServiceError('La entrega cambió. Actualiza el detalle antes de decidir.', {
        status: error.status, code: 'stale',
      });
    }
  }
  const message = action === 'decision'
    ? 'No fue posible confirmar el resultado. Actualiza la cola y el detalle antes de intentarlo de nuevo.'
    : 'No fue posible cargar la revisión. Comprueba la conexión e intenta nuevamente.';
  return new OccReviewServiceError(message, {
    status: error instanceof ElevantApiError ? error.status : null,
    code: action === 'decision' ? 'unknown-outcome' : 'request-failed',
  });
}

export async function loadOccReviewQueue(stationId, { signal } = {}) {
  try {
    return await client().getOccReviewQueue(stationId, { signal });
  } catch (error) {
    throw safeError(error, 'queue');
  }
}

export async function loadOccReviewDetail(operationId, { signal } = {}) {
  try {
    return await client().getOccReviewDetail(operationId, { signal });
  } catch (error) {
    throw safeError(error, 'detail');
  }
}

export async function decideOccReview(operationId, request, etag, { signal } = {}) {
  try {
    return await client().decideOccReview(operationId, request, etag, { signal });
  } catch (error) {
    throw safeError(error, 'decision');
  }
}
