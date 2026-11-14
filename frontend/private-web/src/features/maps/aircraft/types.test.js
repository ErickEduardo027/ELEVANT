import { describe, expect, it } from 'vitest';
import {
  AIRCRAFT_FAMILIES, AIRCRAFT_TYPES, CATEGORY_FALLBACKS, ICON_CATEGORIES, resolveAircraftType, typeFromModel,
} from './types';

// The twenty types of the plan (design G2 and the M5 brief), in the order of the brief.
const PLAN_TYPES = [
  'A320', 'A321', 'A20N', 'A21N', 'B737', 'B738', 'B38M', 'B39M', 'B752', 'B763', 'B77W', 'A333', 'A359', 'B788', 'B789',
  'E190', 'E195', 'BCS3', 'CRJ9', 'AT76',
];

const SPEC_KEYS = ['family', 'iconCategory', 'lengthM', 'spanM', 'heightM', 'fuselageDiaM', 'wingSweepDeg', 'engines',
  'engineDiaM'];

function expectPlausible(spec, name) {
  expect(Object.keys(spec), name).toEqual(SPEC_KEYS);
  expect(AIRCRAFT_FAMILIES, name).toContain(spec.family);
  expect(ICON_CATEGORIES, name).toContain(spec.iconCategory);
  for (const key of ['lengthM', 'spanM', 'heightM', 'fuselageDiaM']) expect(spec[key], `${name} ${key}`).toBeGreaterThan(0);
  // Airframes between a light single and the largest airliner, taller than wide in no case.
  expect(spec.lengthM, name).toBeGreaterThan(5);
  expect(spec.lengthM, name).toBeLessThan(80);
  expect(spec.spanM, name).toBeLessThan(81);
  expect(spec.heightM, name).toBeLessThan(Math.min(spec.lengthM, spec.spanM));
  expect(spec.fuselageDiaM, name).toBeLessThan(spec.heightM);
  expect(spec.fuselageDiaM, name).toBeLessThan(spec.lengthM / 4);
  expect(spec.wingSweepDeg, name).toBeGreaterThanOrEqual(0);
  expect(spec.wingSweepDeg, name).toBeLessThan(45);
  expect(Number.isInteger(spec.engines) && spec.engines >= 1 && spec.engines <= 4, name).toBe(true);
  expect(spec.engineDiaM, name).toBeLessThan(spec.fuselageDiaM);
}

describe('aircraft types (design G2)', () => {
  it('lists exactly the twenty types of the plan with positive, plausible dimensions', () => {
    expect(Object.keys(AIRCRAFT_TYPES)).toEqual(PLAN_TYPES);
    expect(Object.isFrozen(AIRCRAFT_TYPES) && Object.isFrozen(AIRCRAFT_TYPES.B38M)).toBe(true);
    for (const code of PLAN_TYPES) {
      const spec = AIRCRAFT_TYPES[code];
      expectPlausible(spec, code);
      // Jets fly with swept wings; the ATR keeps a straight one.
      if (spec.family === 'turbopropHigh') expect(spec.wingSweepDeg, code).toBeLessThan(10);
      else expect(spec.wingSweepDeg, code).toBeGreaterThanOrEqual(20);
    }
    // Spot checks against the manufacturers' figures (length × span × height).
    expect(AIRCRAFT_TYPES.B38M).toMatchObject({ lengthM: 39.52, spanM: 35.92, heightM: 12.29 });
    expect(AIRCRAFT_TYPES.E195).toMatchObject({ lengthM: 38.65, spanM: 28.72, heightM: 10.55 });
    expect(AIRCRAFT_TYPES.B77W).toMatchObject({ lengthM: 73.86, spanM: 64.8, iconCategory: 'wide2' });
    // The categories of the brief: narrow bodies, twin wide bodies, the rear-engined CRJ and the ATR.
    expect(PLAN_TYPES.filter(code => AIRCRAFT_TYPES[code].iconCategory === 'wide2'))
      .toEqual(['B763', 'B77W', 'A333', 'A359', 'B788', 'B789']);
    expect([AIRCRAFT_TYPES.CRJ9.family, AIRCRAFT_TYPES.CRJ9.iconCategory]).toEqual(['rearTwinT', 'regional']);
    expect([AIRCRAFT_TYPES.AT76.family, AIRCRAFT_TYPES.AT76.iconCategory]).toEqual(['turbopropHigh', 'turboprop']);

    // One generic airframe per icon category, each drawn in its own category.
    expect(Object.keys(CATEGORY_FALLBACKS)).toEqual(ICON_CATEGORIES);
    for (const [category, spec] of Object.entries(CATEGORY_FALLBACKS)) {
      expectPlausible(spec, category);
      expect(spec.iconCategory, category).toBe(category);
    }
    expect(CATEGORY_FALLBACKS.heavy4.engines).toBe(4);
  });

  it('resolves ICAO codes, model text aliases and falls back by size and emitter category, flagging approximate', () => {
    // The designator first, whatever the rest says.
    expect(resolveAircraftType({ typeIcao: 'B38M', model: 'A320-200', sizeCategory: 'Widebody', emitterCategory: 'A5' }))
      .toEqual({ code: 'B38M', spec: AIRCRAFT_TYPES.B38M, iconCategory: 'narrow', approximate: false });
    expect(resolveAircraftType({ typeIcao: ' b789 ' })).toMatchObject({ code: 'B789', iconCategory: 'wide2', approximate: false });

    // A model text names its type: «737 MAX 8» is B38M, «A321neo» A21N, never the ceo or the -800.
    expect(resolveAircraftType({ model: '737 MAX 8' })).toMatchObject({ code: 'B38M', approximate: false });
    expect(resolveAircraftType({ typeIcao: null, model: 'A321neo' })).toMatchObject({ code: 'A21N', approximate: false });
    expect([
      'Boeing 737-800', 'B737 MAX 8', 'A320-200', 'A320neo', 'A321-200', 'Airbus A330-300', 'A350-900', '787-9 Dreamliner',
      '777-300ER', 'Embraer 195', 'ERJ-190', 'A220-300', 'CRJ900', 'ATR 72-600', '757-200', '767-300ER', '737-700',
    ].map(typeFromModel)).toEqual([
      'B738', 'B38M', 'A320', 'A20N', 'A321', 'A333', 'A359', 'B789', 'B77W', 'E195', 'E190', 'BCS3', 'CRJ9', 'AT76',
      'B752', 'B763', 'B737',
    ]);
    // A number is never read inside a longer one.
    expect(['A3200', '1737-800', '7378', 'Cessna 172', '', null, 42].map(typeFromModel)).toEqual([null, null, null, null, null,
      null, null]);

    // A known designator outside the table keeps the shape of its category: four engines, a turboprop, a rear-engined jet.
    expect(resolveAircraftType({ typeIcao: 'B744', emitterCategory: 'A5' }))
      .toEqual({ code: null, spec: CATEGORY_FALLBACKS.heavy4, iconCategory: 'heavy4', approximate: true });
    expect(resolveAircraftType({ typeIcao: 'DH8D', sizeCategory: 'Narrowbody', emitterCategory: 'A3' }).iconCategory)
      .toBe('turboprop');
    expect(resolveAircraftType({ typeIcao: 'E145', emitterCategory: 'A2' }).iconCategory).toBe('regional');

    // The size category of the ELEVANT flight, then the ADS-B emitter category.
    expect(resolveAircraftType({ typeIcao: 'A319', sizeCategory: 'Narrowbody', emitterCategory: 'A5' }))
      .toEqual({ code: null, spec: CATEGORY_FALLBACKS.narrow, iconCategory: 'narrow', approximate: true });
    expect(resolveAircraftType({ sizeCategory: 'Widebody' }).iconCategory).toBe('wide2');
    expect(['A1', 'a2', 'A3', 'A4', 'A5', 'A7'].map(emitterCategory => resolveAircraftType({ emitterCategory }).iconCategory))
      .toEqual(['light', 'bizjet', 'narrow', 'narrow', 'wide2', 'heli']);
    for (const emitterCategory of ['A6', 'B2', 'C1', 'A0', '', null]) {
      expect(resolveAircraftType({ emitterCategory }), String(emitterCategory))
        .toEqual({ code: null, spec: CATEGORY_FALLBACKS.unknown, iconCategory: 'unknown', approximate: true });
    }
    // Nothing known: the neutral dart. Keys of the object prototype are not categories.
    expect(resolveAircraftType()).toMatchObject({ iconCategory: 'unknown', approximate: true });
    expect(resolveAircraftType({ typeIcao: 'constructor', sizeCategory: 'toString', emitterCategory: '__proto__' }))
      .toMatchObject({ iconCategory: 'unknown', approximate: true });
    expect(Object.isFrozen(resolveAircraftType({ typeIcao: 'A320' }))).toBe(true);
  });
});
