import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
import { administratorAccess, DepartmentAccessProvider } from '../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../access/testAccess';
import { ADMIN_OCC_NAVIGATION } from '../admin-occ/navigation';
import OccSidebar from '../admin-occ/shell/OccSidebar';
import { OccShellProvider } from '../admin-occ/shell/OccShellProvider';
import OccTopbar from '../admin-occ/shell/OccTopbar';

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

it('a receipt saved here reaches the OCC frame at once, not with its 60 s poll', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(Date.parse('2026-11-12T14:00:00Z'));
  window.history.replaceState({}, '', '/admin-occ/notifications');
  // One account's notices on a fake server: the frame and the page read the same list, and a receipt changes it.
  let rows = [
    { ...notice('91000000-0000-4000-8000-000000000001', 'OP-201'), kind: 'incident_reported' },
    { ...notice('91000000-0000-4000-8000-000000000002', 'OP-202'), kind: 'agent_message' },
  ];
  const [incident] = rows;
  mocks.useAuth.mockReturnValue({ session: { accountId: '10000000-0000-0000-0000-000000000001' } });
  mocks.observer.mockReturnValue({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) });
  mocks.load.mockReset().mockImplementation(async () => ({ notifications: rows, hasMore: false }));
  mocks.setRead.mockReset().mockImplementation(async (id, read) => {
    rows = rows.map(item => (item.id === id ? { ...item, readAt: read ? new Date().toISOString() : null } : item));
    return rows.find(item => item.id === id);
  });
  const access = administratorAccess('operations', DepartmentPermissionCodes.operations);
  const user = { name: 'Alex Operations', role: 'OCC' };
  const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const toggle = async (kind, name) => {
    const row = screen.getByText(kind).closest('li');
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name })); });
  };
  const railPlate = count => screen.getByRole('link', { name: 'Notificaciones', description: `${count} sin leer` });

  render(
    <LanguageScope>
      <DepartmentAccessProvider initialAccess={access} load={vi.fn().mockResolvedValue(access)} observe={false}>
        <OccShellProvider observe={false}>
          <div data-shell-root="" data-department="occ">
            <OccSidebar navigation={ADMIN_OCC_NAVIGATION} user={user} breakpoint="desktop" railVisible railExpanded
              overlayOpen={false} onToggle={vi.fn()} onCloseOverlay={vi.fn()} />
            <OccTopbar navigation={ADMIN_OCC_NAVIGATION} user={user} />
            <main><CanonicalNotificationsRoute /></main>
          </div>
        </OccShellProvider>
      </DepartmentAccessProvider>
    </LanguageScope>,
  );
  // Ten seconds on the page: the frame and the page read once each, and no poll falls due.
  await flush(10_000);
  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: '1 alerta' })).toBeInTheDocument();
  expect(railPlate(2)).toBeInTheDocument();

  // Marked read here: the page keeps the server's answer, and the frame reads the notices again at once.
  await toggle('Incidencia reportada en rampa', 'Marcar leída');
  await flush();
  expect(mocks.setRead).toHaveBeenCalledExactlyOnceWith(incident.id, true);
  expect(mocks.load).toHaveBeenCalledTimes(3);
  expect(screen.getByRole('button', { name: 'Sin alertas' })).toBeInTheDocument();
  expect(railPlate(1)).toBeInTheDocument();

  // Marked unread within 3 s of that read: grouped like an announcement, the frame reads at the end of the 3 s.
  await toggle('Incidencia reportada en rampa', 'Marcar no leída');
  await flush();
  expect(mocks.setRead).toHaveBeenLastCalledWith(incident.id, false);
  expect(screen.getByRole('button', { name: 'Sin alertas' })).toBeInTheDocument();
  await flush(3_000);
  expect(mocks.load).toHaveBeenCalledTimes(4);
  expect(screen.getByRole('button', { name: '1 alerta' })).toBeInTheDocument();
  expect(railPlate(2)).toBeInTheDocument();

  // A receipt the server refuses changed nothing, so the frame reads nothing.
  mocks.setRead.mockRejectedValueOnce(Object.assign(new Error('refused'), { status: 409 }));
  await toggle('Nuevo mensaje del agente', 'Marcar leída');
  await flush(5_000);
  expect(mocks.load).toHaveBeenCalledTimes(4);
  expect(railPlate(2)).toBeInTheDocument();
});
