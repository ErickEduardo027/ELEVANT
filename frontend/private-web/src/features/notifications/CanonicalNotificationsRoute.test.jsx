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
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';

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

it('renders notices in English with the shared kind labels and target links inside the OCC scope', async () => {
  mocks.useAuth.mockReturnValue({ session: { accountId: '10000000-0000-0000-0000-000000000001' } });
  mocks.observer.mockReturnValue({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) });
  mocks.load.mockReset().mockResolvedValue({ notifications: [
    notice('submitted', 'SUBMITTED'),
    { ...notice('message', 'MESSAGE'), kind: 'agent_message', readAt: '2026-09-01T12:05:00Z' },
  ], hasMore: true });
  act(() => resetLanguageForTests('en'));
  try {
    render(<LanguageScope><CanonicalNotificationsRoute /></LanguageScope>);
    expect(await screen.findByText('Operation submitted for review')).toBeInTheDocument();
    expect(screen.getByText('New message from the agent')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Operational notifications' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 unread of 2 visible');
    const links = screen.getAllByRole('link', { name: 'Open' });
    expect(links[0]).toHaveAttribute('href', '/admin-occ/review?operationId=70000000-0000-0000-0000-000000000001');
    expect(links[1]).toHaveAttribute('href', '/admin-occ/chat?operationId=70000000-0000-0000-0000-000000000001');
    expect(screen.getByRole('button', { name: 'Mark as read' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark as unread' })).toBeInTheDocument();
    expect(screen.getByText('Showing the 100 most recent notices; more history exists.')).toBeInTheDocument();
  } finally {
    act(() => resetLanguageForTests('es'));
  }
});
