import { FLIGHT_REPORT_MILESTONES } from '@elevant/api-client';
import { BUSINESS_TIME_ZONE, addDays, businessToday, stationLocalToUtc } from '../../../services/businessDay';
import { normalizeStandCode } from '../../../services/standCodes';
import { STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { mapOccupancyToRampPositions } from '../../positions-map/positionsMapMappers';
import { resolveAircraftType } from '../aircraft/types';
import { pointInPolygon } from '../airport/geo';
import { indexLayout, matchStand } from '../airport/layoutIndex';
import { locationPoint, resolveStandGeometry } from '../airport/standGeometry';
import { endsItsVisit } from '../core/mapSelection';

// The model of a stand on the OCC maps (PR M4): where it is drawn (attachStandGeometry, design C5) and how it reads
// (deriveDisplayStatus: the seven states and the signals of contracts 2.4, with item 3 of the plan's «Ajustes»). Pure.
// The airport layout arrives as a parameter, so this module never bundles the dataset. The screens pass what their
// reads give: the positions board, and inside the OCC frame (PR M6, traffic/standInputs.js) the map flights of each
// visit (their milestones, their aircraft and the demo instants of the server) and where its aircraft is, live or
// estimated. From them a stand also says which aircraft it draws to scale, how far its turnaround has gone and when
// an aircraft stands on it without its arrival recorded (design D1 to D3).

/** A visit assigned to a stand reads «Llegando» from this long before its aircraft is due on the stand. */
export const ARRIVING_WINDOW_MS = 15 * 60 * 1000;
/** A stand with an aircraft on it reads «Por liberar» from this long before its departure. */
export const RELEASING_WINDOW_MS = 15 * 60 * 1000;
/** A stand nobody covers raises «Sin agente que la cubra» when a flight is on it or due on it within this window. */
export const COVERAGE_WINDOW_MS = 60 * 60 * 1000;
/** The milestones of a turnaround's flight report (contracts 1.3): a stand's progress counts them, 25 in all. */
export const MILESTONES_TOTAL = FLIGHT_REPORT_MILESTONES.length;
/** Below this ground speed (2 kt) an aircraft stands still: ADS-B speed on the ground is noise under it. */
export const STILL_BELOW_MS = (2 * 1852) / 3600;

const MILESTONE_CODES = new Set(FLIGHT_REPORT_MILESTONES.map(item => item.code));
// The aircraft a stand draws to scale (design D3): solid while it is on the stand, dashed while it is still to come.
const FOOTPRINT_OF_STATE = Object.freeze({ occupied: 'solid', releasing: 'solid', planned: 'planned', arriving: 'planned' });

const MINUTE_MS = 60 * 1000;

/** `ms` rounded down to the minute: every state and countdown is evaluated on it, so they change only on the minute. */
export function floorToMinute(ms) {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}

/** The state a stand is drawn with: one of the seven of the vocabulary; anything else reads as free, as today. */
export function standDrawState(status) {
  return STAND_STATE_KEYS.includes(status) ? status : 'available';
}

/**
 * The state a map draws a stand of a screen with: the display status the screen derived (useStandDisplay), else its
 * board status (standDrawState). A screen that derives nothing, such as the console's apron until PR U3 adopts the
 * display, draws the board's state.
 */
export function standStateOf(stand) {
  return STAND_STATE_KEYS.includes(stand?.displayStatus) ? stand.displayStatus : standDrawState(stand?.status);
}

const codeOf = position => normalizeStandCode(position?.id ?? position?.code);
const timeOf = value => {
  const ms = typeof value === 'number' ? value : Date.parse(value ?? '');
  return Number.isFinite(ms) ? ms : null;
};

/**
 * Whole minutes from `now` until `at` (epoch ms), rounded up («en 12 min» means within twelve minutes); 0 or less once
 * it is due, and `null` without a time.
 */
export function minutesUntil(at, now) {
  if (!Number.isFinite(at) || !Number.isFinite(now)) return null;
  const minutes = Math.ceil((at - now) / MINUTE_MS);
  return minutes === 0 ? 0 : minutes;
}

// A per-turnaround input, given as a Map or as a plain object keyed by turnaround id.
function lookup(collection, key) {
  if (collection == null || key == null) return undefined;
  if (collection instanceof Map) return collection.get(key);
  return Object.hasOwn(collection, key) ? collection[key] : undefined;
}

// The map flights (legs) of a visit: one flight or a list of them.
function legsOf(flightsByTurnaround, turnaroundId) {
  const value = lookup(flightsByTurnaround, turnaroundId);
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  return list.filter(flight => flight !== null && typeof flight === 'object');
}

const hasMilestone = (legs, code) => legs.some(leg => Array.isArray(leg.milestones)
  && leg.milestones.some(milestone => milestone?.code === code && milestone.actualAt != null));

// The milestones of the flight report recorded for a visit, each code once (both legs carry the operation's), or `null`
// without its map flights: then nobody knows how far the turnaround has gone.
function recordedMilestones(legs) {
  if (legs.length === 0) return null;
  const codes = new Set();
  for (const leg of legs) {
    for (const milestone of Array.isArray(leg.milestones) ? leg.milestones : []) {
      if (milestone?.actualAt != null && MILESTONE_CODES.has(milestone.code)) codes.add(milestone.code);
    }
  }
  return codes.size;
}

// The type of the aircraft of a visit, to draw it to scale (aircraft/types.js): the first leg whose aircraft says
// something of it. `null` when nothing does, since the neutral dart of an unknown type has no size to draw.
function visitTypeSpec(legs) {
  const aircraft = legs.map(leg => leg.aircraft)
    .find(item => item !== null && typeof item === 'object' && (item.typeIcaoCode || item.model || item.sizeCategory));
  if (!aircraft) return null;
  const type = resolveAircraftType({ typeIcao: aircraft.typeIcaoCode, model: aircraft.model, sizeCategory: aircraft.sizeCategory });
  return type.iconCategory === 'unknown' ? null : type.spec;
}

const isMovingFast = speed => typeof speed === 'number' && Number.isFinite(speed) && speed >= STILL_BELOW_MS;

/**
 * One board visit (a turnaround the positions board lists on the stand) joined with its optional map flights and
 * aircraft position: whether it still counts, whether its aircraft is on the stand, whether it landed, its times, its
 * aircraft type and progress, and whether its aircraft stands on the stand without its arrival recorded.
 */
function describeVisit(turnaround, legs, aircraft, polygon, now, exactNow = now) {
  const arrival = legs.find(leg => leg.direction === 'Arrival') ?? null;
  const departure = legs.find(leg => leg.direction === 'Departure') ?? null;
  const demo = legs.map(leg => leg.demo).find(value => value !== null && typeof value === 'object') ?? null;
  const onBlockAt = timeOf(demo?.onBlockAt);
  const offBlockAt = timeOf(demo?.offBlockAt);
  const touchdownAt = timeOf(demo?.touchdownAt);
  const point = locationPoint(aircraft?.position ?? aircraft);
  // An aircraft in the air is never on a stand; a position that says nothing of it is read as one on the ground.
  const inBox = point !== null && Array.isArray(polygon) && aircraft?.onGround !== false && pointInPolygon(point, polygon);
  const blockOn = hasMilestone(legs, 'BLOCK_ON');
  // OCC's «Registrar llegada» writes the arrival's on-block time (contracts 1.3, `actualKind: 'OnBlock'`).
  const onBlockRecorded = arrival !== null && arrival.actualAt != null && arrival.actualKind === 'OnBlock';
  const isDemo = turnaround.isDemo === true || legs.some(leg => leg.isDemo === true);
  // The aircraft is on the stand (contracts 2.4 and «Ajustes» 3), by the first evidence there is: the server's demo
  // instant; a recorded BLOCK_ON; the aircraft (live or estimated) inside the stand box; and with none of them, the
  // actual time of the arrival leg when it is the on-block, since a runway time only says that the aircraft landed.
  // Without the arrival leg, which is what the board alone gives, the arrival time of the board decides: that is the
  // leg's actual time, whichever kind it is.
  let onStand;
  // The server's demo instants are compared with the exact instant, not the minute: the stand changes in the same
  // moment its aircraft parks or leaves (contracts 2.3, the server owns every instant).
  if (onBlockAt !== null) onStand = exactNow >= onBlockAt;
  else if (blockOn) onStand = true;
  else if (point !== null && Array.isArray(polygon)) onStand = inBox;
  else if (arrival !== null) onStand = onBlockRecorded;
  else onStand = turnaround.arrivedAt != null;
  const landed = turnaround.arrivedAt != null || arrival?.actualAt != null
    || arrival?.phase === 'landed' || arrival?.phase === 'arrived' || (touchdownAt !== null && exactNow >= touchdownAt);
  return {
    turnaround,
    // A leg ends it (mapSelection.js: endsItsVisit); a demo flight leaves its stand at the server's off-block too.
    ended: legs.some(endsItsVisit) || (offBlockAt !== null && exactNow >= offBlockAt),
    onStand,
    landed,
    arrivalAt: onBlockAt ?? timeOf(arrival?.estimatedAt) ?? timeOf(arrival?.scheduledAt)
      ?? timeOf(turnaround.arrivalScheduledAt),
    departureAt: offBlockAt ?? timeOf(demo?.scheduledOffBlockAt) ?? timeOf(departure?.estimatedAt)
      ?? timeOf(departure?.scheduledAt) ?? timeOf(turnaround.departureScheduledAt),
    arrivalFlight: turnaround.arrivalFlightNumber ?? arrival?.flightNumber ?? null,
    departureFlight: turnaround.departureFlightNumber ?? departure?.flightNumber ?? null,
    aircraftType: arrival?.aircraft?.typeIcaoCode ?? departure?.aircraft?.typeIcaoCode ?? arrival?.aircraft?.model
      ?? departure?.aircraft?.model ?? null,
    typeSpec: visitTypeSpec(legs),
    milestonesDone: recordedMilestones(legs),
    // Its aircraft (live or estimated) stands still on the ground inside the stand box, yet nothing records that it is
    // there: no BLOCK_ON and no on-block time. A demo flight's time is the server's, so it never asks.
    arrivalNotRecorded: !isDemo && inBox && !isMovingFast(aircraft?.gsMs) && !blockOn && !onBlockRecorded,
    isDemo,
    // What the stand's detail says of the visit (owner request of 2026-11-15), from what the screen already read:
    // where its aircraft comes from and goes to, its scheduled, estimated and actual times (its landing apart from its
    // stand, N23), its aircraft and its legs (their milestones make the progress strip).
    detail: visitDetail(turnaround, arrival, departure, legs, { touchdownAt, onBlockAt, offBlockAt }, exactNow),
  };
}

const counterpartOf = leg => leg?.counterpart?.iataCode ?? leg?.counterpart?.icaoCode ?? null;

// The first of `instants` (ms or null) already reached at `now`: an actual time still to come is never real. The
// server's demo instants (`onBlockAt`, `touchdownAt`, `offBlockAt`) are its plan, not what happened: a demo arrival
// reads «Aterrizó» only once the stand's clock passed its touchdown, and no recorded time in the future is shown.
const reachedOf = (now, ...instants) => instants.find(at => at !== null && at !== undefined && at <= now) ?? null;

// The earliest time of the milestone `code` recorded on any leg of a visit (both legs carry the operation's), or null.
function earliestMilestone(legs, code) {
  const times = legs.flatMap(leg => (Array.isArray(leg.milestones) ? leg.milestones : []))
    .filter(milestone => milestone?.code === code)
    .map(milestone => timeOf(milestone.actualAt))
    .filter(at => at !== null);
  return times.length > 0 ? Math.min(...times) : null;
}

// The state of a visit's ground operation from its map flights (`turnaround.operationStatus`), or null without one.
const operationStatusOf = legs => legs.map(leg => leg?.turnaround?.operationStatus)
  .find(status => typeof status === 'string' && status.trim() !== '')?.trim() ?? null;

// What happened to a visit's arrival, its landing apart from its stand (N23): a runway time only says that the aircraft
// landed (contracts 1.3), so it never says since when the aircraft is on the stand.
// - `landedAt`: the arrival leg's runway time (`actualKind: 'Runway'`, what the feed and the demo worker write), else
//   the server's demo touchdown;
// - `onStandAt`: what was recorded first, OCC's on-block time (`actualKind: 'OnBlock'`, «Registrar llegada») or the
//   earliest BLOCK_ON of the legs, else the server's demo on-block (D-N23); `onStandRecorded` says it was recorded;
// - `actualAt`: the first of them, the one actual time of before, for what reads that. Without the arrival leg, as the
//   board alone gives a visit, it is the board's arrival time, which tells no kind: that leg's actual time, a runway or
//   an on-block time (and so is a leg's actual time without its kind).
// Each only once it is not after `now`.
function arrivalTimes(turnaround, arrival, legs, demo, now) {
  const legActualAt = timeOf(arrival?.actualAt);
  const kind = arrival?.actualKind;
  const landedAt = reachedOf(now, kind === 'Runway' ? legActualAt : null, demo.touchdownAt);
  const recordedAt = reachedOf(now, kind === 'OnBlock' ? legActualAt : null, earliestMilestone(legs, 'BLOCK_ON'));
  const onStandAt = recordedAt ?? reachedOf(now, demo.onBlockAt);
  const kindless = arrival === null ? timeOf(turnaround.arrivedAt)
    : (kind === 'Runway' || kind === 'OnBlock' ? null : legActualAt);
  return {
    landedAt, onStandAt, onStandRecorded: recordedAt !== null,
    actualAt: onStandAt ?? landedAt ?? reachedOf(now, kindless),
  };
}

// The facts of a visit for the stand's detail: `{ airline, registration, origin, destination, arrival, departure,
// operationStatus, turnaroundStatus, legs }`, `arrival` as `{ scheduledAt, estimatedAt, landedAt, onStandAt,
// onStandRecorded, actualAt }` (arrivalTimes) and `departure` as `{ scheduledAt, estimatedAt, actualAt }` (ms or null),
// an actual time only once it is not after `now` (the stand's clock, server-synced: stands/useStandClock.js).
function visitDetail(turnaround, arrival, departure, legs, demo, now) {
  return {
    airline: turnaround.airlineName ?? arrival?.airline?.name ?? departure?.airline?.name ?? null,
    registration: turnaround.aircraftRegistration ?? arrival?.aircraft?.registration ?? departure?.aircraft?.registration
      ?? null,
    origin: counterpartOf(arrival),
    destination: counterpartOf(departure),
    arrival: {
      scheduledAt: timeOf(arrival?.scheduledAt) ?? timeOf(turnaround.arrivalScheduledAt),
      estimatedAt: timeOf(arrival?.estimatedAt),
      ...arrivalTimes(turnaround, arrival, legs, demo, now),
    },
    departure: {
      scheduledAt: timeOf(departure?.scheduledAt) ?? timeOf(turnaround.departureScheduledAt),
      estimatedAt: timeOf(departure?.estimatedAt),
      actualAt: reachedOf(now, timeOf(departure?.actualAt), demo.offBlockAt),
    },
    // The state of the ground operation (Asignada, En curso, Devuelta…), which the map flights carry with their
    // turnaround; the turnaround's own state (Programada, Confirmada…) stays apart, for a visit without an operation.
    operationStatus: operationStatusOf(legs),
    turnaroundStatus: turnaround.status ?? null,
    legs,
  };
}

// Waiting visits: a landed aircraft first, then by the time it is due on the stand (unknown last), then by id.
function byArrival(first, second) {
  if (first.landed !== second.landed) return first.landed ? -1 : 1;
  const a = first.arrivalAt ?? Infinity;
  const b = second.arrivalAt ?? Infinity;
  if (a !== b) return a < b ? -1 : 1;
  return String(first.turnaround.turnaroundId ?? '').localeCompare(String(second.turnaround.turnaroundId ?? ''));
}

const isArriving = (visit, now) => visit.landed || (visit.arrivalAt !== null && visit.arrivalAt - now <= ARRIVING_WINDOW_MS);

// When the aircraft on a stand frees it: at its departure time while that is still ahead. `null` means nobody knows,
// without a departure time or once that time is past and the aircraft is still there (the `overdue` signal).
const freesAt = (visit, now) => (visit.departureAt !== null && visit.departureAt >= now ? visit.departureAt : null);

// Another visit comes onto an occupied stand before it frees: its aircraft landed already, or it is due within
// 15 minutes and before the stand frees. A turnover due once the aircraft on the stand has left is no conflict.
const comesBeforeItFrees = (visit, freeAt, now) => visit.landed || (visit.arrivalAt !== null
  && visit.arrivalAt - now <= ARRIVING_WINDOW_MS && (freeAt === null || visit.arrivalAt < freeAt));

const cancellerOf = position => normalizeStandCode(position?.cancelledBy ?? position?.linkedPositionId) || null;

// N26: who covers a stand when, from the board's coverage windows of its date (positionsMapMappers.js: `coverage`), as
// instants, by start; `null` without them. A window holds the instants from its start to its end, the end excluded.
function coverageWindows(position) {
  const windows = position?.coverage?.windows;
  if (!Array.isArray(windows)) return null;
  return windows
    .filter(window => window !== null && typeof window === 'object')
    .map(window => ({
      name: String(window.agentName ?? '').trim(),
      startsAt: timeOf(window.startsAt),
      endsAt: timeOf(window.endsAt),
      isReinforcement: window.isReinforcement === true,
    }))
    .filter(window => window.name !== '' && window.startsAt !== null && window.endsAt !== null
      && window.startsAt < window.endsAt)
    .sort((first, second) => first.startsAt - second.startsAt || first.endsAt - second.endsAt
      || first.name.localeCompare(second.name, 'es'));
}

const byName = (first, second) => first.name.localeCompare(second.name, 'es');

// The agents whose window holds `at`, each once: the primary ones first, then the reinforcements. A reinforcement is a
// second agent on stands already covered (ADR-0030) and still covers the stand alone: the server hands it the flight
// of a stand no primary agent covers (persistence's CoverageReassignment).
function agentsAt(windows, at) {
  const agents = new Map();
  for (const window of windows) {
    if (window.startsAt > at || at >= window.endsAt) continue;
    const known = agents.get(window.name);
    agents.set(window.name, { name: window.name, isReinforcement: (known?.isReinforcement ?? true) && window.isReinforcement });
  }
  return [...agents.values()].sort((first, second) => Number(first.isReinforcement) - Number(second.isReinforcement)
    || byName(first, second));
}

// The instant the board's date ends at the station, its midnight: the board brings only the windows of its date, so
// from then on a window that starts at that midnight or later is never among them.
const dayEndOf = date => Date.parse(stationLocalToUtc(`${addDays(date, 1)}T00:00`, BUSINESS_TIME_ZONE));

// The agents whose window holds `at` (agentsAt), or `null` when the windows cannot tell: nobody in them at or after
// `dayEnd`, the board's midnight, says nothing of who covers the stand then.
function knownAgentsAt(windows, at, dayEnd) {
  const agents = agentsAt(windows, at);
  return agents.length === 0 && at >= dayEnd ? null : agents;
}

// When a visit to come reaches the stand, to judge who covers it (D-N26): at its time on the stand, and now at the
// earliest, since an aircraft late on its time reaches the stand from now on.
const chocksOf = (visit, now) => (visit.arrivalAt !== null && visit.arrivalAt > now ? visit.arrivalAt : now);

/**
 * The coverage of a stand at the minute `now` (N26), from its windows (coverageWindows), or null without them. `live`
 * says the board's date is the station's today: only then are the windows judged against the clock. Otherwise, another
 * date (Planificación on another day), they are only listed: `now` is empty, `visit` null, and who covers the stand
 * is the names of the day. `visitAt` is when the visit the stand shows is judged: now for the aircraft on the stand, at
 * its chocks for the one to come (D-N26), null without a visit. `visit` is null too when the windows cannot tell
 * (knownAgentsAt): past `dayEnd`, the board's midnight, with nobody in them.
 */
function coverageOf(windows, live, now, visitAt, dayEnd) {
  if (windows === null) return null;
  const listed = windows.map(window => ({ ...window }));
  if (!live) return { live: false, now: [], visit: null, ended: [], upcoming: [], windows: listed };
  const covering = agentsAt(windows, now);
  const names = new Set(covering.map(agent => agent.name));
  // For each agent who does not cover it now: their last window that ended and their first one still to start.
  const ended = new Map();
  const upcoming = new Map();
  for (const window of windows) {
    if (names.has(window.name)) continue;
    if (window.endsAt <= now) {
      if (!ended.has(window.name) || ended.get(window.name).endsAt < window.endsAt) {
        ended.set(window.name, { name: window.name, endsAt: window.endsAt, isReinforcement: window.isReinforcement });
      }
    } else if (window.startsAt > now && !upcoming.has(window.name)) {
      upcoming.set(window.name, { name: window.name, startsAt: window.startsAt, isReinforcement: window.isReinforcement });
    }
  }
  return {
    live: true,
    now: covering,
    visit: visitAt === null ? null : knownAgentsAt(windows, visitAt, dayEnd),
    ended: [...ended.values()].sort((first, second) => first.endsAt - second.endsAt || byName(first, second)),
    upcoming: [...upcoming.values()].sort((first, second) => first.startsAt - second.startsAt || byName(first, second)),
    windows: listed,
  };
}

function display(state, extra = {}) {
  return {
    state,
    signals: [],
    visit: null,
    arrivalAt: null,
    departureAt: null,
    minutesToArrival: null,
    minutesToDeparture: null,
    flightNumber: null,
    aircraftType: null,
    typeSpec: null,
    footprint: null,
    milestonesDone: null,
    milestonesTotal: MILESTONES_TOTAL,
    isDemo: false,
    cancelledBy: null,
    // The facts of the visit shown (visitDetail) and the next visit while an aircraft is on the stand.
    detail: null,
    next: null,
    // Who covers the stand from its coverage windows (N26: coverageOf), null without them.
    coverage: null,
    ...extra,
  };
}

/**
 * How a stand reads from its own fields alone, without the board's visits: its board status (standDrawState), its
 * flight, type and demo mark, the stand that cancels it, and no visit, times, signals, footprint or progress. A stand of
 * a screen that gives no `turnarounds` (the console's apron) reads this way, and so does any stand the map is given
 * without a display.
 */
export function displayFromStatus(position) {
  return display(standDrawState(position?.status), {
    flightNumber: position?.flightNumber ?? null,
    aircraftType: position?.aircraftType ?? null,
    isDemo: position?.isDemo === true,
    cancelledBy: cancellerOf(position),
  });
}

/**
 * How a stand reads at `nowMs` (rounded down to the minute, except against the server's demo instants, which it
 * compares exactly; the current time when it is not given). `position` is a
 * stand of a positions screen (positionsMapMappers.js), with `geometry` when attachStandGeometry gave it one.
 * `flightsByTurnaround` (the map flights of contracts 1.3, one or both legs per turnaround id) and
 * `aircraftByTurnaround` (per turnaround id: `{ position: [lng, lat], onGround, gsMs, quality }` as
 * traffic/standInputs.js gives it, or just `[lng, lat]` or `{ latitude, longitude }`) are optional, as a Map or a plain
 * object.
 *
 * The state is one of the seven of contracts 2.4:
 * 1. a stand without the board's visits (`turnarounds`, as the dashboard gives its stands) keeps its own state;
 * 2. `unverified`: a map stand with no database row; 3. `disabled`: a free stand cancelled by a combined stand;
 * 4. a visit stops counting once a leg of it ends it (mapSelection.js: endsItsVisit, its PUSHBACK among them; the
 *    board already drops a visit whose PUSHBACK is recorded), and a demo visit at the server's off-block;
 * 5. with an aircraft on the stand: `releasing` when its departure is due within 15 minutes, else `occupied`;
 * 6. otherwise, for the next visit: `arriving` when it landed and its aircraft is not on the stand yet (for a demo
 *    flight before the server's on-block; for any other, no BLOCK_ON and its aircraft, live or estimated, outside the
 *    stand box or in the air), or it is due within 15 minutes; else `planned`; 7. no visit: `available`.
 * Signals, the most urgent first: `urgent` `conflict` (two aircraft are on the stand, or another visit comes onto it
 * before its aircraft leaves: that visit landed already, or it is due within 15 minutes and before the departure of the
 * aircraft on the stand, a departure nobody knows without a time or once it is past; a turnover due once that aircraft
 * has left is no conflict); `attention` `uncovered` (nobody covers the aircraft on the stand or a flight due within 60
 * minutes: with the board's coverage windows of today, N26, nobody covers the aircraft on the stand now, or a flight
 * due when it reaches the stand, D-N26, judged past the board's midnight, where nobody in its windows says nothing,
 * by the names of the day; otherwise the coverage list is empty, never just absent) and `overdue` (the
 * aircraft is still on the stand after its departure time); then the plain notice `arrivalNotRecorded` (design D3): an
 * aircraft, live or estimated, stands still on the ground (under 2 kt) inside the stand box with neither BLOCK_ON nor an
 * on-block time, and it is not a demo flight, whose time the server records: «El avión ya está en la posición. Registra
 * la llegada.»
 *
 * Returns `{ state, signals: [{ kind, reason }], visit (the board turnaround the stand shows, or null), arrivalAt,
 * departureAt (epoch ms or null), minutesToArrival, minutesToDeparture, flightNumber, aircraftType, typeSpec, footprint,
 * milestonesDone, milestonesTotal, isDemo, cancelledBy (the normalized code of the stand that cancels this one, or
 * null), detail, next, coverage }`: `typeSpec` is the shown visit's aircraft type (aircraft/types.js:
 * resolveAircraftType; null when its map flights say nothing of it), `footprint` how the stand draws that aircraft to
 * scale (`solid` while it is on the stand, occupied or releasing; `planned`, dashed, while it is planned or arriving;
 * null without a type or a visit), `milestonesDone` the distinct milestones recorded for that visit out of
 * `milestonesTotal` (25: the flight report of contracts 1.3), null without its map flights, and `coverage` who covers
 * the stand (N26), null without the board's windows: `{ live, now, visit, ended, upcoming, windows }`, where `live`
 * says the board's date is the station's today at `nowMs`; `now` the agents covering it at the minute and `visit`
 * those covering the visit shown (`[{ name, isReinforcement }]`, primaries first; `visit` null without a visit, or
 * when the windows cannot tell: past the board's midnight with nobody in them);
 * `ended` and `upcoming` the last window that ended and the first still to start of each agent who does not cover it
 * now (`[{ name, endsAt | startsAt, isReinforcement }]`); and `windows` every window of the day, by start (`[{ name,
 * startsAt, endsAt, isReinforcement }]`, instants in ms). On another date only `windows` is filled.
 */
export function deriveDisplayStatus(position, { nowMs, flightsByTurnaround, aircraftByTurnaround } = {}) {
  const exactNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const now = floorToMinute(exactNow);
  const cancelledBy = cancellerOf(position);
  if (!Array.isArray(position?.turnarounds)) return displayFromStatus(position);
  if (position.status === 'unverified' || position.standId == null) return display('unverified', { cancelledBy });
  // N26: the board's coverage windows, judged against the clock only on the board's date, the station's today.
  const windows = coverageWindows(position);
  const live = windows !== null && position.coverage.date === businessToday(new Date(exactNow), BUSINESS_TIME_ZONE);
  const dayEnd = live ? dayEndOf(position.coverage.date) : null;
  if (position.status === 'disabled') {
    return display('disabled', { cancelledBy, coverage: coverageOf(windows, live, now, null) });
  }

  const visits = position.turnarounds
    .filter(turnaround => turnaround !== null && typeof turnaround === 'object')
    .map(turnaround => describeVisit(turnaround, legsOf(flightsByTurnaround, turnaround.turnaroundId),
      lookup(aircraftByTurnaround, turnaround.turnaroundId), position.geometry?.polygon, now, exactNow))
    .filter(visit => !visit.ended);
  const onStand = visits.filter(visit => visit.onStand).sort(byArrival);
  const waiting = visits.filter(visit => !visit.onStand).sort(byArrival);
  const current = onStand[0] ?? null;
  const next = waiting[0] ?? null;

  let state = 'available';
  if (current !== null) {
    state = current.departureAt !== null && current.departureAt - now <= RELEASING_WINDOW_MS ? 'releasing' : 'occupied';
  } else if (next !== null) {
    state = isArriving(next, now) ? 'arriving' : 'planned';
  }

  const signals = [];
  const freeAt = current === null ? null : freesAt(current, now);
  if (current !== null && (onStand.length > 1 || waiting.some(visit => comesBeforeItFrees(visit, freeAt, now)))) {
    signals.push({ kind: 'urgent', reason: 'conflict' });
  }
  const isDue = visit => visit.landed || (visit.arrivalAt !== null && visit.arrivalAt - now <= COVERAGE_WINDOW_MS);
  const nobodyThatDay = Array.isArray(position.coveredBy) && position.coveredBy.length === 0;
  // Nobody covers a flight due when it reaches the stand, by today's windows; past the board's midnight, where they
  // cannot tell (knownAgentsAt), by the names of the day.
  const nobodyAtChocks = visit => {
    const agents = knownAgentsAt(windows, chocksOf(visit, now), dayEnd);
    return agents === null ? nobodyThatDay : agents.length === 0;
  };
  // Nobody covers it. With today's windows (N26) the aircraft on the stand is judged now and each flight due within
  // 60 minutes when it reaches the stand (D-N26); otherwise, by the names of the day.
  const uncovered = live
    ? (current !== null && agentsAt(windows, now).length === 0) || waiting.some(visit => isDue(visit) && nobodyAtChocks(visit))
    : nobodyThatDay && (current !== null || waiting.some(isDue));
  if (uncovered) signals.push({ kind: 'attention', reason: 'uncovered' });
  if (current !== null && current.departureAt !== null && now > current.departureAt) {
    signals.push({ kind: 'attention', reason: 'overdue' });
  }
  if (onStand.some(visit => visit.arrivalNotRecorded)) signals.push({ kind: 'notice', reason: 'arrivalNotRecorded' });

  const shown = current ?? next;
  // Who covers the visit shown: the aircraft on the stand now, the one to come at its chocks (D-N26).
  const coverage = coverageOf(windows, live, now, current !== null ? now : next !== null ? chocksOf(next, now) : null,
    dayEnd);
  if (shown === null) return display(state, { signals, cancelledBy, coverage });
  return display(state, {
    signals,
    coverage,
    visit: shown.turnaround,
    arrivalAt: shown.arrivalAt,
    departureAt: shown.departureAt,
    minutesToArrival: minutesUntil(shown.arrivalAt, now),
    minutesToDeparture: minutesUntil(shown.departureAt, now),
    // The flight whose time the stand shows: the departure of the aircraft on it, the arrival of the one to come.
    flightNumber: current !== null ? shown.departureFlight ?? shown.arrivalFlight : shown.arrivalFlight ?? shown.departureFlight,
    aircraftType: shown.aircraftType,
    typeSpec: shown.typeSpec,
    footprint: shown.typeSpec === null ? null : FOOTPRINT_OF_STATE[state] ?? null,
    milestonesDone: shown.milestonesDone,
    isDemo: shown.isDemo,
    cancelledBy,
    detail: shown.detail,
    // The visit that comes next onto the stand once the aircraft on it leaves.
    next: current !== null && next !== null ? {
      turnaround: next.turnaround,
      flightNumber: next.arrivalFlight ?? next.departureFlight,
      arrivalAt: next.arrivalAt,
      minutesToArrival: minutesUntil(next.arrivalAt, now),
      airline: next.detail.airline,
      origin: next.detail.origin,
    } : null,
  });
}

/**
 * Copies of `positions` (the stands of a screen) with how each reads at `nowMs` (deriveDisplayStatus, with the same
 * optional inputs): `displayStatus` (the state the maps draw), `signals` and `display` (the visit the stand shows, its
 * times, flight, type and demo mark). The screen's own `status` stays as it is, for its lists, summary and alerts.
 * Anything that is not an object is left out. Pure: stands/useStandDisplay.js keeps the result per minute.
 */
export function withStandDisplay(positions = [], { nowMs, flightsByTurnaround, aircraftByTurnaround } = {}) {
  // One instant for every stand; the model rounds it to the minute itself, except for the server's demo instants.
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  return (positions ?? [])
    .filter(position => position !== null && typeof position === 'object')
    .map(position => {
      const shown = deriveDisplayStatus(position, { nowMs: now, flightsByTurnaround, aircraftByTurnaround });
      return { ...position, displayStatus: shown.state, signals: shown.signals, display: shown };
    });
}

// The index of each layout, built once per layout object.
const INDEX_CACHE = new WeakMap();

/**
 * The index of `layout` (layoutIndex.js: indexLayout), built once per layout object and kept while the layout lives;
 * `null` for anything that is not a layout with stands. A layout without a taxi graph gets an empty one.
 */
export function standLayoutIndex(layout) {
  if (layout === null || typeof layout !== 'object' || !Array.isArray(layout.stands)) return null;
  let index = INDEX_CACHE.get(layout);
  if (index === undefined) {
    index = indexLayout(layout.taxiGraph ? layout : { ...layout, taxiGraph: { nodes: [], edges: [] } });
    INDEX_CACHE.set(layout, index);
  }
  return index;
}

/**
 * Copies of `positions` (the stands of a positions screen) with `geometry`: where each one is drawn
 * (standGeometry.js: resolveStandGeometry), or `null` when it has neither a stand of `layout` nor a location OCC saved
 * (the screens list it as «Sin ubicar»). A position matches the layout's stand of its normalized code (or an alias the
 * layout lists); a retired stand of the layout is never matched, and a retired position is left out. The saved
 * location counts only when OCC placed the stand (`locationSource: 'occ'`); `maxAircraftSize` sizes a box of its own.
 * The positions map, the planning map and (from PR U3) the console's apron all take this one path.
 */
export function attachStandGeometry(positions = [], layout = null, { index = null } = {}) {
  const layoutIndex = index ?? standLayoutIndex(layout);
  const attached = [];
  for (const position of positions ?? []) {
    if (position === null || typeof position !== 'object' || position.retired === true) continue;
    const match = layoutIndex === null ? null : matchStand(position.id ?? position.code, layoutIndex);
    const layoutStand = match !== null && match.stand.retired !== true ? match.stand : null;
    const dbLocation = position.locationSource === 'occ' ? locationPoint(position) : null;
    attached.push({
      ...position,
      geometry: resolveStandGeometry({
        layoutStand, dbLocation, sizeHint: position.maxAircraftSize ?? null, layout, index: layoutIndex,
      }),
    });
  }
  return attached;
}

const cleanNames = names => [...new Set((Array.isArray(names) ? names : [])
  .map(name => String(name ?? '').trim()).filter(name => name !== ''))];

function nameInitials(name) {
  return name.split(/\s+/u)
    .map(word => word.replace(/[^\p{L}]/gu, ''))
    .filter(word => word !== '')
    .slice(0, 2)
    .map(word => [...word][0].toLocaleUpperCase('es'))
    .join('');
}

/**
 * The initials of the agents who cover a stand, for its label: «M. Castillo» and «Marta Castillo» are «MC»; with
 * more than one agent, the first in alphabetical order and how many more («MC +1»). An empty string without any.
 */
export function coverageInitials(names) {
  const list = cleanNames(names).sort((first, second) => first.localeCompare(second, 'es'));
  if (list.length === 0) return '';
  const initials = nameInitials(list[0]);
  return list.length > 1 ? `${initials} +${list.length - 1}` : initials;
}

/**
 * Who covers a stand of a screen, as its label, tooltip, drawer, list and agent ring say it (N26): with the board's
 * coverage windows of today, the agents covering it at the minute its display was derived (`display.coverage.now`);
 * otherwise (another date, no windows: an older API, or a stand the screen derived nothing for) the names of the day,
 * `coveredBy`. Clean names, each once; an empty list when nobody covers it.
 */
export function standCoverageNames(position) {
  const coverage = position?.display?.coverage;
  if (coverage?.live === true && Array.isArray(coverage.now)) return coverage.now.map(agent => agent.name);
  return cleanNames(position?.coveredBy);
}

/**
 * Who covers the visit a stand shows (D-N26), for its «Agente»: with today's windows, the agents covering the aircraft
 * on the stand now, or the one to come when it reaches the stand; otherwise, and when the windows cannot tell (past the
 * board's midnight with nobody in them), as standCoverageNames.
 */
export function visitCoverageNames(position) {
  const coverage = position?.display?.coverage;
  if (coverage?.live === true && Array.isArray(coverage.visit)) return coverage.visit.map(agent => agent.name);
  return standCoverageNames(position);
}

/**
 * The normalized codes of the other stands covered by an agent who covers stand `code` (an empty set without any), by
 * who covers each stand as standCoverageNames says it: now, with the board's windows of today (N26).
 */
export function sameAgentCodes(positions = [], code) {
  const wanted = normalizeStandCode(code);
  const list = (positions ?? []).filter(position => position !== null && typeof position === 'object');
  const names = new Set(list.filter(position => codeOf(position) === wanted).flatMap(standCoverageNames));
  const codes = new Set();
  if (wanted === '' || names.size === 0) return codes;
  for (const position of list) {
    const other = codeOf(position);
    if (other !== '' && other !== wanted && standCoverageNames(position).some(name => names.has(name))) codes.add(other);
  }
  return codes;
}

// A position the map draws: one attachStandGeometry gave a geometry; or, for the positions of a screen, which never
// carry one because they never import the layout, one with a location (every stand of the reference list is in the
// layout, and a location OCC saved always gets a box of its own).
const isDrawn = position => (position?.geometry === undefined
  ? locationPoint(position) !== null
  : position.geometry !== null);

/**
 * The stands of the positions board (`boardStands`, the board's `positions`) that no drawn position shows (a position
 * of `positions` with a geometry, or, without a `geometry` key, with a location), as positions of the mapper with
 * `latitude` and `longitude` `null`, `geometry` `null` and `locationSource: 'none'`: the screens list them as «Sin
 * ubicar», each with «Ubicar en el mapa». A code seen twice keeps its first stand. `asOf` stamps their `updatedAt`, as
 * the board's `asOf` does, and `operationDate`, the board's date, dates their coverage windows (N26).
 */
export function unlocatedStands(boardStands = [], positions = [], { asOf, operationDate } = {}) {
  const drawn = new Set((positions ?? []).filter(isDrawn).map(codeOf));
  const seen = new Set();
  const missing = [];
  for (const stand of boardStands ?? []) {
    const code = normalizeStandCode(stand?.code);
    if (code === '' || drawn.has(code) || seen.has(code)) continue;
    seen.add(code);
    missing.push({ ...stand, latitude: null, longitude: null });
  }
  if (missing.length === 0) return [];
  const references = missing.map(stand => ({
    id: normalizeStandCode(stand.code), terminal: stand.terminalCode ?? null, lat: null, lon: null,
  }));
  return mapOccupancyToRampPositions(references, { positions: missing, asOf, operationDate })
    .map(position => ({ ...position, latitude: null, longitude: null, locationSource: 'none', geometry: null }));
}
