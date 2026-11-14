import { greatCirclePath, haversineM, measurePolyline, nearestOnPolyline, pointAlong, slicePolyline } from '../airport/geo.js';
import { alongAt, trajectoryLine } from './estimator.js';

// The route of the chosen flight on the OCC map (PR M6, design E5), from its trajectory and its trail: the part flown
// as observed (the ADS-B trail, solid), the part flown as estimated (from the origin airport, or since the signal was
// lost: faint, «Trayecto estimado») and the part still to fly (dashed): for an arrival the approach, the runway, the
// exit and the taxi route to its stand, or to the apron hold where it waits for one («Posición por asignar»); for a
// departure its stand, the taxi route, the runway, the climb and the great circle to its destination. The split
// follows the aircraft. A trail is never joined across a break. traffic/routeFeatures.js (PR M5) draws the route
// layers; it takes these parts in place of its straight line to the next point (PR M6, second part).
// `[lng, lat]`, metres, epoch milliseconds. Pure: explicit '.js' imports, no clock, no JSON; the result is frozen.

/** The parts of a flight route, as the route layers filter them (`properties.part`). */
export const FLIGHT_ROUTE_PARTS = Object.freeze(['flownObserved', 'flownEstimated', 'remaining', 'mark']);
/** The points marked on the part still to fly (`properties.mark`). */
export const FLIGHT_ROUTE_MARKS = Object.freeze(['touchdown', 'runwayExit', 'stand', 'apronHold']);

// Closer than this two ends are one point; a line shorter than MIN_LINE_M is not drawn.
const JOIN_M = 1;
const MIN_LINE_M = 0.5;
const GREAT_CIRCLE_STEP_M = 10_000;

const finite = value => typeof value === 'number' && Number.isFinite(value);
const pointOf = value => (Array.isArray(value) && finite(value[0]) && finite(value[1]) ? [value[0], value[1]] : null);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const lines = new WeakMap();

/** The line a trajectory follows, measured for lookups by distance (cached per trajectory). */
function lineOf(trajectory) {
  let line = lines.get(trajectory);
  if (!line) {
    const { coords, cumM } = trajectoryLine(trajectory);
    line = Object.freeze({ coords, cumM, lengthM: cumM.length > 0 ? cumM[cumM.length - 1] : 0 });
    lines.set(trajectory, line);
  }
  return line;
}

function isDeparture(flight, trajectory) {
  const direction = String(flight?.direction ?? '').toLowerCase();
  if (direction === 'departure') return true;
  if (direction === 'arrival') return false;
  return trajectory?.kind === 'departure';
}

/**
 * The stretch of a trajectory's line that is this flight's: an arrival's ends where it parks or waits for a stand
 * (the first leg of part 'parked'), a departure's begins with its first leg of part 'taxiOut' or 'climb' (a demo
 * visit's trajectory holds both). `{ fromM, toM }`, metres along the line.
 */
function windowOf(trajectory, line, departure) {
  if (departure) {
    const first = trajectory.legs.find(leg => leg.part === 'taxiOut' || leg.part === 'climb');
    return { fromM: first ? first.alongStartM : line.lengthM, toM: line.lengthM };
  }
  const end = trajectory.legs.find(leg => leg.part === 'parked');
  return { fromM: 0, toM: end ? Math.min(line.lengthM, end.alongStartM) : line.lengthM };
}

/** Where `point` projects on the line between `fromM` and `toM`, in metres along the whole line. */
function alongInWindow(line, point, { fromM, toM }) {
  if (!(toM > fromM)) return fromM;
  const hit = nearestOnPolyline(measurePolyline(slicePolyline(line, fromM, toM)), point);
  return hit === null ? fromM : clamp(fromM + hit.alongM, fromM, toM);
}

/**
 * Two paths end to end: a great circle between their ends when they are apart; one point where they meet, the lone
 * point when either path is one (an observed point, the aircraft, the destination: it stays exactly where it is).
 */
function joinPaths(first, second) {
  if (first.length === 0) return [...second];
  if (second.length === 0) return [...first];
  const end = first[first.length - 1];
  const start = second[0];
  if (haversineM(end, start) <= JOIN_M) {
    return second.length === 1 && first.length > 1 ? [...first.slice(0, -1), ...second] : [...first, ...second.slice(1)];
  }
  return [...first, ...greatCirclePath(end, start, GREAT_CIRCLE_STEP_M).slice(1, -1), ...second];
}

/** The path without repeated points, as plain `[lng, lat]` pairs. */
function cleanPath(path) {
  const clean = [];
  for (const point of path) {
    const previous = clean[clean.length - 1];
    if (previous !== undefined && previous[0] === point[0] && previous[1] === point[1]) continue;
    clean.push([point[0], point[1]]);
  }
  return clean;
}

function lineFeature(flightKey, part, n, path, extra = {}) {
  const coordinates = cleanPath(path);
  if (coordinates.length < 2 || measurePolyline(coordinates).lengthM < MIN_LINE_M) return null;
  return {
    type: 'Feature',
    properties: { id: `${flightKey}:${part}:${n}`, flightKey, part, ...extra },
    geometry: { type: 'LineString', coordinates },
  };
}

function markFeature(flightKey, { mark, point, extra }) {
  return {
    type: 'Feature',
    properties: { id: `${flightKey}:mark:${mark}`, flightKey, part: 'mark', mark, ...extra },
    geometry: { type: 'Point', coordinates: [point[0], point[1]] },
  };
}

const epochOf = point => (finite(point.trailEpoch) ? point.trailEpoch : null);

/**
 * The observed parts of a trail (`[{ at, lon, lat, breakBefore?, trailEpoch? }]`, traffic/trailStore.js) in time
 * order, as `[[lng, lat], …]`: a new part at each break mark, at each change of trail epoch (a hand-off snap) and
 * after a gap longer than `breakMs`. `{ parts, first, last }`, the first and last observed points as `[lng, lat]`.
 */
function observedParts(trail, breakMs) {
  const points = (Array.isArray(trail) ? trail : [])
    .filter(point => point && finite(point.lon) && finite(point.lat) && finite(point.at))
    .sort((a, b) => a.at - b.at);
  const parts = [];
  let part = [];
  let previous = null;
  for (const point of points) {
    const breaks = previous !== null && (point.breakBefore === true || epochOf(point) !== epochOf(previous)
      || (finite(breakMs) && point.at - previous.at > breakMs));
    if (breaks) {
      parts.push(part);
      part = [];
    }
    part.push([point.lon, point.lat]);
    previous = point;
  }
  if (part.length > 0) parts.push(part);
  const corner = point => (point ? [point.lon, point.lat] : null);
  return { parts, first: corner(points[0]), last: corner(points[points.length - 1]) };
}

/**
 * The points marked on a trajectory, with how far along its line each lies: for an arrival the touchdown (where its
 * landing roll begins), the runway exit (where the roll ends and it turns off) and where it parks (`stand`, with its
 * code) or waits for a stand (`apronHold`, «Posición por asignar»); for a departure the stand it leaves.
 */
function marksOf(trajectory, { fromM }, departure) {
  const legs = trajectory.legs;
  const meta = trajectory.meta ?? {};
  const marks = [];
  if (departure) {
    const start = legs.find(leg => leg.alongStartM >= fromM - JOIN_M && leg.part === 'taxiOut');
    if (start?.phase === 'pushback' && meta.standCode) {
      marks.push({ mark: 'stand', point: start.path.coords[0], alongM: start.alongStartM, extra: { standCode: meta.standCode } });
    }
    return marks;
  }
  const landing = legs.filter(leg => leg.kind === 'move' && leg.phase === 'landing');
  if (landing.length > 0) {
    const roll = landing[landing.length - 1];
    marks.push({ mark: 'touchdown', point: landing[0].path.coords[0], alongM: landing[0].alongStartM, extra: {} });
    marks.push({
      mark: 'runwayExit', point: roll.path.coords[roll.path.coords.length - 1], alongM: roll.alongStartM + roll.lengthM,
      extra: {},
    });
  }
  const end = legs.find(leg => leg.part === 'parked');
  if (end?.phase === 'parked') {
    marks.push({ mark: 'stand', point: end.path.coords[0], alongM: end.alongStartM, extra: { standCode: meta.standCode ?? null } });
  } else if (end?.phase === 'holding') {
    marks.push({
      mark: 'apronHold', point: end.path.coords[0], alongM: end.alongStartM,
      extra: { labelKey: 'positionPending', apronHoldId: meta.apronHoldId ?? null },
    });
  }
  return marks;
}

/**
 * The route of a flight as the route source's data (design E5): a FeatureCollection, frozen.
 * - `flight`: `{ flightKey, direction: 'Arrival' | 'Departure', isDemo }`; `trajectory`: its trajectory (estimator.js
 *   or demoProfile.js; a demo visit's holds the arrival and the departure, and each row draws its own stretch);
 *   `trail`: its observed points (traffic/trailStore.js); `tMs`: the time the aircraft is at.
 * - LineStrings `{ id: '<flightKey>:<part>:<n>', flightKey, part }`:
 *   - 'flownObserved': each part of the trail, split at its breaks; a break is never joined;
 *   - 'flownEstimated' (`labelKey: 'flownEstimated'`): n = 0 from the origin (the trajectory's `meta.originPath`, else
 *     `origin`) along the trajectory to its first observed point, or to the aircraft without a trail; n = 1 from the
 *     last observed point along the trajectory to the aircraft, once it is estimated past its trail;
 *   - 'remaining': from the aircraft to the end of its stretch: an arrival's stand centre or apron hold; a departure's
 *     climb and then the great circle to `destination` (else the trajectory's `meta.destination`).
 * - Points `{ id: '<flightKey>:mark:<mark>', part: 'mark', mark }` still ahead of the aircraft: 'touchdown',
 *   'runwayExit', 'stand' (`standCode`) and 'apronHold' (`labelKey: 'positionPending'`, `apronHoldId`).
 * - The aircraft is where the trajectory has it at `tMs` (alongAt), or at `aircraft` (`[lng, lat]`, where the map
 *   draws it: a live or coasting position) projected on its stretch. `breakMs` also breaks the trail where two points
 *   are further apart in time. Without a trajectory only the observed parts are drawn. Ids are stable between calls.
 */
export function buildFlightRoute(flight, trajectory, trail, tMs, { origin = null, destination = null, aircraft = null,
  breakMs = null } = {}) {
  const flightKey = String(flight?.flightKey ?? '');
  const features = [];
  const push = feature => {
    if (feature !== null) features.push(feature);
  };
  const observed = observedParts(trail, breakMs);
  let observedCount = 0;
  for (const part of observed.parts) {
    const feature = lineFeature(flightKey, 'flownObserved', observedCount, part);
    if (feature !== null) {
      features.push(feature);
      observedCount += 1;
    }
  }

  const line = trajectory ? lineOf(trajectory) : null;
  if (line !== null && line.coords.length > 0) {
    const departure = isDeparture(flight, trajectory);
    const window = windowOf(trajectory, line, departure);
    const drawnAt = pointOf(aircraft);
    const split = drawnAt !== null ? alongInWindow(line, drawnAt, window)
      : clamp(alongAt(trajectory, finite(tMs) ? tMs : Number.NaN), window.fromM, window.toM);
    const here = drawnAt ?? [...pointAlong(line, split).p];
    const sliceTo = (fromM, toM) => (toM > fromM ? [...slicePolyline(line, fromM, toM)] : []);

    // Flown, estimated: from the origin to the first observed point, or to the aircraft.
    const originPath = trajectory.meta?.originPath;
    const origin0 = pointOf(origin);
    let head = [];
    if (!departure) head = Array.isArray(originPath) && originPath.length >= 2 ? [...originPath] : (origin0 ? [origin0] : []);
    const until = observed.first !== null ? Math.min(split, alongInWindow(line, observed.first, window)) : split;
    const before = joinPaths(joinPaths(head, sliceTo(window.fromM, until)), [observed.first ?? here]);
    push(lineFeature(flightKey, 'flownEstimated', 0, before, { labelKey: 'flownEstimated' }));
    // Flown, estimated since the last observed point.
    if (observed.last !== null) {
      const from = alongInWindow(line, observed.last, window);
      if (split > from + JOIN_M) {
        push(lineFeature(flightKey, 'flownEstimated', 1, joinPaths(joinPaths([observed.last], sliceTo(from, split)), [here]),
          { labelKey: 'flownEstimated' }));
      }
    }
    // Still to fly: to the stand or the apron hold, or (a departure) on to its destination.
    let remaining = joinPaths([here], sliceTo(split, window.toM));
    const goal = pointOf(destination) ?? pointOf(trajectory.meta?.destination);
    if (departure && goal !== null) remaining = joinPaths(remaining, [goal]);
    push(lineFeature(flightKey, 'remaining', 0, remaining));
    for (const mark of marksOf(trajectory, window, departure)) {
      if (mark.alongM >= split - JOIN_M && mark.alongM <= window.toM + JOIN_M) features.push(markFeature(flightKey, mark));
    }
  }
  return deepFreeze({ type: 'FeatureCollection', features });
}
