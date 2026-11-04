import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

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
  airport_permit_required: 'El agente no tiene el carnet aeroportuario vigente.',
  bridge_qualification_required: 'La Terminal B y las posiciones con puente exigen la habilitación de puente vigente.',
  shift_not_covering: 'El turno del agente no cubre todo ese horario.',
  absent: 'El agente tiene una ausencia aprobada ese día.',
  agent_overlap: 'El agente ya cubre posiciones en ese horario.',
  mentor_required: 'El agente tiene menos de 3 meses: necesita un mentor experimentado.',
  mentor_not_eligible: 'El mentor debe tener 3 meses o más, estar activo y tener turno en ese horario.',
  stand_taken: 'Otra persona ya cubre alguna de esas posiciones. Márcalo como refuerzo si es intencional.',
  stand_cancelled: 'Esa posición está anulada por una posición combinada ocupada (por ejemplo 9A anula la 10).',
  stand_narrowbody_only: 'Esa posición solo admite aviones de fuselaje estrecho en este momento.',
  neighbour_widebody: 'Ocuparla limitaría a estrecho una posición vecina que ya tiene un avión ancho.',
};

export function describeReasons(reasons) {
  return (reasons ?? []).map(reason => COVERAGE_REASON_MESSAGES[reason]).filter(Boolean);
}

export function translateCoverageError(error) {
  if (error?.name === 'AbortError') return error;
  if (error instanceof TypeError) return Object.assign(new Error('Revisa los datos del formulario.'), { status: 400 });
  if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
  const status = Number.isInteger(error?.status) ? error.status : null;
  // Keep the rule codes: screens explain each one with describeReasons.
  const reasons = (error?.reasons ?? []).filter(reason => reason in COVERAGE_REASON_MESSAGES);
  const message = reasons.length ? 'La cobertura no cumple las reglas de asignación.'
    : status === 403 ? 'Tu acceso no permite gestionar la cobertura de posiciones.'
      : status === 404 ? 'El agente, la terminal o la posición ya no está disponible.'
        : status === 409 ? 'Los datos cambiaron mientras trabajabas. Se actualizó la vista; inténtalo de nuevo.'
          : status === 400 ? 'Revisa los datos del formulario.'
            : 'No fue posible completar la acción. Intenta de nuevo.';
  return Object.assign(new Error(message), { status, reasons });
}

async function guarded(request) {
  try { return await request(); } catch (error) { throw translateCoverageError(error); }
}

export const loadOccCoverage = (stationId, date, { signal } = {}) =>
  guarded(() => client().getOccCoverage(stationId, date, { signal }));

export const createOccCoverage = command => guarded(() => client().createOccCoverage(command));

export const releaseOccCoverage = (coverageId, date) => guarded(() => client().releaseOccCoverage(coverageId, date));

export const updateOccStandAttributes = (standId, attributes) =>
  guarded(() => client().updateOccStandAttributes(standId, attributes));

export const updateOccTerminalRules = (terminalId, rules) => guarded(() => client().updateOccTerminalRules(terminalId, rules));

export const addOccStandConstraint = rule => guarded(() => client().addOccStandConstraint(rule));

export const removeOccStandConstraint = (constraintId, date) =>
  guarded(() => client().removeOccStandConstraint(constraintId, date));

export async function releaseOccOperationAgent(turnaroundId) {
  try { await client().releaseOccOperationAgent(turnaroundId); } catch (error) {
    const translated = translateCoverageError(error);
    if (translated.status === 409) translated.message = 'Solo se libera un agente asignado antes de que inicie la operación.';
    throw translated;
  }
}
