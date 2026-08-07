import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useFlightMonitoringData } from './useFlightMonitoringData';
import * as flightMonitoringService from '../../services/flightMonitoringService';

describe('useFlightMonitoringData', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  it('starts in loading/syncing state then resolves to success/connected', async () => {
    const snapshot = { station: { code: 'PUJ' }, flights: [{ id: 1, latitude: 18, longitude: -68 }] };
    vi.spyOn(flightMonitoringService, 'getFlightMonitoringSnapshot').mockResolvedValue(snapshot);
    vi.spyOn(flightMonitoringService, 'subscribeToFlightUpdates').mockReturnValue(() => {});

    const { result } = renderHook(() => useFlightMonitoringData('PUJ'));
    expect(result.current.status).toBe('loading');
    expect(result.current.connection).toBe('syncing');

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data).toEqual(snapshot);
    expect(result.current.connection).toBe('connected');
    expect(result.current.lastUpdatedAt).not.toBeNull();
  });

  it('moves to error/disconnected when the snapshot fetch rejects', async () => {
    vi.spyOn(flightMonitoringService, 'getFlightMonitoringSnapshot').mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useFlightMonitoringData('PUJ'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.connection).toBe('disconnected');
    expect(result.current.data).toBeNull();
  });

  it('merges an incoming update into the matching flight by id, leaving others untouched', async () => {
    const snapshot = {
      station: { code: 'PUJ' },
      flights: [
        { id: 1, latitude: 18, longitude: -68, heading: 90 },
        { id: 2, latitude: 20, longitude: -70, heading: 45 },
      ],
    };
    vi.spyOn(flightMonitoringService, 'getFlightMonitoringSnapshot').mockResolvedValue(snapshot);
    let emitUpdate;
    vi.spyOn(flightMonitoringService, 'subscribeToFlightUpdates').mockImplementation(onUpdate => {
      emitUpdate = onUpdate;
      return () => {};
    });

    const { result } = renderHook(() => useFlightMonitoringData('PUJ'));
    await waitFor(() => expect(result.current.status).toBe('success'));

    act(() => emitUpdate({ id: 1, latitude: 18.02, longitude: -68, heading: 91 }));

    await waitFor(() => expect(result.current.data.flights[0].latitude).toBe(18.02));
    expect(result.current.data.flights[1]).toEqual(snapshot.flights[1]);
  });

  it('re-fetches when refreshToken changes', async () => {
    const spy = vi
      .spyOn(flightMonitoringService, 'getFlightMonitoringSnapshot')
      .mockResolvedValue({ station: { code: 'PUJ' }, flights: [] });
    vi.spyOn(flightMonitoringService, 'subscribeToFlightUpdates').mockReturnValue(() => {});

    const { rerender } = renderHook(({ token }) => useFlightMonitoringData('PUJ', token), {
      initialProps: { token: 0 },
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    rerender({ token: 1 });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });
});
