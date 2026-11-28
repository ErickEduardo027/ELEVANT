import { describe, expect, it } from 'vitest';
import { AIRCRAFT_TYPES } from '../aircraft/types';
import { MDPC_LAYOUT } from './airportLayout';
import { haversineM, lineEntersPolygon, pointInPolygon, polygonAreaM2, polylineLengthM, toLocal } from './geo';
import {
  MDPC_STRUCTURES,
  STRUCTURE_FEATURE_KINDS,
  bufferPolyline,
  jetBridgeGeometry,
  standDoor,
  structureFeatures,
} from './structures';

const signedArea = ring => ring.reduce((sum, [x1, y1], index) => {
  const [x2, y2] = ring[(index + 1) % ring.length];
  return sum + (x1 * y2 - x2 * y1) / 2;
}, 0);

const distanceToSegment = ([px, py], [ax, ay], [bx, by]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
const distanceToLine = (point, line) => Math.min(
  ...line.slice(0, -1).map((a, index) => distanceToSegment(point, a, line[index + 1])),
);

// Whether two edges of an open ring that are not neighbours cross: the ring would fold over itself.
function selfCrossings(ring) {
  const crossings = [];
  const n = ring.length;
  const orient = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      const [a, b, c, d] = [ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n]];
      if (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0) crossings.push([i, j]);
    }
  }
  return crossings;
}

const plane = toLocal(MDPC_LAYOUT.meta.arp);
const collection = structureFeatures(MDPC_LAYOUT);
const ofKind = kind => collection.features.filter(feature => feature.properties.kind === kind);
const outerRing = feature => feature.geometry.coordinates[0];

describe('bufferPolyline', () => {
  it('buffers a straight line into a capsule, counter-clockwise, at the half-width all round', () => {
    const line = [[0, 0], [100, 0]];
    const ring = bufferPolyline(line, 10);
    expect(signedArea(ring)).toBeGreaterThan(0);
    // 100 × 20 m plus the two half circles, a little under π r² with 15° steps.
    expect(signedArea(ring)).toBeGreaterThan(2000 + 0.98 * Math.PI * 100);
    expect(signedArea(ring)).toBeLessThan(2000 + Math.PI * 100);
    for (const point of ring) expect(distanceToLine(point, line)).toBeCloseTo(10, 6);
    expect(selfCrossings(ring)).toEqual([]);
  });

  it('keeps every point of a bent line at the half-width, mitred inside and round outside', () => {
    for (const line of [[[0, 0], [100, 0], [100, 80]], [[0, 0], [100, 0], [100, -80]], [[0, 0], [60, 10], [120, 0]]]) {
      const ring = bufferPolyline(line, 11.5);
      expect(signedArea(ring)).toBeGreaterThan(0);
      for (const point of ring) expect(distanceToLine(point, line)).toBeCloseTo(11.5, 6);
      expect(selfCrossings(ring)).toEqual([]);
      const length = polylineLength(line);
      expect(Math.abs(signedArea(ring) - (length * 23 + Math.PI * 11.5 ** 2)) / (length * 23)).toBeLessThan(0.05);
    }
  });

  it('gives a circle for one point and nothing for an empty line or no width', () => {
    const ring = bufferPolyline([[5, 5], [5, 5]], 3);
    expect(ring).toHaveLength(24);
    for (const point of ring) expect(Math.hypot(point[0] - 5, point[1] - 5)).toBeCloseTo(3, 9);
    expect(bufferPolyline([], 3)).toEqual([]);
    expect(bufferPolyline([[0, 0], [1, 0]], 0)).toEqual([]);
  });
});

function polylineLength(line) {
  return line.slice(0, -1).reduce((sum, [x, y], index) => sum + Math.hypot(line[index + 1][0] - x, line[index + 1][1] - y), 0);
}

describe('MDPC structures dataset', () => {
  it('is schema 1, every measure an estimate with its note and no reviewer yet', () => {
    expect(MDPC_STRUCTURES.schema).toBe(1);
    expect(MDPC_STRUCTURES.airport).toBe(MDPC_LAYOUT.meta.icao);
    const entries = [...MDPC_STRUCTURES.buildings, ...MDPC_STRUCTURES.jetBridges, MDPC_STRUCTURES.taxiwayPavement];
    for (const entry of entries) {
      expect(entry.source).toBe('estimate');
      expect(entry.reviewedBy).toBeNull();
      expect(entry.note.length).toBeGreaterThan(10);
    }
    expect(MDPC_STRUCTURES.kindDefaults).toEqual({
      terminal: { heightM: 12, source: 'estimate' },
      fbo: { heightM: 8, source: 'estimate' },
      hangar: { heightM: 14, source: 'estimate' },
    });
    expect(MDPC_STRUCTURES.taxiwayPavement.halfWidthM).toBe(11.5);
  });

  it('describes every terminal footprint of the layout once, and a bridge for each bridged stand B20–B26', () => {
    expect(MDPC_STRUCTURES.buildings.map(building => building.layoutId).sort())
      .toEqual(MDPC_LAYOUT.terminals.map(terminal => terminal.id).sort());
    const bridged = MDPC_LAYOUT.stands.filter(stand => stand.bridge && !stand.retired).map(stand => stand.code);
    expect(bridged).toEqual(['B20', 'B21', 'B22', 'B23', 'B24', 'B25', 'B26']);
    expect(MDPC_STRUCTURES.jetBridges.map(bridge => bridge.stand)).toEqual(bridged);
    for (const bridge of MDPC_STRUCTURES.jetBridges) expect(AIRCRAFT_TYPES[bridge.designType], bridge.stand).toBeTruthy();
  });

  it('attaches each bridge to a terminal edge that faces its aircraft', () => {
    for (const bridge of MDPC_STRUCTURES.jetBridges) {
      const stand = MDPC_LAYOUT.stands.find(candidate => candidate.code === bridge.stand);
      const terminal = MDPC_LAYOUT.terminals.find(candidate => candidate.id === bridge.terminalId);
      const { edge } = jetBridgeGeometry(stand, bridge, terminal, plane);
      const { forward } = standDoor(stand, bridge, plane);
      // The edge's outward normal looks back at the nose: within 30° of the reverse heading.
      const cosine = -(edge.normal[0] * forward[0] + edge.normal[1] * forward[1]);
      expect(cosine, bridge.stand).toBeGreaterThan(Math.cos(30 * Math.PI / 180));
      expect(Math.hypot(edge.to[0] - edge.from[0], edge.to[1] - edge.from[1]), bridge.stand).toBeGreaterThan(8);
    }
  });
});

describe('structureFeatures', () => {
  it('builds the buildings, the bridges and the pavement of MDPC in drawing order', () => {
    expect(ofKind('building')).toHaveLength(5);
    expect(ofKind('jetBridgeTunnel')).toHaveLength(7);
    expect(ofKind('jetBridgeRotunda')).toHaveLength(7);
    expect(ofKind('taxiwayPavement')).toHaveLength(MDPC_LAYOUT.taxiways.length);
    const order = collection.features.map(feature => STRUCTURE_FEATURE_KINDS.indexOf(feature.properties.kind));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(collection.features.map(feature => feature.id)).size).toBe(collection.features.length);
  });

  it('gives every feature a closed, finite ring with an area, flagged as an estimate', () => {
    for (const feature of collection.features) {
      const ring = outerRing(feature);
      expect(feature.geometry.type).toBe('Polygon');
      expect(ring.length, feature.id).toBeGreaterThanOrEqual(5);
      expect(ring[ring.length - 1], feature.id).toEqual(ring[0]);
      expect(ring.flat().every(Number.isFinite), feature.id).toBe(true);
      expect(polygonAreaM2(ring), feature.id).toBeGreaterThan(5);
      expect(feature.properties.estimate, feature.id).toBe(true);
      expect(feature.properties.source).toBe('estimate');
    }
  });

  it('extrudes each terminal footprint as it is in the layout, with its estimated height labelled', () => {
    const terminalB = ofKind('building').find(feature => feature.properties.layoutId === 'term-335430650');
    expect(outerRing(terminalB)).toEqual(MDPC_LAYOUT.terminals.find(terminal => terminal.id === 'term-335430650').polygon);
    expect(terminalB.properties).toMatchObject({
      buildingKind: 'terminal', name: 'Terminal B', baseM: 0, heightM: 15, heightLabel: '15 m est.',
    });
    const heights = Object.fromEntries(ofKind('building').map(feature => [feature.properties.name, feature.properties.heightM]));
    expect(heights['Terminal A (Salidas)']).toBe(12);
    expect(heights['Terminal A (Llegadas)']).toBe(12);
  });

  it('builds each bridge from the terminal edge to the forward left door of the parked aircraft', () => {
    for (const bridge of MDPC_STRUCTURES.jetBridges) {
      const stand = MDPC_LAYOUT.stands.find(candidate => candidate.code === bridge.stand);
      const terminal = MDPC_LAYOUT.terminals.find(candidate => candidate.id === bridge.terminalId);
      const tunnel = collection.features.find(feature => feature.id === `jbt-${stand.code}`);
      const rotunda = collection.features.find(feature => feature.id === `jbr-${stand.code}`);
      const { door, nose } = standDoor(stand, bridge, plane);
      const doorLngLat = plane.inverse(door);
      const spec = AIRCRAFT_TYPES[bridge.designType];

      // The door is beside the fuselage, behind the nose, and on the stand.
      expect(haversineM(stand.center, plane.inverse(nose))).toBeCloseTo(spec.lengthM / 2, 1);
      expect(pointInPolygon(doorLngLat, stand.polygon), stand.code).toBe(true);

      // The tunnel reaches the door: its far end is the door, its width the dataset's.
      const tunnelRing = outerRing(tunnel);
      const farEnd = [tunnelRing[1], tunnelRing[2]].map(point => plane.forward(point));
      const farMid = [(farEnd[0][0] + farEnd[1][0]) / 2, (farEnd[0][1] + farEnd[1][1]) / 2];
      expect(Math.hypot(farMid[0] - door[0], farMid[1] - door[1]), stand.code).toBeLessThan(0.05);
      expect(Math.hypot(farEnd[0][0] - farEnd[1][0], farEnd[0][1] - farEnd[1][1])).toBeCloseTo(bridge.tunnelWidthM, 1);
      expect(polygonAreaM2(tunnelRing) / bridge.tunnelWidthM, stand.code).toBeGreaterThan(5);
      expect(polygonAreaM2(tunnelRing) / bridge.tunnelWidthM, stand.code).toBeLessThan(50);

      // The rotunda stands outside the building, against the edge, and the tunnel never runs through the building.
      const { rotunda: local, edge } = jetBridgeGeometry(stand, bridge, terminal, plane);
      const centre = plane.inverse(local.centre);
      expect(pointInPolygon(centre, terminal.polygon), stand.code).toBe(false);
      expect(Math.hypot(local.centre[0] - edge.attach[0], local.centre[1] - edge.attach[1])).toBeCloseTo(bridge.rotundaRadiusM, 6);
      expect(polygonAreaM2(outerRing(rotunda))).toBeGreaterThan(0.95 * Math.PI * bridge.rotundaRadiusM ** 2);
      expect(lineEntersPolygon([centre, doorLngLat], terminal.polygon), stand.code).toBe(false);

      expect(tunnel.properties).toMatchObject({ stand: stand.code, baseM: 3.4, heightM: 6.4, widthM: 2.6 });
      expect(rotunda.properties).toMatchObject({ stand: stand.code, baseM: 3.4, heightM: 7, radiusM: 2.3 });
    }
  });

  it('paves each taxiway at 23 m round its centreline, without folding over itself', () => {
    for (const taxiway of MDPC_LAYOUT.taxiways) {
      const feature = collection.features.find(candidate => candidate.id === `twp-${taxiway.id}`);
      const ring = outerRing(feature);
      expect(feature.properties).toMatchObject({ taxiway: taxiway.id, ref: taxiway.ref ?? null, widthM: 23 });
      for (const point of taxiway.line) expect(pointInPolygon(point, ring), taxiway.id).toBe(true);
      expect(selfCrossings(ring.slice(0, -1).map(point => plane.forward(point))), taxiway.id).toEqual([]);
      const length = polylineLengthM(taxiway.line);
      const expected = length * 23 + Math.PI * 11.5 ** 2;
      expect(polygonAreaM2(ring), taxiway.id).toBeLessThan(expected * 1.02);
      expect(polygonAreaM2(ring), taxiway.id).toBeGreaterThan(Math.min(expected * 0.6, expected - length * 8));
    }
  });

  it('is empty without a layout and refuses what the layout does not hold', () => {
    expect(structureFeatures(null)).toEqual({ type: 'FeatureCollection', features: [] });
    const unknownBuilding = { ...MDPC_STRUCTURES, buildings: [{ ...MDPC_STRUCTURES.buildings[0], layoutId: 'term-0' }] };
    expect(() => structureFeatures(MDPC_LAYOUT, unknownBuilding)).toThrow(/term-0/);
    const remoteBridge = { ...MDPC_STRUCTURES, jetBridges: [{ ...MDPC_STRUCTURES.jetBridges[0], stand: 'A1' }] };
    expect(() => structureFeatures(MDPC_LAYOUT, remoteBridge)).toThrow(/A1/);
  });
});
