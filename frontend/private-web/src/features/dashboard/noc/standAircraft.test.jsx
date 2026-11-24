import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { standAircraftReading, useStandAircraft } from './standAircraft';

// A square stand box around (0, 0) and a stand without an outline, each listing one turnaround.
const BOX = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]];
const STANDS = [
  { id: 'A1', geometry: { polygon: BOX }, turnarounds: [{ turnaroundId: 't-1' }] },
  { id: 'A2', turnarounds: [{ turnaroundId: 't-2' }] },
];
const at = (lng, lat, extra = {}) => ({ position: [lng, lat], onGround: true, gsMs: 0, ...extra });

describe('standAircraftReading', () => {
  it('reads only what the stands read: inside the box, on the ground, still', () => {
    const inside = standAircraftReading(new Map([['t-1', at(0.1, 0.1)]]), STANDS);
    expect(standAircraftReading(new Map([['t-1', at(0.5, -0.2)]]), STANDS)).toBe(inside);
    expect(standAircraftReading(new Map([['t-1', at(3, 3)]]), STANDS)).not.toBe(inside);
    expect(standAircraftReading(new Map([['t-1', at(0.1, 0.1, { onGround: false })]]), STANDS)).not.toBe(inside);
    expect(standAircraftReading(new Map([['t-1', at(0.1, 0.1, { gsMs: 20 })]]), STANDS)).not.toBe(inside);
    // A stand without an outline, or an aircraft of no stand, reads nothing of the position.
    expect(standAircraftReading(new Map([['t-2', at(0, 0)]]), STANDS))
      .toBe(standAircraftReading(new Map([['t-2', at(9, 9)]]), STANDS));
    expect(standAircraftReading(new Map([['t-9', at(0, 0)]]), STANDS)).toBe('');
  });
});

describe('useStandAircraft', () => {
  it('keeps the Map the stands were given while their reading is the same', () => {
    const first = new Map([['t-1', at(0.1, 0.1)]]);
    const { result, rerender } = renderHook(({ aircraft }) => useStandAircraft(aircraft, STANDS),
      { initialProps: { aircraft: first } });
    expect(result.current).toBe(first);
    rerender({ aircraft: new Map([['t-1', at(0.2, 0.3)]]) });
    expect(result.current).toBe(first);
    const left = new Map([['t-1', at(5, 5)]]);
    rerender({ aircraft: left });
    expect(result.current).toBe(left);
  });
});
