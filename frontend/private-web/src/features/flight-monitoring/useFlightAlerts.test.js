import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFlightAlerts } from './useFlightAlerts';

function flight(overrides) {
  return { id: 1, flightNumber: 'DM161', status: 'scheduled', eta: '2026-08-06T08:00:00-04:00', stand: 'A5', ...overrides };
}

describe('useFlightAlerts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('enqueues no toasts on the first render (nothing to diff against yet)', () => {
    const { result } = renderHook(() => useFlightAlerts([flight()]));
    expect(result.current.toasts).toHaveLength(0);
  });

  it('enqueues a toast when a flight becomes delayed', () => {
    const { result, rerender } = renderHook(({ flights }) => useFlightAlerts(flights), {
      initialProps: { flights: [flight({ status: 'scheduled' })] },
    });

    rerender({ flights: [flight({ status: 'delayed' })] });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]).toEqual(
      expect.objectContaining({ kind: 'delayed', flightNumber: 'DM161' })
    );
  });

  it('enqueues a toast when the eta changes', () => {
    const { result, rerender } = renderHook(({ flights }) => useFlightAlerts(flights), {
      initialProps: { flights: [flight({ eta: '2026-08-06T08:00:00-04:00' })] },
    });

    rerender({ flights: [flight({ eta: '2026-08-06T08:30:00-04:00' })] });

    expect(result.current.toasts).toHaveLength(1);
  });

  it('enqueues a toast when the stand is lost', () => {
    const { result, rerender } = renderHook(({ flights }) => useFlightAlerts(flights), {
      initialProps: { flights: [flight({ stand: 'A5' })] },
    });

    rerender({ flights: [flight({ stand: null })] });

    expect(result.current.toasts).toHaveLength(1);
  });

  it('caps visible toasts at 3, keeping the most recent', () => {
    const { result, rerender } = renderHook(({ flights }) => useFlightAlerts(flights), {
      initialProps: {
        flights: [
          flight({ id: 1, status: 'scheduled' }),
          flight({ id: 2, status: 'scheduled' }),
          flight({ id: 3, status: 'scheduled' }),
          flight({ id: 4, status: 'scheduled' }),
        ],
      },
    });

    rerender({
      flights: [
        flight({ id: 1, status: 'delayed' }),
        flight({ id: 2, status: 'cancelled' }),
        flight({ id: 3, status: 'diverted' }),
        flight({ id: 4, status: 'cancelled' }),
      ],
    });

    expect(result.current.toasts).toHaveLength(3);
  });

  it('auto-dismisses a toast after 6 seconds', () => {
    const { result, rerender } = renderHook(({ flights }) => useFlightAlerts(flights), {
      initialProps: { flights: [flight({ status: 'scheduled' })] },
    });

    rerender({ flights: [flight({ status: 'delayed' })] });
    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('dismissToast removes a toast immediately', () => {
    const { result, rerender } = renderHook(({ flights }) => useFlightAlerts(flights), {
      initialProps: { flights: [flight({ status: 'scheduled' })] },
    });

    rerender({ flights: [flight({ status: 'delayed' })] });
    const id = result.current.toasts[0].id;

    act(() => result.current.dismissToast(id));
    expect(result.current.toasts).toHaveLength(0);
  });

  it('enqueues one error toast when the connection transitions into disconnected', () => {
    const { result, rerender } = renderHook(({ connection }) => useFlightAlerts([flight()], connection), {
      initialProps: { connection: 'connected' },
    });
    expect(result.current.toasts).toHaveLength(0);

    rerender({ connection: 'disconnected' });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].kind).toBe('error');
  });

  it('does not enqueue an error toast when connection starts out disconnected on the very first render', () => {
    const { result } = renderHook(() => useFlightAlerts([flight()], 'disconnected'));
    expect(result.current.toasts).toHaveLength(0);
  });

  it('does not re-enqueue while connection stays disconnected across renders', () => {
    const { result, rerender } = renderHook(({ connection }) => useFlightAlerts([flight()], connection), {
      initialProps: { connection: 'connected' },
    });

    rerender({ connection: 'disconnected' });
    expect(result.current.toasts).toHaveLength(1);

    rerender({ connection: 'disconnected' });
    expect(result.current.toasts).toHaveLength(1);
  });
});