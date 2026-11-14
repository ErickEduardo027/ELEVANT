import { parseInstant } from '../../../services/serverClock';
import { normalizeStandCode } from '../../../services/standCodes';
import { endsItsVisit, matchFlight } from '../../maps/core/mapSelection';
import { isInOperation } from '../../occ-ui/statusVocabulary';
import { missingResources } from '../dashboardModel';

// The console's «Tablero» (contratos 2.5): «Llegadas», «Salidas» and «Escalas», with the flights still to import folded
// in, as flight strips (occ-ui/OccFlightStrip.jsx) sorted by their best time. Pure. The legs are the map flights the map
// draws (contratos 1.3, from the maps lane's useMapSituation), never a second read of them; the planning snapshot adds
// the resources of each turnaround (stand and agents) and the turnarounds of the day the map's window leaves out, so
// nothing the old turnaround table showed is lost (design D.1). `nowMs` is the server's time in milliseconds.

const MINUTE_MS = 60_000;

/**
 * An arrival without a stand turns amber once it is due within this long: the hour of contratos 2.4, the one the stand
 * signals use for a flight due on a stand nobody covers.
 */
export const DUE_SOON_MS = 60 * MINUTE_MS;

/** The filters of «Escalas», the old turnaround table's. */
export const VISIT_FILTERS = Object.freeze(['all', 'inOperation', 'needsResources', 'completed']);

/** The status words of a strip (consoleMessages `status.*`). */
export const FLIGHT_STATUS_KEYS = Object.freeze(['noStand', 'approaching', 'enroute', 'landed', 'onStand', 'inOperation',
  'scheduled', 'departed', 'cancelled', 'diverted', 'completed', 'unknown']);

const TIME_FIELDS = Object.freeze([['actualAt', 'actual'], ['estimatedAt', 'estimated'], ['scheduledAt', 'scheduled']]);
const CLOSED = new Set(['completed', 'cancelled', 'diverted']);
const NO_ROWS = Object.freeze([]);

const normalize = value => String(value ?? '').replace(/[\s_-]+/g, '').toLowerCase();
const isObject = value => value !== null && typeof value === 'object';

/** Milliseconds of an instant the API wrote (up to seven decimals), of a number of milliseconds, or `null`. */
export function instantMs(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const strict = parseInstant(value);
  if (strict !== null) return strict;
  const loose = Date.parse(value);
  return Number.isFinite(loose) ? loose : null;
}

/**
 * The best time of a leg (a map flight or a planning leg): its actual time, else its estimate, else its schedule, as
 * `{ at, kind }` with `at` in milliseconds and `kind` `actual`, `estimated` or `scheduled`; `null` without any.
 */
export function bestTime(leg) {
  if (!isObject(leg)) return null;
  for (const [field, kind] of TIME_FIELDS) {
    const at = instantMs(leg[field]);
    if (at !== null) return Object.freeze({ at, kind });
  }
  return null;
}

/** Whether the operation of a leg has the milestone `code` with a time (the map flights carry the recorded ones). */
export function hasMilestone(leg, code) {
  return Array.isArray(leg?.milestones) && leg.milestones.some(item => item?.code === code && item.actualAt != null);
}

/** The normalized code of the stand assigned to a leg, never the suggestion of a demo flight; `null` without one. */
export function assignedStandCode(leg) {
  const code = normalizeStandCode(leg?.stand?.code);
  return code === '' ? null : code;
}

const dueSoon = (time, nowMs) => time !== null && Number.isFinite(nowMs) && time.at - nowMs <= DUE_SOON_MS;

/**
 * What a map flight is doing, as a status key and its signal (contratos 2.4: a normal state carries no hue):
 * - a cancelled or diverted leg asks for attention; a turnaround Completed is `completed`;
 * - an arrival without an assigned stand is «Llegada sin posición asignada» (`noStand`), amber once it is due within
 *   DUE_SOON_MS (or overdue);
 * - a departure that departed (its phase, or its PUSHBACK) is `departed`;
 * - a visit in operation (isInOperation: its turnaround InProgress, or its operation InProgress or Returned) is
 *   `inOperation`; an aircraft on its stand (the arrival arrived, or BLOCK_ON recorded) is `onStand`;
 * - otherwise the phase: an arrival `approaching`, `landed`, `enroute` (also when it departed from its origin) or
 *   `scheduled`; a departure `scheduled`. Anything else is `unknown`.
 * Returns `{ key, signal }`, `signal` `null` or `attention`.
 */
export function flightStatus(flight, { nowMs } = {}) {
  const phase = normalize(flight?.phase);
  const arrival = flight?.direction === 'Arrival';
  if (phase === 'cancelled') return { key: 'cancelled', signal: 'attention' };
  if (phase === 'diverted') return { key: 'diverted', signal: 'attention' };
  if (normalize(flight?.turnaround?.status) === 'completed') return { key: 'completed', signal: null };
  if (arrival && assignedStandCode(flight) === null) {
    return { key: 'noStand', signal: dueSoon(bestTime(flight), nowMs) ? 'attention' : null };
  }
  if (!arrival && (phase === 'departed' || phase === 'enroute' || hasMilestone(flight, 'PUSHBACK'))) {
    return { key: 'departed', signal: null };
  }
  if (isInOperation(flight)) return { key: 'inOperation', signal: null };
  if (phase === 'arrived' || hasMilestone(flight, 'BLOCK_ON')) return { key: 'onStand', signal: null };
  if (arrival) {
    if (phase === 'landed') return { key: 'landed', signal: null };
    if (phase === 'approaching') return { key: 'approaching', signal: null };
    if (phase === 'enroute' || phase === 'departed') return { key: 'enroute', signal: null };
  }
  return { key: phase === 'scheduled' ? 'scheduled' : 'unknown', signal: null };
}

// The status of a planning leg the map's window leaves out: only what the planning snapshot knows.
function planningLegStatus(turnaround, leg, direction, nowMs) {
  const status = normalize(turnaround.status);
  if (status === 'cancelled') return { key: 'cancelled', signal: 'attention' };
  if (status === 'diverted') return { key: 'diverted', signal: 'attention' };
  if (status === 'completed') return { key: 'completed', signal: null };
  if (direction === 'Arrival' && !turnaround.stand?.code) {
    return { key: 'noStand', signal: dueSoon(bestTime(leg), nowMs) ? 'attention' : null };
  }
  if (direction === 'Departure' && leg.actualAt) return { key: 'departed', signal: null };
  if (isInOperation(turnaround)) return { key: 'inOperation', signal: null };
  if (direction === 'Arrival' && leg.actualAt) return { key: 'landed', signal: null };
  return { key: 'scheduled', signal: null };
}

const sortValue = time => (time === null ? Number.POSITIVE_INFINITY : time.at);

// By the best time, then the flight number and the id, so equal times keep one order whatever the server sent.
function byTime(left, right) {
  if (left.sortAt !== right.sortAt) return left.sortAt < right.sortAt ? -1 : 1;
  const byNumber = String(left.flightNumber ?? '').localeCompare(String(right.flightNumber ?? ''));
  return byNumber || String(left.id).localeCompare(String(right.id));
}

function strip(fields, status, t) {
  return Object.freeze({
    ...fields,
    status: Object.freeze({ key: status.key, label: t(`status.${status.key}`), signal: status.signal }),
    sortAt: sortValue(fields.time),
  });
}

/** One map flight as a strip of the board: the shape of OccFlightStrip plus the keys the console selects with. */
function mapStrip(flight, { nowMs, t, estimatedKeys }) {
  return strip({
    id: flight.flightKey, flightKey: flight.flightKey, visitKey: flight.visitKey ?? null, legId: flight.legId ?? null,
    turnaroundId: flight.turnaroundId ?? null, proposalId: flight.proposalId ?? null,
    imported: flight.imported === true, direction: flight.direction, flightNumber: flight.flightNumber ?? '',
    counterpartIata: flight.counterpart?.iataCode ?? null,
    time: bestTime(flight), standCode: assignedStandCode(flight),
    demo: flight.isDemo === true, estimated: estimatedKeys.has(flight.flightKey),
  }, flightStatus(flight, { nowMs }), t);
}

/** A leg of a planning turnaround as a strip (`flightKey` null: the map does not hold it). */
function planningStrip(turnaround, leg, direction, { nowMs, t }) {
  const counterpart = direction === 'Arrival' ? leg.origin : leg.destination;
  return strip({
    id: leg.id ? `l:${leg.id}` : `${turnaround.id}:${direction}`, flightKey: null, visitKey: `t:${turnaround.id}`,
    legId: leg.id ?? null, turnaroundId: turnaround.id, proposalId: null, imported: true, direction,
    flightNumber: leg.flightNumber ?? '', counterpartIata: counterpart?.iataCode ?? null, time: bestTime(leg),
    standCode: assignedStandCode(turnaround), demo: turnaround.isDemo === true, estimated: false,
  }, planningLegStatus(turnaround, leg, direction, nowMs), t);
}

/** A flight the feed proposes that OCC has not imported: it waits in «Por importar». */
export const isToImport = item => item?.proposalId != null && item.imported !== true;

// Whether the aircraft of a visit is on its stand: the server's demo on-block instant has come, BLOCK_ON is recorded,
// or the arrival arrived. A visit a leg ends (its PUSHBACK, a departure gone) is never on it.
function onStandOf(legs, nowMs) {
  const demo = legs.map(leg => leg.demo).find(isObject) ?? null;
  const onBlockAt = instantMs(demo?.onBlockAt ?? null);
  if (onBlockAt !== null) return Number.isFinite(nowMs) && nowMs >= onBlockAt;
  return legs.some(leg => hasMilestone(leg, 'BLOCK_ON')) || legs.some(leg => leg.direction === 'Arrival'
    && normalize(leg.phase) === 'arrived');
}

function firstTime(...items) {
  const times = items.map(item => item?.sortAt).filter(Number.isFinite);
  return times.length > 0 ? Math.min(...times) : Number.POSITIVE_INFINITY;
}

function visit(fields) {
  return Object.freeze({ ...fields, completed: normalize(fields.status) === 'completed' });
}

/**
 * A visit of the map: the legs of one turnaround (one visitKey) with the planning turnaround, if the day has it. A leg
 * the map's window leaves out (a departure far ahead) comes from the planning snapshot.
 */
function mapVisit(turnaroundId, legs, strips, plan, context) {
  const arrivalLeg = legs.find(leg => leg.direction === 'Arrival') ?? null;
  const departureLeg = legs.find(leg => leg.direction === 'Departure') ?? null;
  const arrival = arrivalLeg ? strips.get(arrivalLeg.flightKey)
    : (plan?.arrival ? planningStrip(plan, plan.arrival, 'Arrival', context) : null);
  const departure = departureLeg ? strips.get(departureLeg.flightKey)
    : (plan?.departure ? planningStrip(plan, plan.departure, 'Departure', context) : null);
  const turnaround = legs.map(leg => leg.turnaround).find(isObject) ?? null;
  const ended = legs.some(endsItsVisit);
  const visitKey = (arrivalLeg ?? legs[0]).visitKey ?? `t:${turnaroundId}`;
  return visit({
    id: visitKey, visitKey, turnaroundId,
    operationCode: turnaround?.operationCode ?? plan?.operationCode ?? null,
    airlineName: (arrivalLeg ?? departureLeg)?.airline?.name ?? plan?.airline?.name ?? null,
    arrival: arrival ?? null, departure: departure ?? null,
    standCode: arrival?.standCode ?? departure?.standCode ?? (plan ? assignedStandCode(plan) : null),
    status: turnaround?.status ?? plan?.status ?? null,
    inOperation: legs.some(leg => isInOperation(leg)) || (plan !== null && isInOperation(plan)),
    onStand: !ended && onStandOf(legs, context.nowMs),
    ended,
    // Unknown (null) until the planning snapshot has the turnaround: the map flights carry no agents.
    missing: plan ? Object.freeze(missingResources(plan)) : null,
    agentsCount: plan ? (plan.agents ?? []).length : null,
    demo: legs.some(leg => leg.isDemo === true) || plan?.isDemo === true,
    sortAt: firstTime(arrival, departure),
    source: 'map',
  });
}

/** A turnaround of the day the map's window leaves out (earlier today, or without legs in it). */
function planningVisit(turnaround, context) {
  const arrival = turnaround.arrival ? planningStrip(turnaround, turnaround.arrival, 'Arrival', context) : null;
  const departure = turnaround.departure ? planningStrip(turnaround, turnaround.departure, 'Departure', context) : null;
  return visit({
    id: `t:${turnaround.id}`, visitKey: `t:${turnaround.id}`, turnaroundId: turnaround.id,
    operationCode: turnaround.operationCode ?? null, airlineName: turnaround.airline?.name ?? null, arrival, departure,
    standCode: assignedStandCode(turnaround), status: turnaround.status ?? null, inOperation: isInOperation(turnaround),
    onStand: false, ended: CLOSED.has(normalize(turnaround.status)) || Boolean(turnaround.departure?.actualAt),
    missing: Object.freeze(missingResources(turnaround)), agentsCount: (turnaround.agents ?? []).length,
    demo: turnaround.isDemo === true, sortAt: firstTime(arrival, departure), source: 'planning',
  });
}

const byVisitTime = (left, right) => (left.sortAt !== right.sortAt ? (left.sortAt < right.sortAt ? -1 : 1)
  : String(left.id).localeCompare(String(right.id)));

/**
 * The board of the console at `nowMs`:
 * - `arrivals` and `departures`: the map flights of the station (`flights`, contratos 1.3) as strips sorted by their
 *   best time, each `{ id, flightKey, visitKey, legId, turnaroundId, proposalId, imported, direction, flightNumber,
 *   counterpartIata, time: { at, kind } | null, standCode, status: { key, label, signal }, demo, estimated, sortAt }`
 *   (the shape of OccFlightStrip). `standCode` is the assigned stand, never the suggestion of a demo flight; `demo` is
 *   the server's mark; `estimated` only when the aircraft the map draws for that flight is at an estimated position
 *   (`aircraft`, the situation's, quality `estimated`): a demo or estimated time already says «est.» by its kind.
 * - `toImport`: `{ arrivals, departures }`, the flights the feed proposes that OCC has not imported (a proposal not
 *   imported: the contracted airlines' flights the map flights already carry), demo ones included and marked. They are
 *   not repeated in `arrivals` and `departures`.
 * - `visits`: «Escalas», one per visit with a turnaround: the map's legs of each turnaround (their visitKey), a leg the
 *   window leaves out taken from the planning snapshot, then the turnarounds of the day (`planningTurnarounds`, the
 *   snapshot as the API sends it) the window leaves out whole. Each `{ id, visitKey,
 *   turnaroundId, operationCode, airlineName, arrival, departure, standCode, status, inOperation, onStand, ended,
 *   completed, missing, agentsCount, demo, sortAt, source }`; `missing` (`stand`, `agents`) and `agentsCount` come from
 *   the planning turnaround and are `null` while it is unknown.
 * - `counts`: `{ arrivals, departures, toImport, visits }`.
 * `t` translates consoleMessages (the status words).
 */
export function buildBoard({ flights = NO_ROWS, aircraft = NO_ROWS, planningTurnarounds = null, nowMs, t } = {}) {
  const rows = (Array.isArray(flights) ? flights : []).filter(row => isObject(row) && typeof row.flightKey === 'string');
  const estimatedKeys = new Set((Array.isArray(aircraft) ? aircraft : [])
    .filter(item => item?.quality === 'estimated' && typeof item.flightKey === 'string').map(item => item.flightKey));
  const context = { nowMs, t, estimatedKeys };
  const strips = new Map(rows.map(row => [row.flightKey, mapStrip(row, context)]));
  const sorted = [...strips.values()].sort(byTime);
  const shown = sorted.filter(item => !isToImport(item));
  const pending = sorted.filter(isToImport);

  const plans = new Map((Array.isArray(planningTurnarounds) ? planningTurnarounds : [])
    .filter(item => isObject(item) && typeof item.id === 'string').map(item => [item.id, item]));
  // The legs of each turnaround, the two of a visit together. A pair still to import has no turnaround yet: it waits in
  // «Por importar».
  const groups = new Map();
  for (const row of rows) {
    if (typeof row.turnaroundId !== 'string' || row.turnaroundId === '') continue;
    if (!groups.has(row.turnaroundId)) groups.set(row.turnaroundId, []);
    groups.get(row.turnaroundId).push(row);
  }
  const visits = [...groups].map(([turnaroundId, legs]) => mapVisit(turnaroundId, legs, strips,
    plans.get(turnaroundId) ?? null, context));
  for (const [id, turnaround] of plans) {
    if (!groups.has(id)) visits.push(planningVisit(turnaround, context));
  }
  visits.sort(byVisitTime);

  const toImport = Object.freeze({
    arrivals: Object.freeze(pending.filter(item => item.direction === 'Arrival')),
    departures: Object.freeze(pending.filter(item => item.direction === 'Departure')),
  });
  const arrivals = Object.freeze(shown.filter(item => item.direction === 'Arrival'));
  const departures = Object.freeze(shown.filter(item => item.direction === 'Departure'));
  return Object.freeze({
    arrivals, departures, toImport, visits: Object.freeze(visits),
    counts: Object.freeze({ arrivals: arrivals.length, departures: departures.length,
      toImport: toImport.arrivals.length + toImport.departures.length, visits: visits.length }),
  });
}

/**
 * The `flightId` the console writes through the one selection store (contratos 2.1, maps/core/useMapSelection.js) for
 * an item of the board, the band or the pending list (anything with `flightKey`, `legId` or `turnaroundId`): the
 * flightKey of the map flight that matchFlight finds for it (a leg id or a turnaround id included), so the map, the
 * board and the inspector speak of the same leg; without a map flight, the leg id or the turnaround id, which the URL
 * accepts as well. `null` when the item names no flight.
 */
export function selectionIdOf(item, flights = NO_ROWS) {
  const own = item?.flightKey ?? item?.legId ?? item?.turnaroundId ?? null;
  if (own === null) return null;
  return matchFlight(flights, own)?.flightKey ?? own;
}

/**
 * The visits of «Escalas» that `filter` keeps: `all`; `inOperation` (isInOperation); `needsResources` (an open
 * turnaround without a stand or an agent, as the planning snapshot says); `completed` (turnaround Completed). An unknown
 * filter throws.
 */
export function filterVisits(visits = NO_ROWS, filter = 'all') {
  if (!VISIT_FILTERS.includes(filter)) throw new RangeError(`Unknown console visit filter: ${String(filter)}`);
  const list = Array.isArray(visits) ? visits : [];
  if (filter === 'inOperation') return list.filter(item => item.inOperation);
  if (filter === 'needsResources') return list.filter(item => Array.isArray(item.missing) && item.missing.length > 0);
  if (filter === 'completed') return list.filter(item => item.completed);
  return list;
}
