import { MercatorCoordinate } from 'maplibre-gl';
import { Color, Matrix4, Quaternion, SRGBColorSpace, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { OCC_PALETTE, occColor } from '../../occ-ui/occPalette';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { destinationPoint, METRES_PER_NM } from '../airport/geo';
import { thresholdsFromFits } from '../core/cameraPresets';
import {
  AIRCRAFT_3D_COLORS, AIRCRAFT_3D_RADIUS_NM, DROP_LINE_MIN_M, GROUND_TRAFFIC_3D_RADIUS_M, SHADOW, TYPE_MEMO_LIMIT,
  instanceKey, linearRgb, liveryInstanceColours, mercatorFrame, planInstances, planLabels, planSprites,
  typeMemoSizeForTests, pivotOf, poseMatrix,
} from './instancePlan';
import { contactShadowMatrix, contactShadowSize, contactShadowStrength } from './contactShadow';
import { DEFAULT_LIVERY, LIVERIES, LIVERY_ZONES } from './liveries';
import { SPRITE_CELLS, cellUv } from './spriteAtlas';
import { altitudeColour, mapColorsFor } from '../style/mapColors';
import { buildOccStyle } from '../style/occStyle';
import { OUTSIDE_FILTER_OPACITY, trafficOverlay } from '../traffic/trafficLayers';
import { DEMO_PLATE_IMAGE, ESTIMATED_RING_IMAGE } from '../style/trafficImages';
import { AIRCRAFT_TYPES, CATEGORY_FALLBACKS } from './types';

// Synthetic aircraft around the ARP of Punta Cana: invented ids and places, the shape of the map's RenderAircraft
// (traffic/situationModel.js). The 3D threshold comes from fitted zooms, as the map derives it (contracts 2.3).
const ARP = MDPC_LAYOUT.meta.arp;
const FIELD_M = MDPC_LAYOUT.meta.elevationFt * 0.3048;
const THRESHOLDS = thresholdsFromFits({ approach: 9.5, airfield: 14.4, ramp: 15.6 });
const OPTIONS = Object.freeze({ zoom: 15, minZoom: THRESHOLDS.polygons, originLngLat: ARP });

function aircraft(id, { bearing = 0, metres = 0, ...fields } = {}) {
  const [lon, lat] = destinationPoint(ARP, bearing, metres);
  return {
    id, hex: null, kind: 'aviam', lon, lat, altM: 0, onGround: true, trackDeg: 0, typeIcao: 'A320', model: null,
    sizeCategory: null, emitterCategory: null, hiddenInStand: false, quality: 'live', ...fields,
  };
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// Instance `index` of an entry: its matrix as three reads it, its translation and its colour.
const matrixOf = (entry, index) => new Matrix4().fromArray(entry.matrices, 16 * index);
const translationOf = (entry, index) => Array.from(entry.matrices.slice(16 * index + 12, 16 * index + 15));
const colourOf = (entry, index) => Array.from(entry.colors.slice(3 * index, 3 * index + 3));
const float32 = values => Array.from(Float32Array.from(values));

// What the frame says of a point: its [x, y] in metres east and north of the ARP.
const local = point => mercatorFrame(ARP).toLocal(point);

// A plan as plain data, to compare two plans.
const snapshot = plan => [...plan].map(([key, entry]) => [key, { ...entry, matrices: Array.from(entry.matrices),
  colors: Array.from(entry.colors), dropLines: Array.from(entry.dropLines) }]);

describe('the 3D instance plan (design G3)', () => {
  it('groups aircraft by type and places each at its ENU position and heading (a 90° heading puts the nose toward +x)', () => {
    const east = aircraft('f:p:east', { bearing: 90, metres: 500, trackDeg: 90 });
    const north = aircraft('f:p:north', { bearing: 0, metres: 800, trackDeg: 0 });
    const southWest = aircraft('h:0a0b0c', { kind: 'other', onGround: false, altM: FIELD_M + 600, bearing: 225, metres: 2_000,
      trackDeg: 225, typeIcao: 'B738' });
    const plan = planInstances([north, southWest, east], [], OPTIONS);

    expect([...plan.keys()]).toEqual(['A320', 'B738']);
    const a320 = plan.get('A320');
    expect(a320).toMatchObject({ spec: AIRCRAFT_TYPES.A320, approximate: false, aircraftCount: 2, count: 4,
      ids: ['f:p:east', 'f:p:north', null, null] });
    expect(a320.matrices).toBeInstanceOf(Float32Array);
    expect(a320.matrices).toHaveLength(16 * 4);
    expect(a320.colors).toHaveLength(3 * 4);
    expect(Object.isFrozen(a320)).toBe(true);
    expect(Object.isFrozen(a320.ids)).toBe(true);

    // Each aircraft stands at its position in the frame of the ARP: x east, y north, on the ground.
    expect(translationOf(a320, 0)).toEqual(float32([...local([east.lon, east.lat]), 0]));
    expect(translationOf(a320, 1)).toEqual(float32([...local([north.lon, north.lat]), 0]));
    expect(translationOf(a320, 0)[0]).toBeCloseTo(500, 1);
    expect(translationOf(a320, 1)[1]).toBeCloseTo(800, 1);

    // The matrix is T · Rz(−heading), column-major, as three composes it.
    for (const [entry, index, item] of [[a320, 0, east], [a320, 1, north], [plan.get('B738'), 0, southWest]]) {
      const [x, y, z] = translationOf(entry, index);
      const expected = new Matrix4().compose(new Vector3(x, y, z),
        new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), (-item.trackDeg * Math.PI) / 180), new Vector3(1, 1, 1));
      matrixOf(entry, index).elements.forEach((value, cell) => expect(value).toBeCloseTo(expected.elements[cell], 6));
    }

    // The nose of a model is at +y (aircraft/aircraftGeometry.js): a 90° heading turns it east, 0° keeps it north.
    const half = AIRCRAFT_TYPES.A320.lengthM / 2;
    const [eastX, eastY] = translationOf(a320, 0);
    const eastNose = new Vector3(0, half, 0).applyMatrix4(matrixOf(a320, 0));
    expect(eastNose.x).toBeCloseTo(eastX + half, 3);
    expect(eastNose.y).toBeCloseTo(eastY, 3);
    const [northX, northY] = translationOf(a320, 1);
    const northNose = new Vector3(0, half, 0).applyMatrix4(matrixOf(a320, 1));
    expect(northNose.x).toBeCloseTo(northX, 3);
    expect(northNose.y).toBeCloseTo(northY + half, 3);
    // A heading of 225° points the nose south-west; no heading at all points it north.
    const b738 = plan.get('B738');
    const toward = new Vector3(0, 1, 0).applyMatrix4(matrixOf(b738, 0)).sub(new Vector3(...translationOf(b738, 0)));
    expect(toward.x).toBeCloseTo(-Math.SQRT1_2, 5);
    expect(toward.y).toBeCloseTo(-Math.SQRT1_2, 5);
    const headless = planInstances([aircraft('f:p:still', { trackDeg: null })], [], OPTIONS).get('A320');
    expect(matrixOf(headless, 0).elements.slice(0, 6).map(value => value + 0)).toEqual([1, 0, 0, 0, 0, 1]);
    const parkedHeading = planInstances([aircraft('f:p:still', { trackDeg: null, headingDeg: 90 })], [], OPTIONS).get('A320');
    expect(new Vector3(0, 1, 0).applyMatrix4(matrixOf(parkedHeading, 0)).x).toBeCloseTo(1, 5);
  });

  it('plans only aircraft within 6 NM of the ARP and from the 3D threshold on', () => {
    expect(AIRCRAFT_3D_RADIUS_NM).toBe(6);
    const inside = aircraft('f:p:inside', { onGround: false, altM: 900, bearing: 70, metres: 5.95 * METRES_PER_NM });
    const outside = aircraft('f:p:outside', { onGround: false, altM: 900, bearing: 70, metres: 6.05 * METRES_PER_NM });
    const far = aircraft('h:0d0e0f', { kind: 'other', onGround: false, altM: 3_000, bearing: 250, metres: 40 * METRES_PER_NM });
    expect(planInstances([inside, outside, far], [], OPTIONS).get('A320').ids).toEqual(['f:p:inside', null]);
    // A parked aircraft follows the same radius.
    const parkedFar = { id: 'f:p:parked-far', lon: outside.lon, lat: outside.lat, headingDeg: 0, typeIcao: 'A320' };
    expect(planInstances([], [parkedFar], OPTIONS).size).toBe(0);

    // From the threshold the caller derives, the airfield fit − 0.3, never below it.
    expect(THRESHOLDS.polygons).toBeCloseTo(14.1, 10);
    const stand = aircraft('f:p:stand', { bearing: 200, metres: 900 });
    expect(planInstances([stand], [], { ...OPTIONS, zoom: THRESHOLDS.polygons - 0.01 }).size).toBe(0);
    expect(planInstances([stand], [], { ...OPTIONS, zoom: THRESHOLDS.polygons }).size).toBe(1);
    expect(planInstances([stand], [], { ...OPTIONS, zoom: 18 }).size).toBe(1);
    // Before the views are fitted there is no threshold, and nothing is planned.
    expect(planInstances([stand], [], { ...OPTIONS, minZoom: undefined }).size).toBe(0);
    expect(planInstances([stand], [], { ...OPTIONS, zoom: Number.NaN }).size).toBe(0);
    expect(planInstances(undefined, undefined, OPTIONS).size).toBe(0);
    expect(planInstances().size).toBe(0);
    expect(() => planInstances([stand], [], { ...OPTIONS, originLngLat: null })).toThrow(RangeError);
  });

  it('other traffic on the ground stays 2D, hidden and unpositioned aircraft are left out, and a parked aircraft is owned by its stand', () => {
    const otherOnGround = aircraft('h:1a1b1c', { kind: 'other', onGround: true, bearing: 120, metres: 700 });
    const otherInTheAir = aircraft('h:2a2b2c', { kind: 'other', onGround: false, altM: 450, bearing: 80, metres: 4_000 });
    const aviamOnGround = aircraft('f:p:taxi', { bearing: 160, metres: 600, trackDeg: 80 });
    const hidden = aircraft('h:3a3b3c', { kind: 'other', onGround: false, altM: 300, hiddenInStand: true });
    const unpositioned = { ...aircraft('f:p:nowhere'), lon: null };
    const noAltitude = aircraft('h:4a4b4c', { kind: 'other', onGround: false, altM: null, bearing: 10, metres: 3_000 });
    const ids = planned => [...planned.values()].flatMap(entry => entry.ids.filter(id => id !== null)).sort();
    expect(ids(planInstances([otherOnGround, otherInTheAir, aviamOnGround, hidden, unpositioned, noAltitude], [], OPTIONS)))
      .toEqual(['f:p:taxi', 'h:2a2b2c']);

    // The stand's aircraft: at the stand's centre, its nose along the stand's heading, its type from the flight.
    const stand = MDPC_LAYOUT.stands.find(item => item.code === 'A1');
    const live = aircraft('f:p:arrival', { bearing: 300, metres: 1_500, trackDeg: 300, onGround: true, typeIcao: 'A320' });
    const parked = { id: 'f:p:arrival', lon: stand.center[0], lat: stand.center[1], headingDeg: stand.headingTrue,
      typeIcao: 'B38M', model: null, sizeCategory: 'Narrowbody' };
    const plan = planInstances([live, aviamOnGround], [parked], OPTIONS);
    expect([...plan.keys()]).toEqual(['A320', 'B38M']);
    expect(plan.get('A320').ids).toEqual(['f:p:taxi', null]);
    const b38m = plan.get('B38M');
    expect(b38m.ids).toEqual(['f:p:arrival', null]);
    expect(translationOf(b38m, 0)).toEqual(float32([...local(stand.center), 0]));
    const nose = new Vector3(0, 1, 0).applyMatrix4(matrixOf(b38m, 0)).sub(new Vector3(...translationOf(b38m, 0)));
    const radians = (stand.headingTrue * Math.PI) / 180;
    expect(nose.x).toBeCloseTo(Math.sin(radians), 5);
    expect(nose.y).toBeCloseTo(Math.cos(radians), 5);
    // A parked aircraft is AVIAM's unless it says otherwise; one without a position is skipped.
    expect(colourOf(b38m, 0)).toEqual(float32(AIRCRAFT_3D_COLORS.aviam));
    expect(planInstances([], [{ ...parked, lon: undefined }], OPTIONS).size).toBe(0);
    const foreign = planInstances([], [{ ...parked, kind: 'other' }], OPTIONS).get('B38M');
    expect(colourOf(foreign, 0)).toEqual(float32(AIRCRAFT_3D_COLORS.other));
  });

  it('an airborne aircraft flies at its true height above the field with a drop line; one on the ground sits at zero', () => {
    expect(DROP_LINE_MIN_M).toBe(3);
    const options = { ...OPTIONS, fieldElevationM: FIELD_M };
    const approach = aircraft('f:p:final', { onGround: false, altM: 300, bearing: 250, metres: 5_000, trackDeg: 80 });
    const flare = aircraft('f:p:flare', { onGround: false, altM: FIELD_M + 2, bearing: 255, metres: 1_200, trackDeg: 80 });
    const belowField = aircraft('f:p:low', { onGround: false, altM: 5, bearing: 260, metres: 1_400, trackDeg: 80 });
    const rolling = aircraft('f:p:roll', { onGround: true, altM: 100, bearing: 90, metres: 400, trackDeg: 80 });
    const entry = planInstances([approach, flare, belowField, rolling], [], options).get('A320');
    expect(entry.ids.slice(0, 4)).toEqual(['f:p:final', 'f:p:flare', 'f:p:low', 'f:p:roll']);
    const [x, y, z] = translationOf(entry, 0);
    expect(z).toBeCloseTo(300 - FIELD_M, 3);
    expect(translationOf(entry, 1)[2]).toBeCloseTo(2, 3);
    expect(translationOf(entry, 2)[2]).toBe(0);
    expect(translationOf(entry, 3)[2]).toBe(0);
    // One drop line, from the aircraft straight down to the ground; none at 2 m, below the field or on the ground.
    expect(Array.from(entry.dropLines)).toEqual(float32([x, y, z, x, y, 0]));
    // Without a field elevation the height is the altitude itself.
    expect(translationOf(planInstances([approach], [], OPTIONS).get('A320'), 0)[2]).toBeCloseTo(300, 3);
    expect(planInstances([rolling], [], options).get('A320').dropLines).toHaveLength(0);
  });

  it('every aircraft has a flat dark shadow under it whose id is null', () => {
    const climbing = aircraft('f:p:climb', { onGround: false, altM: 200, bearing: 75, metres: 3_000, trackDeg: 80 });
    const parked = aircraft('f:p:gate', { bearing: 190, metres: 700, trackDeg: 175 });
    expect(SHADOW).toEqual({ heightM: 0.05, flatten: 0.01 });
    const entry = planInstances([climbing, parked], [], OPTIONS).get('A320');
    expect(entry.count).toBe(2 * entry.aircraftCount);
    for (let index = 0; index < entry.aircraftCount; index += 1) {
      const shadow = entry.aircraftCount + index;
      expect(entry.ids[shadow]).toBeNull();
      const [x, y] = translationOf(entry, index);
      expect(translationOf(entry, shadow)).toEqual(float32([x, y, SHADOW.heightM]));
      // The model flattened to a hundredth of its height, along the aircraft's heading.
      const position = new Vector3();
      const rotation = new Quaternion();
      const scale = new Vector3();
      matrixOf(entry, shadow).decompose(position, rotation, scale);
      expect(scale.z).toBeCloseTo(SHADOW.flatten, 6);
      expect(scale.x).toBeCloseTo(1, 6);
      expect(scale.y).toBeCloseTo(1, 6);
      const aircraftRotation = new Quaternion();
      matrixOf(entry, index).decompose(new Vector3(), aircraftRotation, new Vector3());
      expect(rotation.angleTo(aircraftRotation)).toBeCloseTo(0, 5);
      expect(colourOf(entry, shadow)).toEqual(float32(AIRCRAFT_3D_COLORS.shadow));
    }
  });

  it('the selected aircraft is cyan, AVIAM aircraft are neutral and other traffic is muted (no hue for normal aircraft)', () => {
    expect(AIRCRAFT_3D_COLORS).toEqual({
      aviam: linearRgb(OCC_PALETTE['--occ-text']),
      other: linearRgb(OCC_PALETTE['--occ-faint']),
      selected: linearRgb(OCC_PALETTE['--occ-accent']),
      shadow: linearRgb(OCC_PALETTE['--occ-nav']),
    });
    const aviam = aircraft('f:p:aviam', { bearing: 100, metres: 600 });
    const chosen = aircraft('f:p:chosen', { bearing: 140, metres: 650 });
    const other = aircraft('h:5a5b5c', { kind: 'other', onGround: false, altM: 500, bearing: 60, metres: 4_000 });
    const entry = planInstances([aviam, chosen, other], [], { ...OPTIONS, selectedId: 'f:p:chosen' }).get('A320');
    expect(entry.ids.slice(0, 3)).toEqual(['f:p:aviam', 'f:p:chosen', 'h:5a5b5c']);
    expect(colourOf(entry, 0)).toEqual(float32(AIRCRAFT_3D_COLORS.aviam));
    expect(colourOf(entry, 1)).toEqual(float32(AIRCRAFT_3D_COLORS.selected));
    expect(colourOf(entry, 2)).toEqual(float32(AIRCRAFT_3D_COLORS.other));
    // The chosen aircraft's shadow stays a shadow.
    expect(colourOf(entry, 4)).toEqual(float32(AIRCRAFT_3D_COLORS.shadow));
    // A selection of the other aircraft moves the cyan to it.
    const retargeted = planInstances([aviam, chosen, other], [], { ...OPTIONS, selectedId: 'h:5a5b5c' }).get('A320');
    expect([colourOf(retargeted, 1), colourOf(retargeted, 2)]).toEqual([float32(AIRCRAFT_3D_COLORS.aviam),
      float32(AIRCRAFT_3D_COLORS.selected)]);

    // Normal aircraft are slate greys with no hue to speak of; only the chosen one is a colour.
    const spread = token => {
      const channels = [1, 3, 5].map(start => Number.parseInt(OCC_PALETTE[token].slice(start, start + 2), 16) / 255);
      return Math.max(...channels) - Math.min(...channels);
    };
    expect(spread('--occ-text')).toBeLessThan(0.1);
    expect(spread('--occ-faint')).toBeLessThan(0.1);
    expect(spread('--occ-accent')).toBeGreaterThan(0.4);
    // Other traffic is darker than AVIAM's aircraft; the shadow darker than both.
    const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    expect(luminance(AIRCRAFT_3D_COLORS.other)).toBeLessThan(luminance(AIRCRAFT_3D_COLORS.aviam));
    expect(luminance(AIRCRAFT_3D_COLORS.shadow)).toBeLessThan(luminance(AIRCRAFT_3D_COLORS.other) / 10);
    // The colours can be given.
    const plain = { aviam: [1, 1, 1], other: [0.5, 0.5, 0.5], selected: [0, 0, 1], shadow: [0, 0, 0] };
    expect(colourOf(planInstances([aviam], [], { ...OPTIONS, colors: plain }).get('A320'), 0)).toEqual([1, 1, 1]);
  });

  it("an unknown type gets its category's generic airframe under its own key, flagged approximate", () => {
    const known = aircraft('f:p:known', { bearing: 10, metres: 500 });
    const unknownNarrow = aircraft('f:p:unknown', { bearing: 20, metres: 520, typeIcao: 'B734', sizeCategory: 'Narrowbody' });
    const byModel = aircraft('f:p:model', { bearing: 30, metres: 540, typeIcao: null, model: 'Boeing 737 MAX 8' });
    const nothing = aircraft('h:6a6b6c', { kind: 'other', onGround: false, altM: 600, bearing: 40, metres: 3_000,
      typeIcao: null });
    const plan = planInstances([known, unknownNarrow, byModel, nothing], [], OPTIONS);
    expect([...plan.keys()]).toEqual(['@narrow', '@unknown', 'A320', 'B38M']);
    expect(plan.get('@narrow')).toMatchObject({ spec: CATEGORY_FALLBACKS.narrow, approximate: true, ids: ['f:p:unknown', null] });
    expect(plan.get('@unknown')).toMatchObject({ spec: CATEGORY_FALLBACKS.unknown, approximate: true });
    expect(plan.get('A320')).toMatchObject({ approximate: false, ids: ['f:p:known', null] });
    expect(plan.get('B38M')).toMatchObject({ spec: AIRCRAFT_TYPES.B38M, approximate: false, ids: ['f:p:model', null] });
    expect(instanceKey({ code: 'A20N', iconCategory: 'narrow' })).toBe('A20N');
    expect(instanceKey({ code: null, iconCategory: 'heli' })).toBe('@heli');

    // The resolved types are memoized up to a limit, so a long session with many types does not grow without end.
    const many = Array.from({ length: TYPE_MEMO_LIMIT + 40 }, (_, index) => aircraft(`h:${index}`, { kind: 'other',
      onGround: false, altM: 800, bearing: index, metres: 2_000, typeIcao: `Z${String(index).padStart(3, '0')}` }));
    expect(planInstances(many, [], OPTIONS).get('@unknown').aircraftCount).toBe(many.length);
    expect(typeMemoSizeForTests()).toBeLessThanOrEqual(TYPE_MEMO_LIMIT);
    expect(planInstances([known], [], OPTIONS).get('A320').approximate).toBe(false);
  });

  it("the mercator frame matches MapLibre's MercatorCoordinate and 1 km east of the ARP is 1 000 m", () => {
    const frame = mercatorFrame(ARP);
    const origin = MercatorCoordinate.fromLngLat(ARP, 0);
    expect(frame.originX).toBeCloseTo(origin.x, 14);
    expect(frame.originY).toBeCloseTo(origin.y, 14);
    expect(frame.metreUnits / origin.meterInMercatorCoordinateUnits()).toBeCloseTo(1, 12);
    expect(Object.isFrozen(frame)).toBe(true);

    // The frame's matrix takes a local point to the mercator coordinate MapLibre gives its position and height.
    const matrix = new Matrix4().fromArray(frame.matrix);
    expect(frame.matrix).toBeInstanceOf(Float64Array);
    expect(frame.matrix).not.toBe(frame.matrix);
    for (const [bearing, metres, height] of [[45, 2_000, 300], [200, 9_000, 1_200], [300, 600, 0]]) {
      const point = destinationPoint(ARP, bearing, metres);
      const mercator = new Vector3(...frame.toLocal(point), height).applyMatrix4(matrix);
      const expected = MercatorCoordinate.fromLngLat(point, height);
      expect(mercator.x).toBeCloseTo(expected.x, 14);
      expect(mercator.y).toBeCloseTo(expected.y, 14);
      // The height is on the ARP's scale: within 0.1 % of MapLibre's at the point itself, inside 6 NM.
      if (height > 0) expect(Math.abs(mercator.z / expected.z - 1)).toBeLessThan(0.001);
    }

    // 1 km east is 1 000 m east; 1 km north is 1 000 m north on the ARP's scale.
    const [eastX, eastY] = frame.toLocal(destinationPoint(ARP, 90, 1_000));
    expect(Math.abs(eastX - 1_000)).toBeLessThan(0.01);
    expect(Math.abs(eastY)).toBeLessThan(0.05);
    const [northX, northY] = frame.toLocal(destinationPoint(ARP, 0, 1_000));
    expect(Math.abs(northX)).toBeLessThan(1e-6);
    expect(Math.abs(northY - 1_000)).toBeLessThan(0.1);
    expect(frame.toLocal(ARP)).toEqual([0, 0]);

    for (const wrong of [null, [ARP[0]], [Number.NaN, 18], [-68, 89]]) expect(() => mercatorFrame(wrong)).toThrow(RangeError);
  });

  it("linearRgb matches three's Color for every colour of the palette", () => {
    const tokens = Object.entries(OCC_PALETTE);
    expect(tokens.length).toBeGreaterThan(20);
    for (const [token, value] of tokens) {
      const rgb = /^rgb\((\d+) (\d+) (\d+)/.exec(value);
      const expected = rgb
        ? new Color().setRGB(Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255, SRGBColorSpace)
        : new Color(value);
      const actual = linearRgb(value);
      expect(Object.isFrozen(actual)).toBe(true);
      expect(actual[0], token).toBeCloseTo(expected.r, 12);
      expect(actual[1], token).toBeCloseTo(expected.g, 12);
      expect(actual[2], token).toBeCloseTo(expected.b, 12);
    }
    // The short and the comma forms read the same; anything else is refused.
    expect(linearRgb('#fff')).toEqual([1, 1, 1]);
    expect(linearRgb('rgb(15, 22, 26)')).toEqual(linearRgb('#0f161a'));
    for (const wrong of ['', 'cyan', '#12345', 'rgb(300 0 0)', null, 42]) expect(() => linearRgb(wrong)).toThrow(RangeError);
  });

  it('the plan is deterministic and leaves its input untouched', () => {
    const traffic = deepFreeze([
      aircraft('f:p:b', { bearing: 10, metres: 700, trackDeg: 15 }),
      aircraft('h:7a7b7c', { kind: 'other', onGround: false, altM: 700, bearing: 260, metres: 6_000, trackDeg: 80,
        typeIcao: 'E190' }),
      aircraft('f:p:a', { bearing: 200, metres: 800, trackDeg: 175, typeIcao: 'B38M' }),
      aircraft('f:p:c', { onGround: false, altM: 250, bearing: 250, metres: 3_000, trackDeg: 80 }),
    ]);
    const stand = MDPC_LAYOUT.stands.find(item => item.code === 'B21');
    const parked = deepFreeze([{ id: 'f:p:a', lon: stand.center[0], lat: stand.center[1], headingDeg: stand.headingTrue,
      typeIcao: 'B38M', model: null, sizeCategory: 'Narrowbody' }]);
    const before = JSON.stringify([traffic, parked]);
    const options = deepFreeze({ ...OPTIONS, selectedId: 'f:p:c', fieldElevationM: FIELD_M });

    const first = planInstances(traffic, parked, options);
    expect(snapshot(planInstances(traffic, parked, options))).toEqual(snapshot(first));
    // The order of the input does not matter: instances are sorted by id within each type.
    expect(snapshot(planInstances([...traffic].reverse(), parked, options))).toEqual(snapshot(first));
    expect(JSON.stringify([traffic, parked])).toBe(before);
    // Two plans share nothing that one of them could change.
    const second = planInstances(traffic, parked, options);
    second.get('A320').matrices[12] = 999;
    expect(first.get('A320').matrices[12]).not.toBe(999);
  });
});

describe('liveries and gear (PR M5)', () => {
  it("only an AVIAM aircraft wears its airline's livery: the chosen one, other traffic and every shadow none", () => {
    const list = [
      aircraft('f:a', { airlineIcao: 'CMP' }),
      aircraft('f:b', { bearing: 90, metres: 300, airlineIcao: 'JBU' }),
      aircraft('h:c', { kind: 'other', bearing: 180, metres: 900, onGround: false, altM: 1_200, airlineIcao: 'UAL' }),
      aircraft('f:d', { bearing: 270, metres: 300 }),
    ];
    const entry = planInstances(list, [], { ...OPTIONS, selectedId: 'f:b' }).get('A320');
    expect(entry.ids).toEqual(['f:a', 'f:b', 'f:d', 'h:c', null, null, null, null]);
    // AVIAM's own aircraft in their airline's livery, an unknown airline in the default one.
    expect(entry.liveries).toEqual(['CMP', null, 'DEFAULT', null, null, null, null, null]);
    expect(Object.isFrozen(entry.liveries)).toBe(true);
    // The other traffic and the chosen aircraft keep their role colours.
    expect(colourOf(entry, 1)).toEqual(Array.from(Float32Array.from(AIRCRAFT_3D_COLORS.selected)));
    expect(colourOf(entry, 3)).toEqual(Array.from(Float32Array.from(AIRCRAFT_3D_COLORS.other)));
    // A parked aircraft wears its airline's livery too.
    const parked = planInstances([], [{ id: 's:A5', lon: list[0].lon, lat: list[0].lat, headingDeg: 0, typeIcao: 'A320',
      model: 'A320', kind: 'aviam', airlineIcao: 'DAL' }], OPTIONS).get('A320');
    expect(parked.liveries).toEqual(['DAL', null]);
  });

  it("puts the gear down on a stand and on the ground, up in a climb, and gives each shadow its aircraft's gear", () => {
    const list = [
      aircraft('f:a'),
      aircraft('f:b', { bearing: 90, metres: 2_000, onGround: false, altM: FIELD_M + 900, vrateMs: 8, phase: 'climb' }),
    ];
    const entry = planInstances(list, [{ id: 's:A5', lon: list[0].lon, lat: list[0].lat, headingDeg: 0, typeIcao: 'A320',
      model: 'A320', kind: 'aviam' }], { ...OPTIONS, fieldElevationM: FIELD_M }).get('A320');
    expect(entry.ids.slice(0, 3)).toEqual(['f:a', 'f:b', 's:A5']);
    expect([...entry.gear]).toEqual([1, 0, 1, 1, 0, 1]);
    // An attitude that eased the gear decides it.
    const eased = planInstances(list, [], { ...OPTIONS, fieldElevationM: FIELD_M,
      attitudes: new Map([['f:b', { heightM: 900, pitchDeg: 5, bankDeg: 0, gearDown: true }]]) }).get('A320');
    expect([...eased.gear]).toEqual([1, 1, 1, 1]);
  });
});

describe('poseMatrix and attitudes (CN-30)', () => {
  const apply = (matrix, [x, y, z]) => new Vector3(x, y, z).applyMatrix4(new Matrix4().fromArray(matrix));

  it('is the plain heading matrix without pitch or bank, and puts the model where it is', () => {
    expect([...poseMatrix({ x: 5, y: 6, z: 7, headingDeg: 90 })].map(value => Math.round(value * 1e6) / 1e6))
      .toEqual([0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1]);
    // Heading 90: the nose (+y) points east.
    const nose = apply(poseMatrix({ headingDeg: 90 }), [0, 10, 0]);
    expect(nose.x).toBeCloseTo(10, 6);
    expect(nose.y).toBeCloseTo(0, 6);
  });

  it('pitches the nose up about the main wheels and banks the right wing down for a right turn', () => {
    const pivot = { pivotY: -2, pivotZ: 2 };
    const up = poseMatrix({ pitchDeg: 10, ...pivot });
    // The main wheels stay where they were; the nose rises, the tail sinks less than it would about the middle.
    const wheels = apply(up, [0, -2, 0]);
    expect(wheels.y).toBeCloseTo(-2, 6);
    expect(wheels.z).toBeCloseTo(0, 6);
    expect(apply(up, [0, 18, 0]).z).toBeCloseTo(20 * Math.sin((10 * Math.PI) / 180), 5);
    const right = poseMatrix({ bankDeg: 20, ...pivot });
    expect(apply(right, [17, 0, 2]).z).toBeLessThan(2);
    expect(apply(right, [-17, 0, 2]).z).toBeGreaterThan(2);
    // The fuselage's axis is the bank's: it does not move.
    const axis = apply(right, [0, 0, 2]);
    expect(axis.x).toBeCloseTo(0, 6);
    expect(axis.z).toBeCloseTo(2, 6);
    expect(pivotOf(AIRCRAFT_TYPES.A320).y).toBeLessThan(0);
  });

  it('pitches, banks and lifts an aircraft of the traffic by its attitude, leaving its shadow level', () => {
    const [lon, lat] = destinationPoint(MDPC_LAYOUT.meta.arp, 90, 500);
    const climbing = { id: 'f:climb', kind: 'aviam', lon, lat, altM: 400, onGround: false, trackDeg: 0, typeIcao: 'A320' };
    const plan = planInstances([climbing], [], {
      zoom: 16, minZoom: 15, originLngLat: MDPC_LAYOUT.meta.arp,
      attitudes: new Map([['f:climb', { heightM: 250, pitchDeg: 12, bankDeg: -15 }]]),
    });
    const { matrices } = plan.get('A320');
    // At its height, give or take what pitching about its main wheels moves its origin.
    expect(Math.abs(matrices[14] - 250)).toBeLessThan(2);
    // The nose (column 1) rises; the shadow's is level and on the ground.
    expect(matrices[6]).toBeGreaterThan(0.15);
    expect(matrices[16 + 6]).toBeCloseTo(0, 6);
    expect(matrices[16 + 14]).toBeCloseTo(0.05, 6);
    // Left out when the detailed model draws it.
    expect(planInstances([climbing], [], { zoom: 16, minZoom: 15, originLngLat: MDPC_LAYOUT.meta.arp,
      excludeId: 'f:climb' }).size).toBe(0);
  });

  it('plans the soft contact shadow of each aircraft, full on the ground and none from fadeM up (M4)', () => {
    const parked = { id: 's:B2', lon: ARP[0] + 0.003, lat: ARP[1], headingDeg: 45, typeIcao: 'A320', kind: 'aviam' };
    const low = aircraft('f:low', { bearing: 90, metres: 900, onGround: false, altM: FIELD_M + 10, trackDeg: 90 });
    const high = aircraft('f:high', { bearing: 270, metres: 900, onGround: false, altM: FIELD_M + 400, trackDeg: 270 });
    const plan = planInstances([aircraft('f:ground', { bearing: 180, metres: 500 }), low, high], [parked],
      { ...OPTIONS, fieldElevationM: FIELD_M });
    const entry = plan.get('A320');
    expect(entry.ids.slice(0, entry.aircraftCount)).toEqual(['f:ground', 'f:high', 'f:low', 's:B2']);
    expect(entry.contacts).toHaveLength(16 * entry.aircraftCount);
    const strengths = [...entry.contactStrengths];
    expect(strengths[0]).toBe(1);
    expect(strengths[1]).toBe(0);
    expect(strengths[2]).toBeCloseTo(contactShadowStrength(10), 6);
    expect(strengths[3]).toBe(1);
    // Under each aircraft, a little above the ground, along its heading and the size of its type.
    const [x, y] = translationOf(entry, 3);
    const expected = contactShadowMatrix({ x, y, headingDeg: 45, ...contactShadowSize(AIRCRAFT_TYPES.A320) });
    [...entry.contacts.slice(48, 64)].forEach((value, index) => expect(value).toBeCloseTo(expected[index], 3));
    // None for the one above fadeM.
    expect([...entry.contacts.slice(16, 32)].every(value => value === 0)).toBe(true);
    // The spread of the low one: wider than on the ground.
    const along = index => Math.hypot(entry.contacts[16 * index + 4], entry.contacts[16 * index + 5]);
    expect(along(2) / along(0)).toBeCloseTo(contactShadowSize(AIRCRAFT_TYPES.A320, 10).alongM
      / contactShadowSize(AIRCRAFT_TYPES.A320).alongM, 4);
  });
});

// M9: the liveries of Mapa de posiciones and the other traffic on the ground near the field.
describe('the 3D instance plan with liveries (M9)', () => {
  const zoneOf = (entry, zone, index) => (zone === 'fuselage'
    ? colourOf(entry, index)
    : Array.from(entry.zoneColors[zone].slice(3 * index, 3 * index + 3)));
  const expectZones = (entry, index, colours) => {
    for (const zone of LIVERY_ZONES) expect(zoneOf(entry, zone, index), zone).toEqual(float32(colours[zone]));
  };

  it("liveryInstanceColours gives each zone of the airline's livery in linear colour, the default livery otherwise", () => {
    const copa = liveryInstanceColours({ callsign: 'CMP893' });
    expect(Object.keys(copa)).toEqual(LIVERY_ZONES);
    expect(copa).toEqual({ fuselage: linearRgb(LIVERIES.CMP.fuselage), belly: linearRgb(LIVERIES.CMP.belly),
      tail: linearRgb(LIVERIES.CMP.tail), engine: linearRgb(LIVERIES.CMP.engine), wing: linearRgb(LIVERIES.CMP.wing) });
    // The same frozen object for the same livery, however it is named.
    expect(liveryInstanceColours({ airlineIata: 'CM' })).toBe(copa);
    expect(Object.isFrozen(copa)).toBe(true);
    expect(liveryInstanceColours({ callsign: 'N123AB' }).tail).toEqual(linearRgb(DEFAULT_LIVERY.tail));
  });

  it('without livery every zone of an aircraft is its monochrome colour, and the shadows are the shadow colour', () => {
    const plan = planInstances([aircraft('f:p:mono', { bearing: 90, metres: 300, callsign: 'CMP893' })], [], OPTIONS);
    const entry = plan.get('A320');
    expect(Object.keys(entry.zoneColors)).toEqual(LIVERY_ZONES.filter(zone => zone !== 'fuselage'));
    expectZones(entry, 0, Object.fromEntries(LIVERY_ZONES.map(zone => [zone, AIRCRAFT_3D_COLORS.aviam])));
    expectZones(entry, 1, Object.fromEntries(LIVERY_ZONES.map(zone => [zone, AIRCRAFT_3D_COLORS.shadow])));
  });

  it("with livery parked and nearby aircraft wear their airline's colours; the chosen one and the shadows do not", () => {
    const parked = { id: 's:B20', lon: ARP[0] + 0.001, lat: ARP[1], headingDeg: 200, typeIcao: 'A320', model: 'A320',
      kind: 'aviam', flightNumber: 'CM 893' };
    const taxiing = aircraft('f:p:taxi', { bearing: 45, metres: 600, callsign: 'JBU1234' });
    const chosen = aircraft('f:p:chosen', { bearing: 135, metres: 600, callsign: 'DAL455' });
    const plan = planInstances([taxiing, chosen], [parked], { ...OPTIONS, livery: true, selectedId: 'f:p:chosen' });
    const entry = plan.get('A320');
    expect(entry.ids).toEqual(['f:p:chosen', 'f:p:taxi', 's:B20', null, null, null]);
    expectZones(entry, 0, Object.fromEntries(LIVERY_ZONES.map(zone => [zone, AIRCRAFT_3D_COLORS.selected])));
    expectZones(entry, 1, liveryInstanceColours({ airlineIcao: 'JBU' }));
    expectZones(entry, 2, liveryInstanceColours({ airlineIcao: 'CMP' }));
    // A livery has a hue: jetBlue's fin is not its white body.
    expect(zoneOf(entry, 'tail', 1)).not.toEqual(zoneOf(entry, 'fuselage', 1));
    for (const index of [3, 4, 5]) {
      expectZones(entry, index, Object.fromEntries(LIVERY_ZONES.map(zone => [zone, AIRCRAFT_3D_COLORS.shadow])));
    }
    // Its stand's scale for the parked one, the traffic's floor for the rest; the livery moves no matrix.
    expect(Array.from(entry.floorLengths)).toEqual(float32([AIRCRAFT_TYPES.A320.lengthM, AIRCRAFT_TYPES.A320.lengthM, 0,
      AIRCRAFT_TYPES.A320.lengthM, AIRCRAFT_TYPES.A320.lengthM, 0]));
    const plain = planInstances([taxiing, chosen], [parked], { ...OPTIONS, selectedId: 'f:p:chosen' }).get('A320');
    expect(Array.from(entry.matrices)).toEqual(Array.from(plain.matrices));
  });

  it('with livery the L1 models of PR M5 wear the same airline as the procedural zones, other traffic included', () => {
    const parked = { id: 's:B20', lon: ARP[0] + 0.001, lat: ARP[1], headingDeg: 200, typeIcao: 'A320', model: 'A320',
      kind: 'aviam', flightNumber: 'CM 893' };
    const ground = aircraft('h:7a7b7c', { kind: 'other', onGround: true, bearing: 300, metres: 1_500, callsign: 'AAL1234' });
    const chosen = aircraft('f:p:chosen', { bearing: 135, metres: 600, callsign: 'DAL455' });
    const options = { ...OPTIONS, livery: true, groundRadiusM: GROUND_TRAFFIC_3D_RADIUS_M, selectedId: 'f:p:chosen' };
    const entry = planInstances([ground, chosen], [parked], options).get('A320');
    expect(entry.ids).toEqual(['f:p:chosen', 'h:7a7b7c', 's:B20', null, null, null]);
    // Mapa de posiciones (M9): every aircraft but the chosen one wears its airline, the other traffic too.
    expect(entry.liveries).toEqual([null, 'AAL', 'CMP', null, null, null]);
    expectZones(entry, 1, liveryInstanceColours({ airlineIcao: 'AAL' }));
    // Without livery (the other screens, contracts 2.4) only AVIAM's aircraft wear it.
    const plain = planInstances([ground, chosen], [parked], { ...options, livery: false }).get('A320');
    expect(plain.liveries).toEqual([null, null, 'CMP', null, null, null]);
  });

  it('draws other traffic on the ground in 3D within groundRadiusM of the ARP only, at its heading on the ground', () => {
    const near = aircraft('h:7a7b7c', { kind: 'other', onGround: true, bearing: 300, metres: 1_500, trackDeg: 75,
      typeIcao: 'B738', callsign: 'AAL1234' });
    const beyond = aircraft('h:8a8b8c', { kind: 'other', onGround: true, bearing: 300,
      metres: GROUND_TRAFFIC_3D_RADIUS_M + 500, typeIcao: 'B738' });
    const hidden = aircraft('h:9a9b9c', { kind: 'other', onGround: true, metres: 200, hiddenInStand: true });
    expect(GROUND_TRAFFIC_3D_RADIUS_M).toBe(4_000);
    // Without the radius it stays 2D (contracts 2.4), with or without livery.
    expect(planInstances([near, beyond], [], { ...OPTIONS, livery: true }).size).toBe(0);
    const plan = planInstances([near, beyond, hidden], [], { ...OPTIONS, livery: true,
      groundRadiusM: GROUND_TRAFFIC_3D_RADIUS_M });
    expect([...plan.keys()]).toEqual(['B738']);
    const entry = plan.get('B738');
    expect(entry.ids).toEqual(['h:7a7b7c', null]);
    const [x, y] = local([near.lon, near.lat]);
    expect(translationOf(entry, 0)).toEqual(float32([x, y, 0]));
    const nose = new Vector3(0, 1, 0).transformDirection(matrixOf(entry, 0));
    expect(Math.atan2(nose.x, nose.y) * (180 / Math.PI)).toBeCloseTo(75, 4);
    expectZones(entry, 0, liveryInstanceColours({ airlineIcao: 'AAL' }));
    expect(entry.dropLines.length).toBe(0);
    // A radius that is not a number is none.
    expect(planInstances([near], [], { ...OPTIONS, groundRadiusM: Number.NaN }).size).toBe(0);
  });
});

// PR M2: what the animated layer draws of the traffic, at the positions of one frame.
describe('planSprites (PR M2)', () => {
  const hex = channels => `#${channels.map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`;
  const tintOf = (sprites, index) => hex(Array.from(sprites.colors.slice(3 * index, 3 * index + 3)));
  const spriteAt = (sprites, index) => ({
    id: sprites.ids[index],
    xy: [sprites.matrices[16 * index + 12], sprites.matrices[16 * index + 13]],
    size: [sprites.sizes[2 * index], sprites.sizes[2 * index + 1]],
    offset: [sprites.offsets[2 * index], sprites.offsets[2 * index + 1]],
    cell: Array.from(sprites.cells.slice(4 * index, 4 * index + 4)),
    opacity: sprites.opacities[index],
    plain: sprites.plain[index],
  });

  it('draws one silhouette per aircraft where the frame puts it, turned to its track and tinted by its altitude', () => {
    const climbing = aircraft('f:climb', { bearing: 90, metres: 2_000, onGround: false, altM: 1_200, trackDeg: 90 });
    const taxiing = aircraft('h:taxi', { kind: 'other', bearing: 200, metres: 600, trackDeg: 45 });
    const far = aircraft('h:far', { kind: 'other', bearing: 10, metres: 200 * METRES_PER_NM, onGround: false, altM: 9_000 });
    const sprites = planSprites([climbing, taxiing, far], { originLngLat: ARP });
    expect(sprites.count).toBe(3);
    // Other traffic on the ground first, then in the air, then the ELEVANT flights.
    expect([...sprites.ids]).toEqual(['h:taxi', 'h:far', 'f:climb']);
    const frame = mercatorFrame(ARP);
    const climb = spriteAt(sprites, 2);
    expect(climb.xy[0]).toBeCloseTo(frame.toLocal([climbing.lon, climbing.lat])[0], 1);
    expect(climb.xy[1]).toBeCloseTo(frame.toLocal([climbing.lon, climbing.lat])[1], 1);
    // T(x, y, 0) · Rz(−track): a track of 90 points the nose (+y) east.
    const nose = new Vector3(0, 1, 0).applyMatrix4(matrixOf(sprites, 2)).sub(new Vector3(...climb.xy, 0));
    expect(nose.x).toBeCloseTo(1, 6);
    expect(nose.y).toBeCloseTo(0, 6);
    // Sizes in CSS pixels, as the icons are drawn (trafficFeatures: TRAFFIC_SCALES): 30 × 1.25 for an ELEVANT A320.
    expect(climb.size).toEqual([37.5, 37.5]);
    expect(climb.cell).toEqual(cellUv('ac-narrow-solid').map(value => expect.closeTo(value, 6)));
    // The altitude scale of the map (3 900 ft rounds to the hundred), the ground's grey, far traffic at any distance.
    expect(tintOf(sprites, 2)).toBe(altitudeColour('dark', { altFt: 3_900 }));
    expect(tintOf(sprites, 0)).toBe(mapColorsFor('dark').altitude.ground);
    expect(tintOf(sprites, 1)).toBe(altitudeColour('dark', { altFt: 29_500 }));
    expect(spriteAt(sprites, 0).size).toEqual([0.6 * 30, 0.6 * 30]);
    expect(Array.from(sprites.halos.slice(0, 3)).map(value => Math.round(value * 255)))
      .toEqual([0x0b, 0x12, 0x18]);
  });

  it('marks the chosen, departing, stale, estimated and demo aircraft as the GeoJSON layers do', () => {
    const chosen = aircraft('f:chosen', { onGround: false, altM: 300 });
    const departure = aircraft('f:dep', { direction: 'Departure', bearing: 90, metres: 300 });
    const stale = aircraft('h:stale', { kind: 'other', quality: 'stale', opacity: 0.8, bearing: 180, metres: 300 });
    const estimated = aircraft('f:est', { quality: 'estimated', bearing: 270, metres: 300 });
    const demo = aircraft('f:demo', { isDemo: true, bearing: 0, metres: 900 });
    const sprites = planSprites([chosen, departure, stale, estimated, demo], { originLngLat: ARP, selectedId: 'f:chosen' });
    const ids = [...sprites.ids];
    // The chosen one after the rest, in the accent at 1.4; the ring and the plate last, without an id.
    expect(ids).toEqual(['h:stale', 'f:dep', 'f:est', 'f:demo', 'f:chosen', null, null]);
    expect(tintOf(sprites, 4)).toBe(OCC_PALETTE['--occ-accent']);
    expect(spriteAt(sprites, 4).size).toEqual([1.4 * 30, 1.4 * 30]);
    expect(spriteAt(sprites, 1).cell).toEqual(cellUv('ac-narrow-hollow').map(value => expect.closeTo(value, 6)));
    expect(spriteAt(sprites, 0).opacity).toBeCloseTo(0.4, 6);
    const ring = spriteAt(sprites, 5);
    expect(ring.cell).toEqual(cellUv(ESTIMATED_RING_IMAGE).map(value => expect.closeTo(value, 6)));
    expect(ring.size).toEqual([40 * 1.25, 40 * 1.25]);
    expect(tintOf(sprites, 5)).toBe(OCC_PALETTE['--occ-muted']);
    const plate = spriteAt(sprites, 6);
    expect(plate).toMatchObject({ plain: 1, size: [SPRITE_CELLS[DEMO_PLATE_IMAGE].width, SPRITE_CELLS[DEMO_PLATE_IMAGE].height] });
    // Below the silhouette (its half size 13.75 px takes the 25 px step), in screen pixels: an image with its own
    // colours is a billboard (aircraft/trafficSprites.js: billboardClip), so its matrix only places its aircraft.
    expect(plate.offset).toEqual([0, -25]);
    expect(plate.xy).toEqual(spriteAt(sprites, 3).xy);
    const up = new Vector3(0, 1, 0).applyMatrix4(matrixOf(sprites, 6)).sub(new Vector3(...plate.xy, 0));
    expect(Math.atan2(up.x, up.y)).toBeCloseTo(0, 6);
  });

  it('paints the chosen aircraft and the estimated ring in the OCC colours of the theme, as the GeoJSON layers do', () => {
    const chosen = aircraft('f:chosen', { onGround: false, altM: 300 });
    const estimated = aircraft('f:est', { quality: 'estimated', bearing: 270, metres: 300 });
    const haloOf = (sprites, index) => hex(Array.from(sprites.halos.slice(3 * index, 3 * index + 3)));
    const paintOf = (theme, id) => buildOccStyle({ basemap: false, overlays: [trafficOverlay({ theme })], theme })
      .layers.find(layer => layer.id === id).paint;
    for (const theme of ['dark', 'light']) {
      const sprites = planSprites([chosen, estimated], { originLngLat: ARP, selectedId: 'f:chosen', theme });
      expect([...sprites.ids]).toEqual(['f:est', 'f:chosen', null]);
      const selected = paintOf(theme, 'occ-traffic-selected');
      expect(tintOf(sprites, 1)).toBe(occColor('accent', theme));
      expect(haloOf(sprites, 1)).toBe(occColor('nav', theme));
      expect(tintOf(sprites, 1)).toBe(selected['icon-color']);
      expect(haloOf(sprites, 1)).toBe(selected['icon-halo-color']);
      const ring = paintOf(theme, 'occ-traffic-estimated-ring');
      expect(tintOf(sprites, 2)).toBe(occColor('muted', theme));
      expect(haloOf(sprites, 2)).toBe(occColor('nav', theme));
      expect(tintOf(sprites, 2)).toBe(ring['icon-color']);
      expect(haloOf(sprites, 2)).toBe(ring['icon-halo-color']);
    }
    // The light theme's own tokens, not the dark ones.
    const light = planSprites([chosen, estimated], { originLngLat: ARP, selectedId: 'f:chosen', theme: 'light' });
    expect(tintOf(light, 1)).not.toBe(occColor('accent'));
    expect(tintOf(light, 2)).not.toBe(occColor('muted'));
  });

  it('leaves out the silhouettes of models and of aircraft on their stand, never their marks', () => {
    const modelled = aircraft('f:model', { quality: 'estimated' });
    const parked = aircraft('f:parked', { isDemo: true, bearing: 90, metres: 200 });
    const chosenParked = aircraft('f:chosen', { bearing: 180, metres: 200 });
    const sprites = planSprites([modelled, parked, chosenParked], { originLngLat: ARP, selectedId: 'f:chosen',
      modelIds: new Set(['f:model']), parkedIds: new Set(['f:parked', 'f:chosen']) });
    expect([...sprites.ids]).toEqual(['f:chosen', null, null]);
    expect(planSprites([], { originLngLat: ARP }).count).toBe(0);
    expect(planSprites([{ ...modelled, hiddenInStand: true }], { originLngLat: ARP }).count).toBe(0);
  });

  it('plans models at any distance with radiusNm Infinity (the animated 3D)', () => {
    const far = aircraft('h:far', { kind: 'other', bearing: 45, metres: 40 * METRES_PER_NM, onGround: false, altM: 3_000 });
    expect(planInstances([far], [], OPTIONS).size).toBe(0);
    const plan = planInstances([far], [], { ...OPTIONS, radiusNm: Infinity });
    expect(plan.get('A320')).toMatchObject({ aircraftCount: 1, ids: ['h:far', null] });
  });
});

describe('planLabels (PR M2)', () => {
  const byId = labels => new Map(labels.tags.map(tag => [tag.id, tag]));
  const traffic = [
    aircraft('f:air', { bearing: 10, metres: 900, onGround: false, altM: 300, flightNumber: 'DM1' }),
    aircraft('f:ground', { bearing: 90, metres: 300, flightNumber: 'DM2' }),
    aircraft('f:parked', { bearing: 180, metres: 200, flightNumber: 'DM3' }),
    aircraft('h:other', { kind: 'other', hex: 'other', callsign: 'JBU1', bearing: 270, metres: 500, onGround: false,
      altM: 900 }),
    aircraft('h:stale', { kind: 'other', hex: 'stale', callsign: 'JBU2', bearing: 300, metres: 500, onGround: false,
      altM: 900, quality: 'stale', opacity: 0.8 }),
  ];

  it('below the ramp zoom: ELEVANT tags give way (the chosen first, then air, then ground), other traffic only on demand', () => {
    const labels = planLabels(traffic, { originLngLat: ARP, zoom: 14, parkedIds: new Set(['f:parked']),
      focusId: 'h:other', otherTagsMinZoom: 13 });
    const tags = byId(labels);
    expect([...tags.keys()].sort()).toEqual(['f:air', 'f:ground', 'h:other']);
    expect(tags.get('f:air')).toMatchObject({ priority: 1, always: false });
    expect(tags.get('f:ground')).toMatchObject({ priority: 2, always: false });
    // The one under the pointer always shows, first.
    expect(tags.get('h:other')).toMatchObject({ priority: 0, always: true });
    expect(tags.get('h:other').tag).toMatchObject({ aviam: false, tag1: 'JBU1' });
    // Placed where the frame draws it, past its silhouette as the GeoJSON tags are (radius + 0.4 em).
    const [x, y] = mercatorFrame(ARP).toLocal([traffic[0].lon, traffic[0].lat]);
    expect(tags.get('f:air')).toMatchObject({ x, y });
    // A narrow-body (30 px icon, 4 px inset) at the ELEVANT scale 1.25: (30 - 8) / 2 × 1.25 = 13.75 px.
    expect(tags.get('f:air').offsetPx).toBeCloseTo(13.8 + 0.4 * 12, 1);
    // The parked aircraft is its stand's: no tag, no mark; nothing is chosen, so no ring.
    expect(labels.marks.map(mark => mark.id)).not.toContain('f:parked');
    expect(labels.marks).toHaveLength(4);
    expect(labels.ring).toBeNull();
  });

  it('from the ramp zoom every ELEVANT tag shows; all the traffic tags only from their zoom, dimmed when stale', () => {
    const close = byId(planLabels(traffic, { originLngLat: ARP, zoom: 15.5, labelsOn: true, otherTagsMinZoom: 16 }));
    expect(close.get('f:air')).toMatchObject({ priority: 1, always: true });
    expect(close.get('f:ground')).toMatchObject({ priority: 1, always: true });
    expect(close.has('h:other')).toBe(false);
    const all = byId(planLabels(traffic, { originLngLat: ARP, zoom: 16, labelsOn: true, otherTagsMinZoom: 16 }));
    expect(all.get('h:other')).toMatchObject({ priority: 3, always: false });
    expect(all.get('h:stale').opacity).toBeCloseTo(0.4, 6);
    expect(all.get('h:stale').tag.suffix).toMatch(/^Sin actualizar/);
  });

  it('rings the chosen aircraft where the frame draws it and uses the words of the write', () => {
    const words = new Map([['f:air', { aviam: true, dir: 'arr', tag1: 'WRITE', suffix: '', tag2: '', tagStand: '' }]]);
    const labels = planLabels(traffic, { originLngLat: ARP, zoom: 12, selectedId: 'f:parked', words,
      parkedIds: new Set(['f:parked']) });
    const [x, y] = mercatorFrame(ARP).toLocal([traffic[2].lon, traffic[2].lat]);
    expect(labels.ring).toEqual({ x, y });
    expect(labels.marks.map(mark => mark.id)).toContain('f:parked');
    expect(byId(labels).has('f:parked')).toBe(false);
    expect(byId(labels).get('f:air').tag.tag1).toBe('WRITE');
  });
});

// Integration of M2 with M4 and M8: the sprites and tags of the animated traffic close up and under the board's filter.
describe('planSprites and planLabels close up and with the board filter (M4, M8)', () => {
  const chosen = aircraft('f:chosen', { quality: 'estimated', isDemo: true, flightNumber: 'DM1' });
  const demo = aircraft('f:demo', { isDemo: true, bearing: 90, metres: 400, flightNumber: 'DM2' });
  const outsideOpacity = (sprites, id) => sprites.opacities[sprites.ids.indexOf(id)];

  it('close up leaves out the followed aircraft\'s estimated ring and «Demo» plate, never its silhouette or others\' marks', () => {
    const far = planSprites([chosen, demo], { originLngLat: ARP, selectedId: 'f:chosen' });
    expect(far.ids.filter(id => id === null)).toHaveLength(3);
    const close = planSprites([chosen, demo], { originLngLat: ARP, selectedId: 'f:chosen', closeUpId: 'f:chosen' });
    expect([...close.ids]).toEqual(['f:demo', 'f:chosen', null]);
    // The plate that stays is the other demo flight's, below its own silhouette.
    expect([close.matrices[16 * 2 + 12], close.matrices[16 * 2 + 13]])
      .toEqual([close.matrices[12], close.matrices[13]]);
  });

  it('close up shows no tag and no ring, the marks stay', () => {
    const options = { originLngLat: ARP, zoom: 20, selectedId: 'f:chosen' };
    const far = planLabels([chosen, demo], options);
    expect(far.tags.map(tag => tag.id).sort()).toEqual(['f:chosen', 'f:demo']);
    expect(far.ring).not.toBeNull();
    const close = planLabels([chosen, demo], { ...options, closeUp: true });
    expect(close.tags).toEqual([]);
    expect(close.ring).toBeNull();
    expect(close.marks.map(mark => mark.id).sort()).toEqual(['f:chosen', 'f:demo']);
  });

  it('dims the silhouette, the plate and the tag of what the board filter leaves out, not its estimated ring', () => {
    const outsideIds = new Set(['f:chosen']);
    const sprites = planSprites([chosen, demo], { originLngLat: ARP, outsideIds });
    // f:demo, f:chosen, the ring, then the two plates (f:chosen's first).
    expect([...sprites.ids]).toEqual(['f:chosen', 'f:demo', null, null, null]);
    expect(outsideOpacity(sprites, 'f:chosen')).toBeCloseTo(OUTSIDE_FILTER_OPACITY, 6);
    expect(outsideOpacity(sprites, 'f:demo')).toBe(1);
    expect(sprites.opacities[2]).toBe(1);
    expect(sprites.opacities[3]).toBeCloseTo(OUTSIDE_FILTER_OPACITY, 6);
    expect(sprites.opacities[4]).toBe(1);
    const tags = planLabels([chosen, demo], { originLngLat: ARP, zoom: 16, outsideIds }).tags;
    expect(tags.find(tag => tag.id === 'f:chosen').opacity).toBeCloseTo(OUTSIDE_FILTER_OPACITY, 6);
    expect(tags.find(tag => tag.id === 'f:demo').opacity).toBe(1);
  });
});
