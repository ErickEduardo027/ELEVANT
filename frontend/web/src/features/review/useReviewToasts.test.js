import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useReviewToasts } from './useReviewToasts';

describe('useReviewToasts', () => {
  it('starts with no toasts', () => {
    const { result } = renderHook(() => useReviewToasts());
    expect(result.current.toasts).toEqual([]);
  });

  it('pushToast enqueues a toast with the given message and kind', () => {
    const { result } = renderHook(() => useReviewToasts());
    act(() => {
      result.current.pushToast('Operación aprobada correctamente.', 'success');
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]).toEqual(
      expect.objectContaining({ message: 'Operación aprobada correctamente.', kind: 'success' })
    );
  });

  it('dismissToast removes a toast by id', () => {
    const { result } = renderHook(() => useReviewToasts());
    let id;
    act(() => {
      id = result.current.pushToast('Devuelta con correcciones.', 'info');
    });
    act(() => result.current.dismissToast(id));
    expect(result.current.toasts).toEqual([]);
  });

  it('auto-dismisses a toast after its TTL', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useReviewToasts());
    act(() => {
      result.current.pushToast('Operación aprobada correctamente.');
    });
    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(result.current.toasts).toHaveLength(0);
    vi.useRealTimers();
  });
});
