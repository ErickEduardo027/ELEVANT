import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import useOperationalNotifications from './useOperationalNotifications';

const mocks = vi.hoisted(() => ({ load: vi.fn(), read: vi.fn(), observer: vi.fn() }));
vi.mock('./operationalNotificationService', () => ({
  loadOperationalNotifications: mocks.load, setOperationalNotificationRead: mocks.read,
}));
vi.mock('../../services/accountChangeObserver', () => ({ createPrivateWebAccountChangeObserver: mocks.observer }));

const accountId = '10000000-0000-0000-0000-000000000001';
const notice = (id, readAt = null) => ({ id, kind: 'agent_message', operationCode: id, readAt });
const snapshot = items => ({ notifications: items, hasMore: false });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockReset().mockResolvedValue(snapshot([notice('a')]));
  mocks.read.mockReset();
  mocks.observer.mockReturnValue({ start: vi.fn().mockResolvedValue(), stop: vi.fn().mockResolvedValue() });
});

it('does not read or subscribe when the account lacks the notification grant', () => {
  const { result } = renderHook(() => useOperationalNotifications({ accountId, enabled: false }));
  expect(result.current.items).toEqual([]);
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.observer).not.toHaveBeenCalled();
});

it('uses the first snapshot as a baseline and announces each new unread ID once', async () => {
  const onArrive = vi.fn();
  const { result } = renderHook(() => useOperationalNotifications({ accountId, onArrive }));
  await waitFor(() => expect(result.current.status).toBe('success'));
  expect(onArrive).not.toHaveBeenCalled();
  mocks.load.mockResolvedValue(snapshot([notice('a'), notice('b'), notice('read-history', '2026-10-01T12:00:00Z')]));
  await act(async () => { await result.current.refresh(); });
  expect(onArrive).toHaveBeenCalledExactlyOnceWith([notice('b')]);
  await act(async () => { await result.current.refresh(); });
  expect(onArrive).toHaveBeenCalledTimes(1);
  expect(result.current.count).toBe(2);
});

it('aborts a previous account and never exposes its late response or notices', async () => {
  const pending = deferred();
  mocks.load.mockReturnValueOnce(pending.promise).mockResolvedValue(snapshot([notice('new-account')]));
  const onArrive = vi.fn();
  const { result, rerender } = renderHook(({ account }) => useOperationalNotifications({ accountId: account, onArrive }),
    { initialProps: { account: accountId } });
  const oldSignal = mocks.load.mock.calls[0][0].signal;
  rerender({ account: '10000000-0000-0000-0000-000000000002' });
  expect(result.current.items).toEqual([]);
  expect(oldSignal.aborted).toBe(true);
  await waitFor(() => expect(result.current.items[0]?.id).toBe('new-account'));
  await act(async () => pending.resolve(snapshot([notice('old-account')])));
  expect(result.current.items.map(item => item.id)).toEqual(['new-account']);
  expect(onArrive).not.toHaveBeenCalled();
});

it('keeps acknowledged read receipts when an earlier refresh completes late', async () => {
  const { result } = renderHook(() => useOperationalNotifications({ accountId }));
  await waitFor(() => expect(result.current.status).toBe('success'));
  const pending = deferred();
  mocks.load.mockReturnValueOnce(pending.promise);
  const refreshing = result.current.refresh();
  const saved = notice('a', '2026-10-01T12:00:00Z');
  mocks.read.mockResolvedValue(saved);
  await act(async () => { await result.current.markRead('a', true); });
  await act(async () => { pending.resolve(snapshot([notice('a')])); await refreshing; });
  expect(result.current.items).toEqual([saved]);
  expect(result.current.count).toBe(0);
  expect(mocks.read).toHaveBeenCalledWith('a', true, expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

it('clears previously visible notices if authorization is revoked', async () => {
  const { result } = renderHook(() => useOperationalNotifications({ accountId }));
  await waitFor(() => expect(result.current.count).toBe(1));
  mocks.load.mockRejectedValueOnce({ status: 403 });
  await act(async () => { await result.current.refresh(); });
  expect(result.current.status).toBe('forbidden');
  expect(result.current.items).toEqual([]);
  expect(result.current.count).toBe(0);
});

it('revalidates through the existing account observer and aborts on unmount', async () => {
  const { result, unmount } = renderHook(() => useOperationalNotifications({ accountId }));
  await waitFor(() => expect(result.current.status).toBe('success'));
  const signal = mocks.load.mock.calls[0][0].signal;
  await act(async () => { mocks.observer.mock.calls[0][0](['notifications']); });
  expect(mocks.load).toHaveBeenCalledTimes(2);
  unmount();
  expect(signal.aborted).toBe(true);
});

it('coalesces focus, observer and manual refreshes while the first read is pending', async () => {
  const pending = deferred();
  mocks.load.mockReturnValueOnce(pending.promise);
  const { result } = renderHook(() => useOperationalNotifications({ accountId }));
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    mocks.observer.mock.calls[0][0](['notifications']);
    await result.current.refresh();
  });
  expect(mocks.load).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(snapshot([notice('first')])));
  expect(result.current.items.map(item => item.id)).toEqual(['first']);
});
