import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';
import { placementReasons } from './occFlightFeedService';
import { problemMessage, SESSION_EXPIRED_MESSAGE } from './problemMessages';

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

/**
 * Spanish explanation of each Problem Details code of the positions map: the arrival and its correction (3-N08), the
 * aircraft type seen on arrival (3-B) and the stand commands with their version and key (3-N10). The server title is
 * never shown; a code this map does not list falls back to the shared messages by status.
 */
export const POSITION_PROBLEM_MESSAGES = Object.freeze({
  invalid_position_request: 'Revisa los datos: la matrícula (por ejemplo HI1055) y una hora de llegada que no sea futura.',
  reason_required: 'Indica el motivo de la corrección (entre 5 y 500 caracteres).',
  arrival_locked: 'La llegada ya no se puede registrar ni corregir: la operación ya se entregó a OCC.',
  aircraft_type_unavailable: 'El tipo de avión ya no está disponible. Elige otro.',
  aircraft_type_locked: 'El tipo de avión ya no se puede cambiar: la operación ya se entregó a OCC.',
  stand_unavailable: 'La posición está ocupada o reservada en ese horario. Elige otra o libérala primero.',
  turnaround_closed: 'El vuelo ya está cerrado, cancelado o desviado.',
  version_conflict: 'El vuelo cambió mientras lo revisabas. Se actualizó; revisa e intenta de nuevo.',
  idempotency_conflict: 'Ese envío ya se usó con otros datos. Se actualizó; intenta de nuevo.',
  expected_version_required: 'Actualiza el vuelo antes de guardar los cambios.',
  not_found: 'La operación o la posición ya no está disponible.',
});

const FORBIDDEN = 'Tu acceso no permite registrar llegadas ni asignar posiciones.';
const FALLBACK = 'No fue posible actualizar la posición. Revisa la conexión e intenta de nuevo.';
const VERSION_FORBIDDEN = 'Tu acceso no permite consultar este vuelo: no puedes registrar su llegada ni cambiar su posición.';
const VERSION_FALLBACK = 'No se pudo consultar la versión del vuelo. Revisa la conexión e intenta de nuevo.';

/**
 * Why the version of a flight could not be read (3-N10), in Spanish: until it is read, the positions map offers no
 * command for that flight. An expired session, a missing permission or a flight that is gone say so; any other failure
 * (the network, the server, an unreadable answer) is one the screen retries. The server title is never shown.
 */
export function positionVersionMessage(error) {
  switch (error?.status) {
    case 401: return SESSION_EXPIRED_MESSAGE;
    case 403: return VERSION_FORBIDDEN;
    case 404: return POSITION_PROBLEM_MESSAGES.not_found;
    default: return VERSION_FALLBACK;
  }
}

/**
 * The error a positions screen shows: its Spanish message by code, keeping the status, the code and the rules of the
 * ElevantApiError so the screen decides whether to re-read (409, 412, 428) before a new intent.
 */
export function translatePositionError(error) {
  if (error?.name === 'AbortError') return error;
  if (error instanceof TypeError) {
    return Object.assign(new Error(POSITION_PROBLEM_MESSAGES.invalid_position_request),
      { status: 400, code: 'invalid_position_request', reasons: [] });
  }
  if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
  const status = Number.isInteger(error?.status) ? error.status : null;
  const code = typeof error?.code === 'string' ? error.code : null;
  const reasons = Array.isArray(error?.reasons) ? [...error.reasons] : [];
  // A combined-stand rule (ADR-0030) explains itself: 9A anula la 10, solo fuselaje estrecho, etc.
  const rules = code === 'stand_unavailable' || (!code && status === 409) ? placementReasons(error) : [];
  const message = rules.length ? rules.join(' ')
    : problemMessage(error, POSITION_PROBLEM_MESSAGES, { forbidden: FORBIDDEN, fallback: FALLBACK });
  return Object.assign(new Error(message), { status, code, reasons });
}

/** The server says the flight moved: the screen re-reads it before a new intent. */
export const isStalePosition = error => error?.status === 409 || error?.status === 412 || error?.status === 428;

async function guarded(request) {
  try { return await request(); } catch (error) { throw translatePositionError(error); }
}

/**
 * The headers of a positions command (3-N10): the intent's Idempotency-Key and the ETag of the flight's version on
 * screen, always together. Without them nothing is sent: the screen reads the flight first (428, like the server), so a
 * retry never repeats an arrival or a stand change and a stale version is never missed. The server still accepts the
 * older screens that send neither (expand).
 */
function commandHeaders({ ifMatch = null, idempotencyKey = null } = {}) {
  if (!ifMatch || !idempotencyKey) {
    throw Object.assign(new Error(POSITION_PROBLEM_MESSAGES.expected_version_required),
      { status: 428, code: 'expected_version_required', reasons: [] });
  }
  return { ifMatch, idempotencyKey };
}

export const loadOccPositions = (stationId, date, { signal } = {}) =>
  guarded(() => client().getOccPositions(stationId, date, { signal }));

/**
 * Records the arrival (3-N08): the registration, the actual time in UTC (the screen converts it from the station's
 * local time; null is «now»), the aircraft type seen (3-B, optional) and, to correct a recorded arrival, the reason.
 */
export const recordOccArrival = (turnaroundId, { aircraftRegistration, arrivedAt = null, aircraftTypeId = null,
  reason = null }, headers) =>
  guarded(() => client().recordOccArrival(turnaroundId, { aircraftRegistration, arrivedAt, aircraftTypeId, reason },
    commandHeaders(headers)));

export const assignOccStand = (turnaroundId, standId, reason = null, headers) =>
  guarded(() => client().assignOccStand(turnaroundId, { standId, reason }, commandHeaders(headers)));

export const releaseOccStand = (turnaroundId, headers) =>
  guarded(() => client().releaseOccStand(turnaroundId, commandHeaders(headers)));

async function located(request) {
  try { return await request(); } catch (error) {
    if (error instanceof TypeError) throw new Error('La ubicación no es válida: elige un punto dentro del mapa.');
    const translated = translatePositionError(error);
    if (translated.status === 403) translated.message = 'Tu acceso no permite ubicar posiciones en el mapa.';
    if (translated.status === 400) translated.message = 'La ubicación no es válida: elige un punto dentro del mapa.';
    throw translated;
  }
}

/** Places a stand (WGS84) or clears it with null coordinates (ADR-0027). */
export const locateOccStand = (standId, latitude, longitude, operationDate) =>
  located(() => client().locateOccStand(standId, { latitude, longitude, operationDate }));
