import { addDays, businessToday, stationLocalToUtc } from '../../../services/businessDay';
import { normalizeStandCode } from '../../../services/standCodes';
import { endsItsVisit } from '../../maps/core/mapSelection';
import { standStateOf } from '../../maps/stands/standModel';
import { barGeometry } from '../../occ-ui/occTimelineModel';
import { isInOperation, STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { assignedStandCode, bestTime, hasMilestone, instantMs } from './boardModel';

// The band of «Posiciones» (contratos 2.5, design D.1): the ramp in time, one row per stand with its visits as bars of
// occ-ui/OccTimeline.jsx, under the «ahora» line, in a window of «4 h», «8 h» or the station's «Día». Pure. The stands
// are the positions board joined with the map flights (maps/stands/standModel.js: withStandDisplay), the same display
// the map draws; each visit's times are the best times of its map legs, else the board's. `nowMs` is the server's time.

const HOUR_MS = 3_600_000;

/** The windows of the band: around now (an hour back and three ahead, two back and six ahead) or the station's day. */
export const TIMELINE_RANGES = Object.freeze({
  '4h': Object.freeze({ beforeMs: HOUR_MS, afterMs: 3 * HOUR_MS }),
  '8h': Object.freeze({ beforeMs: 2 * HOUR_MS, afterMs: 6 * HOUR_MS }),
  day: Object.freeze({ stationDay: true }),
});

/** «Con vuelos» hides the stands without a visit in the window; «Todas» shows every stand. */
export const TIMELINE_FILTERS = Object.freeze(['withFlights', 'all']);

const NO_ROWS = Object.freeze([]);
const isObject = value => value !== null && typeof value === 'object';

/**
 * The window of the band at `nowMs`: `{ windowStart, windowEnd }` in milliseconds. `4h` and `8h` are around now; `day`
 * is the station's calendar day in `timeZone` (its midnight to the next, whatever the browser's zone). `null` without a
 * valid now; an unknown range throws.
 */
export function bandWindow(range, nowMs, timeZone) {
  const spec = TIMELINE_RANGES[range];
  if (!Object.hasOwn(TIMELINE_RANGES, range ?? '')) throw new RangeError(`Unknown console band range: ${String(range)}`);
  if (!Number.isFinite(nowMs)) return null;
  if (!spec.stationDay) return { windowStart: nowMs - spec.beforeMs, windowEnd: nowMs + spec.afterMs };
  const day = businessToday(new Date(nowMs), timeZone);
  return {
    windowStart: Date.parse(stationLocalToUtc(`${day}T00:00`, timeZone)),
    windowEnd: Date.parse(stationLocalToUtc(`${addDays(day, 1)}T00:00`, timeZone)),
  };
}

const flightsCache = new WeakMap();
// Before the first read of the flights: one empty Map, so a memo fed with it holds still too.
const NO_FLIGHTS_BY_TURNAROUND = new Map();

/**
 * The map flights by turnaround id, `Map<turnaroundId, legs>`, for the stand display (useStandDisplay), the map and the
 * band. The same array of flights (one read) always gives the same Map, and no flights the same empty Map, so a memo fed
 * with it holds still between reads.
 */
export function flightsByTurnaroundOf(flights) {
  if (!Array.isArray(flights)) return NO_FLIGHTS_BY_TURNAROUND;
  const cached = flightsCache.get(flights);
  if (cached) return cached;
  const byTurnaround = new Map();
  for (const flight of flights) {
    if (!isObject(flight) || typeof flight.turnaroundId !== 'string') continue;
    if (!byTurnaround.has(flight.turnaroundId)) byTurnaround.set(flight.turnaroundId, []);
    byTurnaround.get(flight.turnaroundId).push(flight);
  }
  for (const [id, legs] of byTurnaround) byTurnaround.set(id, Object.freeze(legs));
  flightsCache.set(flights, byTurnaround);
  return byTurnaround;
}

// The map flights by turnaround as a Map or a plain object, as the stand display takes them (standModel.js).
function entriesOf(flightsByTurnaround) {
  if (flightsByTurnaround instanceof Map) return [...flightsByTurnaround];
  return isObject(flightsByTurnaround) ? Object.entries(flightsByTurnaround) : [];
}

function legsOf(flightsByTurnaround, turnaroundId) {
  if (turnaroundId == null) return NO_ROWS;
  const value = flightsByTurnaround instanceof Map ? flightsByTurnaround.get(turnaroundId)
    : isObject(flightsByTurnaround) && Object.hasOwn(flightsByTurnaround, turnaroundId)
      ? flightsByTurnaround[turnaroundId] : null;
  return Array.isArray(value) ? value.filter(isObject) : NO_ROWS;
}

// A board time as a bar end: the recorded arrival is actual, the board's planned times are the schedule.
const boardTime = (at, kind) => {
  const ms = instantMs(at ?? null);
  return ms === null ? null : { at: ms, kind };
};

// Whether the visit's aircraft is on its stand, in the order the stand states read the evidence (standModel.js): the
// server's demo on-block instant; a recorded BLOCK_ON; the arrival leg's on-block time («Registrar llegada»); without
// the arrival leg, the board's recorded arrival.
function onTheStand(legs, arrival, turnaround, nowMs) {
  const demo = legs.map(leg => leg.demo).find(isObject) ?? null;
  const onBlockAt = instantMs(demo?.onBlockAt ?? null);
  if (onBlockAt !== null) return Number.isFinite(nowMs) && nowMs >= onBlockAt;
  if (legs.some(leg => hasMilestone(leg, 'BLOCK_ON'))) return true;
  if (arrival !== null) return arrival.actualAt != null && arrival.actualKind === 'OnBlock';
  return turnaround?.arrivedAt != null;
}

/** One visit as a bar of OccTimeline, with the keys the console selects with. */
function barOf({ turnaroundId, turnaround, legs, nowMs, estimatedKeys }) {
  const arrival = legs.find(leg => leg.direction === 'Arrival') ?? null;
  const departure = legs.find(leg => leg.direction === 'Departure') ?? null;
  const start = bestTime(arrival) ?? boardTime(turnaround?.arrivedAt, 'actual')
    ?? boardTime(turnaround?.arrivalScheduledAt, 'scheduled');
  const end = bestTime(departure) ?? boardTime(turnaround?.departureScheduledAt, 'scheduled');
  let state = 'planned';
  if (legs.some(endsItsVisit)) state = 'departed';
  else if (onTheStand(legs, arrival, turnaround, nowMs)) state = 'onStand';
  return {
    id: turnaroundId,
    turnaroundId,
    flightKey: (arrival ?? departure)?.flightKey ?? null,
    arrivalFlight: arrival?.flightNumber ?? turnaround?.arrivalFlightNumber ?? null,
    departureFlight: departure?.flightNumber ?? turnaround?.departureFlightNumber ?? null,
    startAt: start?.at ?? null, startKind: start?.kind ?? 'scheduled',
    endAt: end?.at ?? null, endKind: end?.kind ?? 'scheduled',
    state,
    estimated: legs.some(leg => estimatedKeys.has(leg.flightKey)),
    demo: turnaround?.isDemo === true || legs.some(leg => leg.isDemo === true),
    conflict: null,
    inOperation: legs.some(leg => isInOperation(leg)) || (isObject(turnaround) && isInOperation(turnaround)),
  };
}

const byStart = (left, right) => {
  const [a, b] = [left.startAt ?? Number.NEGATIVE_INFINITY, right.startAt ?? Number.NEGATIVE_INFINITY];
  if (a !== b) return a < b ? -1 : 1;
  return String(left.id).localeCompare(String(right.id));
};

/**
 * The rows of the band in the window `[windowStart, windowEnd]` (milliseconds), `{ rows: [{ id, label, bars }] }`, one
 * per stand in the order of `stands` (the withStandDisplay output of the console's stands; `label` is the stand code).
 * - The bars of a stand are the visits the positions board lists on it, plus the visits the map flights still assign to
 *   it that the board no longer lists (its PUSHBACK freed the stand, contratos 1.2, while the map keeps the assignment),
 *   in time order: `{ id, turnaroundId, flightKey, arrivalFlight, departureFlight, startAt, startKind, endAt, endKind,
 *   state, estimated, demo, conflict, inOperation }`, the shape of OccTimeline. Only bars inside the window are kept.
 * - A bar runs from the best time of its arrival leg to its departure leg's (`flightsByTurnaround`, the map flights by
 *   turnaround id, a Map or a plain object), else the board's times; a missing end stays open. `state` is `departed`
 *   once a leg ends the visit
 *   (maps/core/mapSelection.js: endsItsVisit, its PUSHBACK among them), `onStand` while the aircraft is on the stand,
 *   else `planned`. `estimated` when the map draws one of its legs at an estimated position (`aircraft`, the
 *   situation's), `demo` the server's mark, `inOperation` isInOperation.
 * - The stand's most pressing signal goes on the bar of the visit the stand shows (`display.visit`), with its words:
 *   `urgent` for `conflict`, `attention` for `uncovered` and `overdue` (contratos 2.4; `t` translates consoleMessages).
 * `filter` `withFlights` leaves out the stands without a bar in the window; `all` keeps every stand. An unknown filter
 * throws.
 */
export function buildStandTimeline({ stands = NO_ROWS, flightsByTurnaround = null, aircraft = NO_ROWS, nowMs,
  windowStart, windowEnd, filter = 'withFlights', t } = {}) {
  if (!TIMELINE_FILTERS.includes(filter)) throw new RangeError(`Unknown console band filter: ${String(filter)}`);
  const estimatedKeys = new Set((Array.isArray(aircraft) ? aircraft : [])
    .filter(item => item?.quality === 'estimated' && typeof item.flightKey === 'string').map(item => item.flightKey));
  // The map's visits by the stand they are assigned to.
  const mapVisits = new Map();
  for (const [turnaroundId, value] of entriesOf(flightsByTurnaround)) {
    const legs = Array.isArray(value) ? value.filter(isObject) : [];
    const code = legs.map(assignedStandCode).find(Boolean) ?? null;
    if (code === null) continue;
    if (!mapVisits.has(code)) mapVisits.set(code, []);
    mapVisits.get(code).push({ turnaroundId, legs });
  }

  const rows = [];
  for (const stand of Array.isArray(stands) ? stands : []) {
    if (!isObject(stand)) continue;
    const code = normalizeStandCode(stand.id ?? stand.code);
    if (code === '') continue;
    const listed = new Set();
    const bars = [];
    for (const turnaround of Array.isArray(stand.turnarounds) ? stand.turnarounds : NO_ROWS) {
      if (!isObject(turnaround) || turnaround.turnaroundId == null || listed.has(turnaround.turnaroundId)) continue;
      listed.add(turnaround.turnaroundId);
      bars.push(barOf({ turnaroundId: turnaround.turnaroundId, turnaround,
        legs: legsOf(flightsByTurnaround, turnaround.turnaroundId), nowMs, estimatedKeys }));
    }
    for (const { turnaroundId, legs } of mapVisits.get(code) ?? NO_ROWS) {
      if (!listed.has(turnaroundId)) bars.push(barOf({ turnaroundId, turnaround: null, legs, nowMs, estimatedKeys }));
    }
    const signal = (Array.isArray(stand.signals) ? stand.signals : NO_ROWS)[0] ?? null;
    const shown = stand.display?.visit?.turnaroundId ?? null;
    if (signal !== null && shown !== null) {
      const bar = bars.find(item => item.turnaroundId === shown);
      if (bar) bar.conflict = Object.freeze({ label: t(`band.signals.${signal.reason}`), signal: signal.kind });
    }
    const drawn = bars.filter(bar => barGeometry(bar, windowStart, windowEnd) !== null).sort(byStart)
      .map(bar => Object.freeze(bar));
    if (filter === 'withFlights' && drawn.length === 0) continue;
    rows.push(Object.freeze({ id: code, label: code, bars: Object.freeze(drawn) }));
  }
  return Object.freeze({ rows: Object.freeze(rows) });
}

/**
 * How many stands read each of the seven states of contratos 2.4 (maps/stands/standModel.js: standStateOf, the state
 * the map draws), for the folded «Posiciones»: `{ available, planned, arriving, occupied, releasing, disabled,
 * unverified }`.
 */
export function standCounts(stands = NO_ROWS) {
  const counts = Object.fromEntries(STAND_STATE_KEYS.map(key => [key, 0]));
  for (const stand of Array.isArray(stands) ? stands : NO_ROWS) {
    if (isObject(stand)) counts[standStateOf(stand)] += 1;
  }
  return Object.freeze(counts);
}
