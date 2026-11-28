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
/** A real flight leaves the runway by the first exit beyond this that it can take (LANDING_EXIT_MAX_TURN_DEG). */
export const LANDING_EXIT_MIN_ALONG_M = 1500;
/**
 * A landing turns off only by an exit that turns this much at most from the runway heading (`turnDeg` of
 * taxiRoute.js: runwayExits). One that turns more points back towards the threshold, a rapid exit built for the other
 * direction: taking it would end the roll in a hairpin.
 */
export const LANDING_EXIT_MAX_TURN_DEG = 90;
// Bearings carry the arithmetic's rounding: a right-angle exit can read 90.000000004°.
const TURN_EPSILON_DEG = 1e-6;
/** The downwind is joined abeam this far past the threshold, and a straight-in flies its inbound course this long. */
export const DOWNWIND_JOIN_NM = 4;
export const STRAIGHT_IN_LEAD_NM = 3;
/** An arrival without an origin starts this far out on the extended centreline. */
export const NO_ORIGIN_START_NM = 40;
/** The straight legs of a holding pattern last this long at its speed (ICAO: one minute at or below FL140). */
export const HOLD_LEG_S = 60;
/** The last metres of the great circle that are rounded into the approach. */
export const ARRIVAL_JOIN_M = 60_000;
/** A departure without a destination is drawn this far at most (M3: one with a destination flies on to it). */
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
 * A holding pattern over `fix` (`[lng, lat]`) on the inbound course `inboundDeg`, flown `laps` times at `speedMs`
 * with right turns (the ICAO standard): over the fix a right turn of 180° at the 25° bank radius, the outbound leg
 * `legM` metres, a second right turn of 180° and the inbound leg back over the fix, on the inbound course again; with
 * legs of 0 m it is a full circle. `{ coords, radiusM, lapM, lengthM }`, frozen: `coords` begins and ends exactly at
 * the fix and passes over it after each lap; the arcs are drawn every 0.5° of turn in the east-north plane of the fix.
 */
export function holdingPatternPath({ fix, inboundDeg, speedMs, legM = speedMs * HOLD_LEG_S, laps = 1 }) {
  const radius = turnRadiusM(speedMs);
  const leg = Math.max(0, legM);
  const count = Math.max(1, Math.round(laps));
  const along = unitOf(inboundDeg);
  const right = unitOf(inboundDeg + 90);
  const steps = Math.ceil(180 / AIR_ARC_STEP_DEG);
  const lap = [];
  // The first turn, round a centre `radius` to the right of the fix, ends abeam it on the outbound course.
  for (let at = 1; at <= steps; at += 1) {
    const theta = (Math.PI * at) / steps;
    lap.push(plus(plus([0, 0], right, radius * (1 - Math.cos(theta))), along, radius * Math.sin(theta)));
  }
  // The outbound leg, then the second turn, round a centre `leg` metres behind the first one, back onto the inbound
  // course `leg` metres before the fix.
  for (let at = leg > 0 ? 0 : 1; at <= steps; at += 1) {
    const theta = (Math.PI * at) / steps;
    lap.push(plus(plus([0, 0], right, radius * (1 + Math.cos(theta))), along, -(leg + radius * Math.sin(theta))));
  }
  if (leg > 0) lap.push([0, 0]);
  else lap[lap.length - 1] = [0, 0];
  const plane = toLocal(fix);
  const onEarth = lap.map(point => (point[0] === 0 && point[1] === 0 ? freezePoint(fix) : freezePoint(plane.inverse(point))));
  const coords = [freezePoint(fix)];
  for (let at = 0; at < count; at += 1) coords.push(...onEarth);
  const lapM = measurePolyline([freezePoint(fix), ...onEarth]).lengthM;
  return Object.freeze({ coords: Object.freeze(coords), radiusM: radius, lapM, lengthM: measurePolyline(coords).lengthM });
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

/** The exits a landing on `runwayEnd` can turn off by (90° at most from its heading), nearest to the threshold first. */
function landingExits(layout, runwayEnd) {
  return runwayExits(layout, runwayEnd).filter(exit => exit.turnDeg <= LANDING_EXIT_MAX_TURN_DEG + TURN_EPSILON_DEG);
}

/**
 * The exit a real flight takes, among those that turn 90° at most from the runway heading: the first beyond
 * `minAlongM` (1 500 m) from the threshold, else the farthest of them; `null` for a runway without one.
 * `{ nodeId, p, alongM, turnDeg }`.
 */
export function defaultLandingExit(layout, runwayEnd, { minAlongM = LANDING_EXIT_MIN_ALONG_M } = {}) {
  const exits = landingExits(layout, runwayEnd);
  return exits.find(exit => exit.alongM > minAlongM) ?? exits[exits.length - 1] ?? null;
}

/**
 * The exits a landing can take after rolling at least `minRollM` from the touchdown point, nearest first: only those
 * that turn 90° at most from the runway heading, as for defaultLandingExit.
 */
export function landingExitCandidates(layout, runwayEnd, { minRollM = 0 } = {}) {
  return Object.freeze(landingExits(layout, runwayEnd).filter(exit => exit.alongM - TOUCHDOWN_ALONG_M >= minRollM));
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
 * drawn `maxDistanceM` at most (none given: on to the destination, M3). Without a destination it holds runway heading
 * for `maxDistanceM` (none given: CLIMB_MAX_NM). `{ coords, turnStartM, lengthM }`, frozen. A turn of more than 90° is
 * flown in equal parts so each corner can be rounded.
 */
export function climbPath({ runwayEnd, liftoff, destination = null, straightM, turnSpeedMs, maxDistanceM = null }) {
  const limitM = Number.isFinite(maxDistanceM) && maxDistanceM > 0 ? maxDistanceM : (destination ? Infinity : CLIMB_MAX_NM * NM);
  const heading = runwayEnd.headingTrue;
  const turnStart = destinationPoint(liftoff, heading, straightM);
  if (!destination) {
    const coords = cutAt(greatCirclePath(liftoff, destinationPoint(liftoff, heading, limitM)), limitM);
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
  const coords = cutAt([...near, ...far], limitM);
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

// CN-29: the approach still to fly from where the aircraft really is. A plan built from the origin's bearing (above)
// is no guide for an aircraft that flies somewhere else: joining it would draw a perpendicular dog-leg to the plan and
// then the plan's own corners. Instead the map flies the aircraft from its position and track onto the final of its
// runway with the shortest path of turns at the 25° bank radius and straight legs (a Dubins path: turn, straight, turn),
// established on the extended centreline at a join chosen near the gate, then straight down the final to the
// threshold. Tangent-continuous: no corner anywhere, so it never doubles back or draws a rectangle.

/** Where the final may be joined, in NM before the threshold, and the join the approach prefers (the gate). */
export const INTERCEPT = Object.freeze({
  minFinalNm: 3,
  maxFinalNm: 14,
  stepNm: 0.5,
  preferredNm: GATE_NM,
  // Every NM short of the preferred join costs this many metres: the shortest path alone joins very short finals.
  shortFinalPenaltyM: 2 * NM,
  // Farther than this from the threshold the aircraft flies the great circle to that distance first.
  farM: 60_000,
  // The turn radius uses the aircraft's speed within these bounds (m/s).
  minSpeedMs: 60,
  maxSpeedMs: 130,
  // Within this of the extended centreline, before the threshold, the aircraft joins ahead of itself.
  nearFinalLateralNm: 3,
});

const TWO_PI = 2 * Math.PI;
const mod2pi = value => ((value % TWO_PI) + TWO_PI) % TWO_PI;
// A heading (degrees true) as a math angle (radians from east, counter-clockwise), and back.
const mathAngle = bearingDeg => degToRad(90 - bearingDeg);

/**
 * The shortest turn-straight-turn path in a plane from `p` heading `h0` (math angle) to `q` heading `h1` at radius `r`:
 * `{ lengthM, sample(stepRad) }`; `sample` gives the points from `p` to `q`, arcs every `stepRad` of turn.
 */
function dubinsCsc(p, h0, q, h1, r) {
  let best = null;
  for (const s1 of [1, -1]) {
    // s = 1 a left (counter-clockwise) turn, −1 a right one.
    for (const s2 of [1, -1]) {
      const c1 = [p[0] - s1 * r * Math.sin(h0), p[1] + s1 * r * Math.cos(h0)];
      const c2 = [q[0] - s2 * r * Math.sin(h1), q[1] + s2 * r * Math.cos(h1)];
      const vx = c2[0] - c1[0];
      const vy = c2[1] - c1[1];
      const d = Math.hypot(vx, vy);
      let heading;
      let straight;
      if (s1 === s2) {
        heading = Math.atan2(vy, vx);
        straight = d;
      } else {
        if (d < 2 * r) continue;
        straight = Math.sqrt(d * d - 4 * r * r);
        // The inner tangent: the line of centres turned by atan(2r / straight), towards the second turn's side.
        heading = Math.atan2(vy, vx) - s2 * Math.atan2(2 * r, straight);
      }
      const sweep1 = s1 === 1 ? mod2pi(heading - h0) : mod2pi(h0 - heading);
      const sweep2 = s2 === 1 ? mod2pi(h1 - heading) : mod2pi(heading - h1);
      const lengthM = r * (sweep1 + sweep2) + straight;
      if (best === null || lengthM < best.lengthM) best = { lengthM, s1, s2, c1, c2, sweep1, sweep2, heading };
    }
  }
  const arc = (centre, s, startHeading, sweep, stepRad) => {
    const points = [];
    const steps = Math.max(1, Math.ceil(sweep / stepRad));
    for (let at = 1; at <= steps; at += 1) {
      const h = startHeading + (s * sweep * at) / steps;
      points.push([centre[0] + s * r * Math.sin(h), centre[1] - s * r * Math.cos(h)]);
    }
    return points;
  };
  return {
    lengthM: best.lengthM,
    sample(stepRad) {
      const first = best.sweep1 > 1e-9 ? arc(best.c1, best.s1, h0, best.sweep1, stepRad) : [];
      const second = best.sweep2 > 1e-9 ? arc(best.c2, best.s2, best.heading, best.sweep2, stepRad) : [];
      const t2 = [best.c2[0] + best.s2 * r * Math.sin(best.heading), best.c2[1] - best.s2 * r * Math.cos(best.heading)];
      return [[p[0], p[1]], ...first, ...(best.sweep2 > 1e-9 ? [t2] : []), ...second.slice(0, -1), [q[0], q[1]]];
    },
  };
}

/**
 * The approach still to fly from an aircraft at `from` (`[lng, lat]`) on track `trackDeg` (degrees true; without one,
 * towards the final) at `speedMs` to the threshold of `runwayEnd` (`{ threshold, headingTrue }`, airport/runwayInUse.js):
 * `{ coords, joinNm, lengthM }`, frozen. Turns at the 25° bank radius for the aircraft's speed (60 to 130 m/s), a straight
 * leg, a turn onto the extended centreline at the join (3 to 14 NM out, preferring the 10 NM gate, never behind the
 * aircraft's own distance along the final: one close in joins shorter, down to 0.3 NM), and the final straight to the threshold. Farther than 60 km from the
 * threshold the aircraft first flies the great circle to 60 km. `coords` starts exactly at `from` and ends exactly at
 * the threshold, its last leg on the runway's heading.
 */
export function interceptPath({ from, trackDeg = null, speedMs = null, runwayEnd }) {
  const threshold = runwayEnd.threshold;
  const plane = toLocal(threshold);
  let head = [];
  let start = from;
  let startTrack = Number.isFinite(trackDeg) ? trackDeg : null;
  const distance = haversineM(from, threshold);
  if (distance > INTERCEPT.farM) {
    const great = greatCirclePath(from, threshold, 10_000);
    const measured = measurePolyline(great);
    const cut = pointAlong(measured, measured.lengthM - INTERCEPT.farM);
    head = [...measured.coords.filter((_, at) => measured.cumM[at] < measured.lengthM - INTERCEPT.farM)];
    start = cut.p;
    startTrack = initialBearing(start, threshold);
  }
  const speed = Math.min(INTERCEPT.maxSpeedMs, Math.max(INTERCEPT.minSpeedMs, Number.isFinite(speedMs) ? speedMs : INTERCEPT.maxSpeedMs));
  const radius = turnRadiusM(speed);
  const p = plane.forward(start);
  const along = unitOf(runwayEnd.headingTrue);
  // How far the aircraft is before the threshold along the final course.
  const behindM = -(p[0] * along[0] + p[1] * along[1]);
  const h1 = mathAngle(runwayEnd.headingTrue);
  // Without a track it heads for the threshold. The join is never behind the aircraft: one already close in (or on
  // final) joins short, down to a third of a mile.
  const h0 = mathAngle(startTrack ?? initialBearing(start, threshold));
  let best = null;
  const behindNm = behindM / NM;
  const lateralM = Math.abs(p[0] * along[1] - p[1] * along[0]);
  // Close to the extended centreline before the threshold: the join is ahead of the aircraft.
  const nearFinal = behindNm > 0 && lateralM < INTERCEPT.nearFinalLateralNm * NM;
  const lowNm = nearFinal ? Math.min(INTERCEPT.minFinalNm, Math.max(0.3, behindNm / 2)) : INTERCEPT.minFinalNm;
  const maxNm = nearFinal ? Math.max(lowNm, Math.min(INTERCEPT.maxFinalNm, behindNm - 0.5)) : INTERCEPT.maxFinalNm;
  const step = Math.min(INTERCEPT.stepNm, Math.max(0.1, (maxNm - lowNm) / 8));
  for (let nm = lowNm; nm <= maxNm + 1e-9; nm += step) {
    const joinM = nm * NM;
    const q = [-joinM * along[0], -joinM * along[1]];
    const path = dubinsCsc(p, h0, q, h1, radius);
    const cost = path.lengthM + joinM + Math.max(0, INTERCEPT.preferredNm - nm) * INTERCEPT.shortFinalPenaltyM;
    if (best === null || cost < best.cost) best = { cost, nm, path, q };
  }
  const local = best.path.sample(AIR_ARC_STEP_RAD * 2);
  const air = local.map((point, at) => (at === 0 ? freezePoint(start) : freezePoint(plane.inverse(point))));
  const coords = [...head.map(freezePoint), ...air, freezePoint(threshold)];
  return Object.freeze({ coords: Object.freeze(coords), joinNm: best.nm, lengthM: measurePolyline(coords).lengthM });
}
