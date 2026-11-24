import { FLIGHT_REPORT_MILESTONES } from '@elevant/api-client';
import type { RampAssignedOperationResponse, RampFlightLegResponse } from '@elevant/api-client';
import type { Tone } from '../../theme/colors';
import { isServiceFinished } from './handoff';

/**
 * What the agent reads about the flight at a glance, derived only from what the tablet already receives: the legs'
 * scheduled, estimated and actual times, the Flight Report milestones and the operation's status. Nothing here is
 * invented: a value the operation does not carry is null and the screen says «por confirmar».
 */

const MINUTE = 60_000;
/** IATA's on-time standard: a flight is late from 15 minutes on; under that it is only watched. */
export const DELAY_CRITICAL_MINUTES = 15;

type Leg = RampFlightLegResponse | null | undefined;

const instant = (value: string | null | undefined) => {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
};

/** The leg's best known time: actual, else estimated, else scheduled. */
export function legBestTime(leg: Leg) {
  return leg ? leg.actualAt ?? leg.estimatedAt ?? leg.scheduledAt : null;
}

/**
 * Minutes from the scheduled time to the actual one, or to the estimated one while there is no actual; null when the
 * leg has neither. Negative is early.
 */
export function legDelayMinutes(leg: Leg): number | null {
  if (!leg) return null;
  const scheduled = instant(leg.scheduledAt);
  const current = instant(leg.actualAt ?? leg.estimatedAt);
  if (scheduled === null || current === null) return null;
  return Math.round((current - scheduled) / MINUTE);
}

export type DelayReading = Readonly<{ minutes: number; text: string; spoken: string; tone: Tone }>;

/** «+12 min» in amber, «+25 min» in red, «A tiempo» in green, «−4 min» early in green; null without a reading. */
export function delayReading(minutes: number | null): DelayReading | null {
  if (minutes === null) return null;
  if (minutes === 0) return { minutes, text: 'A tiempo', spoken: 'a tiempo', tone: 'success' };
  if (minutes < 0) {
    return { minutes, text: `−${Math.abs(minutes)} min`, spoken: `${Math.abs(minutes)} minutos adelantado`,
      tone: 'success' };
  }
  return {
    minutes,
    text: `+${minutes} min`,
    spoken: `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'} de retraso`,
    tone: minutes >= DELAY_CRITICAL_MINUTES ? 'danger' : 'warning',
  };
}

/** The flight's phase on the ramp, in the order it happens. */
export type FlightPhase =
  | 'scheduled' | 'enroute' | 'landed' | 'onstand' | 'boarding' | 'closed' | 'pushback' | 'departed' | 'cancelled';

export const FLIGHT_PHASE_LABELS: Readonly<Record<FlightPhase, string>> = {
  scheduled: 'Programado',
  enroute: 'En ruta',
  landed: 'Aterrizado',
  onstand: 'En posición',
  boarding: 'Embarcando',
  closed: 'Puertas cerradas',
  pushback: 'Push-back',
  departed: 'Salió',
  cancelled: 'Cancelado',
};

/** The steps of the phase strip; «Puertas cerradas» and «Cancelado» are states of a step, not steps. */
export const FLIGHT_PHASE_STEPS: readonly FlightPhase[] =
  ['scheduled', 'enroute', 'landed', 'onstand', 'boarding', 'pushback', 'departed'];

export const FLIGHT_PHASE_TONES: Readonly<Record<FlightPhase, Tone>> = {
  scheduled: 'neutral',
  enroute: 'info',
  landed: 'info',
  onstand: 'brand',
  boarding: 'brand',
  closed: 'warning',
  pushback: 'warning',
  departed: 'success',
  cancelled: 'danger',
};

/** The Flight Report's catalog, read when needed (a test that mocks the client may leave it out). */
const catalog = () => FLIGHT_REPORT_MILESTONES ?? [];
const codesOf = (phases: readonly string[]) =>
  new Set(catalog().filter(item => phases.includes(item.phase)).map(item => item.code));

type MilestoneLike = Readonly<{ code: string }>;

/**
 * The phase from what is recorded, latest first: the departure's actual time, the push-back, the doors, boarding,
 * any arrival or on-stand milestone (the aircraft is on the stand), the arrival's actual time, an estimate for the
 * arrival (the flight is airborne and its ETA is published) and, without any of that, the schedule. An operation
 * that only departs skips the arrival's steps.
 */
export function flightPhase(
  operation: Pick<RampAssignedOperationResponse, 'turnaround' | 'operation'> & { milestones?: readonly MilestoneLike[] | null },
): FlightPhase {
  const { arrival, departure } = operation.turnaround;
  if (operation.operation.status === 'Cancelled') return 'cancelled';
  const codes = new Set((operation.milestones ?? []).map(item => item.code));
  if (departure?.actualAt) return 'departed';
  if (codes.has('PUSHBACK')) return 'pushback';
  if (codes.has('PAX_DOOR_CLOSED') || codes.has('CARGO_DOOR_CLOSED') || codes.has('BULK_CLOSED')) return 'closed';
  const departureCodes = codesOf(['departure']);
  if ([...codes].some(code => departureCodes.has(code))) return 'boarding';
  // Any other milestone of the Flight Report is recorded with the aircraft on the stand.
  if (codes.size > 0) return 'onstand';
  if (arrival?.actualAt) return 'landed';
  if (arrival?.estimatedAt) return 'enroute';
  return 'scheduled';
}

/** Where the phase sits on the strip: «Puertas cerradas» is still boarding's step. */
export function flightPhaseStep(phase: FlightPhase) {
  if (phase === 'closed') return FLIGHT_PHASE_STEPS.indexOf('boarding');
  if (phase === 'cancelled') return -1;
  return FLIGHT_PHASE_STEPS.indexOf(phase);
}

/** «1 h 19 min», «45 min», «2 h». */
export function formatDuration(minutes: number) {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * The time the aircraft spends on the ground at the station: from the arrival's best time to the departure's; null
 * when the operation lacks one of the legs or the times are reversed.
 */
export function groundTimeMinutes(turnaround: RampAssignedOperationResponse['turnaround']) {
  const from = instant(legBestTime(turnaround.arrival));
  const to = instant(legBestTime(turnaround.departure));
  if (from === null || to === null || to <= from) return null;
  return Math.round((to - from) / MINUTE);
}

export type NextEvent = Readonly<{ text: string; tone: Tone; icon: 'airplane' | 'log-in-outline' | 'log-out-outline' | 'time-outline' }>;

/**
 * The countdown to the next movement: «Llega en 25 min», «Sale en 1 h 5 min»; once its time passed without an
 * actual, «Llegada prevista hace 4 min». Null when nothing is pending (both legs happened or the flight is cancelled).
 */
export function nextEvent(
  operation: Pick<RampAssignedOperationResponse, 'turnaround' | 'operation'> & { milestones?: readonly MilestoneLike[] | null },
  now: number,
): NextEvent | null {
  const phase = flightPhase(operation);
  if (phase === 'cancelled' || phase === 'departed') return null;
  const { arrival, departure } = operation.turnaround;
  const arrived = Boolean(arrival?.actualAt) || phase !== 'scheduled' && phase !== 'enroute';
  const leg = arrival && !arrived ? arrival : departure && !departure.actualAt ? departure : null;
  if (!leg) return null;
  const at = instant(legBestTime(leg));
  if (at === null) return null;
  const isArrival = leg === arrival;
  const minutes = Math.round((at - now) / MINUTE);
  if (minutes >= 0) {
    return {
      text: `${isArrival ? 'Llega' : 'Sale'} en ${formatDuration(minutes)}`,
      tone: minutes <= 15 ? 'warning' : 'info',
      icon: isArrival ? 'log-in-outline' : 'log-out-outline',
    };
  }
  return {
    text: `${isArrival ? 'Llegada' : 'Salida'} prevista hace ${formatDuration(-minutes)}`,
    tone: 'danger',
    icon: 'time-outline',
  };
}

/** How many Flight Report milestones are recorded, of the catalog's. */
export function milestoneProgress(milestones: readonly MilestoneLike[] | null | undefined) {
  const known = new Set(catalog().map(item => item.code));
  const done = new Set((milestones ?? []).map(item => item.code).filter(code => known.has(code))).size;
  return { done, total: known.size };
}

/** How many services are finished (completed, not performed or with an exception), of the operation's. */
export function serviceProgress(services: readonly Readonly<{ status: string }>[]) {
  return { done: services.filter(service => isServiceFinished(service.status)).length, total: services.length };
}

/**
 * The airline's badge: its IATA code on a colour of its own, the same for every operation of the airline. There is no
 * logo in the contract, so the code stands in for it.
 */
const BADGE_COLORS = ['#0B4A9B', '#0E6B5C', '#6B3FA0', '#8A3B12', '#1F5F8B', '#5B4636', '#7A2E55', '#2F5D2A'];

export function airlineBadge(airline: Readonly<{ iataCode?: string | null; icaoCode?: string | null; name?: string | null }>) {
  const code = (airline.iataCode || airline.icaoCode || airline.name || '?').trim().toUpperCase();
  const initials = /^[A-Z0-9]{2,3}$/.test(code) ? code.slice(0, 2)
    : code.split(/\s+/).map(word => word[0]).join('').slice(0, 2);
  let hash = 0;
  for (const char of code) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { initials, color: BADGE_COLORS[hash % BADGE_COLORS.length] };
}

/** «B738 · Boeing 737-800», the type as the ramp names it; null without an aircraft. */
export function aircraftTypeLabel(aircraft: RampAssignedOperationResponse['turnaround']['aircraft']) {
  if (!aircraft) return null;
  const model = [aircraft.manufacturer, aircraft.model].filter(Boolean).join(' ');
  return aircraft.icaoCode ? `${aircraft.icaoCode} · ${model}` : model;
}

/** «1.234» passengers or kilograms, as the forms print them; «—» without a value. */
export function formatCount(value: number | null | undefined) {
  return typeof value === 'number' ? value.toLocaleString('es-DO') : '—';
}
