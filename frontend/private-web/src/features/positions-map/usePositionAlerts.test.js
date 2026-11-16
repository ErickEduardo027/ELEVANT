import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePositionAlerts } from './usePositionAlerts';

function position(overrides) {
  return { id: 'A10', status: 'available', combinedConfiguration: null, ...overrides };
}

describe('usePositionAlerts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('enqueues no toasts on the first render (nothing to diff against yet)', () => {
    const { result } = renderHook(() => usePositionAlerts([position({ status: 'disabled', combinedConfiguration: '9-Alfa' })]));
    expect(result.current.toasts).toHaveLength(0);
  });

  it('enqueues a toast when a position becomes disabled by a combined configuration', () => {
    const { result, rerender } = renderHook(({ positions }) => usePositionAlerts(positions), {
      initialProps: { positions: [position({ status: 'occupied' })] },
    });

    rerender({ positions: [position({ status: 'disabled', combinedConfiguration: '9-Alfa' })] });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]).toEqual(
      expect.objectContaining({ kind: 'disabled', title: 'Posición A10 inhabilitada', description: 'Configuración 9-Alfa activa.' })
    );
  });

  it('never invents the relation: does not toast a disabled position with no combined configuration', () => {
    const { result, rerender } = renderHook(({ positions }) => usePositionAlerts(positions), {
      initialProps: { positions: [position({ status: 'occupied' })] },
    });

    rerender({ positions: [position({ status: 'disabled', combinedConfiguration: null })] });

    expect(result.current.toasts).toHaveLength(0);
  });

  it('does not re-toast a position that was already disabled', () => {
    const { result, rerender } = renderHook(({ positions }) => usePositionAlerts(positions), {
      initialProps: { positions: [position({ status: 'disabled', combinedConfiguration: '9-Alfa' })] },
    });

    rerender({ positions: [position({ status: 'disabled', combinedConfiguration: '9-Alfa' })] });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('auto-dismisses a toast after 6 seconds', () => {
    const { result, rerender } = renderHook(({ positions }) => usePositionAlerts(positions), {
      initialProps: { positions: [position({ status: 'occupied' })] },
    });
    rerender({ positions: [position({ status: 'disabled', combinedConfiguration: '9-Alfa' })] });
    expect(result.current.toasts).toHaveLength(1);

    act(() => vi.advanceTimersByTime(6000));
    expect(result.current.toasts).toHaveLength(0);
  });

  it('dismissToast removes a toast immediately', () => {
    const { result, rerender } = renderHook(({ positions }) => usePositionAlerts(positions), {
      initialProps: { positions: [position({ status: 'occupied' })] },
    });
    rerender({ positions: [position({ status: 'disabled', combinedConfiguration: '9-Alfa' })] });
    const id = result.current.toasts[0].id;

    act(() => result.current.dismissToast(id));
    expect(result.current.toasts).toHaveLength(0);
  });

  it('enqueues one error toast when the connection transitions into disconnected', () => {
    const { result, rerender } = renderHook(({ connection }) => usePositionAlerts([position()], connection), {
      initialProps: { connection: 'connected' },
    });
    expect(result.current.toasts).toHaveLength(0);

    rerender({ connection: 'disconnected' });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].kind).toBe('error');
  });

  it('does not enqueue an error toast when connection starts out disconnected on the very first render', () => {
    const { result } = renderHook(() => usePositionAlerts([position()], 'disconnected'));
    expect(result.current.toasts).toHaveLength(0);
  });
});