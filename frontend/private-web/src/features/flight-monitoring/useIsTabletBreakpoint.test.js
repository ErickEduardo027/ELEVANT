import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIsTabletBreakpoint } from './useIsTabletBreakpoint';

function mockMatchMedia(matchingQueries) {
  window.matchMedia = vi.fn().mockImplementation(query => ({
    matches: matchingQueries.includes(query),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('useIsTabletBreakpoint', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('is false when the tablet media query does not match', () => {
    mockMatchMedia([]);
    const { result } = renderHook(() => useIsTabletBreakpoint());
    expect(result.current).toBe(false);
  });

  it('is true when the tablet media query matches', () => {
    mockMatchMedia(['(max-width: 1023.98px)']);
    const { result } = renderHook(() => useIsTabletBreakpoint());
    expect(result.current).toBe(true);
  });

  it('defaults to false when matchMedia is unavailable', () => {
    window.matchMedia = undefined;
    const { result } = renderHook(() => useIsTabletBreakpoint());
    expect(result.current).toBe(false);
  });
});