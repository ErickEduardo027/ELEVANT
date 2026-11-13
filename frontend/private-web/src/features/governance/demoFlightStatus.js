import { BUSINESS_TIME_ZONE } from '../../services/businessDay';
import { OPERATION_STATUS_LABELS, operationStatusLabel as sharedOperationStatusLabel } from '../operations/operationLabels';

/**
 * Where a demo flight is (ADR-0041), computed in the browser between two reads of «Vuelos demo de hoy». The server owns
 * every instant (`DemoFlightTimeline`) and the state: this module only compares those instants with the server's clock,
 * as this browser estimates it from the `serverTime` of the last read. A flight is never declared cancelled or
 * finished here.
 */

/** The phases in which the aircraft moves: the list is read every 5 s while one does (contracts 2.7). */
const MOVING_PHASES = new Set(['Approach', 'TaxiIn', 'TaxiOut']);

const PHASE_LABELS = Object.freeze({
  Approach: 'En aproximación',
  TaxiIn: 'Aterrizó, rueda a la posición',
  Parked: 'En posición',
  TaxiOut: 'Saliendo',
  Departed: 'Despegó',
  Gone: 'Terminado',
});

/** An instant of the API in milliseconds; NaN when there is none. The engines differ beyond milliseconds. */
function instant(value) {
  return typeof value === 'string' ? Date.parse(value.replace(/(\.\d{3})\d+/, '$1')) : Number.NaN;
}

/** True once `value` is reached; an instant that is still null never is. */
const reached = (value, nowMs) => {
  const at = instant(value);
  return Number.isFinite(at) && nowMs >= at;
};

/**
 * How far this browser's clock is behind the server's (milliseconds to add to `Date.now()`). The server stamped its
 * time somewhere between the request and the answer: the middle of the round trip is the best guess. Without a valid
 * time the offset is 0.
 *
 * @param {string} serverTimeIso the `serverTime` of the answer
 * @param {number} sentAtMs this browser's clock when the request left
 * @param {number} receivedAtMs this browser's clock when the answer arrived
 */
export function serverClockOffset(serverTimeIso, sentAtMs, receivedAtMs) {
  const server = instant(serverTimeIso);
  if (!Number.isFinite(server) || !Number.isFinite(sentAtMs) || !Number.isFinite(receivedAtMs)) return 0;
  return Math.round(server - (sentAtMs + Math.max(sentAtMs, receivedAtMs)) / 2);
}

/**
 * The phase at `nowMs` (the server's clock), by the rule of `DemoFlightTimeline.PhaseAt`: what already happened last
 * decides. A cancelled flight vanished at its cancel instant, so it is gone.
 *
 * @returns {'Approach' | 'TaxiIn' | 'Parked' | 'TaxiOut' | 'Departed' | 'Gone'}
 */
export function demoFlightPhase(flight, nowMs) {
  if (reached(flight.vanishAt, nowMs)) return 'Gone';
  if (reached(flight.takeoffAt, nowMs)) return 'Departed';
  if (nowMs < instant(flight.touchdownAt)) return 'Approach';
  if (nowMs < instant(flight.onBlockAt)) return 'TaxiIn';
  return reached(flight.offBlockAt, nowMs) ? 'TaxiOut' : 'Parked';
}

/** An active flight whose aircraft is on approach, taxiing in or taxiing out at `nowMs`. */
export function isMoving(flight, nowMs) {
  return flight.state === 'Active' && MOVING_PHASES.has(demoFlightPhase(flight, nowMs));
}

/**
 * What the superadministrator can still do: «Cancelar vuelo» before touchdown, «Terminar demo» while the aircraft taxies
 * in or waits at its stand, nothing once it leaves. An imported aircraft whose departure is already decided (the
 * push-back, the hand-off, an earlier «Terminar demo» or the end of its wait) has nothing left to end.
 *
 * @returns {'Cancel' | 'Finish' | null}
 */
export function demoFlightAction(flight, nowMs) {
  if (flight.state !== 'Active' || (flight.imported && flight.offBlockAt)) return null;
  const phase = demoFlightPhase(flight, nowMs);
  if (phase === 'Approach') return 'Cancel';
  return phase === 'TaxiIn' || phase === 'Parked' ? 'Finish' : null;
}

/** The label of the row: the server's state when it ended the flight, otherwise where the aircraft is. */
export function phaseLabel(state, phase) {
  if (state === 'Cancelled') return 'Cancelado';
  if (phase === 'Departed') return PHASE_LABELS.Departed;
  if (state === 'Finished') return 'Terminado';
  return PHASE_LABELS[phase] ?? '';
}

/** «4 min 20 s», «45 s», «1 h 5 min»: what is left until an instant, never negative. */
function duration(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  if (minutes > 0) return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
  return `${seconds} s`;
}

/**
 * A clock time of the 24-hour day in `timeZone` («10:08»), AVIAM's calendar when the zone is unknown; a dash without
 * an instant.
 */
export function clockTime(value, timeZone = BUSINESS_TIME_ZONE) {
  const at = instant(value);
  if (!Number.isFinite(at)) return '—';
  const format = zone => new Intl.DateTimeFormat('es-DO', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    timeZone: zone }).format(new Date(at));
  try {
    return format(timeZone);
  } catch {
    return format(BUSINESS_TIME_ZONE);
  }
}

/**
 * The time line of a row at `nowMs` (the server's clock): a countdown while the aircraft is on its way to the stand or
 * to the runway, clock times in `timeZone` otherwise.
 */
export function countdownText(flight, nowMs, timeZone) {
  const at = value => clockTime(value, timeZone);
  if (flight.state === 'Cancelled') return `Cancelado a las ${at(flight.vanishAt)}`;
  switch (demoFlightPhase(flight, nowMs)) {
    case 'Approach':
    case 'TaxiIn':
      return `Llega a la posición en ${duration(instant(flight.onBlockAt) - nowMs)}`;
    case 'Parked': {
      const parked = `En posición desde las ${at(flight.onBlockAt)}`;
      if (flight.offBlockAt) return `${parked} · Sale a las ${at(flight.offBlockAt)}`;
      // An imported aircraft waits for its agent: it leaves with the push-back the tablet records.
      return nowMs < instant(flight.scheduledOffBlockAt)
        ? `${parked} · Salida programada a las ${at(flight.scheduledOffBlockAt)}`
        : `${parked} · Espera el push-back del agente`;
    }
    case 'TaxiOut':
      return `Despega en ${duration(instant(flight.takeoffAt) - nowMs)}`;
    case 'Departed':
      return `Despegó a las ${at(flight.takeoffAt)}`;
    default:
      return `Terminó a las ${at(flight.vanishAt)}`;
  }
}

/**
 * The state of OCC's operation once the flight is imported («Operación asignada», «Operación en curso»…); an empty text
 * without one. A state this screen does not know is named, never shown as a raw English word.
 */
export function operationStatusLabel(status) {
  if (typeof status !== 'string' || !status) return '';
  return Object.hasOwn(OPERATION_STATUS_LABELS, status)
    ? `Operación ${OPERATION_STATUS_LABELS[status].toLowerCase()}`
    : `Operación: ${sharedOperationStatusLabel(status)}`;
}
