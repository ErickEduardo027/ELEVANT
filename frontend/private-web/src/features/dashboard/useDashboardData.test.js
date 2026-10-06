import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useDashboardData } from './useDashboardData';
import { getDashboardSnapshot } from '../../services/dashboardService';

const observerFactory = vi.hoisted(() => vi.fn());
vi.mock('../../services/dashboardService', () => ({ getDashboardSnapshot: vi.fn() }));
vi.mock('../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: observerFactory,
}));

const stationId = '20000000-0000-7000-8000-000000000003';
const scope = { accountId: 'occ-account', stationId, stationCode: 'PUJ',
  date: '2026-09-28', refreshToken: 0 };
const snapshot = { stationId, stationCode: 'PUJ', date: scope.date,
  turnarounds: [], reviews: [], reviewHasMore: false,
  notifications: [], notificationsHasMore: false };

beforeEach(() => {
  vi.mocked(getDashboardSnapshot).mockReset().mockResolvedValue(snapshot);
  observerFactory.mockReset().mockReturnValue({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  });
});

it('does not read or display a dashboard without an authorized station', () => {
  const noStation = { ...scope, stationId: '', stationCode: '' };
  const { result } = renderHook(() => useDashboardData(noStation));
  expect(result.current.status).toBe('forbidden');
  expect(result.current.data).toBeNull();
  expect(getDashboardSnapshot).not.toHaveBeenCalled();
});

it('loads scoped data and revalidates on durable notifications and manual retry', async () => {
  const scopes = [{ ...scope }, { ...scope, refreshToken: 1 }];
  const { result, rerender } = renderHook(({ refreshToken }) =>
    useDashboardData(scopes[refreshToken]), {
    initialProps: { refreshToken: 0 },
  });
  await waitFor(() => expect(result.current.status).toBe('success'));
  expect(result.current.data).toEqual(snapshot);
  expect(getDashboardSnapshot).toHaveBeenCalledWith({
    stationId, stationCode: 'PUJ', date: scope.date,
  }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  await act(async () => observerFactory.mock.calls[0][0](['notifications']));
  await waitFor(() => expect(getDashboardSnapshot).toHaveBeenCalledTimes(2));
  rerender({ refreshToken: 1 });
  await waitFor(() => expect(getDashboardSnapshot).toHaveBeenCalledTimes(3));
});

it('drops stale data when a later read is forbidden', async () => {
  const scopes = [{ ...scope }, { ...scope, refreshToken: 1 }];
  const { result, rerender } = renderHook(({ refreshToken }) =>
    useDashboardData(scopes[refreshToken]), {
    initialProps: { refreshToken: 0 },
  });
  await waitFor(() => expect(result.current.status).toBe('success'));
  vi.mocked(getDashboardSnapshot).mockRejectedValueOnce({ status: 403 });
  rerender({ refreshToken: 1 });
  await waitFor(() => expect(result.current.status).toBe('forbidden'));
  expect(result.current.data).toBeNull();
});

it('never renders the prior station or account snapshot during a scope switch', async () => {
  const renders = [];
  const nextStation = { ...scope, stationId: '20000000-0000-7000-8000-000000000004',
    stationCode: 'SDQ' };
  const nextAccount = { ...scope, accountId: 'other-occ-account' };
  const { result, rerender } = renderHook(({ target }) => {
    const dashboard = useDashboardData(target);
    renders.push({ target, dashboard });
    return dashboard;
  }, { initialProps: { target: scope } });
  await waitFor(() => expect(result.current.status).toBe('success'));

  let from = renders.length;
  rerender({ target: nextStation });
  expect(renders.slice(from).every(({ dashboard }) => dashboard.data === null))
    .toBe(true);
  expect(result.current.status).toBe('loading');
  expect(result.current.data).toBeNull();

  from = renders.length;
  rerender({ target: nextAccount });
  expect(renders.slice(from).every(({ dashboard }) => dashboard.data === null))
    .toBe(true);
  expect(result.current.status).toBe('loading');
  expect(result.current.data).toBeNull();
});

it('does not expose an AbortError as a dashboard failure', async () => {
  vi.mocked(getDashboardSnapshot).mockRejectedValueOnce(
    new DOMException('signal is aborted without reason', 'AbortError'),
  );
  const { result } = renderHook(() => useDashboardData(scope));
  await waitFor(() => expect(getDashboardSnapshot).toHaveBeenCalledOnce());
  await act(async () => {});
  expect(result.current.status).toBe('loading');
  expect(result.current.data).toBeNull();
});
