import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import {
  loadOperationalNotifications, setOperationalNotificationRead,
} from '../../../services/operationalCommunicationService';
import { administratorAccess, DepartmentAccessProvider } from '../../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../../access/testAccess';
import { NOTIFICATIONS_REFRESH_EVENT } from '../../notifications/useNotificationBadge';
import { useOccResource } from '../live/useOccResource';
import { ADMIN_OCC_NAVIGATION } from '../navigation';
import OccShellOverlays from './OccShellOverlays';
import { OccShellProvider, useOccShell } from './OccShellProvider';
import OccTopbar from './OccTopbar';
import { OCC_TEST_ACCOUNT_ID } from './testing/occShellFixtures';

const auth = vi.hoisted(() => ({ session: null }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ session: auth.session }) }));
vi.mock('../../../services/operationalCommunicationService', () => ({
  loadOperationalNotifications: vi.fn(),
  setOperationalNotificationRead: vi.fn(),
}));

const ACCESS = administratorAccess('operations', DepartmentPermissionCodes.operations);
const START = Date.parse('2026-11-12T14:00:00Z');
const OTHER_ACCOUNT_ID = '30000000-0000-4000-8000-000000000002';
const HUB_PATHS = ['/hubs/operations', '/hubs/notifications'];
const hubs = (...states) => states.map((state, index) => ({ path: HUB_PATHS[index], state }));
const PLANNING = ['occ_planning'];
const REVIEW = ['occ_review'];
const BOTH = ['occ_planning', 'occ_review'];

let sequence = 0;
function notice(kind, overrides = {}) {
  sequence += 1;
  const id = `90000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  return { id, operationId: `70000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    operationCode: `OP-${100 + sequence}`, stationCode: 'PUJ', kind, sourceId: id,
    occurredAt: '2026-11-12T13:59:00Z', readAt: null, ...overrides };
}

function fakeObservers() {
  const created = [];
  const createObserver = vi.fn((onChanges, { onStatus } = {}) => {
    const observer = { onChanges, onStatus, start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined) };
    created.push(observer);
    return observer;
  });
  return { created, createObserver };
}

let shell;
function ShellProbe() {
  const value = useOccShell();
  useEffect(() => { shell = value; });
  return null;
}

function ResourceProbe({ name, resources, load }) {
  const read = useOccResource({ key: name, load, permission: 'operations.planning.read', resources });
  return <p>{`${name}: ${read.status}`}</p>;
}

function Subscriber({ resources, onChange }) {
  const { subscribe } = useOccShell();
  useEffect(() => subscribe(resources, onChange), [onChange, resources, subscribe]);
  return null;
}

// `overlays: false` when the screen under test mounts them itself (OccTopbar does).
function frame(ui, { access = ACCESS, createObserver, observe = true, loadAccess, overlays = true } = {}) {
  return (
    <LanguageScope>
      <DepartmentAccessProvider initialAccess={access} load={loadAccess ?? vi.fn().mockResolvedValue(access)}
        observe={false}>
        <OccShellProvider createObserver={createObserver} observe={observe}>
          <div data-shell-root="" data-department="occ">{ui}<ShellProbe />{overlays ? <OccShellOverlays /> : null}</div>
        </OccShellProvider>
      </DepartmentAccessProvider>
    </LanguageScope>
  );
}

const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(START);
  auth.session = { accountId: OCC_TEST_ACCOUNT_ID, stationScopes: [] };
  window.history.replaceState({}, '', '/admin-occ/dashboard');
  loadOperationalNotifications.mockResolvedValue({ notifications: [], hasMore: false });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  resetLanguageForTests('es');
  shell = undefined;
});

describe('OccShellProvider', () => {
  it('opens one account-change observer for the tab however many resources subscribe', async () => {
    const { created, createObserver } = fakeObservers();
    const load = vi.fn().mockResolvedValue({ rows: [] });
    render(frame(<>
      <ResourceProbe name="flights" resources={['occ_planning']} load={load} />
      <ResourceProbe name="queue" resources={['occ_review']} load={load} />
      <ResourceProbe name="planning" resources={[]} load={load} />
    </>, { createObserver }));
    await flush();
    expect(createObserver).toHaveBeenCalledOnce();
    expect(created[0].start).toHaveBeenCalledOnce();
    expect(screen.getByText('flights: success')).toBeInTheDocument();
    expect(screen.getByText('queue: success')).toBeInTheDocument();
    // Three reads plus the notices, on one observer.
    expect(load).toHaveBeenCalledTimes(3);
    expect(loadOperationalNotifications).toHaveBeenCalledOnce();
  });

  it('routes each announcement only to the subscribers of that resource', async () => {
    const { created, createObserver } = fakeObservers();
    const planning = vi.fn();
    const review = vi.fn();
    const both = vi.fn();
    const failing = vi.fn(() => { throw new Error('render failed'); });
    const view = render(frame(<>
      <Subscriber resources={PLANNING} onChange={failing} />
      <Subscriber resources={PLANNING} onChange={planning} />
      <Subscriber resources={REVIEW} onChange={review} />
      <Subscriber resources={BOTH} onChange={both} />
    </>, { createObserver }));
    await flush();

    expect(() => act(() => created[0].onChanges(['occ_planning']))).not.toThrow();
    // A subscriber that throws does not stop the others.
    expect(failing).toHaveBeenCalledOnce();
    expect(planning).toHaveBeenCalledWith(['occ_planning']);
    expect(review).not.toHaveBeenCalled();
    expect(both).toHaveBeenCalledWith(['occ_planning']);

    // One call per page and subscriber, with the resources it listens to.
    act(() => created[0].onChanges(['occ_planning', 'occ_review', 'mobile_devices']));
    expect(both).toHaveBeenCalledTimes(2);
    expect(both).toHaveBeenLastCalledWith(['occ_planning', 'occ_review']);
    expect(review).toHaveBeenCalledWith(['occ_review']);

    // An unmounted subscriber hears nothing more.
    view.rerender(frame(<Subscriber resources={REVIEW} onChange={review} />, { createObserver }));
    act(() => created[0].onChanges(['occ_planning']));
    expect(planning).toHaveBeenCalledTimes(2);
    expect(createObserver).toHaveBeenCalledOnce();
  });

  it('refreshes department access on department_users and access_requests', async () => {
    const { created, createObserver } = fakeObservers();
    const loadAccess = vi.fn().mockResolvedValue(ACCESS);
    render(frame(null, { createObserver, loadAccess }));
    await flush();
    expect(loadAccess).not.toHaveBeenCalled();
    await act(async () => { created[0].onChanges(['department_users']); });
    expect(loadAccess).toHaveBeenCalledTimes(1);
    await act(async () => { created[0].onChanges(['access_requests']); });
    expect(loadAccess).toHaveBeenCalledTimes(2);
    await act(async () => { created[0].onChanges(['occ_planning', 'notifications']); });
    expect(loadAccess).toHaveBeenCalledTimes(2);
  });

  it('loads the notices once and re-reads them on notifications, at most once every 3 s', async () => {
    const { created, createObserver } = fakeObservers();
    render(frame(<><ShellProbe /><ShellProbe /></>, { createObserver }));
    await flush();
    expect(loadOperationalNotifications).toHaveBeenCalledOnce();
    expect(shell.notices).toMatchObject({ status: 'empty', items: [], unreadCount: 0, hasMore: false });

    await flush(10_000);
    for (const wait of [0, 500, 500]) {
      await flush(wait);
      act(() => created[0].onChanges(['notifications']));
    }
    expect(loadOperationalNotifications).toHaveBeenCalledTimes(2);
    await flush(3_000);
    expect(loadOperationalNotifications).toHaveBeenCalledTimes(3);

    // Announcements of other resources are not the notices' business.
    act(() => created[0].onChanges(['occ_planning', 'occ_review']));
    await flush(10_000);
    expect(loadOperationalNotifications).toHaveBeenCalledTimes(3);

    // Another module asking for a new read of the bell (the notifications page after a receipt) gets one.
    act(() => window.dispatchEvent(new CustomEvent(NOTIFICATIONS_REFRESH_EVENT)));
    await flush();
    expect(loadOperationalNotifications).toHaveBeenCalledTimes(4);

    // Grouped like an announcement: more asks inside those 3 s get one read at the end of them.
    for (const wait of [500, 500]) {
      await flush(wait);
      act(() => window.dispatchEvent(new CustomEvent(NOTIFICATIONS_REFRESH_EVENT)));
    }
    await flush(1_999);
    expect(loadOperationalNotifications).toHaveBeenCalledTimes(4);
    await flush(1);
    expect(loadOperationalNotifications).toHaveBeenCalledTimes(5);
  });

  it('does not load notices without operations.notifications.read', async () => {
    const { created, createObserver } = fakeObservers();
    const access = { ...ACCESS, kind: 'Member',
      permissions: ACCESS.permissions.filter(code => code !== 'operations.notifications.read') };
    render(frame(null, { createObserver, access }));
    await flush(120_000);
    act(() => created[0].onChanges(['notifications']));
    await flush(5_000);
    expect(loadOperationalNotifications).not.toHaveBeenCalled();
    expect(shell.notices).toMatchObject({ status: 'forbidden', items: [], unreadCount: 0 });
  });

  it('markRead stores the server read receipt', async () => {
    const { createObserver } = fakeObservers();
    const incident = notice('incident_reported');
    const message = notice('agent_message');
    loadOperationalNotifications.mockResolvedValue({ notifications: [incident, message], hasMore: true });
    setOperationalNotificationRead.mockResolvedValueOnce({ ...incident, readAt: '2026-11-12T14:05:00Z' });
    render(frame(null, { createObserver }));
    await flush();
    expect(shell.notices).toMatchObject({ status: 'success', unreadCount: 2, hasMore: true });

    let receipt;
    await act(async () => { receipt = await shell.notices.markRead(incident.id); });
    expect(setOperationalNotificationRead).toHaveBeenCalledWith(incident.id, true);
    expect(receipt.readAt).toBe('2026-11-12T14:05:00Z');
    expect(shell.notices.items[0]).toEqual({ ...incident, readAt: '2026-11-12T14:05:00Z' });
    expect(shell.notices.unreadCount).toBe(1);
    expect(loadOperationalNotifications).toHaveBeenCalledOnce();

    // A refused receipt reaches the caller and changes nothing.
    setOperationalNotificationRead.mockRejectedValueOnce(new Error('No fue posible completar la solicitud.'));
    let failure;
    await act(async () => { failure = await shell.notices.markRead(message.id).catch(error => error); });
    expect(failure).toBeInstanceOf(Error);
    expect(shell.notices.unreadCount).toBe(1);
  });

  it('shows arrivals as toasts but never on the first read and never messages while the chat is open', async () => {
    const { created, createObserver } = fakeObservers();
    const old = notice('operation_submitted');
    const incident = notice('incident_reported');
    const message = notice('agent_message');
    const laterMessage = notice('agent_message');
    const laterDeviation = notice('deviation_reported');
    const laterIncident = notice('incident_reported');
    loadOperationalNotifications
      .mockResolvedValueOnce({ notifications: [old], hasMore: false })
      .mockResolvedValueOnce({ notifications: [message, incident, old], hasMore: false })
      .mockResolvedValueOnce({ notifications: [laterDeviation, laterMessage, laterIncident, message, incident, old],
        hasMore: false });
    render(frame(null, { createObserver }));
    await flush();
    // Opening the OCC does not replay the unread notice it already had.
    expect(screen.queryAllByRole('alert')).toEqual([]);
    expect(screen.queryAllByRole('status')).toEqual([]);

    await flush(10_000);
    act(() => created[0].onChanges(['notifications']));
    await flush();
    // An incident is urgent: an alert, with its word, «{tipo}, {código}», and the most pressing first.
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Urgente');
    expect(alert).toHaveTextContent(`Incidencia reportada en rampa, ${incident.operationCode}`);
    expect(alert).not.toHaveTextContent('·');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(`Nuevo mensaje del agente, ${message.operationCode}`);
    expect(alert.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Portaled into the shell root, outside the screen, and drawn by the occ-ui stack.
    expect(alert.closest('[data-shell-root]')).not.toBeNull();
    expect(alert.closest('[data-occ-toasts]')).not.toBeNull();

    // «Abrir» goes where the notice points and closes the toast.
    fireEvent.click(within(alert).getByRole('button', { name: 'Abrir' }));
    expect(`${window.location.pathname}${window.location.search}`)
      .toBe(`/admin-occ/review?operationId=${incident.operationId}`);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // With the chat open a new message gets no toast; a new incident and a new deviation still do.
    await flush(10_000);
    act(() => { window.history.pushState({}, '', '/admin-occ/chat'); window.dispatchEvent(new PopStateEvent('popstate')); });
    act(() => created[0].onChanges(['notifications']));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent(`Incidencia reportada en rampa, ${laterIncident.operationCode}`);
    // A deviation asks for attention: a status, not an alert.
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Atención');
    expect(screen.getByRole('status')).toHaveTextContent(`Desviación reportada en rampa, ${laterDeviation.operationCode}`);

    // An attention toast stays 10 s, an urgent one 15 s.
    await flush(9_000);
    expect(screen.getByRole('status')).toBeInTheDocument();
    await flush(1_000);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await flush(4_000);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await flush(1_000);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('feeds the status bar alerts and live link from the shell and shows its toasts outside the bar', async () => {
    const { created, createObserver } = fakeObservers();
    const old = notice('operation_submitted');
    const incident = notice('incident_reported');
    loadOperationalNotifications
      .mockResolvedValueOnce({ notifications: [old], hasMore: false })
      .mockResolvedValue({ notifications: [incident, old], hasMore: false });
    const onOpenNotifications = vi.fn();
    // AppShell sends the OCC bar no notices of its own: the shell's win.
    const bar = <OccTopbar navigation={ADMIN_OCC_NAVIGATION} user={{ name: 'Alex Operations', role: 'OCC' }}
      notificationsEnabled={false} notificationsCount={0} onOpenNotifications={onOpenNotifications} />;
    const view = render(frame(bar, { createObserver, overlays: false }));
    // While the notices load the bar counts nothing.
    expect(screen.getByRole('button', { name: 'Alertas' })).toBeInTheDocument();
    await flush();
    // A plain notice is not an alert.
    expect(screen.getByRole('button', { name: 'Sin alertas' })).toBeInTheDocument();
    expect(screen.queryByTestId('notifications-badge')).not.toBeInTheDocument();
    // The live link is the shell's: connecting until the observer reports.
    expect(screen.getByRole('button', { name: 'Reconectando' })).toBeInTheDocument();
    act(() => created[0].onStatus({ hubs: hubs('Connected', 'Connected'), lastOkAt: Date.now(), lastErrorAt: null,
      failingSince: null }));
    expect(screen.getByRole('button', { name: 'En vivo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fuentes al día' })).toBeInTheDocument();

    await flush(10_000);
    act(() => created[0].onChanges(['notifications']));
    await flush();
    const alerts = screen.getByRole('button', { name: '1 alerta', description: 'Urgente' });
    expect(within(alerts).getByTestId('notifications-badge')).toHaveTextContent('1');
    // The bar mounts the overlays, which leave the header for the shell root.
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(`Incidencia reportada en rampa, ${incident.operationCode}`);
    expect(alert.closest('header')).toBeNull();
    expect(alert.closest('[data-shell-root]')).not.toBeNull();
    expect(loadOperationalNotifications).toHaveBeenCalledTimes(2);

    // The alerts open «Alertas y avisos» over the screen, in the shell root, from the notices already read: no new
    // read, no navigation. The toasts give way to the drawer while it is open.
    fireEvent.click(alerts);
    const drawer = screen.getByRole('dialog', { name: 'Alertas y avisos' });
    expect(drawer.closest('header')).toBeNull();
    expect(drawer.closest('[data-shell-root]')).not.toBeNull();
    expect(within(drawer).getByRole('button', { name: 'Recibido' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/admin-occ/dashboard');
    expect(onOpenNotifications).not.toHaveBeenCalled();
    await flush(5_000);
    expect(loadOperationalNotifications).toHaveBeenCalledTimes(2);

    // «Recibido» is the server read receipt, through the shell: the bar counts it at once.
    setOperationalNotificationRead.mockResolvedValueOnce({ ...incident, readAt: '2026-11-12T14:15:00Z' });
    await act(async () => { fireEvent.click(within(drawer).getByRole('button', { name: 'Recibido' })); });
    expect(setOperationalNotificationRead).toHaveBeenCalledExactlyOnceWith(incident.id, true);
    expect(screen.getByRole('button', { name: 'Sin alertas' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(drawer).getByText('Recibida a las 10:15')).toBeInTheDocument();
    view.unmount();

    // Without the notices permission the bar has no alerts to count and no page to open.
    const access = { ...ACCESS, kind: 'Member',
      permissions: ACCESS.permissions.filter(code => code !== 'operations.notifications.read') };
    render(frame(bar, { createObserver, overlays: false, access }));
    await flush();
    expect(screen.queryByRole('button', { name: /alerta/i })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Idioma' })).toBeInTheDocument();
  });

  it('a received alert takes its toast away, and opening the alerts clears the toasts', async () => {
    const { created, createObserver } = fakeObservers();
    const old = notice('operation_submitted');
    const incident = notice('incident_reported');
    const deviation = notice('deviation_reported');
    const started = notice('operation_started');
    loadOperationalNotifications
      .mockResolvedValueOnce({ notifications: [old], hasMore: false })
      .mockResolvedValue({ notifications: [incident, deviation, started, old], hasMore: false });
    const bar = <OccTopbar navigation={ADMIN_OCC_NAVIGATION} user={{ name: 'Alex Operations', role: 'OCC' }} />;
    render(frame(bar, { createObserver, overlays: false }));
    await flush(10_000);
    act(() => created[0].onChanges(['notifications']));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent(incident.operationCode);
    expect(screen.getAllByRole('status')).toHaveLength(2);

    // Received anywhere (the shell's markRead), the incident needs its toast no more; the others stay.
    setOperationalNotificationRead.mockResolvedValueOnce({ ...incident, readAt: '2026-11-12T14:00:12Z' });
    await act(async () => { await shell.notices.markRead(incident.id); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(2);

    // The drawer shows all of it, so opening it clears the toasts: closing it brings none back.
    fireEvent.click(screen.getByRole('button', { name: '1 alerta' }));
    const drawer = screen.getByRole('dialog', { name: 'Alertas y avisos' });
    expect(within(drawer).getByRole('region', { name: 'Avisos recientes' })).toHaveTextContent(started.operationCode);
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('status')).toEqual([]);
    expect(screen.queryAllByRole('alert')).toEqual([]);
  });

  it('derives the live state from the observer status', async () => {
    const { created, createObserver } = fakeObservers();
    render(frame(null, { createObserver }));
    await flush();
    expect(shell.live).toEqual({ state: 'reconnecting', since: START, lastOkAt: null });

    act(() => created[0].onStatus({ hubs: hubs('Connected', 'Connected'), lastOkAt: START, lastErrorAt: null,
      failingSince: null }));
    expect(shell.live).toEqual({ state: 'live', since: START, lastOkAt: START });
    expect(shell.sources.items.map(item => [item.id, item.state])).toEqual([['elevant', 'ok'], ['realtime', 'ok']]);
    expect(shell.sources.summary).toEqual({ kind: 'ok', delayedCount: 0 });

    // The sockets drop: «Reconectando», and the realtime source is late.
    await flush(5_000);
    act(() => created[0].onStatus({ hubs: hubs('Reconnecting', 'Reconnecting'), lastOkAt: START, lastErrorAt: null,
      failingSince: null }));
    expect(shell.live).toMatchObject({ state: 'reconnecting', since: START + 5_000 });
    expect(shell.sources.summary).toEqual({ kind: 'delayed', delayedCount: 1 });

    // Past the grace, with HTTP still answering: «Sin tiempo real».
    await flush(25_000);
    act(() => created[0].onStatus({ hubs: hubs('Reconnecting', 'Reconnecting'), lastOkAt: Date.now(),
      lastErrorAt: null, failingSince: null }));
    expect(shell.live.state).toBe('reconnecting');
    await flush(10_000);
    expect(shell.live).toMatchObject({ state: 'polling', since: START + 40_000 });

    // ELEVANT stops answering: after a minute, «Sin conexión» and the summary says so.
    act(() => created[0].onStatus({ hubs: hubs('Disconnected', 'Disconnected'), lastOkAt: START + 30_000,
      lastErrorAt: START + 40_000, failingSince: START + 40_000 }));
    await flush(70_000);
    expect(shell.live.state).toBe('offline');
    expect(shell.sources.summary.kind).toBe('disconnected');

    // It answers again, and the browser going offline is «Sin conexión» at once.
    act(() => created[0].onStatus({ hubs: hubs('Connected', 'Connected'), lastOkAt: Date.now(), lastErrorAt: null,
      failingSince: null }));
    expect(shell.live.state).toBe('live');
    let online = false;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
    try {
      act(() => window.dispatchEvent(new Event('offline')));
      expect(shell.live.state).toBe('offline');
      online = true;
      act(() => window.dispatchEvent(new Event('online')));
      expect(shell.live.state).toBe('live');
    } finally {
      delete navigator.onLine;
    }
  });

  it('stops the observer on unmount and starts none without an account id', async () => {
    const { created, createObserver } = fakeObservers();
    const view = render(frame(null, { createObserver }));
    await flush();
    expect(createObserver).toHaveBeenCalledOnce();

    // Another account gets its own observer; the old one stops.
    auth.session = { accountId: OTHER_ACCOUNT_ID, stationScopes: [] };
    view.rerender(frame(null, { createObserver }));
    await flush();
    expect(created[0].stop).toHaveBeenCalledOnce();
    expect(createObserver).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(created[1].stop).toHaveBeenCalledOnce();

    // A session without an account id, or a test that leaves observing off, starts nothing.
    auth.session = { accountId: 'test-admin_occ', stationScopes: [] };
    const unknown = render(frame(null, { createObserver }));
    expect(shell.live.state).toBe('reconnecting');
    await flush(60_000);
    // Nothing tells such a tab that its picture is current.
    expect(shell.live.state).toBe('offline');
    unknown.unmount();
    auth.session = { accountId: OCC_TEST_ACCOUNT_ID, stationScopes: [] };
    render(frame(null, { createObserver, observe: false }));
    await flush(60_000);
    expect(createObserver).toHaveBeenCalledTimes(2);
  });
});
