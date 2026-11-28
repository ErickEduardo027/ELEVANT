import { MercatorCoordinate } from 'maplibre-gl';
import { Color, Matrix4, Quaternion, SRGBColorSpace, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { OCC_PALETTE } from '../../occ-ui/occPalette';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { destinationPoint, METRES_PER_NM } from '../airport/geo';
import { thresholdsFromFits } from '../core/cameraPresets';
import {
  AIRCRAFT_3D_COLORS, AIRCRAFT_3D_RADIUS_NM, DROP_LINE_MIN_M, SHADOW, TYPE_MEMO_LIMIT, instanceKey, linearRgb,
  mercatorFrame, planInstances, typeMemoSizeForTests, pivotOf, poseMatrix,
} from './instancePlan';
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
});
