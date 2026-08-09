import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useReviewSelection } from './useReviewSelection';

describe('useReviewSelection', () => {
  it('starts with nothing selected', () => {
    const { result } = renderHook(() => useReviewSelection());
    expect(result.current.selectedCount).toBe(0);
    expect(result.current.isSelected('REV-1')).toBe(false);
  });

  it('toggles a single id in and out of the selection', () => {
    const { result } = renderHook(() => useReviewSelection());
    act(() => result.current.toggle('REV-1'));
    expect(result.current.isSelected('REV-1')).toBe(true);
    expect(result.current.selectedCount).toBe(1);

    act(() => result.current.toggle('REV-1'));
    expect(result.current.isSelected('REV-1')).toBe(false);
    expect(result.current.selectedCount).toBe(0);
  });

  it('toggleAll selects every visible id when none are selected yet', () => {
    const { result } = renderHook(() => useReviewSelection());
    act(() => result.current.toggleAll(['REV-1', 'REV-2', 'REV-3']));
    expect(result.current.selectedCount).toBe(3);
  });

  it('toggleAll clears the selection when every visible id is already selected', () => {
    const { result } = renderHook(() => useReviewSelection());
    act(() => result.current.toggleAll(['REV-1', 'REV-2']));
    act(() => result.current.toggleAll(['REV-1', 'REV-2']));
    expect(result.current.selectedCount).toBe(0);
  });

  it('clear empties the selection', () => {
    const { result } = renderHook(() => useReviewSelection());
    act(() => result.current.toggle('REV-1'));
    act(() => result.current.clear());
    expect(result.current.selectedCount).toBe(0);
  });
});
