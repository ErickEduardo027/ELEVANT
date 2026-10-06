import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(), load: vi.fn(), setRead: vi.fn(), observer: vi.fn(),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('../../services/operationalCommunicationService', () => ({
  loadOperationalNotifications: mocks.load,
  setOperationalNotificationRead: mocks.setRead,
}));
vi.mock('../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: mocks.observer,
}));
vi.mock('../../components/AppLink', () => ({
  default: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>,
}));

import CanonicalNotificationsRoute from './CanonicalNotificationsRoute';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

const notice = (id, operationCode) => ({
  id, kind: 'operation_submitted', operationCode, stationCode: 'PUJ',
  occurredAt: '2026-09-01T12:00:00Z', operationId: '70000000-0000-0000-0000-000000000001',
  readAt: null,
});

afterEach(() => vi.useRealTimers());

it('ignores AbortError and keeps the latest result when periodic reads finish out of order', async () => {
  const first = deferred();
  const second = deferred();
  mocks.useAuth.mockReturnValue({ session: { accountId: '10000000-0000-0000-0000-000000000001' } });
  mocks.observer.mockReturnValue({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) });
  mocks.load.mockReset().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  vi.useFakeTimers();

  render(<CanonicalNotificationsRoute />);
  expect(mocks.load).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(mocks.load).toHaveBeenCalledTimes(2);

  await act(async () => second.resolve({ notifications: [notice('new', 'NEWER')], hasMore: false }));
  await act(async () => first.resolve({ notifications: [notice('old', 'OLDER')], hasMore: false }));
  expect(screen.getByText(/NEWER/)).toBeInTheDocument();
  expect(screen.queryByText(/OLDER/)).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('does not turn an AbortError into an operational error state', async () => {
  mocks.useAuth.mockReturnValue({ session: { accountId: '10000000-0000-0000-0000-000000000001' } });
  mocks.observer.mockReturnValue({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) });
  mocks.load.mockReset().mockRejectedValue(new DOMException('aborted', 'AbortError'));

  render(<CanonicalNotificationsRoute />);
  await act(async () => {});
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Cargando notificaciones');
});
