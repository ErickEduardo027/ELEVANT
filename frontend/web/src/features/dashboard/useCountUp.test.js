import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCountUp } from './useCountUp';

describe('useCountUp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts up to the target value over the given duration', () => {
    const { result } = renderHook(() => useCountUp(90, { duration: 300, steps: 3 }));
    expect(result.current).toBe(0);

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe(90);
  });

  it('jumps immediately to the target when prefers-reduced-motion is set', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: true });

    const { result } = renderHook(() => useCountUp(50));
    expect(result.current).toBe(50);

    window.matchMedia = originalMatchMedia;
  });
});
