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

  it('does not subscribe to updates while forceDisconnected is true, and subscribes once it flips back to false', async () => {
    const snapshot = { station: { code: 'PUJ' }, flights: [{ id: 1, latitude: 18, longitude: -68 }] };
    vi.spyOn(flightMonitoringService, 'getFlightMonitoringSnapshot').mockResolvedValue(snapshot);
    const unsubscribe = vi.fn();
    const subscribeSpy = vi
      .spyOn(flightMonitoringService, 'subscribeToFlightUpdates')
      .mockReturnValue(unsubscribe);

    const { result, rerender } = renderHook(
      ({ forceDisconnected }) => useFlightMonitoringData('PUJ', 0, forceDisconnected),
      { initialProps: { forceDisconnected: true } }
    );
    await waitFor(() => expect(result.current.status).toBe('success'));

    expect(subscribeSpy).not.toHaveBeenCalled();

    rerender({ forceDisconnected: false });
    await waitFor(() => expect(subscribeSpy).toHaveBeenCalledTimes(1));
  });

  it('unsubscribes from updates when forceDisconnected flips from false to true', async () => {
    const snapshot = { station: { code: 'PUJ' }, flights: [{ id: 1, latitude: 18, longitude: -68 }] };
    vi.spyOn(flightMonitoringService, 'getFlightMonitoringSnapshot').mockResolvedValue(snapshot);
    const unsubscribe = vi.fn();
    vi.spyOn(flightMonitoringService, 'subscribeToFlightUpdates').mockReturnValue(unsubscribe);

    const { result, rerender } = renderHook(
      ({ forceDisconnected }) => useFlightMonitoringData('PUJ', 0, forceDisconnected),
      { initialProps: { forceDisconnected: false } }
    );
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(unsubscribe).not.toHaveBeenCalled();

    rerender({ forceDisconnected: true });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
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

  it('hides prior station data immediately and subscribes to the newly selected station', async () => {
    vi.spyOn(flightMonitoringService, 'getFlightMonitoringSnapshot')
      .mockImplementation(async code => ({ station: { code }, flights: [] }));
    const unsubscribe = vi.fn();
    const subscribe = vi.spyOn(flightMonitoringService, 'subscribeToFlightUpdates')
      .mockReturnValue(unsubscribe);
    const renders = [];
    const { result, rerender } = renderHook(({ code }) => {
      const state = useFlightMonitoringData(code);
      renders.push({ code, state });
      return state;
    }, { initialProps: { code: 'PUJ' } });
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(subscribe).toHaveBeenCalledWith(expect.any(Function), 'PUJ',
      expect.objectContaining({ onSnapshot: expect.any(Function), onError: expect.any(Function) }));

    const from = renders.length;
    rerender({ code: 'SDQ' });
    expect(renders.slice(from).every(({ state }) => state.data === null)).toBe(true);
    await waitFor(() => expect(result.current.data?.station.code).toBe('SDQ'));
    expect(unsubscribe).toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalledWith(expect.any(Function), 'SDQ',
      expect.objectContaining({ onSnapshot: expect.any(Function), onError: expect.any(Function) }));
  });

  it('keeps the current flights on screen while a same-station refresh is in flight', async () => {
    const first = { station: { code: 'PUJ' }, flights: [{ id: 1, latitude: 18.7, longitude: -68.5 }] };
    let finishRefresh;
    const read = vi.spyOn(flightMonitoringService, 'getFlightMonitoringSnapshot')
      .mockResolvedValueOnce(first)
      .mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve; }))
      .mockRejectedValueOnce(new Error('network down'));
    vi.spyOn(flightMonitoringService, 'subscribeToFlightUpdates').mockReturnValue(() => {});
    const renders = [];
    const { result, rerender } = renderHook(({ token }) => {
      const state = useFlightMonitoringData('PUJ', token, false, 'occ-one');
      renders.push(state);
      return state;
    }, { initialProps: { token: 0 } });
    await waitFor(() => expect(result.current.status).toBe('success'));

    // A refresh of the same station (focus, the 25 s poll, occ_planning): the flights stay, only the connection syncs.
    const from = renders.length;
    rerender({ token: 1 });
    expect(read).toHaveBeenCalledTimes(2);
    expect(renders.slice(from).length).toBeGreaterThan(0);
    expect(renders.slice(from).every(state => state.status === 'success' && state.data === first)).toBe(true);
    expect(result.current.connection).toBe('syncing');

    await act(async () => finishRefresh({ station: { code: 'PUJ' }, flights: [{ id: 2 }] }));
    expect(result.current).toMatchObject({ status: 'success', connection: 'connected' });
    expect(result.current.data.flights.map(item => item.id)).toEqual([2]);

    // A refresh that fails still takes the old flights away.
    rerender({ token: 2 });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.data).toBeNull();
    expect(result.current.connection).toBe('disconnected');
  });

  it('drops stale flights on poll failure and replaces the collection after recovery', async () => {
    vi.spyOn(flightMonitoringService, 'getFlightMonitoringSnapshot')
      .mockResolvedValue({ station: { code: 'PUJ' }, flights: [{ id: 1 }] });
    let handlers;
    vi.spyOn(flightMonitoringService, 'subscribeToFlightUpdates')
      .mockImplementation((_update, _station, options) => {
        handlers = options;
        return () => {};
      });
    const { result } = renderHook(() => useFlightMonitoringData('PUJ'));
    await waitFor(() => expect(result.current.status).toBe('success'));
    act(() => handlers.onError(new Error('network down')));
    expect(result.current.status).toBe('error');
    expect(result.current.data).toBeNull();
    act(() => handlers.onSnapshot({ station: { code: 'PUJ' }, flights: [{ id: 2 }] }));
    expect(result.current.status).toBe('success');
    expect(result.current.data.flights.map(item => item.id)).toEqual([2]);
  });
});