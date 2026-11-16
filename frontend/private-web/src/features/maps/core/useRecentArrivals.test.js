import { readFileSync } from 'node:fs';
import { StrictMode } from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { destinationPoint, METRES_PER_NM } from '../airport/geo';
import { runwayEnds } from '../airport/runwayInUse';
import { useRecentArrivals } from './useRecentArrivals';

// The votes the map keeps for its runway in use (contracts 2.3): synthetic live aircraft on final of a runway end of the
// MDPC layout, read at the minutes of a server clock.
const NOON = Date.parse('2026-11-13T16:00:00Z');
const MINUTE = 60 * 1000;
function onFinal(ident, nm, extra = {}) {
  const end = runwayEnds(MDPC_LAYOUT).find(item => item.ident === ident);
  const [lon, lat] = destinationPoint(end.threshold, (end.headingTrue + 180) % 360, nm * METRES_PER_NM);
  return { id: `h:${extra.hex}`, quality: 'live', onGround: false, altM: nm * 100, trackDeg: end.headingTrue,
    vrateMs: -3.5, lon, lat, ...extra };
}
const keysOf = votes => votes.map(vote => `${vote.key}:${vote.ident}`);

describe('useRecentArrivals', () => {
  it('keeps the votes of the arrivals seen on final for ten minutes of the server clock, from one picture to the next', () => {
    const arrival = onFinal('26', 4, { hex: 'aa0001', positionAt: NOON });
    const { result, rerender } = renderHook(({ aircraft, nowMs }) => useRecentArrivals(aircraft, { layout: MDPC_LAYOUT, nowMs }),
      { initialProps: { aircraft: [arrival], nowMs: NOON } });
    expect(keysOf(result.current)).toEqual(['aa0001:26']);
    // The same picture at the same minute: the same list.
    const first = result.current;
    rerender({ aircraft: [arrival], nowMs: NOON });
    expect(keysOf(result.current)).toEqual(['aa0001:26']);
    // The aircraft lands and leaves the picture: its vote stays.
    rerender({ aircraft: [{ ...arrival, onGround: true, altM: 0, positionAt: NOON + 2 * MINUTE }], nowMs: NOON + 2 * MINUTE });
    rerender({ aircraft: [], nowMs: NOON + 5 * MINUTE });
    expect(result.current).toEqual(first);
    // Another arrival joins it; ten minutes after its last position on final the first one goes.
    rerender({ aircraft: [onFinal('26', 6, { hex: 'aa0002', positionAt: NOON + 7 * MINUTE })], nowMs: NOON + 7 * MINUTE });
    expect(keysOf(result.current)).toEqual(['aa0001:26', 'aa0002:26']);
    rerender({ aircraft: [], nowMs: NOON + 11 * MINUTE });
    expect(keysOf(result.current)).toEqual(['aa0002:26']);
    rerender({ aircraft: [], nowMs: NOON + 18 * MINUTE });
    expect(result.current).toEqual([]);
  });

  it('gives the same list for the same inputs, and starts over with another layout', () => {
    const arrival = onFinal('08', 5, { hex: 'aa0003', positionAt: NOON });
    const aircraft = [arrival];
    let renders = 0;
    const { result, rerender } = renderHook(({ layout }) => {
      renders += 1;
      return useRecentArrivals(aircraft, { layout, nowMs: NOON });
    }, { initialProps: { layout: MDPC_LAYOUT }, wrapper: StrictMode });
    const votes = result.current;
    expect(keysOf(votes)).toEqual(['aa0003:08']);
    rerender({ layout: MDPC_LAYOUT });
    expect(result.current).toBe(votes);
    // A layout without runways has no final: the votes of the other layout do not carry over.
    const before = renders;
    rerender({ layout: { runways: [] } });
    expect(result.current).toEqual([]);
    // It settles in one adjustment: no render loop.
    expect(renders - before).toBeLessThanOrEqual(4);
    // No clock and no request: the instant is a parameter.
    expect(readFileSync('src/features/maps/core/useRecentArrivals.js', 'utf8')).not.toMatch(/Date\.now|new Date\(\)|fetch\(|setTimeout/);
  });
});
