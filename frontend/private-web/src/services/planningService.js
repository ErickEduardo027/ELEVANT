import { ElevantApiError } from '@elevant/api-client';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

const PLANNING_LOAD_ERROR = 'No fue posible cargar la planificación operativa.';
const OPTIONS_LOAD_ERROR = 'No fue posible cargar las opciones de planificación.';
const ASSIGNMENT_UNKNOWN_ERROR =
  'No fue posible confirmar la asignación. La planificación se actualizará antes de volver a intentar.';
const UNAUTHORIZED_ERROR = 'La sesión expiró. Inicia sesión nuevamente.';
const FORBIDDEN_ERROR = 'Su cuenta no tiene permiso para consultar esta planificación.';
const ASSIGNMENT_FORBIDDEN_ERROR = 'Su cuenta no tiene permiso para asignar esta operación.';
const ASSIGNMENT_NOT_FOUND_ERROR =
  'La escala ya no está disponible para asignación. La planificación se actualizará.';
const ASSIGNMENT_CONFLICT_ERROR =
  'La operación o el agente cambiaron mientras preparaba la asignación. Revise las opciones actualizadas.';
const ASSIGNMENT_STALE_ERROR =
  'Las opciones de asignación cambiaron. Revise la versión actual antes de confirmar nuevamente.';
const OPTIONS_CONFLICT_ERROR =
  'No fue posible preparar una versión asignable de esta operación. Actualice la planificación y revise su estado.';

class PlanningServiceError extends Error {
  constructor(
    message,
    {
      status = null,
      code = 'request-failed',
      recoverable = true,
      refreshRequired = false,
    } = {}
  ) {
    super(message);
    this.name = 'PlanningServiceError';
    this.status = status;
    this.code = code;
    this.recoverable = recoverable;
    this.refreshRequired = refreshRequired;
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

function safeRequestError(
  error,
  fallbackMessage,
  { conflictMessage = null, conflictCode = 'request-conflict' } = {}
) {
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
      code: conflictCode,
      recoverable: true,
    });
  }

  return new PlanningServiceError(fallbackMessage, {
    status: error instanceof ElevantApiError ? error.status : null,
  });
}

function safeAssignmentError(error) {
  if (error instanceof ElevantApiError && error.status === 401) {
    handleUnauthorizedResponse({ status: 401 });
    return new PlanningServiceError(UNAUTHORIZED_ERROR, {
      status: 401,
      code: 'unauthorized',
      recoverable: false,
    });
  }

  if (error instanceof ElevantApiError && error.status === 403) {
    return new PlanningServiceError(ASSIGNMENT_FORBIDDEN_ERROR, {
      status: 403,
      code: 'forbidden',
      recoverable: false,
    });
  }

  if (error instanceof ElevantApiError && error.status === 404) {
    return new PlanningServiceError(ASSIGNMENT_NOT_FOUND_ERROR, {
      status: 404,
      code: 'not-found',
      refreshRequired: true,
    });
  }

  if (error instanceof ElevantApiError && error.status === 409) {
    return new PlanningServiceError(ASSIGNMENT_CONFLICT_ERROR, {
      status: 409,
      code: 'conflict',
      refreshRequired: true,
    });
  }

  if (error instanceof ElevantApiError && error.status === 412) {
    return new PlanningServiceError(ASSIGNMENT_STALE_ERROR, {
      status: 412,
      code: 'stale',
      refreshRequired: true,
    });
  }

  return new PlanningServiceError(ASSIGNMENT_UNKNOWN_ERROR, {
    status: error instanceof ElevantApiError ? error.status : null,
    code: 'unknown-outcome',
    refreshRequired: true,
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
    () => createPlanningClient().getOccPlanningOptionsWithMetadata(turnaroundId, { signal }),
    OPTIONS_LOAD_ERROR,
    { conflictMessage: OPTIONS_CONFLICT_ERROR, conflictCode: 'options-conflict' }
  );
}

export async function assignPlanningOperation(
  turnaroundId,
  agentId,
  etag,
  { signal } = {}
) {
  try {
    return await createPlanningClient().assignOccPlanningOperationWithMetadata(
      turnaroundId,
      { agentId },
      etag,
      { signal }
    );
  } catch (error) {
    throw safeAssignmentError(error);
  }
}
