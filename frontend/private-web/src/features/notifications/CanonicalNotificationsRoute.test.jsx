import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(), load: vi.fn(), setRead: vi.fn(), observer: vi.fn(), push: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('./operationalNotificationService', () => ({
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

it('coalesces periodic reads while pending and refreshes after completion', async () => {
  const first = deferred();
  const second = deferred();
  mocks.useAuth.mockReturnValue({ session: { accountId: '10000000-0000-0000-0000-000000000001' } });
  mocks.observer.mockReturnValue({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) });
  mocks.load.mockReset().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  vi.useFakeTimers();

  render(<CanonicalNotificationsRoute />);
  expect(mocks.load).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(mocks.load).toHaveBeenCalledTimes(1);
  await act(async () => first.resolve({ notifications: [notice('old', 'OLDER')], hasMore: false }));
  expect(screen.getByText(/OLDER/)).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(mocks.load).toHaveBeenCalledTimes(2);
  await act(async () => second.resolve({ notifications: [notice('new', 'NEWER')], hasMore: false }));
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

it('renders English notices and confirms reading before opening authorized targets', async () => {
  const receipt = deferred();
  mocks.push.mockReset();
  mocks.setRead.mockReset().mockReturnValue(receipt.promise);
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
    const actions = screen.getAllByRole('button', { name: 'Open' });
    expect(actions).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Mark as read' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark as unread' })).toBeInTheDocument();
    expect(screen.getByText('Showing recent notices; more history exists.')).toBeInTheDocument();
    fireEvent.click(actions[0]);
    expect(mocks.setRead).toHaveBeenCalledWith('submitted', true, expect.anything());
    expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => receipt.resolve({ ...notice('submitted', 'SUBMITTED'), readAt: '2026-09-01T12:10:00Z' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/admin-occ/review?operationId=70000000-0000-0000-0000-000000000001'));
    fireEvent.click(actions[1]);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/admin-occ/chat?operationId=70000000-0000-0000-0000-000000000001'));
    expect(mocks.setRead).toHaveBeenCalledTimes(1);
  } finally {
    act(() => resetLanguageForTests('es'));
  }
});
