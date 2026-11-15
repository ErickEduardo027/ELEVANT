import { FLIGHT_REPORT_MILESTONES } from '@elevant/api-client';
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
 * has left is no conflict); `attention` `uncovered` (the coverage list is empty, never just absent, and a flight is on
 * the stand or due within 60 minutes) and `overdue` (the aircraft is still on the stand after its departure time); then
 * the plain notice `arrivalNotRecorded` (design D3): an aircraft, live or estimated, stands still on the ground (under
 * 2 kt) inside the stand box with neither BLOCK_ON nor an on-block time, and it is not a demo flight, whose time the
 * server records: «El avión ya está en la posición. Registra la llegada.»
 *
 * Returns `{ state, signals: [{ kind, reason }], visit (the board turnaround the stand shows, or null), arrivalAt,
 * departureAt (epoch ms or null), minutesToArrival, minutesToDeparture, flightNumber, aircraftType, typeSpec, footprint,
 * milestonesDone, milestonesTotal, isDemo, cancelledBy (the normalized code of the stand that cancels this one, or
 * null) }`: `typeSpec` is the shown visit's aircraft type (aircraft/types.js: resolveAircraftType; null when its map
 * flights say nothing of it), `footprint` how the stand draws that aircraft to scale (`solid` while it is on the stand,
 * occupied or releasing; `planned`, dashed, while it is planned or arriving; null without a type or a visit), and
 * `milestonesDone` the distinct milestones recorded for that visit out of `milestonesTotal` (25: the flight report of
 * contracts 1.3), null without its map flights.
 */
export function deriveDisplayStatus(position, { nowMs, flightsByTurnaround, aircraftByTurnaround } = {}) {
  const exactNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const now = floorToMinute(exactNow);
  const cancelledBy = cancellerOf(position);
  if (!Array.isArray(position?.turnarounds)) return displayFromStatus(position);
  if (position.status === 'unverified' || position.standId == null) return display('unverified', { cancelledBy });
  if (position.status === 'disabled') return display('disabled', { cancelledBy });

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
  const due = current !== null
    || waiting.some(visit => visit.landed || (visit.arrivalAt !== null && visit.arrivalAt - now <= COVERAGE_WINDOW_MS));
  if (Array.isArray(position.coveredBy) && position.coveredBy.length === 0 && due) {
    signals.push({ kind: 'attention', reason: 'uncovered' });
  }
  if (current !== null && current.departureAt !== null && now > current.departureAt) {
    signals.push({ kind: 'attention', reason: 'overdue' });
  }
  if (onStand.some(visit => visit.arrivalNotRecorded)) signals.push({ kind: 'notice', reason: 'arrivalNotRecorded' });

  const shown = current ?? next;
  if (shown === null) return display(state, { signals, cancelledBy });
  return display(state, {
    signals,
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

/** The normalized codes of the other stands covered by an agent who covers stand `code` (an empty set without any). */
export function sameAgentCodes(positions = [], code) {
  const wanted = normalizeStandCode(code);
  const list = (positions ?? []).filter(position => position !== null && typeof position === 'object');
  const names = new Set(list.filter(position => codeOf(position) === wanted).flatMap(position => cleanNames(position.coveredBy)));
  const codes = new Set();
  if (wanted === '' || names.size === 0) return codes;
  for (const position of list) {
    const other = codeOf(position);
    if (other !== '' && other !== wanted && cleanNames(position.coveredBy).some(name => names.has(name))) codes.add(other);
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
 * the board's `asOf` does.
 */
export function unlocatedStands(boardStands = [], positions = [], { asOf } = {}) {
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
  return mapOccupancyToRampPositions(references, { positions: missing, asOf })
    .map(position => ({ ...position, latitude: null, longitude: null, locationSource: 'none', geometry: null }));
}
