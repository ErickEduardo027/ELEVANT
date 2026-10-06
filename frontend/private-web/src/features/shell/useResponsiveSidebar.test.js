import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useResponsiveSidebar } from './useResponsiveSidebar';

function mockMatchMedia(matchingQueries) {
  window.matchMedia = vi.fn().mockImplementation(query => ({
    matches: matchingQueries.includes(query),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('useResponsiveSidebar', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    window.localStorage.clear();
  });

  it('defaults to an expanded desktop rail with no overlay', () => {
    mockMatchMedia([]);
    const { result } = renderHook(() => useResponsiveSidebar());
    expect(result.current.breakpoint).toBe('desktop');
    expect(result.current.railVisible).toBe(true);
    expect(result.current.railExpanded).toBe(true);
    expect(result.current.overlayOpen).toBe(false);
  });

  it('toggle collapses and persists the desktop rail', () => {
    mockMatchMedia([]);
    const { result } = renderHook(() => useResponsiveSidebar());

    act(() => result.current.toggle());
    expect(result.current.railExpanded).toBe(false);
    expect(window.localStorage.getItem('elevant-sidebar-expanded')).toBe('false');
  });

  it('restores a persisted collapsed preference on desktop', () => {
    window.localStorage.setItem('elevant-sidebar-expanded', 'false');
    mockMatchMedia([]);
    const { result } = renderHook(() => useResponsiveSidebar());
    expect(result.current.railExpanded).toBe(false);
  });

  it('keeps the rail icon-only on tablet and opens an overlay on toggle instead', () => {
    mockMatchMedia(['(max-width: 1024px)']);
    const { result } = renderHook(() => useResponsiveSidebar());

    expect(result.current.breakpoint).toBe('tablet');
    expect(result.current.railVisible).toBe(true);
    expect(result.current.railExpanded).toBe(false);

    act(() => result.current.toggle());
    expect(result.current.overlayOpen).toBe(true);
    expect(result.current.railExpanded).toBe(false);
  });

  it('hides the inline rail on mobile and drives the drawer via overlayOpen', () => {
    mockMatchMedia(['(max-width: 1024px)', '(max-width: 640px)']);
    const { result } = renderHook(() => useResponsiveSidebar());

    expect(result.current.breakpoint).toBe('mobile');
    expect(result.current.railVisible).toBe(false);

    act(() => result.current.toggle());
    expect(result.current.overlayOpen).toBe(true);

    act(() => result.current.closeOverlay());
    expect(result.current.overlayOpen).toBe(false);
  });
});