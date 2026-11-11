import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFinanceHomeData } from './useFinanceHomeData';
import { readSession } from '../../auth/authService';
import { getFinanceHomeSnapshot } from '../../../services/financeHomeService';

const observerFactory = vi.hoisted(() => vi.fn());
vi.mock('../../auth/authService', () => ({ readSession: vi.fn(), handleUnauthorizedResponse: vi.fn() }));
vi.mock('../../../services/financeHomeService', async original => ({
  ...(await original()), getFinanceHomeSnapshot: vi.fn(),
}));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: observerFactory,
}));

const home = (operations = 1) => ({ businessDate: '2026-10-31',
  toInvoice: { operations, airlines: operations ? 1 : 0, oldestOperationDate: operations ? '2026-10-02' : null },
  invoicedThisMonth: [], receivables: null, cardCollectionsThisMonth: null, pendingContractApprovals: null,
  chartersAwaitingPrepayment: null });
const failure = (status, code) => Object.assign(new Error('Server title.'), { status, code });

beforeEach(() => {
  vi.mocked(readSession).mockReset();
  vi.mocked(readSession).mockReturnValue({ accountId: 'finance-account',
    stationScopes: [{ stationId: 'station-one', stationCode: 'PUJ' }] });
  vi.mocked(getFinanceHomeSnapshot).mockReset();
  vi.mocked(getFinanceHomeSnapshot).mockResolvedValue(home());
  observerFactory.mockReset();
  observerFactory.mockReturnValue({ start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => vi.useRealTimers());

it('reads the authorized station and revalidates after an approval or a receipt, never a preinvoice', async () => {
  const { result } = renderHook(() => useFinanceHomeData());
  await waitFor(() => expect(result.current.status).toBe('success'));
  expect(getFinanceHomeSnapshot).toHaveBeenCalledWith({ stationId: 'station-one' },
    expect.objectContaining({ signal: expect.any(AbortSignal) }));

  await act(async () => observerFactory.mock.calls[0][0](['finance_preinvoices']));
  expect(getFinanceHomeSnapshot).toHaveBeenCalledOnce();
  await act(async () => observerFactory.mock.calls[0][0](['finance_approved_services']));
  await waitFor(() => expect(getFinanceHomeSnapshot).toHaveBeenCalledTimes(2));
  await act(async () => observerFactory.mock.calls[0][0](['finance_receipts']));
  await waitFor(() => expect(getFinanceHomeSnapshot).toHaveBeenCalledTimes(3));
});

it('says there is no Finance station without issuing an unscoped read', async () => {
  vi.mocked(readSession).mockReturnValue({ accountId: 'finance-account', stationScopes: [] });
  const { result } = renderHook(() => useFinanceHomeData());
  expect(result.current.status).toBe('no-station');
  expect(getFinanceHomeSnapshot).not.toHaveBeenCalled();
});

it('tells a refusal (403) apart from a missing station and from a recoverable error (500)', async () => {
  vi.mocked(getFinanceHomeSnapshot).mockRejectedValueOnce(failure(403, 'forbidden'));
  const { result } = renderHook(() => useFinanceHomeData());
  await waitFor(() => expect(result.current.status).toBe('forbidden'));
  expect(result.current.data).toBeNull();

  vi.mocked(getFinanceHomeSnapshot).mockRejectedValueOnce(failure(500));
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.error).toMatch(/Revise la conexión/);
  expect(result.current.error).not.toMatch(/Server title/);

  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.status).toBe('success'));
});

it('explains a malformed station by its code', async () => {
  vi.mocked(getFinanceHomeSnapshot).mockRejectedValueOnce(failure(400, 'invalid_finance_home_query'));
  const { result } = renderHook(() => useFinanceHomeData());
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.error).toMatch(/La estación elegida no es válida/);
});

it('reports an empty template when no section is included', async () => {
  vi.mocked(getFinanceHomeSnapshot).mockResolvedValueOnce({ ...home(), toInvoice: null, invoicedThisMonth: null });
  const { result } = renderHook(() => useFinanceHomeData());
  await waitFor(() => expect(result.current.status).toBe('empty'));
});

it('keeps the visible indicators while it revalidates and when the revalidation fails', async () => {
  let finish;
  const { result } = renderHook(() => useFinanceHomeData());
  await waitFor(() => expect(result.current.status).toBe('success'));
  vi.mocked(getFinanceHomeSnapshot).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  act(() => result.current.refresh());
  expect(result.current).toMatchObject({ status: 'success', refreshing: true });
  expect(result.current.data.toInvoice.operations).toBe(1);
  await act(async () => finish(home(4)));
  expect(result.current).toMatchObject({ status: 'success', refreshing: false });
  expect(result.current.data.toInvoice.operations).toBe(4);

  vi.mocked(getFinanceHomeSnapshot).mockRejectedValueOnce(failure(503));
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.error).toMatch(/Revise la conexión/));
  expect(result.current).toMatchObject({ status: 'success', refreshing: false });
  expect(result.current.data.toInvoice.operations).toBe(4);
});

it('ignores a late response after the authorized station changes and never shows another station\'s figures', async () => {
  let finishFirst;
  vi.mocked(readSession).mockReturnValue({ accountId: 'finance-account',
    stationScopes: [{ stationId: 'station-one', stationCode: 'PUJ' },
      { stationId: 'station-two', stationCode: 'SDQ' }] });
  vi.mocked(getFinanceHomeSnapshot)
    .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
    .mockResolvedValueOnce(home(2));

  const { result } = renderHook(() => useFinanceHomeData());
  await waitFor(() => expect(getFinanceHomeSnapshot).toHaveBeenCalledOnce());
  act(() => result.current.setStationId('station-two'));
  await waitFor(() => expect(result.current.data?.toInvoice.operations).toBe(2));
  await act(async () => finishFirst(home(999)));
  expect(result.current.data.toInvoice.operations).toBe(2);

  let finishThird;
  vi.mocked(getFinanceHomeSnapshot).mockImplementationOnce(() => new Promise(resolve => { finishThird = resolve; }));
  act(() => result.current.setStationId('station-one'));
  expect(result.current).toMatchObject({ status: 'loading', data: null });
  await act(async () => finishThird(home(7)));
  expect(result.current.data.toInvoice.operations).toBe(7);
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
