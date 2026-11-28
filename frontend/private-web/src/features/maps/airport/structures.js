import { AIRCRAFT_TYPES } from '../aircraft/types';
import data from './data/mdpc.structures.json';
import { roundCoord, toLocal } from './geo';

// The airport in 3D (lane M9): the buildings, the jet bridges and the taxiway pavement of an airport layout as GeoJSON
// features, from the layout (airportLayout.js) and its hand-authored sibling, data/mdpc.structures.json. Every height,
// bridge size and pavement width there is an estimate (`source: 'estimate'`): the features say so (`estimate: true`)
// and the map labels them «est.». Pure: it reads only its arguments.
//
// Kinds:
// - `building`: a terminal footprint of the layout, extruded from `baseM` to `heightM`, with `name` and `heightLabel`;
// - `jetBridgeRotunda` and `jetBridgeTunnel`: a jet bridge built for a stand whose `bridge` is true. The rotunda stands
//   against the terminal edge the dataset names, on the side of the aircraft's forward left door; the tunnel runs from
//   the rotunda's centre to that door. The door sits `doorAftOfNoseM` behind the nose of the stand's design type
//   (aircraft/types.js), parked with its centre on the stand centre and its nose along the stand heading;
// - `taxiwayPavement`: a taxiway centreline of the layout buffered by its estimated half-width, with round joins and
//   round ends, so the taxiways show their width.

const DEGREE = Math.PI / 180;
const ARC_STEP = 15 * DEGREE;
const ROTUNDA_SIDES = 24;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

/** The hand-authored structures of MDPC (schema 1), frozen in depth. */
export const MDPC_STRUCTURES = deepFreeze(data);

/** Every kind of feature the structures collection has, in drawing order from the bottom. */
export const STRUCTURE_FEATURE_KINDS = Object.freeze(['taxiwayPavement', 'building', 'jetBridgeTunnel', 'jetBridgeRotunda']);

const round = point => roundCoord(point, 7);
const closeRing = ring => [...ring, [...ring[0]]];
const ringToLngLat = (plane, ring) => closeRing(ring.map(point => round(plane.inverse(point))));
const polygon = ring => ({ type: 'Polygon', coordinates: [ring] });
const unitFromBearing = bearingDeg => [Math.sin(bearingDeg * DEGREE), Math.cos(bearingDeg * DEGREE)];
const add = ([ax, ay], [bx, by], scale = 1) => [ax + bx * scale, ay + by * scale];
const heightLabel = metres => `${Number(metres).toLocaleString('es-DO', { maximumFractionDigits: 1 })} m est.`;

/** A circle of `sides` points around `[x, y]` in a local plane, open (the first point is not repeated). */
function circle([x, y], radius, sides = ROTUNDA_SIDES) {
  return Array.from({ length: sides }, (_, index) => {
    const angle = (2 * Math.PI * index) / sides;
    return [x + radius * Math.cos(angle), y + radius * Math.sin(angle)];
  });
}

/** The rectangle of `width` along the segment `a`–`b` of a local plane, open and counter-clockwise. */
function segmentQuad(a, b, width) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < 1e-9) return null;
  const half = width / 2;
  const left = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
  return [add(a, left, -half), add(b, left, -half), add(b, left, half), add(a, left, half)];
}

const dedupe = points => points.filter((point, index) => (
  index === 0 || Math.hypot(point[0] - points[index - 1][0], point[1] - points[index - 1][1]) > 1e-6
));

/**
 * The outline of a polyline buffered by `halfWidth` in a local plane: one open ring, counter-clockwise, with round
 * joins on the outer side of each bend, mitred joins on the inner side and round ends. The line is walked forward and
 * back as one closed path with the offset on its left, so each end is a 180° bend and gets its half circle; that walk
 * runs clockwise, and the ring is returned reversed. A single point gives a circle.
 * Bends sharper than about 150° on the inner side fall back to the two offset points, which may leave a small loop:
 * taxiway centrelines never bend that sharply.
 */
export function bufferPolyline(points, halfWidth) {
  const line = dedupe(points);
  if (line.length === 0 || !(halfWidth > 0)) return [];
  if (line.length === 1) return circle(line[0], halfWidth, 2 * Math.PI / ARC_STEP);
  const path = [...line, ...line.slice(0, -1).reverse()];
  const segments = [];
  for (let index = 0; index < path.length - 1; index += 1) {
    const [a, b] = [path[index], path[index + 1]];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const direction = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    segments.push({ start: a, end: b, direction, normal: [-direction[1], direction[0]] });
  }
  const ring = [];
  for (let index = 0; index < segments.length; index += 1) {
    const current = segments[index];
    const next = segments[(index + 1) % segments.length];
    const vertex = current.end;
    const crossValue = current.direction[0] * next.direction[1] - current.direction[1] * next.direction[0];
    const dot = current.direction[0] * next.direction[0] + current.direction[1] * next.direction[1];
    const reversal = Math.abs(crossValue) < 1e-9 && dot < 0;
    if (Math.abs(crossValue) < 1e-9 && dot > 0) {
      ring.push(add(vertex, current.normal, halfWidth));
    } else if (reversal || crossValue < 0) {
      // A right turn (or an end): the left side is the outer one, and the offset sweeps clockwise round the vertex.
      const sweep = reversal ? -Math.PI : Math.atan2(crossValue, dot);
      const from = Math.atan2(current.normal[1], current.normal[0]);
      const steps = Math.max(1, Math.ceil(Math.abs(sweep) / ARC_STEP));
      for (let step = 0; step <= steps; step += 1) {
        const angle = from + (sweep * step) / steps;
        ring.push([vertex[0] + halfWidth * Math.cos(angle), vertex[1] + halfWidth * Math.sin(angle)]);
      }
    } else if (1 + dot > 0.07) {
      // A left turn: the left side is the inner one, where the two offset lines meet (the mitre point).
      const scale = halfWidth / (1 + dot);
      ring.push(add(vertex, [current.normal[0] + next.normal[0], current.normal[1] + next.normal[1]], scale));
    } else {
      ring.push(add(vertex, current.normal, halfWidth), add(vertex, next.normal, halfWidth));
    }
  }
  return ring.reverse();
}

function nearestPointOnSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));
  return [a[0] + t * dx, a[1] + t * dy];
}

/**
 * Where the parked design aircraft of a bridged stand has its forward left door, and the frame of the aircraft:
 * `{ door, nose, forward, left }` in the local plane of `plane` (unit vectors for `forward` and `left`).
 */
export function standDoor(stand, bridge, plane) {
  const spec = AIRCRAFT_TYPES[bridge.designType];
  if (!spec) throw new Error(`Unknown design type «${bridge.designType}» for the jet bridge of ${stand.code}`);
  const centre = plane.forward(stand.center);
  const forward = unitFromBearing(stand.headingTrue);
  const left = [-forward[1], forward[0]];
  const nose = add(centre, forward, spec.lengthM / 2);
  const door = add(add(nose, forward, -bridge.doorAftOfNoseM), left, spec.fuselageDiaM / 2);
  return { door, nose, forward, left };
}

/**
 * A jet bridge in the local plane of `plane`: `{ rotunda: { centre, ring }, tunnel: { from, to, ring }, edge }`. The
 * rotunda stands against the named edge of the terminal, its centre `rotundaRadiusM` out from the edge at the point
 * nearest to a spot `rotundaLateralM` to the left of the door; the tunnel runs from that centre to the door.
 */
export function jetBridgeGeometry(stand, bridge, terminal, plane) {
  const outline = terminal.polygon.map(plane.forward);
  const a = outline[bridge.edgeIndex];
  const b = outline[bridge.edgeIndex + 1];
  if (!a || !b) throw new Error(`Edge ${bridge.edgeIndex} is not on ${terminal.id} for the jet bridge of ${stand.code}`);
  const { door, left } = standDoor(stand, bridge, plane);
  const attach = nearestPointOnSegment(add(door, left, bridge.rotundaLateralM), a, b);
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let normal = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
  // The edge's normal that points to the aircraft, out of the building.
  if ((door[0] - attach[0]) * normal[0] + (door[1] - attach[1]) * normal[1] < 0) normal = [-normal[0], -normal[1]];
  const centre = add(attach, normal, bridge.rotundaRadiusM);
  return {
    edge: { from: a, to: b, attach, normal },
    rotunda: { centre, ring: circle(centre, bridge.rotundaRadiusM) },
    tunnel: { from: centre, to: door, ring: segmentQuad(centre, door, bridge.tunnelWidthM) },
  };
}

const estimateProps = entry => ({
  estimate: entry.source === 'estimate',
  source: entry.source,
  reviewedBy: entry.reviewedBy ?? null,
});

/**
 * The structures of `layout` described by `structures` as one GeoJSON FeatureCollection (kinds above). Each feature
 * carries `kind`, `id`, `estimate`, `source` and `reviewedBy`; the extruded ones carry `baseM` and `heightM` above the
 * ground. A layout id or stand the layout does not hold is an error: the dataset only describes what the layout has.
 */
export function structureFeatures(layout = null, structures = MDPC_STRUCTURES) {
  if (!layout) return { type: 'FeatureCollection', features: [] };
  const plane = toLocal(layout.meta.arp);
  const terminals = new Map(layout.terminals.map(terminal => [terminal.id, terminal]));
  const stands = new Map(layout.stands.map(stand => [stand.code, stand]));
  const features = [];

  const pavement = structures.taxiwayPavement;
  if (pavement) {
    for (const taxiway of layout.taxiways) {
      if (!pavement.kinds.includes(taxiway.kind)) continue;
      const ring = bufferPolyline(taxiway.line.map(plane.forward), pavement.halfWidthM);
      if (ring.length < 3) continue;
      features.push({
        type: 'Feature',
        id: `twp-${taxiway.id}`,
        properties: {
          kind: 'taxiwayPavement', id: `twp-${taxiway.id}`, taxiway: taxiway.id, ref: taxiway.ref ?? null,
          widthM: pavement.halfWidthM * 2, ...estimateProps(pavement),
        },
        geometry: polygon(ringToLngLat(plane, ring)),
      });
    }
  }

  for (const building of structures.buildings) {
    const terminal = terminals.get(building.layoutId);
    if (!terminal) throw new Error(`The layout holds no footprint ${building.layoutId}`);
    features.push({
      type: 'Feature',
      id: `bld-${building.layoutId}`,
      properties: {
        kind: 'building', id: `bld-${building.layoutId}`, layoutId: building.layoutId, buildingKind: building.kind,
        name: building.label, baseM: building.baseM, heightM: building.heightM, heightLabel: heightLabel(building.heightM),
        ...estimateProps(building),
      },
      geometry: polygon(terminal.polygon.map(point => [...point])),
    });
  }

  for (const bridge of structures.jetBridges) {
    const stand = stands.get(bridge.stand);
    if (!stand || stand.retired || !stand.bridge) throw new Error(`The layout has no active bridged stand ${bridge.stand}`);
    const terminal = terminals.get(bridge.terminalId);
    if (!terminal) throw new Error(`The layout holds no footprint ${bridge.terminalId}`);
    const geometry = jetBridgeGeometry(stand, bridge, terminal, plane);
    const baseM = bridge.baseHeightM;
    const heightM = bridge.baseHeightM + bridge.tunnelHeightM;
    const common = { stand: stand.code, baseM, heightM, ...estimateProps(bridge) };
    if (geometry.tunnel.ring) {
      features.push({
        type: 'Feature',
        id: `jbt-${stand.code}`,
        properties: { kind: 'jetBridgeTunnel', id: `jbt-${stand.code}`, widthM: bridge.tunnelWidthM, ...common },
        geometry: polygon(ringToLngLat(plane, geometry.tunnel.ring)),
      });
    }
    features.push({
      type: 'Feature',
      id: `jbr-${stand.code}`,
      properties: {
        kind: 'jetBridgeRotunda', id: `jbr-${stand.code}`, radiusM: bridge.rotundaRadiusM, ...common,
        heightM: heightM + bridge.rotundaRiseM,
      },
      geometry: polygon(ringToLngLat(plane, geometry.rotunda.ring)),
    });
  }

  const order = new Map(STRUCTURE_FEATURE_KINDS.map((kind, index) => [kind, index]));
  features.sort((a, b) => order.get(a.properties.kind) - order.get(b.properties.kind));
  return { type: 'FeatureCollection', features };
}
