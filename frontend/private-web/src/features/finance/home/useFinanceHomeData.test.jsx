import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFinanceHomeData } from './useFinanceHomeData';
import { readSession } from '../../auth/authService';
import { getFinanceHomeSnapshot } from '../../../services/financeHomeService';

const observerFactory = vi.hoisted(() => vi.fn());
vi.mock('../../auth/authService', () => ({ readSession: vi.fn() }));
vi.mock('../../../services/financeHomeService', () => ({ getFinanceHomeSnapshot: vi.fn() }));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: observerFactory,
}));

beforeEach(() => {
  vi.mocked(readSession).mockReset();
  vi.mocked(readSession).mockReturnValue({ accountId: 'finance-account',
    stationScopes: [{ stationId: 'station-one', stationCode: 'PUJ' }] });
  vi.mocked(getFinanceHomeSnapshot).mockReset();
  vi.mocked(getFinanceHomeSnapshot).mockResolvedValue({ kpis: {}, approvedServices: [],
    pendingActions: [], bounds: {} });
  observerFactory.mockReset();
  observerFactory.mockReturnValue({ start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => vi.useRealTimers());

it('reads the authorized station and revalidates after a durable finance change', async () => {
  const { result } = renderHook(() => useFinanceHomeData());
  await waitFor(() => expect(result.current.status).toBe('success'));
  expect(getFinanceHomeSnapshot).toHaveBeenCalledWith(expect.objectContaining({
    stationId: 'station-one',
  }), expect.objectContaining({ signal: expect.any(AbortSignal) }));

  await act(async () => observerFactory.mock.calls[0][0](['finance_preinvoices']));
  await waitFor(() => expect(getFinanceHomeSnapshot).toHaveBeenCalledTimes(2));
});

it('does not issue an unscoped read when Finance has no station grant', async () => {
  vi.mocked(readSession).mockReturnValue({ accountId: 'finance-account', stationScopes: [] });
  const { result } = renderHook(() => useFinanceHomeData());
  expect(result.current.status).toBe('forbidden');
  expect(getFinanceHomeSnapshot).not.toHaveBeenCalled();
});

it('ignores a late response after the authorized station changes', async () => {
  let finishFirst;
  vi.mocked(readSession).mockReturnValue({ accountId: 'finance-account',
    stationScopes: [{ stationId: 'station-one', stationCode: 'PUJ' },
      { stationId: 'station-two', stationCode: 'SDQ' }] });
  vi.mocked(getFinanceHomeSnapshot)
    .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
    .mockResolvedValueOnce({ kpis: { approvedServices: 2 }, approvedServices: [],
      pendingActions: [], bounds: {} });

  const { result } = renderHook(() => useFinanceHomeData());
  await waitFor(() => expect(getFinanceHomeSnapshot).toHaveBeenCalledOnce());
  act(() => result.current.setStationId('station-two'));
  await waitFor(() => expect(result.current.data?.kpis.approvedServices).toBe(2));
  await act(async () => finishFirst({ kpis: { approvedServices: 999 },
    approvedServices: [], pendingActions: [], bounds: {} }));
  expect(result.current.data.kpis.approvedServices).toBe(2);
});

it('revalidates on focus when no socket hint arrived', async () => {
  const { result } = renderHook(() => useFinanceHomeData());
  await waitFor(() => expect(result.current.status).toBe('success'));
  await act(async () => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(getFinanceHomeSnapshot).toHaveBeenCalledTimes(2));
});

it('does not poll or open extra hubs while another Finance module is active', async () => {
  const { result, rerender } = renderHook(({ active }) => useFinanceHomeData(active), {
    initialProps: { active: false },
  });
  expect(getFinanceHomeSnapshot).not.toHaveBeenCalled();
  expect(observerFactory).not.toHaveBeenCalled();

  rerender({ active: true });
  await waitFor(() => expect(result.current.status).toBe('success'));
  expect(getFinanceHomeSnapshot).toHaveBeenCalledOnce();
  expect(observerFactory).toHaveBeenCalledOnce();
});

it('uses the 25-second fallback when no durable hint arrives', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const { result } = renderHook(() => useFinanceHomeData());
  await act(async () => { await Promise.resolve(); });
  expect(result.current.status).toBe('success');
  await act(async () => vi.advanceTimersByTimeAsync(25_000));
  expect(getFinanceHomeSnapshot).toHaveBeenCalledTimes(2);
});