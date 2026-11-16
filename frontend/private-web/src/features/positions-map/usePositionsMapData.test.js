import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { usePositionsMapData } from './usePositionsMapData';
import * as service from '../../services/positionsMapService';

beforeEach(() => vi.restoreAllMocks());

it('does not expose a previous station or account snapshot during a switch', async () => {
  vi.spyOn(service, 'getPositionsSnapshot').mockImplementation(async code => ({
    station: { code }, positions: [], source: 'planning',
  }));
  const subscribe = vi.spyOn(service, 'subscribeToPositionUpdates')
    .mockReturnValue(() => {});
  const renders = [];
  const { result, rerender } = renderHook(({ code, account }) => {
    const state = usePositionsMapData(code, 0, false, account);
    renders.push({ code, account, state });
    return state;
  }, { initialProps: { code: 'PUJ', account: 'occ-one' } });
  await waitFor(() => expect(result.current.status).toBe('success'));
  let from = renders.length;
  rerender({ code: 'SDQ', account: 'occ-one' });
  expect(renders.slice(from).every(({ state }) => state.data === null)).toBe(true);
  await waitFor(() => expect(result.current.data?.station.code).toBe('SDQ'));
  expect(subscribe).toHaveBeenCalledWith(expect.any(Function), 'SDQ',
    expect.objectContaining({ onSnapshot: expect.any(Function), onError: expect.any(Function) }));
  from = renders.length;
  rerender({ code: 'SDQ', account: 'occ-two' });
  expect(renders.slice(from).every(({ state }) => state.data === null)).toBe(true);
});

it('drops stale map data on failed refresh and restores a full snapshot after recovery', async () => {
  vi.spyOn(service, 'getPositionsSnapshot').mockResolvedValue({
    station: { code: 'PUJ' }, positions: [{ id: 'A1' }], source: 'planning',
  });
  let handlers;
  vi.spyOn(service, 'subscribeToPositionUpdates')
    .mockImplementation((_update, _station, options) => {
      handlers = options;
      return () => {};
    });
  const { result } = renderHook(() => usePositionsMapData('PUJ'));
  await waitFor(() => expect(result.current.status).toBe('success'));
  act(() => handlers.onError(new Error('network down')));
  expect(result.current.status).toBe('error');
  expect(result.current.data).toBeNull();
  act(() => handlers.onSnapshot({ station: { code: 'PUJ' },
    positions: [{ id: 'A2' }], source: 'planning' }));
  expect(result.current.status).toBe('success');
  expect(result.current.data.positions.map(item => item.id)).toEqual(['A2']);
});
it('keeps the current snapshot on screen while a same-station refresh is in flight', async () => {
  const first = { station: { code: 'PUJ' }, positions: [{ id: 'A1' }], source: 'occ' };
  let finishRefresh;
  const read = vi.spyOn(service, 'getPositionsSnapshot')
    .mockResolvedValueOnce(first)
    .mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve; }))
    .mockRejectedValueOnce(new Error('network down'));
  vi.spyOn(service, 'subscribeToPositionUpdates').mockReturnValue(() => {});
  const renders = [];
  const { result, rerender } = renderHook(({ token }) => {
    const state = usePositionsMapData('PUJ', token, false, 'occ-one');
    renders.push(state);
    return state;
  }, { initialProps: { token: 0 } });
  await waitFor(() => expect(result.current.status).toBe('success'));

  // A refresh of the same station (focus, the 25 s poll, occ_planning): the snapshot stays, only the connection syncs.
  const from = renders.length;
  rerender({ token: 1 });
  expect(read).toHaveBeenCalledTimes(2);
  expect(renders.slice(from).length).toBeGreaterThan(0);
  expect(renders.slice(from).every(state => state.status === 'success' && state.data === first)).toBe(true);
  expect(result.current.connection).toBe('syncing');

  await act(async () => finishRefresh({ station: { code: 'PUJ' }, positions: [{ id: 'A2' }], source: 'occ' }));
  expect(result.current).toMatchObject({ status: 'success', connection: 'connected' });
  expect(result.current.data.positions.map(item => item.id)).toEqual(['A2']);

  // A refresh that fails still takes the old snapshot away.
  rerender({ token: 2 });
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.data).toBeNull();
  expect(result.current.connection).toBe('disconnected');
});
