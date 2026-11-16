import { describe, expect, it } from 'vitest';
import { MDPC_LAYOUT } from '../airport/airportLayout.js';
import {
  destinationPoint, haversineM, initialBearing, measurePolyline, nearestOnPolyline, pointAlong, pointToPolylineM, toLocal,
} from '../airport/geo.js';
import { runwayEnd } from '../airport/runwayInUse.js';
import { edgeLine } from '../airport/taxiGraph.js';
import { createKinematicsLayout } from './kinematicsFixtures.js';
import {
  AIR_ARC_STEP_DEG,
  GATE_NM,
  HOLD_LEG_S,
  TOUCHDOWN_ALONG_M,
  approachPath,
  arrivalAirPath,
  centrelinePoint,
  climbPath,
  defaultLandingExit,
  finalPath,
  holdingPatternPath,
  landingExitCandidates,
  landingRollPath,
  takeoffPath,
  turnRadiusM,
} from './pathBuilder.js';
import { graphFor, runwayExits } from './taxiRoute.js';
import { NM, fpmToMs, ftToM, ktToMs } from './units.js';

const end08 = runwayEnd(MDPC_LAYOUT, '08');
const APPROACH_MS = ktToMs(180);
const MIA = [-80.287, 25.7959];
const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/** Signed distance of a point from the extended centreline of a runway end (positive to the left of its heading). */
function offCentreline(end, point) {
  const [x, y] = toLocal(end.threshold).forward(point);
  const radians = (end.headingTrue * Math.PI) / 180;
  return -x * Math.cos(radians) + y * Math.sin(radians);
}

/** The radius of the circle through three points. */
function circumradius(a, b, c) {
  const [ab, bc, ca] = [haversineM(a, b), haversineM(b, c), haversineM(c, a)];
  const s = (ab + bc + ca) / 2;
  const area = Math.sqrt(Math.max(0, s * (s - ab) * (s - bc) * (s - ca)));
  return (ab * bc * ca) / (4 * area);
}

/** Bearings every `stepM` along a path. */
function bearingsAlong(coords, stepM) {
  const measured = measurePolyline(coords);
  const bearings = [];
  for (let distance = 0; distance <= measured.lengthM; distance += stepM) bearings.push(pointAlong(measured, distance).bearingDeg);
  return bearings;
}

/**
 * How far a landing on `end` turns to leave by `exit`, measured on the plan itself: the smallest angle between the
 * runway heading and the bearing of the first 10 m of each of the exit's edges that are not runway.
 */
function turnOnto(layout, end, exit) {
  const graph = graphFor(layout);
  return Math.min(...graph.adjacency.get(exit.nodeId)
    .filter(({ edge }) => edge.kind !== 'runway')
    .map(({ edge }) => {
      const line = edge.a === exit.nodeId ? edgeLine(graph, edge) : [...edgeLine(graph, edge)].reverse();
      return angleBetween(initialBearing(exit.p, pointAlong(line, 10).p), end.headingTrue);
    }));
}

/** The synthetic aerodrome with the taxi edges of `exitIds` leaving them on 233°: back towards 09, ahead along 27. */
function bentBack(exitIds) {
  const layout = createKinematicsLayout();
  const point = id => layout.taxiGraph.nodes.find(node => node.id === id).p;
  for (const edge of layout.taxiGraph.edges) {
    if (edge.kind === 'runway' || !exitIds.includes(edge.a)) continue;
    const via = destinationPoint(point(edge.a), 233, 50);
    edge.line = [point(edge.a), via, point(edge.b)];
    edge.m = haversineM(point(edge.a), via) + haversineM(via, point(edge.b));
  }
  return layout;
}

describe('approach and departure paths', () => {
  it('an inbound from behind goes direct to a gate 10 NM out on the extended centreline', () => {
    const radius = turnRadiusM(APPROACH_MS);
    expect(radius).toBeCloseTo(APPROACH_MS ** 2 / (9.80665 * Math.tan((25 * Math.PI) / 180)), 6);
    expect(radius).toBeGreaterThan(1800);
    expect(radius).toBeLessThan(1950);
    const approach = approachPath({ inboundBearingDeg: 120, runwayEnd: end08, speedMs: APPROACH_MS });
    expect(approach.mode).toBe('straight-in');
    expect(approach.radiusM).toBe(radius);
    // It ends at the gate, 10 NM out on the extended centreline, established on the runway heading.
    const gate = destinationPoint(end08.threshold, end08.headingTrue + 180, GATE_NM * NM);
    expect(haversineM(approach.gate, gate)).toBeLessThan(0.01);
    expect(approach.coords[approach.coords.length - 1]).toEqual(approach.gate);
    const last = approach.coords.length - 1;
    expect(angleBetween(initialBearing(approach.coords[last - 1], approach.coords[last]), end08.headingTrue)).toBeLessThan(AIR_ARC_STEP_DEG);
    // Before its turn it flies straight on the inbound course: direct, with no downwind on the way. (Bearings 16 km from
    // the threshold differ from the plane's by the meridians' convergence, under 0.1°.)
    expect(angleBetween(initialBearing(approach.coords[0], approach.coords[1]), 120)).toBeLessThan(0.1);
    for (const point of approach.coords) expect(Math.abs(offCentreline(end08, point))).toBeLessThan(4 * NM);
    // One turn of 46° at the 25° bank radius.
    const arc = approach.coords.slice(1, -1);
    expect(arc.length).toBeGreaterThan(10);
    expect(circumradius(arc[2], arc[Math.floor(arc.length / 2)], arc[arc.length - 3]) / radius).toBeCloseTo(1, 2);
  });

  it('an inbound from ahead flies a downwind 6 NM abeam, a base and a final, with corners filleted at the 25° bank radius', () => {
    // Arriving on 250° from the east-north-east, ahead of runway 08.
    const approach = approachPath({ inboundBearingDeg: 250, runwayEnd: end08, speedMs: APPROACH_MS });
    expect(approach.mode).toBe('downwind');
    const radius = approach.radiusM;
    const offsets = approach.coords.map(point => offCentreline(end08, point));
    // The downwind: flown opposite to the landing, 6 NM abeam on the side the aircraft comes from (the left of 08).
    const downwind = approach.coords.filter((_, at) => Math.abs(offsets[at] - 6 * NM) < 1);
    expect(downwind.length).toBeGreaterThanOrEqual(2);
    expect(angleBetween(initialBearing(approach.coords[0], approach.coords[1]), end08.headingTrue + 180)).toBeLessThan(0.1);
    expect(offsets[0]).toBeCloseTo(6 * NM, 3);
    // The base: perpendicular to the centreline, from 6 NM abeam towards it, beyond the gate.
    const baseLegs = [];
    for (let at = 1; at < approach.coords.length; at += 1) {
      const bearing = initialBearing(approach.coords[at - 1], approach.coords[at]);
      if (haversineM(approach.coords[at - 1], approach.coords[at]) > 1000) baseLegs.push(bearing);
    }
    expect(baseLegs.some(bearing => angleBetween(bearing, end08.headingTrue + 90) < 0.5)).toBe(true);
    // Every rounded corner has the 25° bank radius, and the final turn ends established at the gate.
    const corners = [];
    for (let at = 1; at < approach.coords.length - 1; at += 1) {
      const [a, b, c] = [approach.coords[at - 1], approach.coords[at], approach.coords[at + 1]];
      if (haversineM(a, b) < radius * 0.05 && haversineM(b, c) < radius * 0.05) corners.push(circumradius(a, b, c));
    }
    expect(corners.length).toBeGreaterThan(40);
    for (const value of corners) expect(value / radius).toBeCloseTo(1, 2);
    const last = approach.coords.length - 1;
    expect(approach.coords[last]).toEqual(approach.gate);
    expect(angleBetween(initialBearing(approach.coords[last - 1], approach.coords[last]), end08.headingTrue)).toBeLessThan(AIR_ARC_STEP_DEG);
    // The other side for an aircraft coming from the south-east of the field.
    const fromSouth = approachPath({ inboundBearingDeg: 290, runwayEnd: end08, speedMs: APPROACH_MS });
    expect(offCentreline(end08, fromSouth.coords[0])).toBeCloseTo(-6 * NM, 3);
  });

  it('the final descends 3° and crosses the threshold at 50 ft', () => {
    const final = finalPath(end08);
    expect(final.coords[1]).toEqual(end08.threshold);
    expect(haversineM(final.coords[0], end08.threshold)).toBeCloseTo(GATE_NM * NM, 3);
    // It arrives at the threshold on the runway heading (the reverse azimuth of the threshold → gate bearing).
    expect(angleBetween(initialBearing(final.coords[1], final.coords[0]) + 180, end08.headingTrue)).toBeLessThan(1e-6);
    // 50 ft over the threshold of 08 (43 ft), 3° up to the gate: 318 ft per NM.
    expect(final.alt1M).toBeCloseTo(ftToM(43 + 50), 9);
    expect(Math.atan((final.alt0M - final.alt1M) / final.lengthM) * (180 / Math.PI)).toBeCloseTo(3, 9);
    expect((final.alt0M - final.alt1M) / ftToM(1) / GATE_NM).toBeCloseTo(318.4, 0);
    const steep = finalPath(end08, { gateNm: 5, glideDeg: 3.5, thresholdCrossFt: 60 });
    expect(steep.alt1M).toBeCloseTo(ftToM(43 + 60), 9);
    expect(steep.lengthM).toBe(5 * NM);
  });

  it('a holding pattern turns right at the 25° bank radius and comes back over its fix on the inbound course', () => {
    // Over the 08 gate, on the course the final leaves it on.
    const fix = centrelinePoint(end08, -GATE_NM * NM);
    const inboundDeg = initialBearing(fix, end08.threshold);
    const radius = turnRadiusM(APPROACH_MS);
    const legM = APPROACH_MS * HOLD_LEG_S;
    const hold = holdingPatternPath({ fix, inboundDeg, speedMs: APPROACH_MS });
    expect(hold.radiusM).toBe(radius);
    // It begins and ends exactly over the fix, on the inbound course: two half circles and two one-minute legs.
    const last = hold.coords.length - 1;
    expect(hold.coords[0]).toEqual(fix);
    expect(hold.coords[last]).toEqual(fix);
    expect(angleBetween(initialBearing(hold.coords[0], hold.coords[1]), inboundDeg)).toBeLessThanOrEqual(AIR_ARC_STEP_DEG);
    expect(angleBetween(initialBearing(hold.coords[last], hold.coords[last - 1]) + 180, inboundDeg)).toBeLessThan(1e-6);
    expect(hold.lengthM).toBeCloseTo(2 * Math.PI * radius + 2 * legM, -1);
    expect(hold.lapM).toBe(hold.lengthM);
    // Right turns: all of it lies right of the inbound course (south of the 08 final), out to two radii abeam, and
    // reaches back along the course one leg and one radius behind the fix.
    const offsets = hold.coords.map(point => offCentreline(end08, point));
    expect(Math.max(...offsets)).toBeLessThan(1e-6);
    expect(Math.min(...offsets)).toBeCloseTo(-2 * radius, -1);
    const plane = toLocal(fix);
    const course = [Math.sin((inboundDeg * Math.PI) / 180), Math.cos((inboundDeg * Math.PI) / 180)];
    const behind = Math.max(...hold.coords.map(point => {
      const [x, y] = plane.forward(point);
      return -(x * course[0] + y * course[1]);
    }));
    expect(behind).toBeCloseTo(legM + radius, 3);
    // The heading turns by the arc step at most from one point to the next.
    const bearings = hold.coords.slice(1).map((point, at) => initialBearing(hold.coords[at], point));
    bearings.slice(1).forEach((bearing, at) => expect(angleBetween(bearing, bearings[at])).toBeLessThanOrEqual(AIR_ARC_STEP_DEG + 1e-3));
    // Without legs it is a circle; laps fly the same lap again, back over the fix after each.
    const circle = holdingPatternPath({ fix, inboundDeg, speedMs: APPROACH_MS, legM: 0 });
    expect(circle.lengthM).toBeCloseTo(2 * Math.PI * radius, -1);
    expect(circle.coords[circle.coords.length - 1]).toEqual(fix);
    const three = holdingPatternPath({ fix, inboundDeg, speedMs: APPROACH_MS, laps: 3 });
    expect(three.lapM).toBeCloseTo(hold.lengthM, 6);
    expect(three.lengthM).toBeCloseTo(3 * hold.lengthM, 6);
    expect(three.coords.filter(point => point[0] === fix[0] && point[1] === fix[1])).toHaveLength(4);
  });

  it('the rollout on 08 starts 300 m past the threshold and ends at the exit on the centreline', () => {
    const exit = defaultLandingExit(MDPC_LAYOUT, end08);
    // The first exit beyond 1 500 m: the one before it is short of it.
    const exits = runwayExits(MDPC_LAYOUT, end08);
    const index = exits.indexOf(exit);
    expect(exit.alongM).toBeGreaterThan(1500);
    expect(exits[index - 1].alongM).toBeLessThanOrEqual(1500);
    const roll = landingRollPath(end08, exit);
    expect(roll.fromAlongM).toBe(TOUCHDOWN_ALONG_M);
    expect(haversineM(roll.coords[0], centrelinePoint(end08, TOUCHDOWN_ALONG_M))).toBeLessThan(0.001);
    expect(roll.coords[roll.coords.length - 1]).toEqual(exit.p);
    expect(roll.lengthM).toBeCloseTo(exit.alongM - TOUCHDOWN_ALONG_M, 0);
    for (const point of roll.coords) expect(pointToPolylineM(point, end08.centerline).distanceM).toBeLessThan(0.05);
    expect(nearestOnPolyline(end08.centerline, roll.coords[0]).alongM).toBeCloseTo(300, 1);
    // An exit before the touchdown point gives no roll; the candidates leave room to stop.
    expect(landingRollPath(end08, exits[0])).toBeNull();
    expect(landingExitCandidates(MDPC_LAYOUT, end08, { minRollM: 1500 }).every(candidate => candidate.alongM >= 1800)).toBe(true);
    // Beyond the threshold and the far end the centreline goes on along the runway heading.
    expect(haversineM(centrelinePoint(end08, -1000), end08.threshold)).toBeCloseTo(1000, 3);
    expect(haversineM(centrelinePoint(end08, end08.lengthM + 500), end08.oppositeThreshold)).toBeCloseTo(500, 3);
    // The take-off roll runs on the centreline from where the line-up ends.
    const takeoff = takeoffPath(end08, 110, 1800);
    expect(takeoff.toAlongM - takeoff.fromAlongM).toBeCloseTo(1800, 6);
    expect(takeoffPath(end08, 2000, 5000).toAlongM).toBeCloseTo(end08.lengthM, 6);
    // On the synthetic runway every exit leaves at a right angle, and right angles are taken whatever the last digits
    // of the arithmetic (x2 reads 90.000000004°): x2 at 1 600 m, and the farthest, x3, when none lies beyond the
    // distance asked for.
    const synthetic = createKinematicsLayout();
    const end09 = runwayEnd(synthetic, '09');
    for (const exit of runwayExits(synthetic, end09)) expect(exit.turnDeg, exit.nodeId).toBeCloseTo(90, 6);
    expect(defaultLandingExit(synthetic, end09).nodeId).toBe('x2');
    expect(defaultLandingExit(synthetic, end09, { minAlongM: 2800 }).nodeId).toBe('x3');
  });

  it('a landing on 08, 26, 09 or 27 turns off only by an exit that turns 90° at most from the runway heading', () => {
    const defaults = [];
    for (const ident of ['08', '26', '09', '27']) {
      const end = runwayEnd(MDPC_LAYOUT, ident);
      const exits = runwayExits(MDPC_LAYOUT, end);
      for (const exit of exits) expect(exit.turnDeg, `${ident} ${exit.nodeId}`).toBeCloseTo(turnOnto(MDPC_LAYOUT, end, exit), 9);
      // Every end has rapid exits built for the other direction, which point back towards its threshold.
      const usable = exits.filter(exit => turnOnto(MDPC_LAYOUT, end, exit) <= 90);
      expect(usable.length, ident).toBeLessThan(exits.length);
      // The default: the first usable exit beyond 1 500 m.
      const exit = defaultLandingExit(MDPC_LAYOUT, end);
      expect(turnOnto(MDPC_LAYOUT, end, exit), ident).toBeLessThanOrEqual(90);
      expect(exit, ident).toBe(usable.find(candidate => candidate.alongM > 1500));
      defaults.push(exit.nodeId);
      // The candidates the demo fits its time with: every usable exit past the touchdown point, and only those.
      for (const minRollM of [0, 948, 1500]) {
        const label = `${ident} after ${minRollM} m`;
        const candidates = landingExitCandidates(MDPC_LAYOUT, end, { minRollM });
        expect(candidates.length, label).toBeGreaterThan(0);
        for (const candidate of candidates) expect(turnOnto(MDPC_LAYOUT, end, candidate), `${label}: ${candidate.nodeId}`).toBeLessThanOrEqual(90);
        expect(candidates, label).toEqual(usable.filter(candidate => candidate.alongM - TOUCHDOWN_ALONG_M >= minRollM));
      }
    }
    expect(defaults).toEqual(['n7592262104', 'n7592209929', 'n7592254365', 'n7592254321']);
    // On 09 the first exit beyond 1 500 m, n7592254321 at 1 513 m, is the rapid exit of 27 and turns 155° back: the
    // landing goes on to n7592254365, 2 088 m along, which turns 11°.
    const end09 = runwayEnd(MDPC_LAYOUT, '09');
    const first = runwayExits(MDPC_LAYOUT, end09).find(exit => exit.alongM > 1500);
    expect(first.nodeId).toBe('n7592254321');
    expect(turnOnto(MDPC_LAYOUT, end09, first)).toBeGreaterThan(150);
    const taken = defaultLandingExit(MDPC_LAYOUT, end09);
    expect(taken.alongM).toBeCloseTo(2088, 0);
    expect(turnOnto(MDPC_LAYOUT, end09, taken)).toBeLessThan(20);
    // On 08 the rapid exits of 26 at 1 439 m and 2 485 m turn 149° and 164° back: never candidates.
    const on08 = landingExitCandidates(MDPC_LAYOUT, end08).map(exit => exit.nodeId);
    for (const nodeId of ['n7592209929', 'n7592262113']) expect(on08).not.toContain(nodeId);
  });

  it('an exit that turns back is never the fallback, and a runway whose exits all turn back gives no exit', () => {
    // x3 bent back: 143° from the heading of 09, but a rapid exit of 37° for a landing on 27, 300 m along.
    const bent = bentBack(['x3']);
    const end09 = runwayEnd(bent, '09');
    const end27 = runwayEnd(bent, '27');
    expect(runwayExits(bent, end09).find(exit => exit.nodeId === 'x3').turnDeg).toBeCloseTo(143, 6);
    expect(runwayExits(bent, end27).find(exit => exit.nodeId === 'x3').turnDeg).toBeCloseTo(37, 6);
    expect(defaultLandingExit(bent, end09).nodeId).toBe('x2');
    // Nothing beyond 2 800 m: the farthest exit that turns 90° at most, x2, rather than x3.
    expect(defaultLandingExit(bent, end09, { minAlongM: 2800 }).nodeId).toBe('x2');
    expect(landingExitCandidates(bent, end09).map(exit => exit.nodeId)).not.toContain('x3');
    expect(defaultLandingExit(bent, end27, { minAlongM: 0 }).nodeId).toBe('x3');
    // All three bent back: a landing on 09 has no exit and no candidate.
    const allBent = bentBack(['x1', 'x2', 'x3']);
    expect(defaultLandingExit(allBent, runwayEnd(allBent, '09'))).toBeNull();
    expect(landingExitCandidates(allBent, runwayEnd(allBent, '09'))).toEqual([]);
  });

  it('the climb holds runway heading to 1 500 ft and then turns onto the great circle', () => {
    // 2 500 ft/min at 160 kt: 1 500 ft is 36 s and 2.96 km past lift-off.
    const speed = ktToMs(160);
    const straightM = (ftToM(1500) / fpmToMs(2500)) * speed;
    expect(straightM).toBeCloseTo(2963, 0);
    const liftoff = centrelinePoint(end08, 1900);
    const climb = climbPath({ runwayEnd: end08, liftoff, destination: MIA, straightM, turnSpeedMs: speed });
    expect(climb.coords[0]).toEqual(liftoff);
    expect(climb.turnStartM).toBe(straightM);
    // On runway heading up to the turn.
    const measured = measurePolyline(climb.coords);
    for (let distance = 0; distance <= straightM; distance += 250) {
      expect(angleBetween(pointAlong(measured, distance).bearingDeg, end08.headingTrue), String(distance)).toBeLessThan(0.05);
    }
    // MIA lies north-west: a left turn of about 130°, flown in two rounded parts, then the great circle to it.
    const radius = turnRadiusM(speed);
    const afterTurn = straightM + radius * Math.PI;
    for (let distance = afterTurn; distance < climb.lengthM - 1000; distance += 20_000) {
      const at = pointAlong(measured, distance);
      expect(angleBetween(at.bearingDeg, initialBearing(at.p, MIA)), String(distance)).toBeLessThan(0.5);
    }
    // Drawn 250 NM at most; without a destination it keeps runway heading.
    expect(climb.lengthM).toBeLessThanOrEqual(250 * NM + 1);
    expect(climb.lengthM).toBeGreaterThan(249 * NM);
    const straightOut = climbPath({ runwayEnd: end08, liftoff, destination: null, straightM, turnSpeedMs: speed, maxDistanceM: 50_000 });
    expect(straightOut.lengthM).toBeCloseTo(50_000, 3);
    expect(angleBetween(initialBearing(liftoff, straightOut.coords[straightOut.coords.length - 1]), end08.headingTrue)).toBeLessThan(0.01);
  });

  it('the arrival path from MIA joins the approach without a heading step above the turn limit', () => {
    const arrival = arrivalAirPath({ origin: MIA, runwayEnd: end08, speedMs: APPROACH_MS });
    expect(haversineM(arrival.coords[0], MIA)).toBeLessThan(0.01);
    expect(arrival.coords[arrival.coords.length - 1]).toEqual(end08.threshold);
    expect(arrival.mode).toBe('straight-in');
    expect(arrival.entryAlongM).toBeLessThan(arrival.gateAlongM);
    expect(arrival.thresholdAlongM - arrival.gateAlongM).toBeCloseTo(GATE_NM * NM, 0);
    expect(arrival.thresholdAlongM / haversineM(MIA, end08.threshold)).toBeLessThan(1.02);
    // Every 200 m the heading changes no more than a 25° bank turn allows over 200 m, plus one 0.5° arc chord.
    const radius = turnRadiusM(APPROACH_MS);
    const limit = (200 / radius) * (180 / Math.PI) + AIR_ARC_STEP_DEG + 0.05;
    const bearings = bearingsAlong(arrival.coords, 200);
    let worst = 0;
    for (let at = 1; at < bearings.length; at += 1) worst = Math.max(worst, angleBetween(bearings[at], bearings[at - 1]));
    expect(worst).toBeLessThanOrEqual(limit);
    // From the far side the same holds through a downwind; without an origin it starts 40 NM out on the centreline.
    const fromMadrid = arrivalAirPath({ origin: [-3.5676, 40.4983], runwayEnd: end08, speedMs: APPROACH_MS });
    expect(fromMadrid.mode).toBe('downwind');
    const madridBearings = bearingsAlong(fromMadrid.coords, 200);
    let madridWorst = 0;
    for (let at = 1; at < madridBearings.length; at += 1) madridWorst = Math.max(madridWorst, angleBetween(madridBearings[at], madridBearings[at - 1]));
    expect(madridWorst).toBeLessThanOrEqual(limit);
    const straight = arrivalAirPath({ origin: null, runwayEnd: end08, speedMs: APPROACH_MS });
    expect(straight.thresholdAlongM).toBeCloseTo(40 * NM, 0);
    expect(straight.gateAlongM).toBeCloseTo(30 * NM, 0);
    expect(straight.entryAlongM).toBe(0);
  });
});
