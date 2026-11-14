import { describe, expect, it } from 'vitest';
import { destinationPoint, haversineM } from '../airport/geo.js';
import { runwayEnd } from '../airport/runwayInUse.js';
import { FOLLOW_RANGES, FOLLOW_TAU_S, FOLLOW_ZOOM, followCamera, stepCamera } from './followCamera.js';
import { createKinematicsLayout } from './kinematicsFixtures.js';
import { angleDiff } from './smoothing.js';
import { ktToMs, nmToM } from './units.js';

// Follow mode on the synthetic aerodrome: its reference point is the airport, the 09 threshold the runway and S2 the
// stand the aircraft taxis to.
const layout = createKinematicsLayout();
const END_09 = runwayEnd(layout, '09');
const AIRPORT = layout.meta.arp;
const THRESHOLD = END_09.threshold;
const STAND = layout.stands.find(stand => stand.code === 'S2').center;
const HOLD = layout.apronHolds.find(hold => hold.id === 'ah-t2').p;
const TARGETS = Object.freeze({ airport: AIRPORT, threshold: THRESHOLD, stand: STAND });

const away = (from, bearingDeg, nm) => destinationPoint(from, bearingDeg, nmToM(nm));
/** On the extended centreline of 09, `nm` NM before its threshold. */
const onFinal = nm => away(THRESHOLD, END_09.headingTrue + 180, nm);
const flying = (point, gsMs = ktToMs(250)) => ({ lon: point[0], lat: point[1], onGround: false, gsMs });
const rolling = (point, gsMs) => ({ lon: point[0], lat: point[1], onGround: true, gsMs });
const inside = ([lng, lat], [[west, south], [east, north]]) => lng > west && lng < east && lat > south && lat < north;

describe('follow camera', () => {
  it('en route it frames the aircraft and the airport up to zoom 8', () => {
    expect(FOLLOW_ZOOM).toEqual({
      enrouteMax: 8, approachMax: 11.5, finalFrom: 12.5, finalTo: 13.8, groundFrom: 14.5, groundTo: 15.5, standZoom: 17,
      standRadiusM: 250, stand3dPitch: 50, ground3dPitch: 40,
    });
    expect(FOLLOW_RANGES.approachRadiusM).toBe(nmToM(40));
    expect(Object.isFrozen(FOLLOW_ZOOM) && Object.isFrozen(FOLLOW_RANGES)).toBe(true);
    for (const [phase, nm, bearing] of [['enroute', 120, 300], ['descent', 60, 20], ['enroute', 41, 180], ['climb', 80, 60]]) {
      const point = away(AIRPORT, bearing, nm);
      const camera = followCamera({ aircraft: flying(point), phase, targets: TARGETS, mode3d: true });
      expect(camera, `${phase} ${nm} NM`).toMatchObject({ kind: 'bounds', maxZoom: 8, pitch: 0 });
      // Both inside, neither on an edge.
      expect(inside(point, camera.bounds) && inside(AIRPORT, camera.bounds), `${phase} ${nm} NM`).toBe(true);
      expect(Object.isFrozen(camera) && Object.isFrozen(camera.bounds[0])).toBe(true);
    }
    // Without an airport the threshold stands in for it; with no target at all it centres on the aircraft.
    const far = flying(away(AIRPORT, 300, 120));
    expect(inside(THRESHOLD, followCamera({ aircraft: far, phase: 'enroute', targets: { threshold: THRESHOLD } }).bounds)).toBe(true);
    expect(followCamera({ aircraft: far, phase: 'enroute' })).toEqual({ kind: 'center', center: [far.lon, far.lat], zoom: 8, pitch: 0 });
    expect(followCamera({ aircraft: null, targets: TARGETS })).toBeNull();
    expect(followCamera({ aircraft: { lon: Number.NaN, lat: 18 } })).toBeNull();
    expect(followCamera()).toBeNull();
  });

  it('within 40 NM it frames the aircraft and the threshold up to 11.5', () => {
    for (const [phase, nm, bearing] of [['approach', 30, 200], ['descent', 39, 290], ['enroute', 20, 120], ['approach', 15, 90]]) {
      const point = away(AIRPORT, bearing, nm);
      const camera = followCamera({ aircraft: flying(point), phase, targets: TARGETS });
      expect(camera, `${phase} ${nm} NM`).toMatchObject({ kind: 'bounds', maxZoom: 11.5, pitch: 0 });
      expect(inside(point, camera.bounds) && inside(THRESHOLD, camera.bounds), `${phase} ${nm} NM`).toBe(true);
    }
    // The boundary is 40 NM from the airport.
    expect(followCamera({ aircraft: flying(away(AIRPORT, 0, 39.99)), phase: 'descent', targets: TARGETS }).maxZoom).toBe(11.5);
    expect(followCamera({ aircraft: flying(away(AIRPORT, 0, 40.01)), phase: 'descent', targets: TARGETS }).maxZoom).toBe(8);
    // On final but beyond the gate, and climbing out beyond 10 NM, it is the same framing: the threshold and the aircraft.
    expect(followCamera({ aircraft: flying(onFinal(12)), phase: 'final', targets: TARGETS })).toMatchObject({ kind: 'bounds', maxZoom: 11.5 });
    const climbing = followCamera({ aircraft: flying(away(THRESHOLD, END_09.headingTrue, 20)), phase: 'climb', targets: TARGETS });
    expect(climbing).toMatchObject({ kind: 'bounds', maxZoom: 11.5 });
    expect(inside(THRESHOLD, climbing.bounds)).toBe(true);
    // The box keeps a margin around both: at least 500 m, and 10 % of the distance between them.
    const [[west], [east]] = followCamera({ aircraft: flying(away(THRESHOLD, 270, 30)), phase: 'approach', targets: TARGETS }).bounds;
    const span = haversineM([west, THRESHOLD[1]], [east, THRESHOLD[1]]);
    expect(span).toBeGreaterThan(nmToM(30) * 1.19);
    expect(span).toBeLessThan(nmToM(30) * 1.21);
  });

  it('on final the zoom goes from 12.5 to 13.8 as it nears the threshold', () => {
    const zooms = [];
    for (const nm of [10, 8, 5, 2, 0.5, 0]) {
      const point = onFinal(nm);
      const camera = followCamera({ aircraft: flying(point, ktToMs(150)), phase: 'final', targets: TARGETS, mode3d: true });
      expect(camera, `${nm} NM`).toMatchObject({ kind: 'center', pitch: 0 });
      // Half way between the aircraft and the threshold, so both are in sight.
      const toAircraft = haversineM(camera.center, point);
      const toThreshold = haversineM(camera.center, THRESHOLD);
      expect(Math.abs(toAircraft - toThreshold), `${nm} NM`).toBeLessThan(1);
      expect(toAircraft + toThreshold - haversineM(point, THRESHOLD), `${nm} NM`).toBeLessThan(1);
      zooms.push(camera.zoom);
    }
    expect(zooms[0]).toBeCloseTo(12.5, 9);
    expect(zooms[2]).toBeCloseTo(12.5 + 1.3 / 2, 9);
    expect(zooms[zooms.length - 1]).toBeCloseTo(13.8, 9);
    for (let at = 1; at < zooms.length; at += 1) expect(zooms[at]).toBeGreaterThan(zooms[at - 1]);
    // The initial climb is the same the other way round: from 13.8 at the runway to 12.5 at 10 NM.
    const outbound = [0.2, 3, 6, 9.99].map(nm => followCamera({
      aircraft: flying(away(THRESHOLD, END_09.headingTrue, nm)), phase: 'climb', targets: TARGETS,
    }));
    expect(outbound.every(camera => camera.kind === 'center')).toBe(true);
    for (let at = 1; at < outbound.length; at += 1) expect(outbound[at].zoom).toBeLessThan(outbound[at - 1].zoom);
    expect(outbound[0].zoom).toBeLessThanOrEqual(13.8);
    expect(outbound[outbound.length - 1].zoom).toBeGreaterThanOrEqual(12.5);
  });

  it('rolling and taxiing it centres on the aircraft between 14.5 and 15.5', () => {
    // On the runway 800 m past the threshold, far from the stand.
    const runway = away(THRESHOLD, END_09.headingTrue, 800 / 1852);
    expect(haversineM(runway, STAND)).toBeGreaterThan(FOLLOW_ZOOM.standRadiusM);
    for (const [phase, gsMs, zoom] of [
      ['landing', ktToMs(137), 14.5], ['landing', ktToMs(80), 15], ['taxiIn', ktToMs(16), 15.5], ['taxiOut', ktToMs(25), 15.5],
      ['pushback', 1.5, 15.5], ['holding', 0, 15.5], ['takeoff', ktToMs(140), 14.5], ['takeoff', ktToMs(30), 15.5],
    ]) {
      const flat = followCamera({ aircraft: rolling(runway, gsMs), phase, targets: TARGETS });
      expect(flat, `${phase} ${gsMs}`).toEqual({ kind: 'center', center: runway, zoom: expect.closeTo(zoom, 9), pitch: 0 });
      expect(followCamera({ aircraft: rolling(runway, gsMs), phase, targets: TARGETS, mode3d: true }).pitch).toBe(40);
    }
    // The faster, the wider, and never out of 14.5–15.5.
    let previous = Infinity;
    for (let knots = 0; knots <= 200; knots += 5) {
      const { zoom } = followCamera({ aircraft: rolling(runway, ktToMs(knots)), phase: 'landing', targets: TARGETS });
      expect(zoom).toBeLessThanOrEqual(previous);
      expect(zoom >= 14.5 && zoom <= 15.5).toBe(true);
      previous = zoom;
    }
    // Without its own flag, a ground phase says it is on the ground; with it, the flag wins.
    expect(followCamera({ aircraft: { lon: runway[0], lat: runway[1], gsMs: 5 }, phase: 'taxiIn', targets: TARGETS }).zoom).toBe(15.5);
    expect(followCamera({ aircraft: { ...flying(runway), phase: 'taxiIn' }, targets: TARGETS }))
      .toMatchObject({ kind: 'bounds', maxZoom: 11.5 });
    expect(followCamera({ aircraft: { ...rolling(runway, 5), phase: 'taxiIn' }, targets: TARGETS }).zoom).toBe(15.5);
  });

  it('within 250 m of the stand it centres at 17 with pitch 50 in 3D', () => {
    for (const metres of [249.9, 200, 60, 0]) {
      const point = destinationPoint(STAND, 0, metres);
      const flat = followCamera({ aircraft: rolling(point, ktToMs(5)), phase: 'taxiIn', targets: TARGETS });
      expect(flat, `${metres} m`).toMatchObject({ kind: 'center', zoom: 17, pitch: 0 });
      expect(followCamera({ aircraft: rolling(point, ktToMs(5)), phase: 'taxiIn', targets: TARGETS, mode3d: true }).pitch).toBe(50);
      // Between the aircraft and its stand.
      expect(haversineM(flat.center, STAND), `${metres} m`).toBeCloseTo(metres / 2, 0);
    }
    // Beyond 250 m it is the taxi framing again.
    expect(followCamera({ aircraft: rolling(destinationPoint(STAND, 0, 250.1), ktToMs(10)), phase: 'taxiIn', targets: TARGETS }))
      .toMatchObject({ kind: 'center', zoom: 15.5 });
    // Parked on it.
    const parked = followCamera({ aircraft: rolling(STAND, 0), phase: 'parked', targets: TARGETS, mode3d: true });
    expect(parked).toMatchObject({ zoom: 17, pitch: 50 });
    expect(haversineM(parked.center, STAND)).toBeLessThan(0.01);
    // A flight waiting for a stand has the apron hold as its objective.
    const nearHold = followCamera({
      aircraft: rolling(destinationPoint(HOLD, 270, 120), ktToMs(8)), phase: 'taxiIn', targets: { ...TARGETS, stand: null, apronHold: HOLD },
    });
    expect(nearHold).toMatchObject({ zoom: 17 });
    // A departure leaving its stand is shown the same way, the other way round.
    expect(followCamera({ aircraft: rolling(destinationPoint(STAND, 0, 40), 1.5), phase: 'pushback', targets: TARGETS }).zoom).toBe(17);
    // In the air the stand does not count.
    expect(followCamera({ aircraft: flying(STAND), phase: 'final', targets: TARGETS }).zoom).toBeLessThan(14);
  });

  it('stepCamera approaches the target exponentially and never overshoots', () => {
    const start = Object.freeze({ center: [-68.40, 18.40], zoom: 10, pitch: 0, bearing: 170 });
    const target = Object.freeze({ center: [-68.36, 18.57], zoom: 15, pitch: 50, bearing: -170 });
    const frame = 1 / 60;
    let camera = start;
    for (let step = 1; step <= 300; step += 1) {
      const next = stepCamera(camera, target, frame);
      // Every value moves toward the target and never passes it.
      expect(next.zoom).toBeGreaterThan(camera.zoom);
      expect(next.zoom).toBeLessThan(15);
      expect(next.pitch).toBeGreaterThan(camera.pitch);
      expect(next.pitch).toBeLessThan(50);
      expect(next.center[0]).toBeGreaterThan(camera.center[0]);
      expect(next.center[0]).toBeLessThan(-68.36);
      expect(next.center[1]).toBeGreaterThan(camera.center[1]);
      expect(next.center[1]).toBeLessThan(18.57);
      // The bearing turns the short way through 180°, from 170° to −170°.
      expect(next.bearing >= 170 || next.bearing <= -170, String(next.bearing)).toBe(true);
      expect(Math.abs(angleDiff(next.bearing, target.bearing))).toBeLessThan(Math.abs(angleDiff(camera.bearing, target.bearing)));
      // What is left shrinks as e^(−t/τ).
      expect((15 - next.zoom) / 5).toBeCloseTo(Math.exp((-step * frame) / FOLLOW_TAU_S), 9);
      expect(Object.isFrozen(next) && Object.isFrozen(next.center)).toBe(true);
      camera = next;
    }
    // After 5 s, more than six time constants, less than 0.3 % is left.
    expect((15 - camera.zoom) / 5).toBeLessThan(0.003);
    // Two steps of 0.25 s land where one of 0.5 s does.
    const once = stepCamera(start, target, 0.5);
    const twice = stepCamera(stepCamera(start, target, 0.25), target, 0.25);
    expect(twice.zoom).toBeCloseTo(once.zoom, 12);
    expect(twice.pitch).toBeCloseTo(once.pitch, 12);
    expect(twice.center[0]).toBeCloseTo(once.center[0], 12);
    expect(twice.center[1]).toBeCloseTo(once.center[1], 12);
    expect(twice.bearing).toBeCloseTo(once.bearing, 12);
    // No time leaves it where it is; an unbounded time, or no camera yet, takes the target.
    expect(stepCamera(start, target, 0)).toEqual(start);
    expect(stepCamera(start, target, Infinity)).toEqual(target);
    expect(stepCamera(null, target, frame)).toEqual(target);
    expect(stepCamera(start, null, frame)).toBe(start);
    expect(stepCamera(start, { kind: 'bounds', bounds: [[0, 0], [1, 1]] }, frame)).toBe(start);
    // Without a bearing on one side, the other's stays.
    expect(stepCamera({ center: [0, 0], zoom: 1, pitch: 0 }, { center: [1, 1], zoom: 2, pitch: 0, bearing: -17 }, frame).bearing).toBe(-17);
    // The longitude goes the short way across the antimeridian too.
    const across = stepCamera({ center: [179.9, 0], zoom: 5, pitch: 0 }, { center: [-179.9, 0], zoom: 5, pitch: 0 }, FOLLOW_TAU_S);
    expect(across.center[0] > 179.9 || across.center[0] < -179.9).toBe(true);
  });
});
