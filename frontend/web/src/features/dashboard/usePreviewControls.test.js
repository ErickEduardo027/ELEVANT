import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePreviewControls } from './usePreviewControls';

describe('usePreviewControls', () => {
  it('starts in light theme and default force state', () => {
    const { result } = renderHook(() => usePreviewControls());
    expect(result.current.theme).toBe('light');
    expect(result.current.forceState).toBe('default');
  });

  it('toggles the theme between light and dark', () => {
    const { result } = renderHook(() => usePreviewControls());
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe('dark');
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe('light');
  });

  it('sets the forced preview state', () => {
    const { result } = renderHook(() => usePreviewControls());
    act(() => result.current.setForceState('flyAwareError'));
    expect(result.current.forceState).toBe('flyAwareError');
  });
});
