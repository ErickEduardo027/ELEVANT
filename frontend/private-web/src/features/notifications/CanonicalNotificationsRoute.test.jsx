import { act, cleanup, fireEvent, render as renderView, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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
import { notificationsMessages } from './notificationsMessages';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import { administratorAccess, DepartmentAccessProvider } from '../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../access/testAccess';
import { ADMIN_OCC_NAVIGATION } from '../admin-occ/navigation';
import OccSidebar from '../admin-occ/shell/OccSidebar';
import { OccShellProvider } from '../admin-occ/shell/OccShellProvider';
import OccTopbar from '../admin-occ/shell/OccTopbar';
import { createOccShellValue, OccShellTestProvider } from '../admin-occ/shell/testing/occShellFixtures';

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

// Every case renders inside the OCC frame, whose shell channel brings the feed's announcements (contratos 2.7). The
// observer is a spy: the page must not open one of its own.
let shell;
beforeEach(() => {
  shell = createOccShellValue();
  mocks.useAuth.mockReturnValue({ session: { accountId: '10000000-0000-0000-0000-000000000001' } });
  mocks.observer.mockReset()
    .mockReturnValue({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => vi.useRealTimers());

function InFrame({ children }) {
  return <OccShellTestProvider value={shell}>{children}</OccShellTestProvider>;
}
const render = ui => renderView(ui, { wrapper: InFrame });

it('ignores AbortError and keeps the latest result when periodic reads finish out of order', async () => {
  const first = deferred();
  const second = deferred();
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
  mocks.load.mockReset().mockRejectedValue(new DOMException('aborted', 'AbortError'));

  render(<CanonicalNotificationsRoute />);
  await act(async () => {});
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Cargando notificaciones');
});

it('renders notices in English with the shared kind labels and target links inside the OCC scope', async () => {
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

  // The real frame: its provider gives the page the channel, and the test wrapper is not needed.
  renderView(
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

// The history of one account: an unread and a read notice of each priority (contratos 2.4), newest first.
const history = [
  { ...notice('92000000-0000-4000-8000-000000000001', 'OP-301'), kind: 'incident_reported' },
  { ...notice('92000000-0000-4000-8000-000000000002', 'OP-302'), kind: 'flight_cancelled_by_provider' },
  { ...notice('92000000-0000-4000-8000-000000000003', 'OP-303'), kind: 'operation_submitted' },
  { ...notice('92000000-0000-4000-8000-000000000004', 'OP-304'), kind: 'incident_reported', readAt: '2026-09-01T12:10:00Z' },
  { ...notice('92000000-0000-4000-8000-000000000005', 'OP-305'), kind: 'agent_released', readAt: '2026-09-01T12:10:00Z' },
  { ...notice('92000000-0000-4000-8000-000000000006', 'OP-306'), kind: 'agent_message', readAt: '2026-09-01T12:10:00Z' },
];
const codesOf = list => within(list).queryAllByRole('listitem').map(item => item.querySelector('[data-occ-plate]').textContent);

function renderHistory(notifications = history) {
  mocks.load.mockReset().mockResolvedValue({ notifications, hasMore: false });
  return render(<CanonicalNotificationsRoute />);
}

it('filters Todo, Sin leer and Alertas with their counts', async () => {
  renderHistory();
  const list = await screen.findByRole('list', { name: 'Avisos' });
  const filters = screen.getByRole('group', { name: 'Filtrar avisos' });
  const all = within(filters).getByRole('button', { name: 'Todo 6' });
  const unread = within(filters).getByRole('button', { name: 'Sin leer 3' });
  const alerts = within(filters).getByRole('button', { name: 'Alertas 4' });
  expect(all).toHaveAttribute('aria-pressed', 'true');
  expect(codesOf(list)).toEqual(['OP-301', 'OP-302', 'OP-303', 'OP-304', 'OP-305', 'OP-306']);

  fireEvent.click(unread);
  expect(unread).toHaveAttribute('aria-pressed', 'true');
  expect(all).toHaveAttribute('aria-pressed', 'false');
  expect(codesOf(list)).toEqual(['OP-301', 'OP-302', 'OP-303']);
  // «Alertas» are the urgent and attention notices, read or not; a plain notice is never one.
  fireEvent.click(alerts);
  expect(codesOf(list)).toEqual(['OP-301', 'OP-302', 'OP-304', 'OP-305']);
  fireEvent.click(all);
  expect(codesOf(list)).toHaveLength(6);
  // The filters are the screen's own: they read nothing, and the total keeps counting every notice on screen.
  expect(mocks.load).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status')).toHaveTextContent('3 sin leer de 6 visibles');
  // The sections switch with pressed buttons inside their navigation.
  const sections = within(screen.getByRole('navigation', { name: 'Secciones de notificaciones' })).getByRole('group');
  expect(within(sections).getByRole('button', { name: 'Avisos' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(sections).getByRole('button', { name: 'Servicios' })).toHaveAttribute('aria-pressed', 'false');
});

it('draws each notice with its priority glyph and word, and urgent and attention rows with their slab', async () => {
  renderHistory();
  const list = await screen.findByRole('list', { name: 'Avisos' });
  const rowOf = code => within(list).getByText(code).closest('li');
  const expected = [
    ['OP-301', 'urgent', 'Urgente', true], ['OP-302', 'attention', 'Atención', true], ['OP-303', 'notice', 'Aviso', true],
    ['OP-304', 'urgent', 'Urgente', false], ['OP-305', 'attention', 'Atención', false], ['OP-306', 'notice', 'Aviso', false],
  ];
  for (const [code, priority, word, unread] of expected) {
    const row = rowOf(code);
    // One glyph per notice, its shape by priority and its word as its name: never the colour alone.
    expect(row.querySelectorAll('[data-occ-glyph]'), code).toHaveLength(1);
    expect(within(row).getByRole('img', { name: word })).toHaveAttribute('data-occ-glyph', priority);
    // An unread alert is lit; the read receipt turns the light off, and a plain notice is never lit.
    const lit = unread && priority !== 'notice';
    expect(row.getAttribute('data-occ-tone'), code).toBe(lit ? priority : null);
    expect(within(row).queryByText('Sin leer'), code)[unread ? 'toBeInTheDocument' : 'toBeNull']();
    expect(row.querySelector('[data-occ-plate="code"]'), code).toHaveTextContent(code);
    expect(within(row).getByRole('link', { name: 'Abrir' }), code).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: unread ? 'Marcar leída' : 'Marcar no leída' }), code).toBeInTheDocument();
  }
  // The kind is the shared label, word for word, and the time is in the identifiers' face, in the station's time.
  expect(within(rowOf('OP-301')).getByText('Incidencia reportada en rampa').tagName).toBe('STRONG');
  const time = rowOf('OP-301').querySelector('time');
  expect(time).toHaveAttribute('dateTime', '2026-09-01T12:00:00Z');
  expect(time).toHaveTextContent('01/09 08:00');
  expect(time.closest('.font-mono')).not.toBeNull();
  // The board's header carries its legend: the three priorities with their shapes, the most pressing first.
  const legend = screen.getByRole('list', { name: 'Prioridad' });
  expect([...legend.querySelectorAll('[data-signal]')].map(item => [item.dataset.signal, item.textContent,
    item.querySelector('[data-occ-glyph]').dataset.shape])).toEqual([
    ['urgent', 'Urgente', 'octagon'], ['attention', 'Atención', 'triangle'], ['notice', 'Aviso', 'diamond'],
  ]);
  expect(screen.getByRole('region', { name: 'Historial de avisos' })).toContainElement(legend);
});

it('says what is missing when a filter leaves no notice', async () => {
  renderHistory(history.filter(item => item.readAt && item.kind === 'agent_message'));
  await screen.findByText('OP-306');
  fireEvent.click(screen.getByRole('button', { name: 'Sin leer 0' }));
  expect(screen.getByText('No hay avisos sin leer.')).toBeInTheDocument();
  expect(screen.queryByText('OP-306')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Alertas 0' }));
  expect(screen.getByText('No hay alertas.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Todo 1' }));
  expect(screen.getByText('OP-306')).toBeInTheDocument();
  // With no notice at all, the history says so in its own words.
  cleanup();
  renderHistory([]);
  expect(await screen.findByText('Aún no hay notificaciones para tu cuenta. Los nuevos eventos aparecerán aquí.')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('0 sin leer de 0 visibles');
});

it('says when the account cannot read its notices, without a retry, and offers one after any other failure', async () => {
  mocks.load.mockReset().mockRejectedValue(Object.assign(new Error('No tienes acceso a esta conversación o notificación.'),
    { status: 403 }));
  const view = render(<CanonicalNotificationsRoute />);
  expect(await screen.findByText('Tu acceso no permite ver estas notificaciones.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
  expect(screen.queryByRole('group', { name: 'Filtrar avisos' })).toBeNull();
  view.unmount();

  mocks.load.mockReset().mockRejectedValueOnce(new Error('No fue posible completar la solicitud.'))
    .mockResolvedValueOnce({ notifications: history.slice(0, 1), hasMore: false });
  render(<CanonicalNotificationsRoute />);
  // The screen's own sentence, never the server's title.
  expect(await screen.findByRole('alert')).toHaveTextContent('No fue posible cargar las notificaciones.');
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('Incidencia reportada en rampa')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('reads the history again when the frame announces notifications, without an observer of its own', async () => {
  // The first read, then the history with the notice that just arrived, newest first.
  mocks.load.mockReset().mockResolvedValue({ notifications: history.slice(0, 2), hasMore: false })
    .mockResolvedValueOnce({ notifications: history.slice(1, 2), hasMore: false });
  const view = render(<CanonicalNotificationsRoute />);
  expect(codesOf(await screen.findByRole('list', { name: 'Avisos' }))).toEqual(['OP-302']);
  // It listens on the shell's channel, to notifications only: the tab's one observer stays the frame's (contratos 2.7).
  expect(shell.subscriptions()).toEqual(['notifications']);
  expect(mocks.observer).not.toHaveBeenCalled();

  // What other modules announce reads nothing here.
  act(() => shell.announce(['occ_planning', 'operation_messages', 'mobile_devices']));
  expect(mocks.load).toHaveBeenCalledTimes(1);

  // A new notice for the account: the page reads its history again at once and shows it first.
  act(() => shell.announce(['notifications']));
  await waitFor(() => expect(codesOf(screen.getByRole('list', { name: 'Avisos' }))).toEqual(['OP-301', 'OP-302']));
  expect(mocks.load).toHaveBeenCalledTimes(2);

  // Leaving the page stops listening.
  view.unmount();
  expect(shell.subscriptions()).toEqual([]);
});

it('keeps es and en with the same keys and placeholders, and no subtitle', () => {
  const leafPaths = (node, prefix = '') => Object.entries(node).flatMap(([key, value]) => (value !== null && typeof value === 'object'
    ? leafPaths(value, `${prefix}${key}.`) : [`${prefix}${key}`])).sort();
  const textAt = (messages, path) => path.split('.').reduce((node, key) => node[key], messages);
  const placeholdersOf = text => [...text.matchAll(/\{(\w+)\}/g)].map(([, name]) => name).sort();
  const paths = leafPaths(notificationsMessages.es);
  expect(leafPaths(notificationsMessages.en)).toEqual(paths);
  for (const path of paths) {
    for (const language of ['es', 'en']) expect(textAt(notificationsMessages[language], path).trim(), `${language}: ${path}`).not.toBe('');
    expect(placeholdersOf(textAt(notificationsMessages.en, path)), path).toEqual(placeholdersOf(textAt(notificationsMessages.es, path)));
  }
  expect(notificationsMessages.es.filters).toEqual({ label: 'Filtrar avisos', all: 'Todo', unread: 'Sin leer', alerts: 'Alertas' });
  for (const language of ['es', 'en']) expect(notificationsMessages[language]).not.toHaveProperty('subtitle');
});
