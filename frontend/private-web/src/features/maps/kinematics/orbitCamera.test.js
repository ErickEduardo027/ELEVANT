import { describe, expect, it } from 'vitest';
import { destinationPoint, initialBearing } from '../airport/geo.js';
import {
  ORBIT, ORBIT_VIEWS, PUJ_TOWER, createOrbit, orbitAdvance, orbitAuto, orbitDrag, orbitRotate, orbitTarget, orbitTilt,
  orbitWheel, orbitZoom, stepOrbitCamera, wrap360,
} from './orbitCamera.js';

// «Seguir en 3D» (CN-30): the orbit of the camera round the followed aircraft.
const angle = (a, b) => Math.abs(((b - a + 540) % 360) - 180);
const AIRCRAFT = Object.freeze({ lon: -68.37, lat: 18.57, altM: 14.3, onGround: true, trackDeg: 80 });

describe('orbit camera (CN-30)', () => {
  it('wraps the bearing through north both ways', () => {
    expect(wrap360(370)).toBe(10);
    expect(wrap360(-10)).toBe(350);
    let orbit = createOrbit('orbit', { trackDeg: 350 });
    orbit = orbitRotate(orbit, 20);
    expect(orbit.bearingDeg).toBeCloseTo(10, 9);
    orbit = orbitRotate(orbit, -30);
    expect(orbit.bearingDeg).toBeCloseTo(340, 9);
    // Twenty-four steps of 15°: a full turn, where it started.
    let turned = createOrbit('chase');
    for (let step = 0; step < 24; step += 1) turned = orbitRotate(turned, ORBIT.rotateStepDeg);
    expect(turned.offsetDeg).toBeCloseTo(0, 9);
    // MapLibre's bearing stays in (−180, 180].
    const target = orbitTarget(orbitRotate(createOrbit('chase'), 200), AIRCRAFT);
    expect(target.bearing).toBeGreaterThan(-180);
    expect(target.bearing).toBeLessThanOrEqual(180);
  });

  it('clamps the tilt to 0–85° and the zoom to its limits', () => {
    let orbit = createOrbit('chase');
    orbit = orbitTilt(orbit, 100);
    expect(orbit.pitch).toBe(ORBIT.maxPitch);
    orbit = orbitTilt(orbit, -200);
    expect(orbit.pitch).toBe(ORBIT.minPitch);
    expect(orbitZoom(orbit, 10).zoom).toBe(ORBIT.maxZoom);
    expect(orbitZoom(orbit, -10).zoom).toBe(ORBIT.minZoom);
    expect(orbitWheel(createOrbit('chase'), -100).zoom).toBeGreaterThan(ORBIT_VIEWS.chase.zoom);
    // A drag up tilts towards the horizon; to the right it turns the camera round the aircraft.
    const dragged = orbitDrag(createOrbit('orbit'), 100, -40);
    expect(dragged.pitch).toBeGreaterThan(ORBIT_VIEWS.orbit.pitch);
    expect(angle(dragged.bearingDeg, createOrbit('orbit').bearingDeg)).toBeCloseTo(100 * ORBIT.dragDegPerPx, 6);
  });

  it('keeps a relative offset with the aircraft as it turns, and an absolute bearing in «Órbita libre»', () => {
    const left = orbitRotate(createOrbit('chase'), 90);
    const absolute = createOrbit('orbit', { trackDeg: 80 });
    for (const trackDeg of [80, 120, 200, 300, 10]) {
      const aircraft = { ...AIRCRAFT, trackDeg };
      // On its left whatever its heading.
      expect(angle(orbitTarget(left, aircraft).bearing, trackDeg + 90)).toBeLessThan(1e-9);
      // Where the person put it, whatever the aircraft does.
      expect(angle(orbitTarget(absolute, aircraft).bearing, 80)).toBeLessThan(1e-9);
    }
    // Chase is behind it, looking along its track; the side view 90° to its left.
    expect(angle(orbitTarget(createOrbit('chase'), AIRCRAFT).bearing, 80)).toBeLessThan(1e-9);
    expect(angle(orbitTarget(createOrbit('side'), AIRCRAFT).bearing, 170)).toBeLessThan(1e-9);
  });

  it('looks from the tower at the aircraft, and pivots on the aircraft at its height above the field', () => {
    const tower = createOrbit('tower');
    const out = { ...AIRCRAFT, ...Object.fromEntries([['lon', destinationPoint(PUJ_TOWER.point, 200, 1500)[0]],
      ['lat', destinationPoint(PUJ_TOWER.point, 200, 1500)[1]]]) };
    const target = orbitTarget(tower, out, { fieldElevationM: 14.3 });
    expect(angle(target.bearing, initialBearing(PUJ_TOWER.point, [out.lon, out.lat]))).toBeLessThan(1e-6);
    expect(target.pitch).toBeGreaterThanOrEqual(20);
    expect(target.pitch).toBeLessThanOrEqual(ORBIT_VIEWS.tower.pitch);
    // On the ground the pivot is on the ground; in the air at its height above the field.
    expect(target.elevation).toBe(0);
    const flying = orbitTarget(createOrbit('chase'), { ...AIRCRAFT, onGround: false, altM: 314.3 }, { fieldElevationM: 14.3 });
    expect(flying.elevation).toBeCloseTo(300, 9);
    expect(orbitTarget(createOrbit('chase'), { ...AIRCRAFT, onGround: false, altM: 5 }, { fieldElevationM: 14.3 }).elevation).toBe(0);
    // Turning from the tower view orbits freely from there.
    expect(orbitRotate(tower, 15)).toMatchObject({ mode: 'absolute', view: 'orbit' });
  });

  it('eases the camera without overshoot, the short way, and holds and auto-turns by the time', () => {
    const target = orbitTarget(createOrbit('chase'), { ...AIRCRAFT, trackDeg: 10 });
    let camera = { center: target.center, zoom: 15, pitch: 30, bearing: -170 };
    let previousGap = angle(camera.bearing, target.bearing);
    for (let frame = 0; frame < 120; frame += 1) {
      camera = stepOrbitCamera(camera, target, 1 / 60);
      const gap = angle(camera.bearing, target.bearing);
      expect(gap).toBeLessThanOrEqual(previousGap + 1e-9);
      expect(camera.zoom).toBeLessThanOrEqual(target.zoom + 1e-9);
      previousGap = gap;
    }
    expect(previousGap).toBeLessThan(0.5);
    // Two half steps land where one step does.
    const start = { center: target.center, zoom: 15, pitch: 30, bearing: 0 };
    const one = stepOrbitCamera(start, target, 0.1);
    const two = stepOrbitCamera(stepOrbitCamera(start, target, 0.05), target, 0.05);
    expect(two.zoom).toBeCloseTo(one.zoom, 9);
    // Held «girar a la derecha» for a second: 45°; auto-turn: 8° a second.
    expect(orbitAdvance(createOrbit('orbit'), 0.25, { rotate: 1 }).bearingDeg).toBeCloseTo(createOrbit('orbit').bearingDeg + 45 / 4, 9);
    expect(orbitAdvance(orbitAuto(createOrbit('orbit'), true), 0.25).bearingDeg).toBeCloseTo(2, 9);
    expect(orbitAdvance(createOrbit('orbit'), 0.25, { tilt: 1 }).pitch).toBeCloseTo(ORBIT_VIEWS.orbit.pitch + 7.5, 9);
  });
});
