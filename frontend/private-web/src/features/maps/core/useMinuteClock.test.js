import { readFileSync } from 'node:fs';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMinuteClock } from './useMinuteClock';

// 11:07 in Punta Cana, 30 s into the minute.
const MINUTE = 60 * 1000;
const NOW = Date.parse('2026-11-13T15:07:00Z');

afterEach(() => {
  vi.useRealTimers();
});

describe('useMinuteClock', () => {
  it('ticks on minute boundaries and holds a frozen instant', () => {
    vi.useFakeTimers({ now: NOW + 30 * 1000 });
    const renders = vi.fn();
    const { result, unmount } = renderHook(() => {
      const minute = useMinuteClock();
      renders(minute);
      return minute;
    });
    // Rounded down to the minute, with one timeout to the next boundary and nothing else.
    expect(result.current).toBe(NOW);
    expect(vi.getTimerCount()).toBe(1);
    const before = renders.mock.calls.length;
    act(() => vi.advanceTimersByTime(29_999));
    expect(result.current).toBe(NOW);
    expect(renders.mock.calls.length).toBe(before);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(NOW + MINUTE);
    // Then once per minute: one render and one timeout at a time, never an interval.
    act(() => vi.advanceTimersByTime(MINUTE));
    expect(result.current).toBe(NOW + 2 * MINUTE);
    expect(renders.mock.calls.length).toBe(before + 2);
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(10 * MINUTE));
    expect(result.current).toBe(NOW + 12 * MINUTE);
    // Gone with the component.
    unmount();
    expect(vi.getTimerCount()).toBe(0);

    // A frozen instant is rounded the same way, holds and starts no timer; freed, the clock runs again.
    const frozen = renderHook(({ frozenAt }) => useMinuteClock({ frozenAt }), { initialProps: { frozenAt: NOW + 25 * 1000 } });
    expect(frozen.result.current).toBe(NOW);
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(5 * MINUTE));
    expect(frozen.result.current).toBe(NOW);
    frozen.rerender({ frozenAt: null });
    expect(frozen.result.current).toBe(NOW + 17 * MINUTE);
    expect(vi.getTimerCount()).toBe(1);
    frozen.unmount();
  });

  it('reads the browser clock only: no request, no animation frame', () => {
    const source = readFileSync('src/features/maps/core/useMinuteClock.js', 'utf8');
    expect(source).not.toMatch(/fetch|elevantApi|setInterval|requestAnimationFrame/);
  });
});
