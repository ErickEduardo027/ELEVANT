import { describe, expect, it } from 'vitest';
import { PERF_CATEGORIES, PERF_PROFILES, perfFor } from './perfProfiles.js';
import { NM, fpmToMs, ftToM, ktToMs, msToKt } from './units.js';

// Every leaf of a profile as `group.key`.
function leaves(profile, prefix = '') {
  return Object.entries(profile).flatMap(([key, value]) => (value !== null && typeof value === 'object'
    ? leaves(value, `${prefix}${key}.`)
    : [[`${prefix}${key}`, value]]));
}

describe('performance profiles', () => {
  it('narrow-body values match design F2 in SI units', () => {
    const narrow = PERF_PROFILES.narrow;
    // En route, descent and approach.
    expect(narrow.cruise.speedMs).toBeCloseTo(ktToMs(450), 9);
    expect(narrow.cruise.altM).toBeCloseTo(ftToM(36_000), 9);
    expect(narrow.descent.highSpeedMs).toBeCloseTo(ktToMs(290), 9);
    expect(narrow.descent.lowSpeedMs).toBeCloseTo(ktToMs(250), 9);
    expect(narrow.descent.transitionAltM).toBeCloseTo(ftToM(10_000), 9);
    // 3 NM per 1 000 ft: about 18.2 m flown per metre lost.
    expect(narrow.descent.ratio).toBeCloseTo((3 * NM) / ftToM(1_000), 9);
    expect(narrow.descent.ratio).toBeCloseTo(18.23, 2);
    expect(narrow.approach.speedMs).toBeCloseTo(ktToMs(180), 9);
    // The final: 180 to 137 kt on 3°, 50 ft over the threshold; touchdown 300 m beyond it.
    expect(narrow.final.startSpeedMs).toBeCloseTo(ktToMs(180), 9);
    expect(narrow.final.vrefMs).toBeCloseTo(ktToMs(137), 9);
    expect(narrow.final.glideDeg).toBe(3);
    expect(narrow.final.thresholdCrossM).toBeCloseTo(ftToM(50), 9);
    expect(narrow.landing).toEqual({ touchdownAlongM: 300, brakingMs2: 1.8, brakingMinMs2: 1.2, brakingMaxMs2: 2.5, exitSpeedMs: 15 });
    // Taxi: 16 kt straight, 9 kt in turns, 5 kt on the lead-in, fitted between 5 and 25 kt.
    expect(msToKt(narrow.taxi.straightMs)).toBeCloseTo(16, 9);
    expect(msToKt(narrow.taxi.turnMs)).toBeCloseTo(9, 9);
    expect(msToKt(narrow.taxi.leadInMs)).toBeCloseTo(5, 9);
    expect([msToKt(narrow.taxi.minMs), msToKt(narrow.taxi.maxMs)].map(value => Math.round(value * 1e9) / 1e9)).toEqual([5, 25]);
    // Pushback 1.5 m/s (2 at most) and a 60 s engine start; a 20 s hold, a 10 kt line-up, 2.2 m/s² to 148 kt.
    expect(narrow.pushback).toMatchObject({ speedMs: 1.5, maxSpeedMs: 2, engineStartS: 60 });
    expect(narrow.takeoff.holdShortS).toBe(20);
    expect(msToKt(narrow.takeoff.lineUpMs)).toBeCloseTo(10, 9);
    expect(narrow.takeoff.accelMs2).toBe(2.2);
    expect(narrow.takeoff.liftoffMs).toBeCloseTo(ktToMs(148), 9);
    // Climb: 2 500 ft/min from 160 to 270 kt, the turn at 1 500 ft, drawn 250 NM, 25° of bank.
    expect(narrow.climb.rateMs).toBeCloseTo(fpmToMs(2_500), 9);
    expect(narrow.climb.startSpeedMs).toBeCloseTo(ktToMs(160), 9);
    expect(narrow.climb.endSpeedMs).toBeCloseTo(ktToMs(270), 9);
    expect(narrow.climb.turnAltM).toBeCloseTo(ftToM(1_500), 9);
    expect(narrow.climb.maxDistanceM).toBe(250 * NM);
    expect(narrow.climb.bankDeg).toBe(25);
    expect(Object.isFrozen(PERF_PROFILES) && Object.isFrozen(narrow.taxi)).toBe(true);
  });

  it('every category is complete and positive, and a wide-body lands faster than a turboprop', () => {
    expect(PERF_CATEGORIES).toEqual(['narrow', 'wide', 'regional', 'turboprop']);
    expect(Object.keys(PERF_PROFILES)).toEqual([...PERF_CATEGORIES]);
    const shape = leaves(PERF_PROFILES.narrow).map(([key]) => key);
    for (const category of PERF_CATEGORIES) {
      const values = leaves(PERF_PROFILES[category]);
      expect(values.map(([key]) => key), category).toEqual(shape);
      for (const [key, value] of values) {
        expect(Number.isFinite(value) && value > 0, `${category} ${key} = ${value}`).toBe(true);
      }
      // Every taxi target is inside the range a fit may scale it to.
      const { taxi } = PERF_PROFILES[category];
      for (const speed of [taxi.straightMs, taxi.turnMs, taxi.leadInMs]) {
        expect(speed).toBeGreaterThanOrEqual(taxi.minMs - 1e-9);
        expect(speed).toBeLessThanOrEqual(taxi.maxMs);
      }
    }
    const { wide, regional, turboprop } = PERF_PROFILES;
    // The design's own numbers for each category.
    expect([wide.final.vrefMs, wide.takeoff.liftoffMs, wide.cruise.speedMs].map(msToKt).map(Math.round)).toEqual([145, 165, 490]);
    expect(wide.takeoff.accelMs2).toBe(1.9);
    expect(wide.climb.rateMs).toBeCloseTo(fpmToMs(2_000), 9);
    expect([regional.final.vrefMs, regional.takeoff.liftoffMs, regional.cruise.speedMs].map(msToKt).map(Math.round)).toEqual([130, 140, 420]);
    expect([turboprop.final.vrefMs, turboprop.takeoff.liftoffMs, turboprop.cruise.speedMs].map(msToKt).map(Math.round)).toEqual([110, 115, 275]);
    expect(turboprop.cruise.altM).toBeCloseTo(ftToM(25_000), 9);
    expect(turboprop.climb.rateMs).toBeCloseTo(fpmToMs(1_500), 9);
    // The rest scales with them: a turboprop approaches slower than a wide-body and never descends above 250 kt.
    expect(wide.final.vrefMs).toBeGreaterThan(turboprop.final.vrefMs);
    expect(wide.approach.speedMs).toBeGreaterThan(PERF_PROFILES.narrow.approach.speedMs);
    expect(turboprop.approach.speedMs).toBeLessThan(regional.approach.speedMs);
    for (const category of PERF_CATEGORIES) {
      const profile = PERF_PROFILES[category];
      expect(profile.descent.lowSpeedMs).toBeLessThanOrEqual(ktToMs(250) + 1e-9);
      expect(profile.approach.speedMs).toBeGreaterThan(profile.final.vrefMs);
      expect(profile.takeoff.liftoffMs).toBeGreaterThan(profile.final.vrefMs);
    }
  });

  it('perfFor picks by ICAO type, then by size category, then narrow-body', () => {
    expect(['A20N', 'A320', 'A321', 'B738', 'B38M', 'B739'].map(typeIcao => perfFor({ typeIcao }).category))
      .toEqual(Array(6).fill('narrow'));
    expect(['E190', 'E195', 'CRJ9'].map(typeIcao => perfFor({ typeIcao }).category)).toEqual(Array(3).fill('regional'));
    expect(['AT76', 'AT72', 'DH8D'].map(typeIcao => perfFor({ typeIcao }).category)).toEqual(Array(3).fill('turboprop'));
    expect(['B77W', 'B789', 'A333', 'A359'].map(typeIcao => perfFor({ typeIcao }).category)).toEqual(Array(4).fill('wide'));
    // The map flights' own field name and any case; the type wins over the size category.
    expect(perfFor({ typeIcaoCode: ' at76 ' }).category).toBe('turboprop');
    expect(perfFor({ typeIcao: 'E190', sizeCategory: 'Widebody' }).category).toBe('regional');
    // An unknown type falls back on the size category, then on a narrow-body.
    expect(perfFor({ typeIcao: 'B744', sizeCategory: 'Widebody' }).category).toBe('wide');
    expect(perfFor({ typeIcao: 'ZZZZ', sizeCategory: 'Narrowbody' }).category).toBe('narrow');
    expect(perfFor({ sizeCategory: null }).category).toBe('narrow');
    expect(perfFor().category).toBe('narrow');
    // The profile is the category's, frozen, and the same object every time.
    const wide = perfFor({ typeIcao: 'B789' });
    expect(wide.final).toBe(PERF_PROFILES.wide.final);
    expect(perfFor({ typeIcao: 'A359' })).toBe(wide);
    expect(Object.isFrozen(wide)).toBe(true);
  });
});
