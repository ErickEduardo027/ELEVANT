import {
  destinationPoint,
  filletPath,
  greatCirclePath,
  haversineM,
  initialBearing,
  measurePolyline,
  nearestOnPolyline,
  pointAlong,
  toLocal,
} from '../airport/geo.js';
import { centrelineBetween } from '../airport/runwayInUse.js';
import { G0, NM, degToRad, ftToM } from './units.js';
import { runwayExits } from './taxiRoute.js';

// The air and runway paths of the map kinematics (PR M6, design F2): the approach to a runway end (straight in to a
// gate 10 NM out, or a downwind 6 NM abeam, a base and a final), the 3° final crossing the threshold at 50 ft, the
// landing roll to an exit, the take-off roll, the initial climb and the whole arrival from the counterpart airport.
// Geometry only: lengths and heights, never times (the trajectory fits those to the server's instants). Metres, m/s
// and degrees true; `[lng, lat]`. Corners are rounded at the radius of a 25° bank turn in the east-north plane of the
// threshold. Pure: explicit '.js' imports, no clock, no JSON; runway ends come from airport/runwayInUse.js.

/** The bank of every rounded turn in the air. */
export const BANK_DEG = 25;
/** The gate where the final begins, and the downwind's distance abeam the centreline, in NM. */
export const GATE_NM = 10;
export const DOWNWIND_OFFSET_NM = 6;
/** The glide path, and the height it crosses the threshold at. */
export const GLIDE_DEG = 3;
export const THRESHOLD_CROSS_FT = 50;
/** Where the wheels touch, along the centreline from the threshold. */
export const TOUCHDOWN_ALONG_M = 300;
/** A real flight leaves the runway by the first exit beyond this. */
export const LANDING_EXIT_MIN_ALONG_M = 1500;
/** The downwind is joined abeam this far past the threshold, and a straight-in flies its inbound course this long. */
export const DOWNWIND_JOIN_NM = 4;
export const STRAIGHT_IN_LEAD_NM = 3;
/** An arrival without an origin starts this far out on the extended centreline. */
export const NO_ORIGIN_START_NM = 40;
/** The last metres of the great circle that are rounded into the approach. */
export const ARRIVAL_JOIN_M = 60_000;
/** A departure is drawn this far at most. */
export const CLIMB_MAX_NM = 250;
/** Arcs in the air are drawn every 0.5° of turn (16 m at 180 kt), so the heading never steps by more. */
export const AIR_ARC_STEP_DEG = 0.5;
const AIR_ARC_STEP_RAD = degToRad(AIR_ARC_STEP_DEG);

const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const unitOf = bearingDeg => [Math.sin(degToRad(bearingDeg)), Math.cos(degToRad(bearingDeg))];
const plus = (a, b, scale = 1) => [a[0] + b[0] * scale, a[1] + b[1] * scale];
const freezePoint = point => Object.freeze([point[0], point[1]]);
const freezePoints = points => Object.freeze(points.map(freezePoint));

/** The radius in metres of a coordinated turn at `speedMs` and `bankDeg`: v² / (g · tan bank). */
export function turnRadiusM(speedMs, bankDeg = BANK_DEG) {
  return (speedMs * speedMs) / (G0 * Math.tan(degToRad(bankDeg)));
}

/**
 * The point `distM` metres along a runway end's centreline from its threshold, as `[lng, lat]`: a negative distance is
 * on the extended centreline behind the threshold, one past the runway on its extension beyond the far end.
 */
export function centrelinePoint(end, distM) {
  if (distM < 0) return freezePoint(destinationPoint(end.threshold, end.headingTrue + 180, -distM));
  if (distM > end.lengthM) return freezePoint(destinationPoint(end.oppositeThreshold, end.headingTrue, distM - end.lengthM));
  return pointAlong(end.centerline, distM).p;
}

/** The corners of an approach in the east-north plane of the threshold, before rounding. */
function approachCorners({ inboundBearingDeg, runwayEnd, speedMs, gateNm, downwindOffsetNm }) {
  const radius = turnRadiusM(speedMs);
  const along = unitOf(runwayEnd.headingTrue);
  const gate = [-gateNm * NM * along[0], -gateNm * NM * along[1]];
  const inbound = unitOf(inboundBearingDeg);
  const off = angleBetween(inboundBearingDeg, runwayEnd.headingTrue);
  if (off <= 90) {
    // Direct to an intercept on the extended centreline, placed so the turn ends established at the gate.
    const tangent = radius * Math.tan(degToRad(off) / 2);
    const intercept = plus(gate, along, -tangent);
    const entry = plus(intercept, inbound, -Math.max(STRAIGHT_IN_LEAD_NM * NM, 2 * tangent));
    return { mode: 'straight-in', radius, corners: [entry, intercept, gate] };
  }
  // From ahead: a downwind abeam on the side the aircraft comes from, a base, and the final turn ending at the gate.
  const from = [-inbound[0], -inbound[1]];
  const cross = along[0] * from[1] - along[1] * from[0];
  const side = cross < 0 ? -1 : 1;
  const abeam = [-along[1] * side * downwindOffsetNm * NM, along[0] * side * downwindOffsetNm * NM];
  const intercept = plus(gate, along, -radius);
  const baseStart = plus(intercept, abeam);
  const entry = plus(plus([0, 0], along, DOWNWIND_JOIN_NM * NM), abeam);
  return { mode: 'downwind', radius, corners: [entry, baseStart, intercept, gate] };
}

/**
 * The approach to a runway end from an aircraft flying `inboundBearingDeg` at `speedMs`: `{ coords (entry → gate),
 * mode, gate, entry, radiusM, lengthM }`, frozen. Arriving from behind the runway (within 90° of its heading) it flies
 * direct to an intercept on the extended centreline and is established at the gate, `gateNm` out ('straight-in');
 * from ahead it joins a downwind `downwindOffsetNm` abeam on the side it comes from, abeam a point 4 NM past the
 * threshold, then flies a base and turns final at the gate ('downwind'). Corners are rounded at the 25° bank radius.
 */
export function approachPath({ inboundBearingDeg, runwayEnd, speedMs, gateNm = GATE_NM, downwindOffsetNm = DOWNWIND_OFFSET_NM }) {
  const plan = approachCorners({ inboundBearingDeg, runwayEnd, speedMs, gateNm, downwindOffsetNm });
  const plane = toLocal(runwayEnd.threshold);
  const rounded = filletPath(plan.corners, plan.radius, { arcStepM: plan.radius * AIR_ARC_STEP_RAD });
  const gate = centrelinePoint(runwayEnd, -gateNm * NM);
  const coords = rounded.coords.map((point, at) => (at === rounded.coords.length - 1 ? gate : freezePoint(plane.inverse(point))));
  return Object.freeze({
    coords: Object.freeze(coords),
    mode: plan.mode,
    gate,
    entry: coords[0],
    radiusM: plan.radius,
    lengthM: measurePolyline(coords).lengthM,
  });
}

/**
 * The final from the gate to the threshold on the extended centreline: `{ coords: [gate, threshold], alt0M, alt1M,
 * lengthM }`, frozen. Heights are above sea level: `alt1M` crosses the threshold `thresholdCrossFt` above its
 * elevation and `alt0M` is that plus the glide path's rise over the distance (318 ft per NM at 3°).
 */
export function finalPath(runwayEnd, { gateNm = GATE_NM, glideDeg = GLIDE_DEG, thresholdCrossFt = THRESHOLD_CROSS_FT } = {}) {
  const gate = centrelinePoint(runwayEnd, -gateNm * NM);
  const alt1M = ftToM(runwayEnd.elevationFt + thresholdCrossFt);
  return Object.freeze({
    coords: freezePoints([gate, runwayEnd.threshold]),
    alt0M: alt1M + gateNm * NM * Math.tan(degToRad(glideDeg)),
    alt1M,
    lengthM: gateNm * NM,
  });
}

/**
 * The landing roll on the centreline from the touchdown point (300 m past the threshold) to an exit (`{ alongM }`):
 * `{ coords, fromAlongM, toAlongM, lengthM }`, frozen; `null` when the exit is not past the touchdown point.
 */
export function landingRollPath(runwayEnd, exit) {
  if (!exit || !(exit.alongM > TOUCHDOWN_ALONG_M)) return null;
  const coords = centrelineBetween(runwayEnd, TOUCHDOWN_ALONG_M, exit.alongM);
  return Object.freeze({ coords, fromAlongM: TOUCHDOWN_ALONG_M, toAlongM: exit.alongM, lengthM: measurePolyline(coords).lengthM });
}

/**
 * The exit a real flight takes: the first beyond `minAlongM` (1 500 m) from the threshold, else the farthest; `null`
 * for a runway without exits. `{ nodeId, p, alongM }`.
 */
export function defaultLandingExit(layout, runwayEnd, { minAlongM = LANDING_EXIT_MIN_ALONG_M } = {}) {
  const exits = runwayExits(layout, runwayEnd);
  return exits.find(exit => exit.alongM > minAlongM) ?? exits[exits.length - 1] ?? null;
}

/** The exits a landing can take after rolling at least `minRollM` from the touchdown point, nearest first. */
export function landingExitCandidates(layout, runwayEnd, { minRollM = 0 } = {}) {
  return Object.freeze(runwayExits(layout, runwayEnd).filter(exit => exit.alongM - TOUCHDOWN_ALONG_M >= minRollM));
}

/**
 * The take-off roll on the centreline from `fromAlongM` (where the line-up ends) over `distM` metres, clamped to the
 * runway: `{ coords, fromAlongM, toAlongM, lengthM }`, frozen.
 */
export function takeoffPath(runwayEnd, fromAlongM, distM) {
  const from = Math.max(0, Math.min(runwayEnd.lengthM, fromAlongM));
  const to = Math.max(from, Math.min(runwayEnd.lengthM, from + distM));
  const coords = centrelineBetween(runwayEnd, from, to);
  return Object.freeze({ coords, fromAlongM: from, toAlongM: to, lengthM: measurePolyline(coords).lengthM });
}

/** Cuts a measured line `lengthM` from its start. */
function cutAt(points, lengthM) {
  const measured = measurePolyline(points);
  if (measured.lengthM <= lengthM) return measured.coords;
  const kept = measured.coords.filter((_, at) => measured.cumM[at] < lengthM);
  return freezePoints([...kept, pointAlong(measured, lengthM).p]);
}

/**
 * The initial climb from `liftoff` (`[lng, lat]`): runway heading for `straightM` metres (the caller's distance to
 * 1 500 ft), then a turn at the 25° bank radius for `turnSpeedMs` onto the great circle to `destination`, the whole
 * drawn `maxDistanceM` at most. Without a destination it holds runway heading. `{ coords, turnStartM, lengthM }`,
 * frozen. A turn of more than 90° is flown in equal parts so each corner can be rounded.
 */
export function climbPath({ runwayEnd, liftoff, destination = null, straightM, turnSpeedMs, maxDistanceM = CLIMB_MAX_NM * NM }) {
  const heading = runwayEnd.headingTrue;
  const turnStart = destinationPoint(liftoff, heading, straightM);
  if (!destination) {
    const coords = cutAt(greatCirclePath(liftoff, destinationPoint(liftoff, heading, maxDistanceM)), maxDistanceM);
    return Object.freeze({ coords, turnStartM: straightM, lengthM: measurePolyline(coords).lengthM });
  }
  const radius = turnRadiusM(turnSpeedMs);
  const plane = toLocal(liftoff);
  let bearing = initialBearing(turnStart, destination);
  const turn = ((bearing - heading + 540) % 360) - 180;
  const corners = [[0, 0]];
  let tail = turnStart;
  if (Math.abs(turn) >= 0.5) {
    const parts = Math.ceil(Math.abs(turn) / 90);
    const step = turn / parts;
    const tangent = radius * Math.tan(degToRad(Math.abs(step)) / 2);
    let point = plane.forward(turnStart);
    let direction = heading;
    for (let part = 0; part < parts; part += 1) {
      point = plus(point, unitOf(direction), part === 0 ? tangent : 2 * tangent);
      corners.push(point);
      direction += step;
    }
    // The last leg points at the destination from the last corner; it is long enough for the corner's arc.
    const lastCorner = plane.inverse(corners[corners.length - 1]);
    bearing = initialBearing(lastCorner, destination);
    tail = destinationPoint(lastCorner, bearing, Math.min(haversineM(lastCorner, destination), Math.max(4 * tangent, 20_000)));
  }
  corners.push(plane.forward(tail));
  const rounded = filletPath(corners, radius, { arcStepM: radius * AIR_ARC_STEP_RAD });
  const near = rounded.coords.map((point, at) => (at === 0 ? freezePoint(liftoff) : freezePoint(plane.inverse(point))));
  const far = greatCirclePath(tail, destination).slice(1);
  const coords = cutAt([...near, ...far], maxDistanceM);
  return Object.freeze({ coords, turnStartM: straightM, lengthM: measurePolyline(coords).lengthM });
}

/**
 * The whole arrival in the air to a runway end: `{ coords, mode, entryAlongM, gateAlongM, thresholdAlongM }`, frozen,
 * the distances measured along `coords` from its start. From `origin` (`[lng, lat]`) it follows the great circle to
 * the approach's entry and on through the approach (`approachPath` for the inbound course it arrives on) and the
 * final to the threshold; its last 60 km are taken into the threshold's plane, so the join is rounded at the same 25°
 * bank radius. Without an origin it starts 40 NM out on the extended centreline.
 */
export function arrivalAirPath({ origin = null, runwayEnd, speedMs }) {
  if (!origin) {
    const coords = freezePoints([centrelinePoint(runwayEnd, -NO_ORIGIN_START_NM * NM), centrelinePoint(runwayEnd, -GATE_NM * NM), runwayEnd.threshold]);
    const measured = measurePolyline(coords);
    return Object.freeze({
      coords, mode: 'straight-in', entryAlongM: 0, gateAlongM: measured.cumM[1], thresholdAlongM: measured.lengthM,
    });
  }
  const inbound = (initialBearing(runwayEnd.threshold, origin) + 180) % 360;
  const plan = approachCorners({ inboundBearingDeg: inbound, runwayEnd, speedMs, gateNm: GATE_NM, downwindOffsetNm: DOWNWIND_OFFSET_NM });
  const plane = toLocal(runwayEnd.threshold);
  const entry = plane.inverse(plan.corners[0]);
  const cruise = measurePolyline(greatCirclePath(origin, entry));
  const joinFrom = Math.max(0, cruise.lengthM - ARRIVAL_JOIN_M);
  const far = cruise.coords.filter((_, at) => cruise.cumM[at] < joinFrom);
  const nearCruise = cruise.coords.filter((_, at) => cruise.cumM[at] >= joinFrom).slice(0, -1);
  const local = [...(far.length > 0 ? [far[far.length - 1]] : []), ...nearCruise].map(plane.forward);
  const rounded = filletPath([...local, ...plan.corners], plan.radius, { arcStepM: plan.radius * AIR_ARC_STEP_RAD });
  const gate = centrelinePoint(runwayEnd, -GATE_NM * NM);
  const near = rounded.coords.map((point, at) => (at === rounded.coords.length - 1 ? gate : freezePoint(plane.inverse(point))));
  const coords = freezePoints([...far.slice(0, -1), ...near, runwayEnd.threshold]);
  const measured = measurePolyline(coords);
  return Object.freeze({
    coords,
    mode: plan.mode,
    entryAlongM: nearestOnPolyline(measured, entry).alongM,
    gateAlongM: measured.cumM[measured.coords.length - 2],
    thresholdAlongM: measured.lengthM,
  });
}
