import { describe, expect, it } from 'vitest';
import { METRES_PER_NM } from '../airport/geo.js';
import {
  FPM,
  FT,
  G0,
  KT,
  NM,
  degToRad,
  fpmToMs,
  ftToM,
  ktToMs,
  mToFt,
  mToNm,
  msToFpm,
  msToKt,
  nmToM,
  normalizeDeg,
  radToDeg,
} from './units.js';

describe('units', () => {
  it("conversions round-trip and NM equals geo's METRES_PER_NM", () => {
    expect(NM).toBe(METRES_PER_NM);
    expect(KT).toBeCloseTo(0.514444, 6);
    expect(FT).toBe(0.3048);
    expect(FPM).toBeCloseTo(0.00508, 9);
    expect(G0).toBe(9.80665);

    // Known values: 1 NM per hour is one knot; 1 000 ft is 304.8 m; 600 ft/min is about 3 m/s.
    expect(ktToMs(1)).toBeCloseTo(1852 / 3600, 12);
    expect(ftToM(1000)).toBeCloseTo(304.8, 9);
    expect(nmToM(10)).toBe(18520);
    expect(fpmToMs(600)).toBeCloseTo(3.048, 9);
    expect(degToRad(180)).toBeCloseTo(Math.PI, 12);

    for (const value of [0, 0.5, 25, 137, 250, 36000]) {
      expect(msToKt(ktToMs(value))).toBeCloseTo(value, 9);
      expect(mToFt(ftToM(value))).toBeCloseTo(value, 9);
      expect(mToNm(nmToM(value))).toBeCloseTo(value, 9);
      expect(msToFpm(fpmToMs(value))).toBeCloseTo(value, 9);
      expect(radToDeg(degToRad(value))).toBeCloseTo(value, 9);
    }

    // Bearings wrap into [0, 360), negative zero included.
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(-90)).toBe(270);
    expect(normalizeDeg(725)).toBe(5);
    expect(Object.is(normalizeDeg(-0), 0)).toBe(true);
    expect(normalizeDeg(359.5)).toBe(359.5);
  });
});
