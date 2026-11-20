import { parseInstant } from '../../../services/serverClock';
import { normalizeStandCode } from '../../../services/standCodes';
import { endsItsVisit, matchFlight } from '../../maps/core/mapSelection';
import { isInOperation } from '../../occ-ui/statusVocabulary';
import { missingResources } from '../dashboardModel';

// The console's «Tablero» (contratos 2.5): «Llegadas», «Salidas» and «Escalas», with the flights still to import folded
// in, as flight strips (occ-ui/OccFlightStrip.jsx) sorted by their best time. Pure. The legs are the map flights the map
// draws (contratos 1.3, from the maps lane's useMapSituation), never a second read of them; the planning snapshot adds
// the agents of each turnaround and the turnarounds of the day the map's window leaves out, so nothing the old
// turnaround table showed is lost (design D.1). The stand of a visit the map flights hold is theirs: they are re-read on
// `occ_planning`, the snapshot only on its 60 s poll (contratos 2.7). `nowMs` is the server's time in milliseconds.

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
 * `{ at, kind }` with `at` in milliseconds and `kind` `actual`, `estimated` or `scheduled`; `null` without any. An
 * actual time keeps the kind a map flight gives it (contracts 1.3) as `actualKind`: `Runway`, which only says that the
 * aircraft landed or took off, or `OnBlock`, OCC's «Registrar llegada» (N23). A planning leg tells none.
 */
export function bestTime(leg) {
  if (!isObject(leg)) return null;
  for (const [field, kind] of TIME_FIELDS) {
    const at = instantMs(leg[field]);
    if (at === null) continue;
    return Object.freeze(kind === 'actual' && typeof leg.actualKind === 'string'
      ? { at, kind, actualKind: leg.actualKind } : { at, kind });
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

/**
 * Whether the aircraft of a visit is on its stand, by the first evidence there is, in the order the stand states read it
 * (maps/stands/standModel.js, contratos 2.4): the server's demo on-block instant (`demo.onBlockAt`) has come; a BLOCK_ON
 * is recorded; the arrival leg's actual time is its on-block (`actualKind: 'OnBlock'`, OCC's «Registrar llegada»); and,
 * without the arrival leg, a recorded arrival (`arrivedAt`: the positions board's or the planning snapshot's). A runway
 * time and the provider's «Arrived» (`phase: 'arrived'`) only say that the aircraft landed. `legs` are the map flights
 * of the visit (contratos 1.3) and `nowMs` the server's time. The stand and the end of the visit are its callers' to
 * check: the board (buildBoard) and the band of «Posiciones» (standTimeline.js) read this one rule.
 */
export function aircraftOnStand(legs, { nowMs, arrivedAt = null } = {}) {
  const list = Array.isArray(legs) ? legs.filter(isObject) : NO_ROWS;
  const onBlockAt = instantMs(list.map(leg => leg.demo).find(isObject)?.onBlockAt ?? null);
  if (onBlockAt !== null) return Number.isFinite(nowMs) && nowMs >= onBlockAt;
  if (list.some(leg => hasMilestone(leg, 'BLOCK_ON'))) return true;
  const arrival = list.find(leg => leg.direction === 'Arrival') ?? null;
  if (arrival !== null) return arrival.actualAt != null && arrival.actualKind === 'OnBlock';
  return arrivedAt != null;
}

const dueSoon = (time, nowMs) => time !== null && Number.isFinite(nowMs) && time.at - nowMs <= DUE_SOON_MS;

// The status of an arrival by its phase alone (contratos 1.3), the board's (flightStatus) and the importer's
// (providerArrivalStatusKey): the provider's «Arrived» only says that it landed, and a flight that departed from its
// origin is en route.
const ARRIVAL_PHASE_KEYS = new Map([['scheduled', 'scheduled'], ['departed', 'enroute'], ['enroute', 'enroute'],
  ['approaching', 'approaching'], ['landed', 'landed'], ['arrived', 'landed'], ['cancelled', 'cancelled'],
  ['diverted', 'diverted']]);
const arrivalPhaseKey = phase => ARRIVAL_PHASE_KEYS.get(phase) ?? 'unknown';

/**
 * What a map flight is doing, as a status key and its signal (contratos 2.4: a normal state carries no hue):
 * - a cancelled or diverted leg asks for attention; a turnaround Completed is `completed`;
 * - an arrival without an assigned stand is «Llegada sin posición asignada» (`noStand`), amber once it is due within
 *   DUE_SOON_MS (or overdue);
 * - a departure that departed (its phase, or its PUSHBACK) is `departed`;
 * - a visit in operation (isInOperation: its turnaround InProgress, or its operation InProgress or Returned) is
 *   `inOperation`; an aircraft on its stand is `onStand`: `onStand` when the caller read it over the legs of the visit
 *   (buildBoard), else the flight alone, with an assigned stand, a visit it does not end (mapSelection.js: endsItsVisit)
 *   and the evidence of aircraftOnStand, never the provider's «Arrived»;
 * - otherwise the phase: an arrival `landed` (also when the provider says «Arrived»), `approaching`, `enroute` (also
 *   when it departed from its origin) or `scheduled`; a departure `scheduled`. Anything else is `unknown`.
 * Returns `{ key, signal }`, `signal` `null` or `attention`.
 */
export function flightStatus(flight, { nowMs, onStand } = {}) {
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
  const parked = typeof onStand === 'boolean' ? onStand
    : assignedStandCode(flight) !== null && !endsItsVisit(flight) && aircraftOnStand([flight], { nowMs });
  if (parked) return { key: 'onStand', signal: null };
  if (arrival) return { key: arrivalPhaseKey(phase), signal: null };
  return { key: phase === 'scheduled' ? 'scheduled' : 'unknown', signal: null };
}

// The provider's words (the statuses AeroDataBox reports, which the demo flights use too), lower-case, and the phase
// the server gives a map flight for each before the flight's time: the table of `Waiting` and `Of` in
// backend/Elevant.Application/Operations/MapFlights/MapFlightPhases.cs (ADR-0042, decision 7). Keep the two in step.
const PROVIDER_WORD_PHASES = new Map([
  ['expected', 'scheduled'], ['unknown', 'scheduled'], ['checkin', 'scheduled'], ['boarding', 'scheduled'],
  ['gateclosed', 'scheduled'], ['delayed', 'scheduled'], ['departed', 'departed'], ['enroute', 'enroute'],
  ['approaching', 'approaching'], ['arrived', 'arrived'], ['canceled', 'cancelled'], ['cancelled', 'cancelled'],
  ['canceleduncertain', 'cancelled'], ['diverted', 'diverted'],
]);

/**
 * The status key (consoleMessages `status.*`) of an arrival the feed proposes, by what the provider reports, so that
 * «Importar vuelos» (planning/components/ProviderFlightsDialog.jsx) names it as the board names its phase, never in
 * the provider's words (N22). Its runway time (`runwayAt`) decides first: `landed`, whatever the word. Without one,
 * the provider's word (`providerStatus`), in any case and without the spaces around it, gives the phase the server
 * gives a map flight (MapFlightPhases.cs) and the board's status for that phase: Expected, Unknown, CheckIn,
 * Boarding, GateClosed and Delayed, or no word, `scheduled`; Departed and EnRoute `enroute`; Approaching
 * `approaching`; Arrived `landed`; Canceled, Cancelled and CanceledUncertain `cancelled`; Diverted `diverted`; any
 * other word `unknown`. It has no clock: an arrival the provider still expects stays `scheduled` after its time, when
 * the server's phase is already `enroute`. Only for an arrival: `null` for anything else.
 */
export function providerArrivalStatusKey(item) {
  if (item?.direction !== 'Arrival') return null;
  if (instantMs(item.runwayAt) !== null) return 'landed';
  const word = String(item.providerStatus ?? '').trim().toLowerCase();
  return arrivalPhaseKey(word === '' ? 'scheduled' : (PROVIDER_WORD_PHASES.get(word) ?? 'unknown'));
}

// The status of a planning leg the map's window leaves out: only what the planning snapshot knows, with the stand of its
// visit (the map flights' when they hold the visit, mapVisit).
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

/**
 * One map flight as a strip of the board: the shape of OccFlightStrip plus the keys the console selects with. `facts`
 * are those of its visit (visitFactsOf), when it has one.
 */
function mapStrip(flight, { nowMs, t, estimatedKeys }, facts) {
  return strip({
    id: flight.flightKey, flightKey: flight.flightKey, visitKey: flight.visitKey ?? null, legId: flight.legId ?? null,
    turnaroundId: flight.turnaroundId ?? null, proposalId: flight.proposalId ?? null,
    imported: flight.imported === true, direction: flight.direction, flightNumber: flight.flightNumber ?? '',
    counterpartIata: flight.counterpart?.iataCode ?? null,
    time: bestTime(flight), standCode: assignedStandCode(flight),
    demo: flight.isDemo === true, estimated: estimatedKeys.has(flight.flightKey),
  }, flightStatus(flight, { nowMs, onStand: facts?.onStand }), t);
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

/**
 * When a leg says its aircraft left its stand (N30), once the leg ended its visit by leaving it (mapSelection.js:
 * endsItsVisit): its PUSHBACK, a departure's best time once it departed, or the off-block of the demo clock once the
 * server's timeline took the aircraft off the stand, the first of them, in milliseconds. A diverted flight or a
 * cancelled arrival ends its visit without leaving the stand: `null`, as for a leg that did not end it.
 */
function leftStandAt(leg) {
  if (!endsItsVisit(leg)) return null;
  const pushback = Array.isArray(leg.milestones)
    ? leg.milestones.find(item => item?.code === 'PUSHBACK' && item.actualAt != null) ?? null : null;
  const times = [
    instantMs(pushback?.actualAt ?? null),
    leg.direction === 'Departure' && leg.phase === 'departed' ? bestTime(leg)?.at ?? null : null,
    instantMs(leg.demo?.offBlockAt ?? null),
  ].filter(Number.isFinite);
  return times.length > 0 ? Math.min(...times) : null;
}

// When the aircraft of a visit left its stand: the first instant its legs give, else, when the map's window leaves its
// departure out, the departure time the planning snapshot recorded; `null` while nothing says that it left.
function departedAtOf(legs, plan) {
  const times = legs.map(leftStandAt).filter(Number.isFinite);
  if (times.length > 0) return Math.min(...times);
  return legs.some(leg => leg.direction === 'Departure') ? null : instantMs(plan?.departure?.actualAt ?? null);
}

/**
 * What the map flights say of one visit, the fresh read (contratos 2.7: they are re-read on `occ_planning`, the planning
 * snapshot only on its 60 s poll): the stand they assign it (the open assignment, the same on every leg; `null` without
 * one), whether a leg ended the visit (mapSelection.js: endsItsVisit, its PUSHBACK among them), whether its aircraft
 * is on that stand (aircraftOnStand; without the arrival leg in the map's window, the arrival the planning snapshot
 * recorded) and when it left it (`departedAt`, departedAtOf). A visit without a stand, or one a leg ended, is not on a
 * stand, as on the stands the map draws.
 */
function visitFactsOf(legs, plan, nowMs) {
  const standCode = legs.map(assignedStandCode).find(Boolean) ?? null;
  const ended = legs.some(endsItsVisit);
  const onStand = standCode !== null && !ended
    && aircraftOnStand(legs, { nowMs, arrivedAt: plan?.arrival?.actualAt ?? null });
  return Object.freeze({ standCode, ended, onStand, departedAt: departedAtOf(legs, plan) });
}

const isText = value => typeof value === 'string' && value !== '';

function firstTime(...items) {
  const times = items.map(item => item?.sortAt).filter(Number.isFinite);
  return times.length > 0 ? Math.min(...times) : Number.POSITIVE_INFINITY;
}

function visit(fields) {
  return Object.freeze({ ...fields, completed: normalize(fields.status) === 'completed' });
}

/**
 * A visit of the map: the legs of one turnaround (one visitKey) with the planning turnaround, if the day has it. Its
 * stand, its end, whether its aircraft is on the stand, when it left it and the state of its operation are what its map
 * flights say (`facts`, visitFactsOf), fresher than the snapshot: a stand assigned, moved or released on another screen
 * reads here as on its strips at once. A leg the map's window leaves out (a departure far ahead) comes from the planning
 * snapshot with that stand, and so does what the turnaround lacks: its stand as the map flights give it, its agents as
 * the snapshot lists them, the state of its operation while the map flights carry none.
 */
function mapVisit(turnaroundId, legs, strips, plan, facts, context) {
  const arrivalLeg = legs.find(leg => leg.direction === 'Arrival') ?? null;
  const departureLeg = legs.find(leg => leg.direction === 'Departure') ?? null;
  const planned = plan === null ? null
    : { ...plan, stand: facts.standCode === null ? null : { code: facts.standCode } };
  const arrival = arrivalLeg ? strips.get(arrivalLeg.flightKey)
    : (planned?.arrival ? planningStrip(planned, planned.arrival, 'Arrival', context) : null);
  const departure = departureLeg ? strips.get(departureLeg.flightKey)
    : (planned?.departure ? planningStrip(planned, planned.departure, 'Departure', context) : null);
  const turnaround = legs.map(leg => leg.turnaround).find(isObject) ?? null;
  const visitKey = (arrivalLeg ?? legs[0]).visitKey ?? `t:${turnaroundId}`;
  return visit({
    id: visitKey, visitKey, turnaroundId,
    operationCode: turnaround?.operationCode ?? plan?.operationCode ?? null,
    airlineName: (arrivalLeg ?? departureLeg)?.airline?.name ?? plan?.airline?.name ?? null,
    arrival: arrival ?? null, departure: departure ?? null,
    standCode: facts.standCode,
    status: turnaround?.status ?? plan?.status ?? null,
    operationStatus: legs.map(leg => leg.turnaround?.operationStatus).find(isText) ?? plan?.operation?.status ?? null,
    inOperation: legs.some(leg => isInOperation(leg)) || (plan !== null && isInOperation(plan)),
    onStand: facts.onStand,
    ended: facts.ended,
    departedAt: facts.departedAt,
    // Unknown (null) until the planning snapshot has the turnaround: the map flights carry no agents.
    missing: planned ? Object.freeze(missingResources(planned)) : null,
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
    standCode: assignedStandCode(turnaround), status: turnaround.status ?? null,
    operationStatus: turnaround.operation?.status ?? null, inOperation: isInOperation(turnaround),
    onStand: false, ended: CLOSED.has(normalize(turnaround.status)) || Boolean(turnaround.departure?.actualAt),
    departedAt: instantMs(turnaround.departure?.actualAt ?? null),
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
 *   turnaroundId, operationCode, airlineName, arrival, departure, standCode, status, operationStatus, inOperation,
 *   onStand, ended, departedAt, completed, missing, agentsCount, demo, sortAt, source }`. A visit the map flights hold
 *   (`source: 'map'`) takes its `standCode`, `ended`, `onStand` and `departedAt` from them (visitFactsOf), and `missing`
 *   (`stand`, `agents`) has that stand and the agents of the planning turnaround; `missing` and `agentsCount` are
 *   `null` while the snapshot does not have it. The strips of its legs read «En posición» by the same `onStand`.
 *   `operationStatus` is the state of its ground operation (the map flights', else the snapshot's; `null` without
 *   one) and `departedAt` when its aircraft left the stand, in milliseconds (N30): its PUSHBACK, its departure once it
 *   departed or the demo clock's off-block, and for a turnaround the window leaves out, the departure time the
 *   snapshot recorded; `null` while nothing says that it left.
 * - `counts`: `{ arrivals, departures, toImport, visits }`.
 * `t` translates consoleMessages (the status words).
 */
export function buildBoard({ flights = NO_ROWS, aircraft = NO_ROWS, planningTurnarounds = null, nowMs, t } = {}) {
  const rows = (Array.isArray(flights) ? flights : []).filter(row => isObject(row) && typeof row.flightKey === 'string');
  const estimatedKeys = new Set((Array.isArray(aircraft) ? aircraft : [])
    .filter(item => item?.quality === 'estimated' && typeof item.flightKey === 'string').map(item => item.flightKey));
  const context = { nowMs, t, estimatedKeys };
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
  const facts = new Map([...groups].map(([turnaroundId, legs]) => [turnaroundId,
    visitFactsOf(legs, plans.get(turnaroundId) ?? null, nowMs)]));

  const strips = new Map(rows.map(row => [row.flightKey, mapStrip(row, context, facts.get(row.turnaroundId))]));
  const sorted = [...strips.values()].sort(byTime);
  const shown = sorted.filter(item => !isToImport(item));
  const pending = sorted.filter(isToImport);

  const visits = [...groups].map(([turnaroundId, legs]) => mapVisit(turnaroundId, legs, strips,
    plans.get(turnaroundId) ?? null, facts.get(turnaroundId), context));
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

/** The marks of the board its legend explains, in the legend's order: the two signals, then the two tags. */
export const BOARD_LEGEND_KEYS = Object.freeze(['attention', 'urgent', 'demo', 'estimated']);

/**
 * What the legend of the board names (contratos 2.4: a board shows its legend in its header, and a legend lists only
 * what is on screen), for the items of its visible tab: `strips` («Llegadas» or «Salidas», «Por importar» included) or
 * `visits` («Escalas» as its filter shows them). `attention` and `urgent` when a strip's status carries that signal or
 * a visit lacks a stand or an agent (its amber triangle); `demo` when a strip or a visit is a demo flight; `estimated`
 * when a strip says «est.» (its aircraft at an estimated position). In the order of BOARD_LEGEND_KEYS.
 */
export function boardLegendKeys({ strips = NO_ROWS, visits = NO_ROWS } = {}) {
  const found = new Set();
  for (const item of Array.isArray(strips) ? strips : NO_ROWS) {
    if (item?.status?.signal) found.add(item.status.signal);
    if (item?.demo) found.add('demo');
    if (item?.estimated) found.add('estimated');
  }
  for (const item of Array.isArray(visits) ? visits : NO_ROWS) {
    if (Array.isArray(item?.missing) && item.missing.length > 0) found.add('attention');
    if (item?.demo) found.add('demo');
  }
  return BOARD_LEGEND_KEYS.filter(key => found.has(key));
}

/**
 * The visits of «Escalas» that `filter` keeps: `all`; `inOperation` (isInOperation); `needsResources` (an open
 * turnaround without a stand or an agent: the stand as its map flights give it when they hold the visit, the agents as
 * the planning snapshot lists them); `completed` (turnaround Completed). An unknown filter throws.
 */
export function filterVisits(visits = NO_ROWS, filter = 'all') {
  if (!VISIT_FILTERS.includes(filter)) throw new RangeError(`Unknown console visit filter: ${String(filter)}`);
  const list = Array.isArray(visits) ? visits : [];
  if (filter === 'inOperation') return list.filter(item => item.inOperation);
  if (filter === 'needsResources') return list.filter(item => Array.isArray(item.missing) && item.missing.length > 0);
  if (filter === 'completed') return list.filter(item => item.completed);
  return list;
}
