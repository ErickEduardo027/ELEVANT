import { normalizedOccIncidentReport, normalizedOccIncidentStatus } from '@elevant/api-client';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';
import { INCIDENT_PROBLEM_MESSAGES } from '../features/incidents/incidentMessages';
import { problemMessage } from './problemMessages';

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

const FORBIDDEN = 'Su acceso no incluye las incidencias de esta operación.';
// A refusal without a Problem Details code (an older server) is explained by its status.
const STATUS_CODES = { 404: 'not_found', 409: 'version_conflict', 412: 'version_conflict', 428: 'expected_version_required' };

/**
 * The failure of an incident call in Spanish by its Problem Details code (3-G), keeping the status and the code the
 * screen reacts to: 403 shows the unauthorized state; 409 and 412 re-read the list before a new intent.
 */
function translate(error, fallback) {
  if (error?.name === 'AbortError') return error;
  const status = Number.isInteger(error?.status) ? error.status : null;
  if (status === 401) handleUnauthorizedResponse({ status: 401 });
  const code = typeof error?.code === 'string' ? error.code : null;
  const message = problemMessage({ status: status ?? undefined, code: code ?? STATUS_CODES[status] },
    INCIDENT_PROBLEM_MESSAGES, { forbidden: FORBIDDEN, fallback });
  return Object.assign(new Error(message), { status, code });
}

async function guarded(request, fallback) {
  try { return await request(); } catch (error) { throw translate(error, fallback); }
}

// The form is checked here, before sending: a TypeError of the call is then a network failure, never invalid data.
function invalid(code) {
  return Object.assign(new Error(INCIDENT_PROBLEM_MESSAGES[code]), { status: 400, code });
}

/** The live incidents of an operation of OCC's stations (3-G). */
export const loadOccIncidents = (operationId, { signal } = {}) =>
  guarded(() => client().getOccOperationIncidents(operationId, { signal }),
    'No se pudieron cargar las incidencias. Revise la conexión e intente de nuevo.');

/** OCC reports an incident; the intent's key replays it after an uncertain answer. */
export async function reportOccIncident(operationId, command, idempotencyKey) {
  if (!normalizedOccIncidentReport(command)) throw invalid('incident_report_invalid');
  return guarded(() => client().reportOccIncident(operationId, command, idempotencyKey),
    'No se pudo confirmar el reporte. Actualice la lista antes de intentarlo de nuevo.');
}

/** OCC moves an incident with a note, against the version it saw. */
export async function changeOccIncidentStatus(incidentId, command, version, idempotencyKey) {
  if (!normalizedOccIncidentStatus(command)) throw invalid('reason_required');
  return guarded(() => client().changeOccIncidentStatus(incidentId, command, version, idempotencyKey),
    'No se pudo confirmar el cambio. Actualice la lista antes de intentarlo de nuevo.');
}
