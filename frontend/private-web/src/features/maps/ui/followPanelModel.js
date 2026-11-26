import { haversineM } from '../airport/geo';
import { stationTime } from '../traffic/stationTime';
import { operationStatusLabel } from '../../operations/operationLabels';

// What the panel of «Seguir en 3D» says of the followed aircraft (CN-30): the flight (identity, route, what it does in
// the air or on the ground, how far from Punta Cana and when it arrives) and, for an ELEVANT flight, its operation
// (code, state, stand, the times of its leg, the delay, the milestones recorded) from the map flight row the screen
// already read. Nothing is read here: the panel passes the aircraft the map draws and its row. Pure.

const FEET_PER_METRE = 3.28084;
const KNOTS_PER_MS = 1.943844;
const FPM_PER_MS = 196.8504;
const NM_M = 1852;
// Below this a vertical rate is level flight; below this ground speed an aircraft on the ground stands still.
const LEVEL_FPM = 300;
const STILL_KT = 2;
// Faster than this on the ground is a landing or take-off roll.
const ROLL_KT = 40;
// The phases of the motion on the ground.
const GROUND_PHASES = new Set(['landing', 'taxiIn', 'parked', 'holding', 'pushback', 'taxiOut', 'takeoff']);

const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = value => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const instant = value => {
  if (finite(value)) return value;
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
};
const OPERATOR = /^([A-Z]{3})\d/;

/** The words of each phase the motion names (kinematics/estimator.js, legPlans.js), as the panel's keys. */
export const FOLLOW_PHASES = Object.freeze({
  enroute: 'enroute', descent: 'descent', approach: 'approach', final: 'final', landing: 'landing', taxiIn: 'taxiIn',
  parked: 'parked', holding: 'holding', pushback: 'pushback', taxiOut: 'taxiOut', takeoff: 'takeoff', climb: 'climb',
});

/**
 * The phase key of an aircraft: the motion's own when it names one, else from what it does: on the ground taxiing or
 * stopped, in the air climbing, descending or level.
 */
export function phaseKeyOf(item) {
  const phase = text(item?.phase);
  const ground = item?.onGround === true;
  // The motion's phase, when it agrees with what the signal says (a live fix on the runway is not «on final»).
  if (phase && FOLLOW_PHASES[phase] && GROUND_PHASES.has(phase) === ground) return FOLLOW_PHASES[phase];
  const kt = finite(item?.gsMs) ? item.gsMs * KNOTS_PER_MS : 0;
  if (ground) {
    if (kt >= ROLL_KT) return phase === 'takeoff' || phase === 'climb' ? 'takeoff' : 'landing';
    return kt >= STILL_KT ? 'taxiing' : 'stopped';
  }
  const fpm = finite(item?.vrateMs) ? item.vrateMs * FPM_PER_MS : 0;
  if (fpm >= LEVEL_FPM) return 'climb';
  if (fpm <= -LEVEL_FPM) return 'descent';
  return 'cruise';
}

/**
 * The flight facts of the followed aircraft (`item`, as the map draws it) and its map flight row (`flight`, or null for
 * other traffic): `{ title, subtitle, airline, type, registration, from, to, altitude: { ft, ground }, speedKt,
 * verticalFpm, headingDeg, squawk, distanceNm, etaMin, phase, source }`; numbers rounded as the panel shows them, null
 * when unknown. `station` is `{ code, point: [lng, lat] }` (Punta Cana by default from the caller).
 */
export function flightFacts(item, flight = null, { station = null } = {}) {
  if (!item) return null;
  const callsign = text(item.callsign) ?? text(flight?.callsign);
  const flightNumber = text(item.flightNumber) ?? text(flight?.flightNumber);
  const title = flightNumber ?? callsign ?? text(item.registration) ?? (text(item.hex)?.toUpperCase() ?? '—');
  const counterpart = text(flight?.counterpart?.iataCode) ?? text(flight?.counterpart?.icaoCode) ?? text(item.counterpartIata);
  const departure = flight?.direction === 'Departure' || item.direction === 'Departure';
  const here = text(station?.code);
  let from = null;
  let to = null;
  if (counterpart !== null || flight !== null) {
    from = departure ? here : counterpart;
    to = departure ? counterpart : here;
  }
  const ground = item.onGround === true;
  const ft = !ground && finite(item.altM) ? Math.round((item.altM * FEET_PER_METRE) / 25) * 25 : null;
  const speedKt = finite(item.gsMs) ? Math.round(item.gsMs * KNOTS_PER_MS) : null;
  const verticalFpm = !ground && finite(item.vrateMs) ? Math.round((item.vrateMs * FPM_PER_MS) / 50) * 50 : null;
  const headingDeg = finite(item.trackDeg) ? Math.round(((item.trackDeg % 360) + 360) % 360) % 360 : null;
  const point = Array.isArray(station?.point) ? station.point : null;
  const distanceM = point && finite(item.lon) && finite(item.lat) ? haversineM([item.lon, item.lat], point) : null;
  const distanceNm = distanceM === null ? null : Math.round((distanceM / NM_M) * 10) / 10;
  // How long until it arrives at the speed it flies, for an arrival still in the air.
  const etaMin = !departure && !ground && distanceM !== null && finite(item.gsMs) && item.gsMs > 10
    ? Math.max(1, Math.round(distanceM / item.gsMs / 60)) : null;
  return Object.freeze({
    title,
    subtitle: [flightNumber !== null && flightNumber !== title ? flightNumber : null,
      callsign !== null && callsign !== title ? callsign : null].filter(Boolean).join(' / ') || null,
    airline: text(flight?.airline?.name) ?? (callsign ? OPERATOR.exec(callsign)?.[1] ?? null : null),
    type: text(item.typeIcao) ?? text(flight?.aircraft?.typeIcaoCode),
    registration: text(item.registration) ?? text(flight?.aircraft?.registration),
    from,
    to,
    altitude: Object.freeze({ ft, ground }),
    speedKt,
    verticalFpm,
    headingDeg,
    squawk: text(item.squawk),
    distanceNm,
    etaMin,
    phase: phaseKeyOf(item),
    source: item.isDemo === true ? 'demo' : (text(item.quality) ?? 'live'),
  });
}

/**
 * The operation of an ELEVANT flight row (`flight`, a map flight): `{ code, status, stand, terminal, direction,
 * scheduled, estimated, actual, delayMin, milestones: [{ code, at }], mismatch }`, the times as the station's «14:02»;
 * null without a row. `mismatch` is the aircraft's `standMismatch` (CN-31) when it stands at another stand.
 */
export function operationFacts(flight, item = null, { locale, language = 'es' } = {}) {
  if (!flight) return null;
  const scheduledMs = instant(flight.scheduledAt);
  const estimatedMs = instant(flight.estimatedAt);
  const actualMs = instant(flight.actualAt);
  const best = actualMs ?? estimatedMs;
  const delayMin = scheduledMs !== null && best !== null ? Math.round((best - scheduledMs) / 60_000) : null;
  const milestones = (Array.isArray(flight.milestones) ? flight.milestones : [])
    .map(entry => ({ code: text(entry?.code), atMs: instant(entry?.actualAt) }))
    .filter(entry => entry.code !== null && entry.atMs !== null)
    .sort((a, b) => a.atMs - b.atMs)
    .map(entry => Object.freeze({ code: entry.code, at: stationTime(entry.atMs, locale) }));
  return Object.freeze({
    code: text(flight.turnaround?.operationCode),
    // The operation's state in the words of the operations (En curso, Asignada…).
    status: text(flight.turnaround?.operationStatus) ? operationStatusLabel(flight.turnaround.operationStatus, language) : null,
    phase: text(flight.phase),
    stand: text(flight.stand?.code) ?? text(flight.suggestedStandCode),
    terminal: text(flight.stand?.terminalCode),
    direction: flight.direction === 'Departure' ? 'departure' : 'arrival',
    imported: flight.imported === true,
    scheduled: stationTime(scheduledMs, locale),
    estimated: stationTime(estimatedMs, locale),
    actual: stationTime(actualMs, locale),
    delayMin,
    milestones: Object.freeze(milestones),
    mismatch: item?.standMismatch ?? null,
  });
}
