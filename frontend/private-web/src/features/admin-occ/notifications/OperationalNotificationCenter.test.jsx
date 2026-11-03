import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import CanonicalNotificationsRoute from '../../notifications/CanonicalNotificationsRoute';
import { OccNotificationBell, OperationalNotificationProvider, useOperationalNotificationCenter } from './OperationalNotificationCenter';

const mocks = vi.hoisted(() => ({ load: vi.fn(), read: vi.fn(), observer: vi.fn(), push: vi.fn(), accountId: '10000000-0000-0000-0000-000000000001' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ session: { accountId: mocks.accountId } }),
}));
vi.mock('../../notifications/operationalNotificationService', () => ({
  loadOperationalNotifications: mocks.load, setOperationalNotificationRead: mocks.read,
}));
vi.mock('../../../services/accountChangeObserver', () => ({ createPrivateWebAccountChangeObserver: mocks.observer }));

const navigation = [{ path: '/admin-occ/notifications' }, { path: '/admin-occ/chat' }];
const operationId = '70000000-0000-0000-0000-000000000001';
const notice = id => ({ id, operationId, operationCode: 'OP-' + id, stationCode: 'PUJ',
  kind: 'agent_message', occurredAt: '2026-10-01T12:00:00Z', readAt: null });
let notices;
function Harness({ history = false }) {
  const center = useOperationalNotificationCenter();
  return <><OccNotificationBell center={center} /><button type="button" onClick={center.refresh}>Refresh feed</button>
    {history && <CanonicalNotificationsRoute />}{center.ui}</>;
}
function renderCenter(history = false) {
  return render(<LanguageScope><OperationalNotificationProvider enabled navigation={navigation}>
    <Harness history={history} />
  </OperationalNotificationProvider></LanguageScope>);
}
beforeEach(() => {
  vi.resetAllMocks(); resetLanguageForTests('es'); notices = [notice('one')];
  mocks.accountId = '10000000-0000-0000-0000-000000000001';
  mocks.load.mockImplementation(async () => ({ notifications: notices, hasMore: true }));
  mocks.read.mockImplementation(async (id, read) => {
    const updated = { ...notices.find(item => item.id === id), readAt: read ? '2026-10-01T12:01:00Z' : null };
    notices = notices.map(item => item.id === id ? updated : item);
    return updated;
  });
  mocks.observer.mockReturnValue({ start: vi.fn().mockResolvedValue(), stop: vi.fn().mockResolvedValue() });
});
afterEach(() => { vi.useRealTimers(); resetLanguageForTests('es'); });

it('shares one request and synchronizes read receipts between the bell and full history', async () => {
  renderCenter(true);
  const trigger = await screen.findByRole('button', { name: /Notificaciones, 1 sin leer/ });
  expect(mocks.load).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole('status')).toHaveLength(1);
  await userEvent.click(trigger);
  const panel = screen.getByRole('dialog', { name: 'Notificaciones' });
  expect(within(panel).getByRole('button', { name: 'Abrir' })).toBeEnabled();
  await userEvent.click(within(panel).getByRole('button', { name: 'Marcar como leída' }));
  expect(await screen.findByRole('button', { name: 'Marcar no leída' })).toBeInTheDocument();
  expect(screen.queryByTestId('notifications-badge')).not.toBeInTheDocument();
  expect(within(panel).queryByText(/OP-one/)).not.toBeInTheDocument();
  expect(within(panel).getByText('No tienes notificaciones pendientes.')).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it('closes outside the anchor and exposes translated recent counts', async () => {
  act(() => resetLanguageForTests('en'));
  renderCenter();
  const trigger = await screen.findByRole('button', { name: /Notifications, 1 unread among recent notices/ });
  await userEvent.click(trigger);
  const panel = screen.getByRole('dialog', { name: 'Notifications' });
  expect(within(panel).getByRole('link', { name: 'View all notifications' })).toBeInTheDocument();
  expect(within(panel).getByText('Showing recent notices; more history exists.')).toBeInTheDocument();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('does not notify the initial history and groups new events into at most three notices', async () => {
  renderCenter();
  await screen.findByRole('button', { name: /Notificaciones, 1 sin leer/ });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  notices = [...notices, ...['two', 'three', 'four', 'five', 'six'].map(notice)];
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh feed' })); });
  expect(await screen.findAllByRole('status')).toHaveLength(3);
  expect(screen.getByText('3 notificaciones nuevas más')).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh feed' })); });
  expect(screen.getAllByRole('status')).toHaveLength(3);
});

it('discards queued toasts across account changes, including a return to the old account', async () => {
  const view = renderCenter();
  await screen.findByRole('button', { name: /Notificaciones, 1 sin leer/ });
  notices = [...notices, notice('new')];
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh feed' })); });
  expect(await screen.findByRole('status')).toBeInTheDocument();
  const rerender = () => view.rerender(<LanguageScope><OperationalNotificationProvider enabled navigation={navigation}><Harness /></OperationalNotificationProvider></LanguageScope>);
  mocks.accountId = '10000000-0000-0000-0000-000000000002';
  rerender();
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  mocks.accountId = '10000000-0000-0000-0000-000000000001';
  rerender();
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(4));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('does not replay old toasts after a forbidden response recovers', async () => {
  renderCenter();
  await screen.findByRole('button', { name: /Notificaciones, 1 sin leer/ });
  notices = [...notices, notice('new')];
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh feed' })); });
  expect(await screen.findByRole('status')).toBeInTheDocument();
  mocks.load.mockRejectedValueOnce({ status: 403 });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh feed' })); });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh feed' })); });
  await screen.findByRole('button', { name: /Notificaciones, 2 sin leer/ });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('pauses automatic dismissal while a notice is being read', async () => {
  vi.useFakeTimers();
  renderCenter();
  await act(async () => {});
  notices = [...notices, notice('new')];
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh feed' })); });
  const toast = screen.getByRole('status');
  fireEvent.mouseEnter(toast);
  await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
  expect(toast).toBeInTheDocument();
  fireEvent.mouseLeave(toast);
  await act(async () => { await vi.advanceTimersByTimeAsync(8001); });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('filters read notices before choosing the eight pending items', async () => {
  notices = [...Array.from({ length: 8 }, (_, index) => ({ ...notice('read-' + index), readAt: '2026-10-01T12:01:00Z' })), notice('pending')];
  renderCenter();
  await userEvent.click(await screen.findByRole('button', { name: /Notificaciones, 1 sin leer/ }));
  const panel = screen.getByRole('dialog', { name: 'Notificaciones' });
  expect(within(panel).getByText(/OP-pending/)).toBeInTheDocument();
  expect(within(panel).queryByText(/OP-read-0/)).not.toBeInTheDocument();
});

it('keeps the notice after a failed open and navigates only after retry confirms reading', async () => {
  mocks.read.mockRejectedValueOnce(new Error('offline'));
  renderCenter();
  await userEvent.click(await screen.findByRole('button', { name: /Notificaciones, 1 sin leer/ }));
  const panel = screen.getByRole('dialog', { name: 'Notificaciones' });
  await userEvent.click(within(panel).getByRole('button', { name: 'Abrir' }));
  expect(await within(panel).findByRole('alert')).toBeInTheDocument();
  expect(mocks.push).not.toHaveBeenCalled();
  expect(within(panel).getByText(/OP-one/)).toBeInTheDocument();
  await userEvent.click(within(panel).getByRole('button', { name: 'Abrir' }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/admin-occ/chat?operationId=' + operationId));
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(screen.queryByTestId('notifications-badge')).not.toBeInTheDocument();
});

it('deduplicates identical IDs and coalesces simultaneous read and open actions', async () => {
  notices = [notice('one'), notice('one')];
  let resolve;
  mocks.read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  renderCenter();
  await userEvent.click(await screen.findByRole('button', { name: /Notificaciones, 1 sin leer/ }));
  const panel = screen.getByRole('dialog', { name: 'Notificaciones' });
  expect(within(panel).getAllByText(/OP-one/)).toHaveLength(1);
  fireEvent.click(within(panel).getByRole('button', { name: 'Marcar como leída' }));
  fireEvent.click(within(panel).getByRole('button', { name: 'Abrir' }));
  expect(mocks.read).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ ...notice('one'), readAt: '2026-10-01T12:01:00Z' }));
  expect(mocks.push).toHaveBeenCalledTimes(1);
});
