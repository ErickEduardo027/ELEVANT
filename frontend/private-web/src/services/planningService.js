import { ElevantApiError } from '@elevant/api-client';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

const PLANNING_LOAD_ERROR = 'No fue posible cargar la planificación operativa.';
const OPTIONS_LOAD_ERROR = 'No fue posible cargar las opciones de planificación.';
const UNAUTHORIZED_ERROR = 'La sesión expiró. Inicia sesión nuevamente.';
const FORBIDDEN_ERROR = 'Su cuenta no tiene permiso para consultar esta planificación.';
const CONTRACT_AMBIGUITY_ERROR =
  'No fue posible determinar un contrato operativo único para este vuelo.';

class PlanningServiceError extends Error {
  constructor(message, { status = null, code = 'request-failed', recoverable = true } = {}) {
    super(message);
    this.name = 'PlanningServiceError';
    this.status = status;
    this.code = code;
    this.recoverable = recoverable;
  }
}

function isAbortError(error) {
  return error !== null && typeof error === 'object' && error.name === 'AbortError';
}

function createPlanningClient() {
  return createPrivateWebApiClient({
    // The shared client invokes this immediately before every authenticated request.
    // Reading here avoids retaining a token that may have expired or been replaced.
    getAccessToken: () => readSession()?.token,
  });
}

function safeRequestError(error, fallbackMessage, { conflictMessage = null } = {}) {
  if (isAbortError(error)) return error;

  if (error instanceof ElevantApiError && error.status === 401) {
    handleUnauthorizedResponse({ status: 401 });
    return new PlanningServiceError(UNAUTHORIZED_ERROR, {
      status: 401,
      code: 'unauthorized',
      recoverable: false,
    });
  }

  if (error instanceof ElevantApiError && error.status === 403) {
    return new PlanningServiceError(FORBIDDEN_ERROR, {
      status: 403,
      code: 'forbidden',
      recoverable: false,
    });
  }

  if (error instanceof ElevantApiError && error.status === 409 && conflictMessage) {
    return new PlanningServiceError(conflictMessage, {
      status: 409,
      code: 'contract-ambiguity',
      recoverable: true,
    });
  }

  return new PlanningServiceError(fallbackMessage, {
    status: error instanceof ElevantApiError ? error.status : null,
  });
}

async function executeSafely(request, fallbackMessage, options) {
  try {
    return await request();
  } catch (error) {
    throw safeRequestError(error, fallbackMessage, options);
  }
}

export async function getPlanningSnapshot({ stationId, date, signal } = {}) {
  const parameters = {
    ...(stationId === undefined ? {} : { stationId }),
    ...(date === undefined ? {} : { date }),
  };

  return executeSafely(
    () => createPlanningClient().getOccPlanningSnapshot(parameters, { signal }),
    PLANNING_LOAD_ERROR
  );
}

export async function getPlanningOptions(turnaroundId, { signal } = {}) {
  return executeSafely(
    () => createPlanningClient().getOccPlanningOptions(turnaroundId, { signal }),
    OPTIONS_LOAD_ERROR,
    { conflictMessage: CONTRACT_AMBIGUITY_ERROR }
  );
}
