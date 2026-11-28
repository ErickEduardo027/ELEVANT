import { describe, expect, it } from 'vitest';
import {
  AIRCRAFT_FAMILIES, AIRCRAFT_TYPES, CATEGORY_FALLBACKS, DESIGNATOR_CATEGORIES, ICON_CATEGORIES, resolveAircraftType,
  typeFromModel,
} from './types';

// The thirty-five types of the plan (design G2, the M5 brief, PR M7 and the B739 of PR M5), in the order of the table.
const PLAN_TYPES = [
  'A319', 'A320', 'A321', 'A20N', 'A21N', 'B737', 'B738', 'B739', 'B38M', 'B39M', 'B752', 'B763', 'B772', 'B77W', 'A332',
  'A333', 'A339', 'A359', 'B788', 'B789', 'B744', 'A388', 'E190', 'E195', 'BCS3', 'CRJ9', 'AT76', 'DH8D', 'B350', 'B190',
  'CL35', 'GLF5', 'C172', 'AS50', 'EC35',
];

const SPEC_KEYS = ['family', 'iconCategory', 'lengthM', 'spanM', 'heightM', 'fuselageDiaM', 'wingSweepDeg', 'engines',
  'engineDiaM'];

// Families whose wing is straight (or that have none): propellers and rotors. Every other airframe of the table is a jet.
const STRAIGHT_WINGED = ['turbopropHigh', 'turbopropLow', 'pistonSingle', 'helicopter'];

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
  it('lists exactly the types of the plan with positive, plausible dimensions', () => {
    expect(Object.keys(AIRCRAFT_TYPES)).toEqual(PLAN_TYPES);
    expect(Object.isFrozen(AIRCRAFT_TYPES) && Object.isFrozen(AIRCRAFT_TYPES.B38M)).toBe(true);
    for (const code of PLAN_TYPES) {
      const spec = AIRCRAFT_TYPES[code];
      expectPlausible(spec, code);
      // Jets fly with swept wings; propellers and rotors keep a straight one.
      if (STRAIGHT_WINGED.includes(spec.family)) expect(spec.wingSweepDeg, code).toBeLessThan(10);
      else expect(spec.wingSweepDeg, code).toBeGreaterThanOrEqual(20);
    }
    // Spot checks against the manufacturers' figures (length × span × height).
    expect(AIRCRAFT_TYPES.B38M).toMatchObject({ lengthM: 39.52, spanM: 35.92, heightM: 12.29 });
    expect(AIRCRAFT_TYPES.B739).toMatchObject({ lengthM: 42.11, spanM: 35.79, heightM: 12.55, family: 'twinUnderwing' });
    expect(AIRCRAFT_TYPES.E195).toMatchObject({ lengthM: 38.65, spanM: 28.72, heightM: 10.55 });
    expect(AIRCRAFT_TYPES.B77W).toMatchObject({ lengthM: 73.86, spanM: 64.8, iconCategory: 'wide2' });
    expect(AIRCRAFT_TYPES.A319).toMatchObject({ lengthM: 33.84, spanM: 35.8, heightM: 11.76 });
    expect(AIRCRAFT_TYPES.A388).toMatchObject({ lengthM: 72.72, spanM: 79.75, heightM: 24.09 });
    expect(AIRCRAFT_TYPES.DH8D).toMatchObject({ lengthM: 32.83, spanM: 28.42, heightM: 8.34 });
    expect(AIRCRAFT_TYPES.GLF5).toMatchObject({ lengthM: 29.39, spanM: 28.5, heightM: 7.87 });
    // A helicopter's length runs with its rotors turning and its span is the main rotor's diameter.
    expect(AIRCRAFT_TYPES.AS50).toMatchObject({ lengthM: 12.94, spanM: 10.69, heightM: 3.34 });
    // The 747-400 and the Cessna 172 are the generic airframes of their categories.
    expect(AIRCRAFT_TYPES.B744).toEqual(CATEGORY_FALLBACKS.heavy4);
    expect(AIRCRAFT_TYPES.C172).toEqual(CATEGORY_FALLBACKS.light);

    // The categories and families of the plan: narrow and twin wide bodies, four engines, the rear-engined CRJ, the
    // turboprops on a high and on a low wing, business jets, a light single and helicopters.
    expect(PLAN_TYPES.filter(code => AIRCRAFT_TYPES[code].iconCategory === 'wide2'))
      .toEqual(['B763', 'B772', 'B77W', 'A332', 'A333', 'A339', 'A359', 'B788', 'B789']);
    const builtAs = code => [AIRCRAFT_TYPES[code].family, AIRCRAFT_TYPES[code].iconCategory];
    expect(['B744', 'A388'].map(builtAs)).toEqual([['quadUnderwing', 'heavy4'], ['quadUnderwing', 'heavy4']]);
    expect(builtAs('CRJ9')).toEqual(['rearTwinT', 'regional']);
    expect(['AT76', 'DH8D'].map(builtAs)).toEqual([['turbopropHigh', 'turboprop'], ['turbopropHigh', 'turboprop']]);
    expect(['B350', 'B190'].map(builtAs)).toEqual([['turbopropLow', 'turboprop'], ['turbopropLow', 'turboprop']]);
    expect(['CL35', 'GLF5'].map(builtAs)).toEqual([['bizjet', 'bizjet'], ['bizjet', 'bizjet']]);
    expect(builtAs('C172')).toEqual(['pistonSingle', 'light']);
    expect(['AS50', 'EC35'].map(builtAs)).toEqual([['helicopter', 'heli'], ['helicopter', 'heli']]);
    // Every family but the dart of an unknown aircraft has a type in the table.
    expect(new Set(PLAN_TYPES.map(code => AIRCRAFT_TYPES[code].family)))
      .toEqual(new Set(AIRCRAFT_FAMILIES.filter(family => family !== 'dart')));

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
    // The types PR M7 added are exact now: they no longer borrow their category's airframe.
    expect(resolveAircraftType({ typeIcao: 'A319', sizeCategory: 'Narrowbody', emitterCategory: 'A5' }))
      .toEqual({ code: 'A319', spec: AIRCRAFT_TYPES.A319, iconCategory: 'narrow', approximate: false });
    expect(resolveAircraftType({ typeIcao: 'B744', emitterCategory: 'A5' }))
      .toEqual({ code: 'B744', spec: AIRCRAFT_TYPES.B744, iconCategory: 'heavy4', approximate: false });
    expect(resolveAircraftType({ typeIcao: 'DH8D', sizeCategory: 'Narrowbody', emitterCategory: 'A3' }))
      .toEqual({ code: 'DH8D', spec: AIRCRAFT_TYPES.DH8D, iconCategory: 'turboprop', approximate: false });

    // A model text names its type: «737 MAX 8» is B38M, «A321neo» A21N, never the ceo or the -800.
    expect(resolveAircraftType({ model: '737 MAX 8' })).toMatchObject({ code: 'B38M', approximate: false });
    expect(resolveAircraftType({ typeIcao: null, model: 'A321neo' })).toMatchObject({ code: 'A21N', approximate: false });
    expect([
      'Boeing 737-800', 'B737 MAX 8', 'A320-200', 'A320neo', 'A321-200', 'Airbus A330-300', 'A350-900', '787-9 Dreamliner',
      '777-300ER', 'Embraer 195', 'ERJ-190', 'A220-300', 'CRJ900', 'ATR 72-600', '757-200', '767-300ER', '737-700',
      'Boeing 737-900ER',
    ].map(typeFromModel)).toEqual([
      'B738', 'B38M', 'A320', 'A20N', 'A321', 'A333', 'A359', 'B789', 'B77W', 'E195', 'E190', 'BCS3', 'CRJ9', 'AT76',
      'B752', 'B763', 'B737', 'B739',
    ]);
    expect([
      'Airbus A319-100', 'Boeing 777-200ER', 'A330-200', 'Airbus A330-900', 'A330neo', 'Boeing 747-400', 'Airbus A380-800',
      'Q400', 'Dash 8-400', 'De Havilland Canada DHC-8-402 Dash 8', 'Beechcraft King Air 350', 'Beechcraft 1900D', '1900D',
      'Bombardier Challenger 350', 'Gulfstream G550', 'Gulfstream V', 'Cessna 172S', 'Skyhawk', 'Airbus H125', 'AS350 B3',
      'H135', 'Eurocopter EC135 T2',
    ].map(typeFromModel)).toEqual([
      'A319', 'B772', 'A332', 'A339', 'A339', 'B744', 'A388', 'DH8D', 'DH8D', 'DH8D', 'B350', 'B190', 'B190', 'CL35', 'GLF5',
      'GLF5', 'C172', 'C172', 'AS50', 'AS50', 'EC35', 'EC35',
    ]);
    // A number is never read inside a longer one, and a neighbour of a type is not that type.
    expect(['A3200', '1737-800', '7378', 'Cessna 1720', '777-300', 'A330-800', 'Dash 8-300', 'Gulfstream VI', 'H1250', '',
      null, 42].map(typeFromModel)).toEqual(Array(12).fill(null));

    // A known designator outside the table keeps the shape of its category: four engines, a turboprop, a rear-engined jet.
    expect(resolveAircraftType({ typeIcao: 'A346', emitterCategory: 'A5' }))
      .toEqual({ code: null, spec: CATEGORY_FALLBACKS.heavy4, iconCategory: 'heavy4', approximate: true });
    expect(resolveAircraftType({ typeIcao: 'AT72', sizeCategory: 'Narrowbody', emitterCategory: 'A3' }))
      .toMatchObject({ code: null, iconCategory: 'turboprop', approximate: true });
    expect(resolveAircraftType({ typeIcao: 'E145', emitterCategory: 'A2' }))
      .toMatchObject({ code: null, iconCategory: 'regional', approximate: true });

    // The size category of the ELEVANT flight, then the ADS-B emitter category.
    expect(resolveAircraftType({ typeIcao: 'B736', sizeCategory: 'Narrowbody', emitterCategory: 'A5' }))
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

  it('no designator is both in the table and in the category list', () => {
    expect(Object.isFrozen(DESIGNATOR_CATEGORIES)).toBe(true);
    expect(Object.keys(DESIGNATOR_CATEGORIES).filter(code => Object.hasOwn(AIRCRAFT_TYPES, code))).toEqual([]);
    // The list still holds the shapes the emitter category gets wrong, each with a category the icons draw.
    expect(Object.keys(DESIGNATOR_CATEGORIES)).toEqual(expect.arrayContaining(['A346', 'B748', 'AT72', 'DH8C', 'E145']));
    for (const [code, category] of Object.entries(DESIGNATOR_CATEGORIES)) {
      expect(['heavy4', 'turboprop', 'regional'], code).toContain(category);
      expect(resolveAircraftType({ typeIcao: code }), code).toMatchObject({ code: null, iconCategory: category, approximate: true });
    }
    // Every designator of the table resolves to its own row.
    for (const code of PLAN_TYPES) {
      expect(resolveAircraftType({ typeIcao: code, emitterCategory: 'A1' }), code)
        .toEqual({ code, spec: AIRCRAFT_TYPES[code], iconCategory: AIRCRAFT_TYPES[code].iconCategory, approximate: false });
    }
  });
});
