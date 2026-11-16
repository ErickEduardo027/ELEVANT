import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { usePlanningData } from './usePlanningData';

const load = vi.hoisted(() => vi.fn());
vi.mock('../../services/planningService', () => ({ getPlanningSnapshot: load }));
vi.mock('./planningMappers', () => ({ mapOccPlanningSnapshot: snapshot => snapshot }));
beforeEach(() => load.mockReset());
const snapshot = { flights: [{ id: 'scale-a' }] };

it('keeps the daily snapshot mounted during revalidation', async () => {
  load.mockResolvedValueOnce(snapshot);
  const { result, rerender } = renderHook(props => usePlanningData(props), { initialProps: { stationId: 'station-a', refreshToken: 0 } });
  await waitFor(() => expect(result.current.status).toBe('success'));
  let complete;
  load.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  rerender({ stationId: 'station-a', refreshToken: 1 });
  expect(result.current).toMatchObject({ status: 'success', data: snapshot, refreshing: true });
  await act(async () => complete({ flights: [] }));
  expect(result.current).toMatchObject({ status: 'empty', refreshing: false });
});

it('hides data immediately on scope change and ignores responses from the old scope', async () => {
  let oldResponse; let newResponse;
  load.mockImplementationOnce(() => new Promise(resolve => { oldResponse = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { newResponse = resolve; }));
  const { result, rerender } = renderHook(props => usePlanningData(props), { initialProps: { stationId: 'station-a' } });
  rerender({ stationId: 'station-b' });
  expect(result.current.data).toBeNull();
  await act(async () => oldResponse(snapshot));
  expect(result.current.data).toBeNull();
  await act(async () => newResponse({ flights: [{ id: 'scale-b' }] }));
  expect(result.current.data.flights[0].id).toBe('scale-b');
});

it('removes the visible snapshot after authorization is revoked', async () => {
  load.mockResolvedValueOnce(snapshot).mockRejectedValueOnce({ status: 403 });
  const { result, rerender } = renderHook(props => usePlanningData(props), { initialProps: { stationId: 'station-a', refreshToken: 0 } });
  await waitFor(() => expect(result.current.status).toBe('success'));
  rerender({ stationId: 'station-a', refreshToken: 1 });
  await waitFor(() => expect(result.current.status).toBe('forbidden'));
  expect(result.current.data).toBeNull();
});

it('never exposes the previous account snapshot while the same station is loading', async () => {
  load.mockResolvedValueOnce(snapshot);
  const { result, rerender } = renderHook(props => usePlanningData(props), {
    initialProps: { accountId: 'account-a', stationId: 'station-a' },
  });
  await waitFor(() => expect(result.current.status).toBe('success'));
  let complete;
  load.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  rerender({ accountId: 'account-b', stationId: 'station-a' });
  expect(result.current).toMatchObject({ status: 'loading', data: null, refreshing: false });
  await act(async () => complete({ flights: [{ id: 'other-account-scale' }] }));
  expect(result.current.data.flights.map(flight => flight.id)).toEqual(['other-account-scale']);
});
