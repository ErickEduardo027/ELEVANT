import { describe, expect, it } from 'vitest';
import { DASHBOARD_POSITIONS } from '../../dashboard/dashboardPositions';
import {
  AIRFIELD_RADIUS_NM, APPROACH_RADIUS_NM, CAMERA_3D, PUJ_ARP, REGION_RADIUS_NM, TERMINALS, VIEW_NAMES, airfieldBounds,
  boundsCenter, cameraAngles, defaultFlightView, destinationPoint, distanceNm, fitZooms, isInBounds, presetForZoom,
  presetTargets, ringBounds, sameFits, standBounds, targetFor, thresholdsFromFits, transitionFor, unionBounds,
} from './cameraPresets';

const METRES_PER_DEGREE = 6371008.8 * (Math.PI / 180);
const toRadians = degrees => (degrees * Math.PI) / 180;

// Metres between two longitudes on a parallel, and between two latitudes on a meridian.
const eastWestMetres = (fromLng, toLng, lat) => (toLng - fromLng) * METRES_PER_DEGREE * Math.cos(toRadians(lat));
const northSouthMetres = (fromLat, toLat) => (toLat - fromLat) * METRES_PER_DEGREE;

// Synthetic stands beside the catalogue: one retired far to the east and one without a location.
const STANDS = [
  ...DASHBOARD_POSITIONS,
  { id: 'B33', terminal: 'B', lat: 18.6, lon: -68.2, retired: true },
  { id: 'X9', terminal: 'A', latitude: null, longitude: null },
];
const located = STANDS.filter(stand => stand.retired !== true && Number.isFinite(stand.lon ?? stand.longitude));

function envelope(stands) {
  const lngs = stands.map(stand => stand.lon);
  const lats = stands.map(stand => stand.lat);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}

// A stand-in for map.cameraForBounds: the zoom at which the width of the bounds fills `width` pixels.
const cameraForWidth = width => bounds => ({ zoom: Math.log2((width * 360) / (512 * (bounds[1][0] - bounds[0][0]))) });

describe('camera presets', () => {
  it('region and approach are 250 NM and 40 NM rings around the ARP (every corner within 0.5 % of the radius)', () => {
    const targets = presetTargets({ stands: STANDS });
    expect(VIEW_NAMES).toEqual(['region', 'approach', 'airfield', 'ramp']);
    expect(PUJ_ARP).toEqual([-68.3634, 18.5674]);
    for (const [view, radius] of [['region', REGION_RADIUS_NM], ['approach', APPROACH_RADIUS_NM]]) {
      const { bounds, pitch, bearing } = targets[view];
      expect({ pitch, bearing }).toEqual({ pitch: 0, bearing: 0 });
      const [[west, south], [east, north]] = bounds;
      // Where the ring touches the box: on the ARP meridian to the north and south, and on the outer meridians at the
      // latitude where a circle on the sphere reaches its widest longitude.
      const widest = Math.asin(Math.sin(toRadians(PUJ_ARP[1])) / Math.cos((radius * 1852) / 6371008.8)) * (180 / Math.PI);
      const corners = [[PUJ_ARP[0], north], [PUJ_ARP[0], south], [east, widest], [west, widest]];
      for (const corner of corners) {
        expect(Math.abs(distanceNm(PUJ_ARP, corner) - radius) / radius, `${view} ${corner}`).toBeLessThan(0.005);
      }
      // The whole ring stays inside the box and reaches each side.
      const ring = Array.from({ length: 360 }, (_, bearingDegrees) => destinationPoint(PUJ_ARP, bearingDegrees, radius));
      const grown = [[west - 1e-9, south - 1e-9], [east + 1e-9, north + 1e-9]];
      expect(ring.every(point => isInBounds(point, grown))).toBe(true);
      expect(Math.max(...ring.map(([lng]) => lng))).toBeCloseTo(east, 3);
      expect(Math.min(...ring.map(([, lat]) => lat))).toBeCloseTo(south, 6);
    }
    expect(ringBounds(PUJ_ARP, 40)).toEqual(targets.approach.bounds);
  });

  it('ramp and terminal presets fit the non-retired stand points plus 120 m; airfield is the airport box plus 300 m', () => {
    const targets = presetTargets({ stands: STANDS });
    const [[stWest, stSouth], [stEast, stNorth]] = envelope(located);
    const [[west, south], [east, north]] = targets.ramp.bounds;
    // 120 m on every side (the longitude margin is held at the box's farthest latitude, so it is never short).
    expect(eastWestMetres(west, stWest, stSouth)).toBeGreaterThanOrEqual(119.99);
    expect(eastWestMetres(west, stWest, stSouth)).toBeLessThan(121);
    expect(eastWestMetres(stEast, east, stNorth)).toBeCloseTo(120, 0);
    expect(northSouthMetres(south, stSouth)).toBeCloseTo(120, 6);
    expect(northSouthMetres(stNorth, north)).toBeCloseTo(120, 6);
    // The retired B33 far to the east and the stand without a location change nothing.
    expect(standBounds(STANDS)).toEqual(standBounds(DASHBOARD_POSITIONS));
    expect(east).toBeLessThan(-68.35);

    expect(TERMINALS).toEqual(['A', 'B', 'FBO']);
    for (const terminal of TERMINALS) {
      const own = located.filter(stand => stand.terminal === terminal);
      const [[tWest, tSouth], [tEast, tNorth]] = envelope(own);
      const bounds = targets.terminals[terminal].bounds;
      expect(northSouthMetres(bounds[0][1], tSouth), terminal).toBeCloseTo(120, 6);
      expect(northSouthMetres(tNorth, bounds[1][1]), terminal).toBeCloseTo(120, 6);
      expect(eastWestMetres(bounds[0][0], tWest, tSouth), terminal).toBeGreaterThanOrEqual(119.99);
      expect(eastWestMetres(tEast, bounds[1][0], tNorth), terminal).toBeGreaterThanOrEqual(119.99);
      expect(targets.terminals[terminal]).toMatchObject({ pitch: 0, bearing: 0 });
      // Every stand of the terminal is inside its view, and no stand of another terminal set its edges.
      expect(own.every(stand => isInBounds([stand.lon, stand.lat], bounds)), terminal).toBe(true);
    }
    expect(targetFor(targets, 'ramp', 'B')).toBe(targets.terminals.B);
    // A terminal without a located stand falls back to the whole ramp.
    expect(presetTargets({ stands: DASHBOARD_POSITIONS.filter(stand => stand.terminal !== 'FBO') }).terminals.FBO).toBeNull();
    const noFbo = presetTargets({ stands: DASHBOARD_POSITIONS.filter(stand => stand.terminal !== 'FBO') });
    expect(targetFor(noFbo, 'ramp', 'FBO')).toBe(noFbo.ramp);
    expect(targetFor(targets, 'airfield', 'A')).toBe(targets.airfield);
    expect(targetFor(targets, 'moon')).toBeNull();

    // The airfield: a 1.5 NM ring around the ARP joined with the stand bounds, plus 300 m.
    const box = unionBounds(ringBounds(PUJ_ARP, AIRFIELD_RADIUS_NM), standBounds(STANDS));
    const airfield = targets.airfield.bounds;
    expect(airfield).toEqual(airfieldBounds(STANDS));
    expect(northSouthMetres(airfield[0][1], box[0][1])).toBeCloseTo(300, 6);
    expect(northSouthMetres(box[1][1], airfield[1][1])).toBeCloseTo(300, 6);
    expect(eastWestMetres(airfield[0][0], box[0][0], box[0][1])).toBeGreaterThanOrEqual(299.99);
    expect(eastWestMetres(box[1][0], airfield[1][0], box[1][1])).toBeGreaterThanOrEqual(299.99);
    // Each view frames the next one.
    for (const [outer, inner] of [['region', 'approach'], ['approach', 'airfield'], ['airfield', 'ramp']]) {
      const [[iw, is], [ie, iN]] = targets[inner].bounds;
      expect(isInBounds([iw, is], targets[outer].bounds) && isInBounds([ie, iN], targets[outer].bounds), outer).toBe(true);
    }

    // A station without one located stand still has a ramp view around the ARP.
    const empty = presetTargets({ stands: [] });
    expect(isInBounds(PUJ_ARP, empty.ramp.bounds)).toBe(true);
    expect(empty.terminals).toEqual({ A: null, B: null, FBO: null });
    const [centreLng, centreLat] = boundsCenter(empty.ramp.bounds);
    expect(centreLng).toBeCloseTo(PUJ_ARP[0], 9);
    expect(centreLat).toBeCloseTo(PUJ_ARP[1], 9);
    expect(boundsCenter(null)).toBeNull();
  });

  it('thresholds derive from the fitted zooms: polygons airfield−0.3, codes ramp−0.3, three-line ramp+0.8', () => {
    const targets = presetTargets({ stands: STANDS });
    const wide = fitZooms(cameraForWidth(1440), targets);
    expect(Object.keys(wide)).toEqual(VIEW_NAMES);
    expect(wide.region).toBeLessThan(wide.approach);
    expect(wide.approach).toBeLessThan(wide.airfield);
    expect(wide.airfield).toBeLessThan(wide.ramp);
    const thresholds = thresholdsFromFits(wide);
    expect(thresholds.polygons).toBeCloseTo(wide.airfield - 0.3, 9);
    expect(thresholds.codes).toBeCloseTo(wide.ramp - 0.3, 9);
    expect(thresholds.threeLine).toBeCloseTo(wide.ramp + 0.8, 9);

    // Panels that cover part of the screen lower every fit and every threshold with it: nothing is a fixed number.
    const narrow = fitZooms(cameraForWidth(800), targets);
    expect(narrow.ramp).toBeCloseTo(wide.ramp - Math.log2(1440 / 800), 9);
    expect(thresholdsFromFits(narrow).codes).toBeCloseTo(narrow.ramp - 0.3, 9);
    expect(thresholdsFromFits(narrow).codes).toBeLessThan(thresholds.codes);
    expect(sameFits(wide, fitZooms(cameraForWidth(1440), targets))).toBe(true);
    expect(sameFits(wide, narrow)).toBe(false);

    // The bearing of the target reaches the camera; any view that cannot be fitted leaves no fits at all.
    const asked = [];
    fitZooms((bounds, options) => {
      asked.push(options);
      return { zoom: 10 };
    }, targets);
    expect(asked).toEqual(VIEW_NAMES.map(() => ({ bearing: 0 })));
    expect(fitZooms(bounds => (bounds === targets.ramp.bounds ? undefined : { zoom: 9 }), targets)).toBeNull();
    expect(fitZooms(() => ({ zoom: Number.NaN }), targets)).toBeNull();
    expect(fitZooms(null, targets)).toBeNull();
    expect(thresholdsFromFits(null)).toBeNull();
    expect(thresholdsFromFits({ airfield: 14 })).toBeNull();
  });

  it('presetForZoom keeps the selector truthful between fitted zooms and returns null before the fit', () => {
    const fits = { region: 6, approach: 9, airfield: 14, ramp: 15.5 };
    // Each boundary is half way between two consecutive fitted zooms: 7.5, 11.5 and 14.75.
    const cases = [
      [3, 'region'], [6, 'region'], [7.49, 'region'], [7.5, 'approach'], [9, 'approach'], [11.49, 'approach'],
      [11.5, 'airfield'], [14, 'airfield'], [14.74, 'airfield'], [14.75, 'ramp'], [15.5, 'ramp'], [19.5, 'ramp'],
    ];
    for (const [zoom, view] of cases) expect(presetForZoom(zoom, fits), String(zoom)).toBe(view);
    // A screen with less room moves every boundary with its fits.
    const smaller = { region: 5.2, approach: 8.2, airfield: 13.2, ramp: 14.7 };
    expect(presetForZoom(14.5, fits)).toBe('airfield');
    expect(presetForZoom(14.5, smaller)).toBe('ramp');

    expect(presetForZoom(15, null)).toBeNull();
    expect(presetForZoom(Number.NaN, fits)).toBeNull();
    expect(presetForZoom(undefined, fits)).toBeNull();
    expect(presetForZoom(12, { region: 6, approach: 9, airfield: 14 })).toBeNull();
  });

  it('transitionFor picks flyTo above 2.5 zoom steps, easeTo below, with explicit clamped durations', () => {
    expect(transitionFor(15, 16)).toEqual({ method: 'easeTo', duration: 820, essential: false });
    expect(transitionFor(16, 15)).toEqual({ method: 'easeTo', duration: 820, essential: false });
    expect(transitionFor(15, 17.5)).toEqual({ method: 'easeTo', duration: 1150, essential: false });
    expect(transitionFor(15, 17.6)).toEqual({ method: 'flyTo', duration: 1172, curve: 1.42, essential: false });
    expect(transitionFor(15.5, 6)).toEqual({ method: 'flyTo', duration: 2600, curve: 1.42, essential: false });
    expect(transitionFor(10, 10)).toEqual({ method: 'easeTo', duration: 600, essential: false });
    // Without a starting zoom the camera eases for the shortest duration.
    expect(transitionFor(undefined, 12)).toEqual({ method: 'easeTo', duration: 600, essential: false });
    for (const [from, to] of [[6, 16], [9, 14], [14, 15.5], [15.5, 9]]) {
      const transition = transitionFor(from, to);
      expect(transition).not.toHaveProperty('maxDuration');
      expect(transition.duration).toBeGreaterThanOrEqual(600);
      expect(transition.duration).toBeLessThanOrEqual(2600);
    }
  });

  it('a linked flight within 40 NM opens on approach, otherwise on region', () => {
    const at = (bearing, distance) => {
      const [longitude, latitude] = destinationPoint(PUJ_ARP, bearing, distance);
      return { latitude, longitude };
    };
    expect(defaultFlightView(at(70, 30))).toBe('approach');
    expect(defaultFlightView({ id: 'leg-1', position: at(250, 12) })).toBe('approach');
    expect(defaultFlightView({ id: 'leg-1', position: { lat: at(10, 39.9).latitude, lon: at(10, 39.9).longitude } }))
      .toBe('approach');
    expect(defaultFlightView(at(70, 45))).toBe('region');
    expect(defaultFlightView({ id: 'leg-2', latitude: null, longitude: null })).toBe('region');
    expect(defaultFlightView(null)).toBe('region');
    expect(distanceNm(PUJ_ARP, destinationPoint(PUJ_ARP, 123, 40))).toBeCloseTo(40, 6);
  });

  it('3D tilts only the airfield (pitch 40) and ramp (pitch 55) views, both at bearing −17', () => {
    expect(CAMERA_3D).toEqual({ airfield: { pitch: 40, bearing: -17 }, ramp: { pitch: 55, bearing: -17 } });
    expect(cameraAngles('ramp', '3d')).toEqual({ pitch: 55, bearing: -17 });
    expect(cameraAngles('airfield', '3d')).toEqual({ pitch: 40, bearing: -17 });
    expect(cameraAngles('region', '3d')).toEqual({ pitch: 0, bearing: 0 });
    expect(cameraAngles('approach', '3d')).toEqual({ pitch: 0, bearing: 0 });
    expect(cameraAngles('ramp', '2d')).toEqual({ pitch: 0, bearing: 0 });
    expect(cameraAngles('toString', '3d')).toEqual({ pitch: 0, bearing: 0 });
    // The answer is a copy: a caller that changes it changes no preset.
    cameraAngles('ramp', '3d').pitch = 10;
    expect(cameraAngles('ramp', '3d').pitch).toBe(55);
  });
});
