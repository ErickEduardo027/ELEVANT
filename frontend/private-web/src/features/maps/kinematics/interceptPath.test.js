import { describe, expect, it } from 'vitest';
import { MDPC_LAYOUT } from '../airport/airportLayout.js';
import { destinationPoint, haversineM, initialBearing, measurePolyline } from '../airport/geo.js';
import { runwayEnd } from '../airport/runwayInUse.js';
import { INTERCEPT, interceptPath } from './pathBuilder.js';
import { NM, ktToMs } from './units.js';

// CN-29: the approach still to fly from where a live aircraft really is (pathBuilder.js: interceptPath). The report:
// AA465, an A321 at 3 800 ft and 261 kt north-west of Higüey, drew a dashed dog-leg (a perpendicular jog to its plan and
// the plan's corners) instead of a smooth approach onto the runway at Punta Cana.

const angle = (a, b) => Math.abs(((b - a + 540) % 360) - 180);
const HIGUEY_NW = [-68.8, 18.7];

/** The turn between each two consecutive legs of a path, in degrees. */
function turnsOf(coords) {
  const turns = [];
  for (let at = 1; at < coords.length - 1; at += 1) {
    if (haversineM(coords[at - 1], coords[at]) < 1 || haversineM(coords[at], coords[at + 1]) < 1) continue;
    turns.push(angle(initialBearing(coords[at - 1], coords[at]), initialBearing(coords[at], coords[at + 1])));
  }
  return turns;
}

/** The heading the path leaves its first point on. */
const startBearing = coords => initialBearing(coords[0], coords[1]);

const CASES = [];
for (const ident of ['08', '26', '09', '27']) {
  for (const [name, from, trackDeg] of [
    ['north-west of Higüey, heading south-east', HIGUEY_NW, 120],
    ['north of the field, heading east', [-68.4, 18.85], 90],
    ['south-west, heading north-east', [-68.7, 18.3], 45],
    ['east, heading west', [-68.0, 18.6], 270],
    ['close in on a wide base', destinationPoint([-68.383, 18.57], 230, 9 * NM), 330],
  ]) CASES.push([ident, name, from, trackDeg]);
}

describe('interceptPath (CN-29)', () => {
  it.each(CASES)('runway %s, aircraft %s: smooth from the aircraft to the threshold, aligned with the runway', (ident, _name, from, trackDeg) => {
    const end = runwayEnd(MDPC_LAYOUT, ident);
    const path = interceptPath({ from, trackDeg, speedMs: ktToMs(261), runwayEnd: end });
    const { coords } = path;
    // It starts at the aircraft, on its own track, and ends at the threshold.
    expect(coords[0]).toEqual(from);
    expect(angle(startBearing(coords), trackDeg)).toBeLessThan(3);
    expect(coords[coords.length - 1]).toEqual(end.threshold);
    // The final: its last leg on the runway's heading, at least INTERCEPT.minFinalNm long.
    const last = initialBearing(coords[coords.length - 2], coords[coords.length - 1]);
    expect(angle(last, end.headingTrue)).toBeLessThan(1);
    expect(haversineM(coords[coords.length - 2], end.threshold)).toBeGreaterThanOrEqual(INTERCEPT.minFinalNm * NM - 1);
    // No corner: the arcs are drawn every degree and the tangents join them without a turn.
    expect(Math.max(...turnsOf(coords))).toBeLessThan(2.5);
    // Never a rectangle or a doubling back: the total turn stays under a full circle and a half.
    const total = turnsOf(coords).reduce((sum, turn) => sum + turn, 0);
    expect(total).toBeLessThan(540);
  });

  it('the reported AA465 joins the final of 08 near the gate with one smooth turn, no dog-leg', () => {
    const end = runwayEnd(MDPC_LAYOUT, '08');
    const path = interceptPath({ from: HIGUEY_NW, trackDeg: 120, speedMs: ktToMs(261), runwayEnd: end });
    expect(path.joinNm).toBeGreaterThanOrEqual(6);
    expect(path.joinNm).toBeLessThanOrEqual(INTERCEPT.preferredNm);
    // Shorter than going round the plan's corners: little more than the straight distance.
    expect(path.lengthM).toBeLessThan(1.25 * haversineM(HIGUEY_NW, end.threshold));
    // Every point after the start gets closer to the threshold (no going away and coming back).
    const distances = path.coords.map(point => haversineM(point, end.threshold));
    for (let at = 1; at < distances.length; at += 1) expect(distances[at]).toBeLessThan(distances[at - 1] + 1);
  });

  it('without a track it heads for the final; far away it flies the great circle first', () => {
    const end = runwayEnd(MDPC_LAYOUT, '08');
    const near = interceptPath({ from: HIGUEY_NW, runwayEnd: end });
    expect(Math.max(...turnsOf(near.coords))).toBeLessThan(2.5);
    const far = interceptPath({ from: [-72, 20.5], trackDeg: 110, speedMs: ktToMs(450), runwayEnd: end });
    expect(far.coords[0]).toEqual([-72, 20.5]);
    expect(far.coords[far.coords.length - 1]).toEqual(end.threshold);
    expect(measurePolyline(far.coords).lengthM).toBeLessThan(1.1 * haversineM([-72, 20.5], end.threshold));
  });
});
