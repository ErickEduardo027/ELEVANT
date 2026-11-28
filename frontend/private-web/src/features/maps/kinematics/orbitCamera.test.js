import { describe, expect, it } from 'vitest';
import { destinationPoint, initialBearing } from '../airport/geo.js';
import {
  CLOSE_CHASE, CLOSE_UP_ZOOM, ORBIT, ORBIT_VIEWS, ORBIT_VIEW_NAMES, PUJ_TOWER, closeChaseZoom, closestOrbitZoom,
  createOrbit, orbitAdvance, orbitAuto, orbitDrag, orbitRotate, orbitTarget, orbitTilt,
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

describe('«Muy cerca» and the ultra zoom (M4)', () => {
  // The metres from MapLibre's camera to the pivot at `zoom` (1.5 heights of the map, 512 px tiles).
  const cameraDistanceM = (zoom, { latDeg = AIRCRAFT.lat, heightPx = 800 } = {}) =>
    (1.5 * heightPx * (40_075_016.686 / 512) * Math.cos((latDeg * Math.PI) / 180)) / 2 ** zoom;

  it('reaches zoom 22 and offers «Muy cerca» right after «Persecución»', () => {
    expect(ORBIT.maxZoom).toBe(22);
    expect(CLOSE_UP_ZOOM).toBe(19.5);
    expect(ORBIT_VIEW_NAMES).toEqual(['chase', 'close', 'side', 'top', 'tower', 'orbit']);
    expect(Object.keys(ORBIT_VIEWS).sort()).toEqual([...ORBIT_VIEW_NAMES].sort());
    expect(orbitZoom(createOrbit('close'), 10).zoom).toBe(22);
    // Close behind the tail and a little above it, on the aircraft's track.
    const close = createOrbit('close', { trackDeg: 80 });
    expect(close).toMatchObject({ view: 'close', mode: 'relative', offsetDeg: 0 });
    expect(close.pitch).toBeGreaterThan(ORBIT_VIEWS.chase.pitch);
    expect(close.zoom).toBeGreaterThan(CLOSE_UP_ZOOM);
    expect(angle(orbitTarget(close, AIRCRAFT).bearing, 80)).toBeLessThan(1e-9);
  });

  it("stands 25–40 m behind the tail by the type's length, within the orbit's zoom", () => {
    const behindTailM = (lengthM, options = {}) => {
      const zoom = closeChaseZoom({ lengthM, latDeg: AIRCRAFT.lat, viewportHeightPx: options.heightPx ?? 800 });
      return cameraDistanceM(zoom, options) - lengthM / 2;
    };
    // An A320 (37.6 m): 0.7 lengths, about 26 m; a B747 (70.7 m) is held at 40 m; a light aircraft (8 m) at 25 m.
    expect(behindTailM(37.6)).toBeCloseTo(37.6 * CLOSE_CHASE.behindTailFactor, 6);
    expect(behindTailM(70.7)).toBeCloseTo(CLOSE_CHASE.maxBehindTailM, 6);
    expect(behindTailM(8.3)).toBeCloseTo(CLOSE_CHASE.minBehindTailM, 6);
    // The same distance on a taller map.
    expect(behindTailM(37.6, { heightPx: 1200 })).toBeCloseTo(37.6 * CLOSE_CHASE.behindTailFactor, 6);
    // A longer aircraft: a wider view; unknown length and screen: the 38 m airliner on 800 px, the view's own zoom.
    expect(closeChaseZoom({ lengthM: 70.7, latDeg: AIRCRAFT.lat })).toBeLessThan(closeChaseZoom({ lengthM: 37.6,
      latDeg: AIRCRAFT.lat }));
    expect(closeChaseZoom({ latDeg: AIRCRAFT.lat })).toBeCloseTo(ORBIT_VIEWS.close.zoom, 1);
    expect(closeChaseZoom({ lengthM: -1, latDeg: Number.NaN, viewportHeightPx: 0 }))
      .toBe(closeChaseZoom({ latDeg: 0 }));
    // Never past the orbit's limits.
    expect(closeChaseZoom({ lengthM: 0.01, viewportHeightPx: 4000 })).toBe(ORBIT.maxZoom);
    expect(closeChaseZoom({ lengthM: 1e7 })).toBe(ORBIT.minZoom);
  });

  it('closestOrbitZoom keeps the camera out of the model, nearer than «Muy cerca» and within 22 (M4)', () => {
    const clearanceM = (lengthM, heightPx = 800) => cameraDistanceM(closestOrbitZoom({ lengthM, latDeg: AIRCRAFT.lat,
      viewportHeightPx: heightPx }), { heightPx }) - lengthM / 2;
    for (const lengthM of [27.2, 37.6, 56.7, 70.7]) {
      expect(clearanceM(lengthM), String(lengthM)).toBeCloseTo(CLOSE_CHASE.clearanceM, 6);
      const sizing = { lengthM, latDeg: AIRCRAFT.lat };
      expect(closestOrbitZoom(sizing)).toBeGreaterThan(closeChaseZoom(sizing));
      expect(closestOrbitZoom(sizing)).toBeLessThanOrEqual(ORBIT.maxZoom);
    }
    // A short map would put MapLibre's camera inside an A320 at zoom 22; a tall one lets it nearer in zoom.
    expect(closestOrbitZoom({ lengthM: 37.6, latDeg: AIRCRAFT.lat, viewportHeightPx: 500 })).toBeLessThan(22);
    expect(closestOrbitZoom({ lengthM: 37.6, latDeg: AIRCRAFT.lat, viewportHeightPx: 1200 }))
      .toBeGreaterThan(closestOrbitZoom({ lengthM: 37.6, latDeg: AIRCRAFT.lat }));
    // A light aircraft is far enough at the map's own limit.
    expect(closestOrbitZoom({ lengthM: 8.3, latDeg: AIRCRAFT.lat })).toBe(ORBIT.maxZoom);
    expect(closestOrbitZoom({})).toBe(closestOrbitZoom({ lengthM: CLOSE_CHASE.lengthM }));
  });

  it("createOrbit takes a given zoom within the limits, and keeps the view's own without one", () => {
    expect(createOrbit('close', { zoom: 21.3 }).zoom).toBe(21.3);
    expect(createOrbit('close', { zoom: 30 }).zoom).toBe(ORBIT.maxZoom);
    expect(createOrbit('close', { zoom: 3 }).zoom).toBe(ORBIT.minZoom);
    expect(createOrbit('close', { zoom: Number.NaN }).zoom).toBe(ORBIT_VIEWS.close.zoom);
    expect(createOrbit('chase').zoom).toBe(ORBIT_VIEWS.chase.zoom);
  });
});
