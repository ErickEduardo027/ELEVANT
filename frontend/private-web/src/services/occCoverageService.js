import { normalizedStandAttributes } from '@elevant/api-client';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';
import { problemMessage } from './problemMessages';

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

/** What each assignment or stand rule means for OCC (ADR-0030). */
export const COVERAGE_REASON_MESSAGES = {
  window_invalid: 'El horario no es válido: debe terminar después de empezar y durar como máximo 16 horas.',
  no_stands: 'Elige al menos una posición.',
  stand_inactive: 'Alguna posición está desactivada.',
  stand_other_terminal: 'Todas las posiciones deben ser de la terminal elegida.',
  too_many_stands: 'Supera el máximo de posiciones por agente de esta terminal.',
  driver_license_required: 'Más de 2 posiciones exige licencia de conducir en rampa vigente.',
  vehicle_required: 'Más de 2 posiciones exige asignarle un vehículo.',
  agent_inactive: 'El agente no está activo.',
  // 3-N05: the tablet only lets the agent work stands of a terminal in their scope.
  terminal_scope_missing: 'El agente no tiene alcance vigente en esa terminal.',
  airport_permit_required: 'El agente no tiene el carnet aeroportuario vigente hasta el final del horario.',
  bridge_qualification_required: 'La Terminal B y las posiciones con puente exigen la habilitación de puente vigente.',
  shift_not_covering: 'El turno del agente no cubre todo ese horario.',
  absent: 'El agente tiene una ausencia aprobada ese día.',
  agent_overlap: 'El agente ya cubre posiciones en ese horario.',
  mentor_required: 'El agente tiene menos de 3 meses: necesita un mentor experimentado.',
  mentor_not_eligible: 'El mentor debe tener 3 meses o más, estar activo y tener turno en ese horario.',
  // 2-N23: a mentor on an approved absence or without a current airport permit accompanies nobody.
  mentor_absent: 'El mentor tiene una ausencia aprobada ese día.',
  mentor_permit_required: 'El mentor no tiene el carnet aeroportuario vigente.',
  stand_taken: 'Otra persona ya cubre alguna de esas posiciones. Márcalo como refuerzo si es intencional.',
  stand_cancelled: 'Esa posición está anulada por una posición combinada ocupada (por ejemplo 9A anula la 10).',
  stand_narrowbody_only: 'Esa posición solo admite aviones de fuselaje estrecho en este momento.',
  neighbour_widebody: 'Ocuparla limitaría a estrecho una posición vecina que ya tiene un avión ancho.',
  // A stand in use is never deactivated, from Configuración either (2-A).
  stand_in_use: 'La posición tiene vuelos sin terminar o coberturas abiertas: no se puede desactivar.',
  // Nor is a stand of an inactive terminal reactivated there (2-A).
  terminal_inactive: 'La terminal de esta posición está desactivada: reactívala primero en «Datos maestros».',
};

/**
 * Spanish explanation of each Problem Details code of the coverage commands (ADR-0030, 2-A, 3-J): the rule a refused
 * change breaks, a version that changed meanwhile, a reused key or a missing version. The server title is never shown;
 * a code-less answer of an older server is explained by its status.
 */
export const COVERAGE_PROBLEM_MESSAGES = Object.freeze({
  stand_in_use: COVERAGE_REASON_MESSAGES.stand_in_use,
  terminal_inactive: COVERAGE_REASON_MESSAGES.terminal_inactive,
  coverage_rejected: 'La cobertura no cumple las reglas de asignación.',
  invalid_coverage_request: 'Revisa los datos del formulario.',
  not_found: 'El agente, la terminal o la posición ya no está disponible.',
  version_conflict: 'Los datos cambiaron mientras trabajabas. Se actualizó la vista; inténtalo de nuevo.',
  idempotency_conflict: 'Ese envío ya se usó con otros datos. Se actualizó la vista; inténtalo de nuevo.',
  expected_version_required: 'Actualiza la vista antes de guardar los cambios.',
  idempotency_key_required: 'No se pudo identificar el envío; inténtalo de nuevo.',
});

/** A refused stand change (2-A) says where its version may have changed meanwhile: here or in «Datos maestros». */
export const STAND_PROBLEM_MESSAGES = Object.freeze({
  ...COVERAGE_PROBLEM_MESSAGES,
  version_conflict: 'La posición cambió mientras la editabas, aquí o en «Datos maestros». Se actualizó la vista; revisa e inténtalo de nuevo.',
  expected_version_required: 'Actualiza la vista antes de guardar los cambios de la posición.',
});

const STATUS_CODES = { 400: 'invalid_coverage_request', 404: 'not_found', 409: 'version_conflict', 422: 'coverage_rejected' };

const UNCERTAIN_MESSAGE = 'No fue posible completar la acción. Intenta de nuevo.';

export function describeReasons(reasons) {
  return (reasons ?? []).map(reason => COVERAGE_REASON_MESSAGES[reason]).filter(Boolean);
}

/**
 * The coverage failure in Spanish, keeping its status, code and the rules it broke (each one explained on screen).
 * `messages` is the area's explanation of each code: the coverage commands by default, a stand change its own.
 */
export function translateCoverageError(error, messages = COVERAGE_PROBLEM_MESSAGES) {
  if (error?.name === 'AbortError') return error;
  if (error instanceof TypeError) {
    return Object.assign(new Error(messages.invalid_coverage_request),
      { status: 400, code: 'invalid_coverage_request', reasons: [] });
  }
  if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
  const status = Number.isInteger(error?.status) ? error.status : null;
  const code = typeof error?.code === 'string' ? error.code : undefined;
  // Keep the rule codes: screens explain each one with describeReasons.
  const reasons = (error?.reasons ?? []).filter(reason => reason in COVERAGE_REASON_MESSAGES);
  // A code with its own message (stand_in_use, terminal_inactive…) explains itself; the other broken rules are listed.
  const explained = code !== undefined && code !== 'coverage_rejected'
    && Object.prototype.hasOwnProperty.call(messages, code);
  const message = reasons.length && !explained ? messages.coverage_rejected
    : problemMessage({ status, code: code ?? STATUS_CODES[status] }, messages, {
      forbidden: 'Tu acceso no permite gestionar la cobertura de posiciones.',
      fallback: UNCERTAIN_MESSAGE,
    });
  return Object.assign(new Error(message), { status, code, reasons });
}

async function guarded(request) {
  try { return await request(); } catch (error) { throw translateCoverageError(error); }
}

export const loadOccCoverage = (stationId, date, { signal } = {}) =>
  guarded(() => client().getOccCoverage(stationId, date, { signal }));

/** Hands an agent their stands; the intent's key replays a creation whose answer was lost (3-J). */
export const createOccCoverage = (command, { idempotencyKey } = {}) =>
  guarded(() => client().createOccCoverage(command, { idempotencyKey }));

export const releaseOccCoverage = (coverageId, date, { idempotencyKey } = {}) =>
  guarded(() => client().releaseOccCoverage(coverageId, date, { idempotencyKey }));

/**
 * The attributes of a stand from Configuración (2-A), with its version on the board and the intent's Idempotency-Key.
 * A value the server would refuse is explained as invalid data before sending; no answer at all (a network failure) is
 * uncertain: it keeps no status, so the intent keeps its key and the retry replays the first result.
 */
export async function updateOccStandAttributes(standId, attributes, idempotencyKey) {
  try { normalizedStandAttributes(attributes); } catch {
    throw Object.assign(new Error('Revisa los datos del formulario.'), { status: 400, reasons: [] });
  }
  try { return await client().updateOccStandAttributes(standId, attributes, idempotencyKey); } catch (error) {
    if (error instanceof TypeError) throw Object.assign(new Error(UNCERTAIN_MESSAGE), { status: null, reasons: [] });
    throw translateCoverageError(error, STAND_PROBLEM_MESSAGES);
  }
}

export const updateOccTerminalRules = (terminalId, rules) => guarded(() => client().updateOccTerminalRules(terminalId, rules));

export const addOccStandConstraint = rule => guarded(() => client().addOccStandConstraint(rule));

export const removeOccStandConstraint = (constraintId, date) =>
  guarded(() => client().removeOccStandConstraint(constraintId, date));

/**
 * A command on an operation's agent (3-J, 3-F) keeps the ElevantApiError as it came (status, code): the drawer explains
 * it by its Problem Details code. A body the client refuses is explained as invalid data, never as a network failure.
 */
async function agentCommand(request, invalidCode) {
  try {
    return await request();
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    if (error instanceof TypeError) throw Object.assign(new Error(invalidCode), { status: 400, code: invalidCode });
    throw error;
  }
}

/**
 * Releases the agent OCC saw (`expectedAssignmentId`) of an operation not started yet, with the intent's key (3-J):
 * another agent is `assignment_changed`, a started operation `operation_started`.
 */
export const releaseOccOperationAgent = (turnaroundId, { expectedAssignmentId, idempotencyKey } = {}) =>
  agentCommand(() => client().releaseOccOperationAgent(turnaroundId, { expectedAssignmentId, idempotencyKey }),
    'expected_version_required');

/** «Relevar agente» (3-F): who works the started operation and the agents that may take what is left of it. */
export const loadOccHandoverOptions = (turnaroundId, { signal } = {}) =>
  agentCommand(() => client().getOccHandoverOptions(turnaroundId, { signal }), 'invalid_handover');

/** «Relevar agente» (3-F): the agent, the assignment OCC saw and the reason, with the intent's key. */
export const handOverOccOperation = (turnaroundId, command, idempotencyKey) =>
  agentCommand(() => client().handOverOccOperation(turnaroundId, command, idempotencyKey), 'invalid_handover');
