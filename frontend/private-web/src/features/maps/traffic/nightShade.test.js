import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pointInPolygon } from '../airport/geo';
import { PUJ_ARP } from '../core/cameraPresets';
import {
  NIGHT_LABEL_LATITUDES, NIGHT_LABEL_OFFSET_DEG, NIGHT_MAX_LATITUDE, floorToMinute, nightShadeFeatures, nightStretch,
  terminatorPolygon,
} from './nightShade';
import { CIVIL_TWILIGHT_DEG, subsolarPoint, sunPosition } from './solar';

// The night shade (design E6, PR M8): the edge of the civil twilight, solved meridian by meridian from the subsolar
// point of traffic/solar.js and checked here against sunPosition of the same module.
const at = iso => Date.parse(iso);
// 11:00 in Punta Cana (the lab's noon), 18:15 (dusk: the edge crosses the region), 19:00 (night at PUJ), and an instant
// of the March equinox, when the night holds neither pole.
const NOON = at('2026-11-13T15:00:00Z');
const DUSK = at('2026-11-13T22:15:00Z');
const NIGHT = at('2026-11-13T23:00:00Z');
const EQUINOX = at('2026-03-20T14:46:00Z');
const MINUTE = 60_000;

const elevationAt = (ms, point) => sunPosition(ms, point).elevationDeg;
const insideNight = (ms, point) => terminatorPolygon(ms).polygons.some(ring => pointInPolygon(point, ring));
// The distance, in degrees of the plane of longitude and latitude, from a point to a segment.
function distanceToSegment([x, y], [ax, ay], [bx, by]) {
  const [dx, dy] = [bx - ax, by - ay];
  const share = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + share * dx), y - (ay + share * dy));
}
// The point opposite the sun, within the shade's latitudes.
function antisolar(ms) {
  const [lng, lat] = subsolarPoint(ms);
  return [lng > 0 ? lng - 180 : lng + 180, -lat];
}

describe('night shade', () => {
  it('every vertex of the edge has the sun at −6° within 0.05° (sunPosition)', () => {
    for (const ms of [NOON, DUSK, NIGHT, EQUINOX, at('2026-06-21T08:24:00Z'), at('2026-09-23T00:05:00Z')]) {
      const { edges } = terminatorPolygon(ms);
      const vertices = edges.flat();
      expect(vertices.length, new Date(ms).toISOString()).toBeGreaterThan(100);
      for (const vertex of vertices) {
        expect(Math.abs(elevationAt(ms, vertex) - CIVIL_TWILIGHT_DEG), `${new Date(ms).toISOString()} ${vertex}`)
          .toBeLessThan(0.05);
      }
    }
    // The edge is the civil twilight's unless another one is asked for.
    expect(CIVIL_TWILIGHT_DEG).toBe(-6);
    const sunset = terminatorPolygon(DUSK, { edgeDeg: 0 }).edges.flat();
    for (const vertex of sunset) expect(Math.abs(elevationAt(DUSK, vertex))).toBeLessThan(0.05);
  });

  it('a point inside is night and one outside is not, at noon and at night', () => {
    // At 11:00 PUJ is in the day and the point opposite the sun in the night.
    expect(elevationAt(NOON, PUJ_ARP)).toBeGreaterThan(40);
    expect(insideNight(NOON, PUJ_ARP)).toBe(false);
    expect(insideNight(NOON, antisolar(NOON))).toBe(true);
    // At 19:00 PUJ is in the night (the sun 15° down) and the subsolar point, of course, is not.
    expect(elevationAt(NIGHT, PUJ_ARP)).toBeLessThan(CIVIL_TWILIGHT_DEG);
    expect(insideNight(NIGHT, PUJ_ARP)).toBe(true);
    expect(insideNight(NIGHT, subsolarPoint(NIGHT))).toBe(false);
    // At 18:15 PUJ is still in the civil twilight while Puerto Rico, 120 NM east, is in the night: the edge lies
    // between them, inside the Región view.
    expect(elevationAt(DUSK, PUJ_ARP)).toBeGreaterThan(CIVIL_TWILIGHT_DEG);
    expect(insideNight(DUSK, PUJ_ARP)).toBe(false);
    expect(insideNight(DUSK, [-66.0, 18.44])).toBe(true);
    // In November the Arctic is in the night and the Antarctic in the day: the shade closes towards the north pole.
    const north = terminatorPolygon(DUSK).polygons[0].filter(([, lat]) => lat === NIGHT_MAX_LATITUDE);
    expect(north.length).toBeGreaterThan(100);
    expect(insideNight(DUSK, [0, -84])).toBe(false);
    // A sampled grid agrees with the sun everywhere off the edge.
    for (let lat = -80; lat <= 80; lat += 10) {
      for (let lng = -175; lng <= 175; lng += 10) {
        const elevation = elevationAt(DUSK, [lng, lat]);
        if (Math.abs(elevation - CIVIL_TWILIGHT_DEG) < 1) continue;
        expect(insideNight(DUSK, [lng, lat]), `${lng}, ${lat}`).toBe(elevation < CIVIL_TWILIGHT_DEG);
      }
    }
  });

  it('the ring is closed and within ±85° and ±180°', () => {
    for (const ms of [NOON, DUSK, NIGHT, EQUINOX]) {
      const { polygons } = terminatorPolygon(ms);
      expect(polygons.length).toBeGreaterThan(0);
      for (const ring of polygons) {
        expect(ring.at(-1), new Date(ms).toISOString()).toEqual(ring[0]);
        expect(ring.length).toBeGreaterThan(4);
        for (const [lng, lat] of ring) {
          expect(Math.abs(lng)).toBeLessThanOrEqual(180);
          expect(Math.abs(lat)).toBeLessThanOrEqual(NIGHT_MAX_LATITUDE);
        }
      }
    }
    // One polygon in November; at the equinox the cap of the night crosses the antimeridian and is split there.
    expect(nightShadeFeatures(DUSK).features.map(item => [item.properties.kind, item.geometry.type]))
      .toEqual([['night', 'Polygon'], ['nightEdge', 'MultiLineString'], ['nightLabel', 'MultiPoint']]);
    const equinox = nightShadeFeatures(EQUINOX).features;
    expect(equinox.map(item => item.geometry.type)).toEqual(['MultiPolygon', 'MultiLineString', 'MultiPoint']);
    expect(equinox[0].geometry.coordinates).toHaveLength(2);
    // Neither pole is in the night then, and the point opposite the sun is.
    expect(insideNight(EQUINOX, [0, 84.9])).toBe(false);
    expect(insideNight(EQUINOX, [0, -84.9])).toBe(false);
    expect(insideNight(EQUINOX, antisolar(EQUINOX))).toBe(true);
    // A meridian with no night has no stretch.
    const [sunLng, sunLat] = subsolarPoint(EQUINOX);
    expect(nightStretch(sunLng, [sunLng, sunLat])).toBeNull();
  });

  it('writes its word on the night side of the edge, so the night does not show by its tone alone', () => {
    for (const ms of [DUSK, NIGHT, EQUINOX]) {
      const [label] = nightShadeFeatures(ms).features.filter(item => item.properties.kind === 'nightLabel');
      expect(label.properties.label).toBe('Noche');
      expect(label.geometry.coordinates.length).toBeGreaterThan(4);
      for (const point of label.geometry.coordinates) {
        // In the night, at one of its latitudes, and close to the edge.
        expect(NIGHT_LABEL_LATITUDES).toContain(point[1]);
        expect(elevationAt(ms, point), String(point)).toBeLessThan(CIVIL_TWILIGHT_DEG);
        expect(insideNight(ms, point), String(point)).toBe(true);
        const nearest = Math.min(...terminatorPolygon(ms).edges.flatMap(line => line.slice(1)
          .map((to, index) => distanceToSegment(point, line[index], to))));
        expect(nearest, String(point)).toBeLessThanOrEqual(NIGHT_LABEL_OFFSET_DEG + 1e-6);
      }
    }
    // At dusk one of them sits in the Región view, east of PUJ, over Puerto Rico's latitude band.
    const [dusk] = nightShadeFeatures(DUSK).features.filter(item => item.properties.kind === 'nightLabel');
    expect(dusk.geometry.coordinates.filter(([lng, lat]) => lat === 20 && lng > PUJ_ARP[0] && lng < -64)).toHaveLength(1);
    // In the screen's language.
    expect(nightShadeFeatures(DUSK, { label: 'Night' }).features.at(-1).properties.label).toBe('Night');
  });

  it('the polygon moves with the minute', () => {
    const minute = floorToMinute(DUSK + 25_000);
    expect(minute).toBe(DUSK);
    // Two instants of one minute draw the same night; the next minute moves its edge west by about a quarter degree.
    expect(nightShadeFeatures(DUSK + 59_999)).toEqual(nightShadeFeatures(DUSK));
    const next = nightShadeFeatures(DUSK + MINUTE);
    expect(next).not.toEqual(nightShadeFeatures(DUSK));
    const edgeAt = ms => terminatorPolygon(ms).edges.flat().find(([lng]) => lng === -68);
    expect(edgeAt(DUSK + MINUTE)[1]).not.toBe(edgeAt(DUSK)[1]);
    // It reads no clock of its own: the instant is a parameter.
    const source = readFileSync('src/features/maps/traffic/nightShade.js', 'utf8');
    expect(source).not.toMatch(/Date\.now|new Date\(\)|performance\.now|setTimeout|setInterval/);
    expect(source).toMatch(/from '\.\/solar\.js'/);
  });
});
