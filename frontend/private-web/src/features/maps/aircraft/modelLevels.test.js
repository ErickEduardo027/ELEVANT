import { describe, expect, it } from 'vitest';
import { L1_HYSTERESIS, L1_MIN_PX, detailLevel, instancedLevel, metresPerPixel, wantsL1 } from './modelLevels';

// The levels of detail of the 3D layer (PR M5): procedural far away, L1 once a type's aircraft are drawn large enough
// and its model has loaded, L2 for the detailed aircraft once its model has loaded.
describe('modelLevels', () => {
  it('measures the map in metres per CSS pixel (Web Mercator, 512 px world)', () => {
    expect(metresPerPixel(0, 0)).toBeCloseTo(40_075_016.686 / 512, 6);
    expect(metresPerPixel(10, 0)).toBeCloseTo(40_075_016.686 / 512 / 1024, 9);
    expect(metresPerPixel(10, 60)).toBeCloseTo(metresPerPixel(10, 0) / 2, 9);
    expect(metresPerPixel(undefined, 18.5)).toBeNaN();
    expect(metresPerPixel(16, null)).toBeNaN();
  });

  it('draws a type with its L1 model from L1_MIN_PX long on screen, once loaded, and comes back below the hysteresis', () => {
    const lengthM = 40;
    const at = pixels => lengthM / pixels;
    expect(instancedLevel({ lengthM, metresPerPixel: at(L1_MIN_PX), hasModel: true })).toBe('l1');
    expect(instancedLevel({ lengthM, metresPerPixel: at(L1_MIN_PX - 1), hasModel: true })).toBe('procedural');
    // Not loaded yet (or no model): procedural at any size.
    expect(instancedLevel({ lengthM, metresPerPixel: at(400), hasModel: false })).toBe('procedural');
    // Once on L1, it stays down to the hysteresis' share of the threshold, so a zoom about it does not flicker.
    const between = at(((1 + L1_HYSTERESIS) / 2) * L1_MIN_PX);
    expect(instancedLevel({ lengthM, metresPerPixel: between, hasModel: true, current: 'l1' })).toBe('l1');
    expect(instancedLevel({ lengthM, metresPerPixel: between, hasModel: true, current: 'procedural' })).toBe('procedural');
    expect(instancedLevel({ lengthM, metresPerPixel: at(L1_HYSTERESIS * L1_MIN_PX - 1), hasModel: true, current: 'l1' }))
      .toBe('procedural');
    // Without a scale or a length nothing changes.
    expect(instancedLevel({ lengthM, metresPerPixel: Number.NaN, hasModel: true })).toBe('procedural');
    expect(instancedLevel({ lengthM: 0, metresPerPixel: 0.1, hasModel: true })).toBe('procedural');
    expect(instancedLevel()).toBe('procedural');
  });

  it('asks for the L1 model only when it would be drawn, and an A320 parked at Punta Cana wants it from about zoom 17', () => {
    expect(wantsL1({ lengthM: 40, metresPerPixel: 40 / (2 * L1_MIN_PX) })).toBe(true);
    expect(wantsL1({ lengthM: 40, metresPerPixel: 40 / (L1_MIN_PX / 2) })).toBe(false);
    const lat = 18.567;
    expect(wantsL1({ lengthM: 37.57, metresPerPixel: metresPerPixel(15, lat) })).toBe(false);
    expect(wantsL1({ lengthM: 37.57, metresPerPixel: metresPerPixel(17, lat) })).toBe(true);
  });

  it('draws the detailed aircraft with its L2 model once loaded', () => {
    expect(detailLevel({ hasModel: true })).toBe('l2');
    expect(detailLevel({ hasModel: false })).toBe('procedural');
    expect(detailLevel()).toBe('procedural');
  });
});
