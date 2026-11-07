import { ElevantApiError } from '@elevant/api-client';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

const PLANNING_LOAD_ERROR = 'No fue posible cargar la planificación operativa.';
const OPTIONS_LOAD_ERROR = 'No fue posible cargar las opciones de planificación.';
const MANUAL_OPTIONS_ERROR = 'No fue posible cargar las opciones del vuelo manual.';
const MANUAL_CREATE_ERROR = 'No fue posible confirmar el nuevo vuelo. Puede reintentar con los mismos datos.';
const MANUAL_CONFLICT_ERROR = 'El vuelo o su contrato cambiaron. Revise los datos antes de intentar otra vez.';
const SHIFT_PROGRAM_ERROR = 'No fue posible confirmar el turno. Puede reintentar con los mismos datos.';
const SHIFT_CONFLICT_ERROR = 'El turno, agente o alcance cambió. Actualice las opciones antes de intentarlo de nuevo.';
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
      problemCode = null,
    } = {}
  ) {
    super(message);
    this.name = 'PlanningServiceError';
    this.status = status;
    this.code = code;
    this.recoverable = recoverable;
    this.refreshRequired = refreshRequired;
    // The Problem Details code of the API, so a screen can explain the cause (`aircraft_type_unavailable`, 2-A).
    this.problemCode = problemCode;
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
      problemCode: error.code ?? null,
    });
  }

  return new PlanningServiceError(fallbackMessage, {
    status: error instanceof ElevantApiError ? error.status : null,
    problemCode: error instanceof ElevantApiError ? error.code ?? null : null,
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

const READINESS_LOAD_ERROR = 'No fue posible comprobar si los agentes asignados pueden operar.';

/**
 * The planning board's marks (2-N25): the assignments of the station's operations on the date whose agent is
 * inactive, on an approved absence or without a current airport permit or ramp licence. Nothing is released.
 */
export async function getAssignmentReadiness({ stationId, date, signal } = {}) {
  return executeSafely(
    () => createPlanningClient().getOccAssignmentReadiness({ stationId, date }, { signal }),
    READINESS_LOAD_ERROR
  );
}

export async function getPlanningOptions(turnaroundId, { signal } = {}) {
  return executeSafely(
    () => createPlanningClient().getOccPlanningOptionsWithMetadata(turnaroundId, { signal }),
    OPTIONS_LOAD_ERROR,
    { conflictMessage: OPTIONS_CONFLICT_ERROR, conflictCode: 'options-conflict' }
  );
}

export async function getManualTurnaroundOptions(stationId, date, { signal } = {}) {
  return executeSafely(
    () => createPlanningClient().getManualTurnaroundOptions({ stationId, date }, { signal }),
    MANUAL_OPTIONS_ERROR
  );
}

export async function createManualTurnaround(request, { signal } = {}) {
  return executeSafely(
    () => createPlanningClient().createManualTurnaround(request, { signal }),
    MANUAL_CREATE_ERROR,
    { conflictMessage: MANUAL_CONFLICT_ERROR, conflictCode: 'manual-conflict' }
  );
}

export async function programPlanningShift(turnaroundId, request, { signal } = {}) {
  return executeSafely(
    () => createPlanningClient().programOccShift(turnaroundId, request, { signal }),
    SHIFT_PROGRAM_ERROR,
    { conflictMessage: SHIFT_CONFLICT_ERROR, conflictCode: 'shift-conflict' }
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

/**
 * A turnaround change keeps the ElevantApiError as it came (status, code, reasons) so the screen explains it by its
 * Problem Details code (3-A, 3-N21); a body the client refuses is explained as invalid data, never as a network failure.
 */
async function turnaroundRequest(request, invalidCode) {
  try {
    return await request();
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (error instanceof ElevantApiError && error.status === 401) handleUnauthorizedResponse({ status: 401 });
    if (error instanceof TypeError) throw Object.assign(new Error(invalidCode), { status: 400, code: invalidCode });
    throw error;
  }
}

/** One turnaround with its ETag and the changes its state allows (3-A). */
export const getTurnaround = (turnaroundId, { signal } = {}) =>
  turnaroundRequest(() => createPlanningClient().getOccTurnaround(turnaroundId, { signal }), 'invalid_turnaround_change');

/** «Editar vuelo» with the intent's key and the ETag on screen. */
export const rescheduleTurnaround = (turnaroundId, command, { ifMatch, idempotencyKey }) =>
  turnaroundRequest(() => createPlanningClient().rescheduleOccTurnaround(turnaroundId, command, { ifMatch, idempotencyKey }),
    'invalid_turnaround_change');

/** «Cancelar vuelo» (`Cancelled`) or «Marcar desviado» (`Diverted`) with its reason. */
export const changeTurnaroundStatus = (turnaroundId, command, { ifMatch, idempotencyKey }) =>
  turnaroundRequest(() => createPlanningClient().changeOccTurnaroundStatus(turnaroundId, command, { ifMatch, idempotencyKey }),
    'invalid_turnaround_change');

/** The minimal carrier of a charter (3-N21). */
export const createCharterAirline = (command, idempotencyKey) =>
  turnaroundRequest(() => createPlanningClient().createOccCharterAirline(command, idempotencyKey), 'invalid_charter_airline');
