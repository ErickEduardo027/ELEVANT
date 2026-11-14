import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render as renderView, screen, waitFor, within } from '@testing-library/react';
import DevicesRoute, { DEVICE_STATUS_TONES } from './DevicesRoute';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import { createOccShellValue, OccShellTestProvider } from '../admin-occ/shell/testing/occShellFixtures';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';
import { loadOccDevices, revokeOccDevice, unbindOccDevice } from '../../services/occDevicesService';

const stationId = '20000000-0000-7000-8000-000000000003';
const auth = vi.hoisted(() => ({ scopes: [] }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ session: { stationScopes: auth.scopes } }) }));
// A spy: the page must not open an observer of its own (contratos 2.7).
vi.mock('../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('../../services/occDevicesService', async importOriginal => ({
  ...(await importOriginal()),
  loadOccDevices: vi.fn(), unbindOccDevice: vi.fn(), revokeOccDevice: vi.fn(),
}));

const agent = { accountId: '40000000-0000-7000-8000-000000000002', rampAgentId: null, name: 'Riley Ramp', employeeNumber: 'DEV-RA-001' };
const busy = { id: 'dev-1', platform: 'Android', deviceName: 'Tablet T-07', appVersion: '1.2.3', operatingSystemVersion: '16',
  lastSeenAt: '2026-11-06T12:00:00.000Z', status: 'Bound', agent, boundAt: '2026-11-06T11:00:00.000Z', unboundAt: null,
  revokedAt: null, agentHasOperationInProgress: true, version: 'tok-1' };
const free = { ...busy, id: 'dev-2', deviceName: 'Tablet T-08', status: 'Unbound', unboundAt: '2026-11-06T13:00:00.000Z',
  agentHasOperationInProgress: false, version: 'tok-2' };
const data = (extra = {}) => ({ stationId, stationCode: 'PUJ', canUnbind: true, canRevoke: true, devices: [busy, free], ...extra });
const failure = (status, code) => Object.assign(new Error('Raw server title'), { status, code, title: 'Raw server title' });

// Every case renders inside the OCC frame, whose shell channel brings the feed's announcements (contratos 2.7).
let shell;
beforeEach(() => { shell = createOccShellValue(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); auth.scopes = []; });

function InFrame({ children }) {
  return <OccShellTestProvider value={shell}>{children}</OccShellTestProvider>;
}
const render = ui => renderView(ui, { wrapper: InFrame });

// The register writes the year of an instant only when it is not this one: these cases read the clock of a fixed day.
function onFixedDay() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-14T12:00:00.000Z'));
}

function signedIn() { auth.scopes = [{ stationId, stationCode: 'PUJ' }]; }

it('lists who holds each tablet and frees a busy one with its token and key', async () => {
  signedIn();
  loadOccDevices.mockResolvedValue(data());
  unbindOccDevice.mockResolvedValue({ ...busy, status: 'Unbound', version: 'tok-3' });
  render(<DevicesRoute />);

  const list = await screen.findByRole('region', { name: 'Tablets de la estación' });
  expect(within(list).getByText(/Operación en curso/)).toBeInTheDocument();
  expect(within(list).getAllByText('Riley Ramp · DEV-RA-001')).toHaveLength(2);
  // A free tablet can still be revoked but there is nothing to unbind.
  expect(within(list).getAllByRole('button', { name: 'Liberar' })).toHaveLength(1);
  fireEvent.click(within(list).getByRole('button', { name: 'Liberar' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Motivo (opcional)'), { target: { value: '  Cambio de turno ' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Liberar tablet' }));
  expect(await screen.findByText('Tablet T-07 quedó libre para el próximo agente.')).toBeInTheDocument();
  expect(unbindOccDevice).toHaveBeenCalledWith('dev-1', { expectedVersion: 'tok-1', reason: 'Cambio de turno' },
    expect.stringMatching(/^[0-9a-f-]{36}$/));
  expect(loadOccDevices).toHaveBeenCalledTimes(2);
});

it('revokes a lost tablet only with a reason and explains a tablet that changed hands', async () => {
  signedIn();
  loadOccDevices.mockResolvedValue(data());
  revokeOccDevice.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockRejectedValueOnce(failure(409, 'version_conflict'));
  render(<DevicesRoute />);
  const list = await screen.findByRole('region', { name: 'Tablets de la estación' });
  fireEvent.click(within(list).getAllByRole('button', { name: 'Revocar' })[1]);
  const dialog = screen.getByRole('alertdialog');
  const submit = within(dialog).getByRole('button', { name: 'Revocar tablet' });
  expect(submit).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText('Motivo'), { target: { value: 'Tablet extraviada en la rampa' } });
  fireEvent.click(submit);
  // A network failure keeps the dialog and the key for the retry.
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Revisa la conexión');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Revocar tablet' }));
  const alert = await screen.findByText(/cambió de manos/);
  expect(alert).not.toHaveTextContent('Raw server title');
  const [first, second] = revokeOccDevice.mock.calls;
  expect(first[2]).toBe(second[2]);
  expect(first[1]).toEqual({ expectedVersion: 'tok-2', reason: 'Tablet extraviada en la rampa' });
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(loadOccDevices).toHaveBeenCalledTimes(2);
});

it('only promises the sessions that revoking ends: a free tablet keeps those of an agent who signed out (2-N02)', async () => {
  signedIn();
  loadOccDevices.mockResolvedValue(data());
  revokeOccDevice.mockResolvedValue({ ...free, status: 'Revoked', revokedAt: '2026-11-06T14:00:00.000Z', version: 'tok-4' });
  render(<DevicesRoute />);
  const list = await screen.findByRole('region', { name: 'Tablets de la estación' });
  const [held, released] = within(list).getAllByRole('button', { name: 'Revocar' });

  // A tablet in an agent's hands: revoking it signs that agent out everywhere.
  fireEvent.click(held);
  expect(within(screen.getByRole('alertdialog')).getByText(/se cierran todas las sesiones de Riley Ramp\./))
    .toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));

  // A free one: OCC may have freed it with the session still open, or the agent signed out of it.
  fireEvent.click(released);
  const dialog = screen.getByRole('alertdialog');
  expect(within(dialog).getByText(/Si Riley Ramp no cerró sesión en ella, se cierran todas sus sesiones\./))
    .toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText('Motivo'), { target: { value: 'Tablet extraviada en la rampa' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Revocar tablet' }));
  expect(await screen.findByText('Tablet T-08 quedó revocada; ya no queda ninguna sesión abierta en ella.'))
    .toBeInTheDocument();
  expect(screen.queryByText(/las sesiones de su último agente se cerraron/)).not.toBeInTheDocument();
  expect(revokeOccDevice).toHaveBeenCalledWith('dev-2', { expectedVersion: 'tok-2', reason: 'Tablet extraviada en la rampa' },
    expect.stringMatching(/^[0-9a-f-]{36}$/));
});

it('shows the empty, unauthorized, read-only and retry states', async () => {
  signedIn();
  loadOccDevices.mockResolvedValueOnce(data({ devices: [] }));
  const { unmount } = render(<DevicesRoute />);
  expect(await screen.findByText('Sin tablets registradas')).toBeInTheDocument();
  unmount();

  loadOccDevices.mockRejectedValueOnce(failure(403, 'forbidden'));
  const second = render(<DevicesRoute />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Tu acceso no permite ver las tablets');
  second.unmount();

  loadOccDevices.mockResolvedValueOnce(data({ canUnbind: false, canRevoke: false }));
  const third = render(<DevicesRoute />);
  expect(await screen.findByText(/permite consultar las tablets/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Liberar' })).not.toBeInTheDocument();
  third.unmount();

  loadOccDevices.mockRejectedValueOnce(failure(503)).mockResolvedValueOnce(data());
  render(<DevicesRoute />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No fue posible completar la acción');
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByRole('region', { name: 'Tablets de la estación' })).toBeInTheDocument();
});

it('needs the OCC station of the session', () => {
  render(<DevicesRoute />);
  expect(screen.getByRole('alert')).toHaveTextContent('no tiene una estación OCC autorizada');
  expect(loadOccDevices).not.toHaveBeenCalled();
});

it('shows each tablet status with its glyph and word', async () => {
  onFixedDay();
  signedIn();
  const held = { ...busy, id: 'dev-3', deviceName: 'Tablet T-09', agentHasOperationInProgress: false, version: 'tok-5' };
  const revoked = { ...free, id: 'dev-4', deviceName: 'Tablet T-10', status: 'Revoked', revokedAt: '2025-12-30T15:00:00.000Z',
    version: 'tok-6' };
  loadOccDevices.mockResolvedValue(data({ devices: [busy, held, free, revoked] }));
  render(<DevicesRoute />);
  const list = await screen.findByRole('region', { name: 'Tablets de la estación' });
  const table = within(list).getByRole('table', { name: 'Tablets de la estación' });
  expect(within(table).getAllByRole('columnheader').map(header => header.textContent))
    .toEqual(['Tablet', 'Agente', 'Última conexión', 'Estado', '']);
  const rowOf = name => within(table).getByText(name).closest('tr');
  const statusOf = name => rowOf(name).querySelector('[data-occ-status]');
  // In an agent's hands, free and revoked carry no hue: a filled, a hollow and a slashed circle, each with its word.
  expect(DEVICE_STATUS_TONES).toEqual({ Bound: 'active', Unbound: 'neutral', Revoked: 'muted' });
  expect([statusOf('Tablet T-09').dataset.tone, statusOf('Tablet T-09').textContent]).toEqual(['active', 'En uso']);
  expect(statusOf('Tablet T-09').querySelector('svg')).toHaveAttribute('data-shape', 'filled-circle');
  expect([statusOf('Tablet T-08').dataset.tone, statusOf('Tablet T-08').textContent]).toEqual(['neutral', 'Libre']);
  expect(statusOf('Tablet T-08').querySelector('svg')).toHaveAttribute('data-shape', 'hollow-circle');
  expect([statusOf('Tablet T-10').dataset.tone, statusOf('Tablet T-10').textContent]).toEqual(['muted', 'Revocada']);
  expect(statusOf('Tablet T-10').querySelector('svg')).toHaveAttribute('data-shape', 'slashed-circle');
  // An agent in the middle of an operation asks for attention: the amber triangle and why no one else can take it.
  expect([statusOf('Tablet T-07').dataset.tone, statusOf('Tablet T-07').textContent]).toEqual(['attention', 'Operación en curso']);
  expect(statusOf('Tablet T-07').querySelector('[data-occ-glyph="attention"]')).not.toBeNull();
  expect(within(rowOf('Tablet T-07')).getByText(/Otro agente no puede tomarla hasta que este cierre sesión o la liberes\./))
    .toBeInTheDocument();
  // Who holds it, since when; the last connection in the station's time, in the identifiers' face.
  expect(within(rowOf('Tablet T-07')).getByText('En manos de')).toBeInTheDocument();
  expect(within(rowOf('Tablet T-08')).getByText('Último agente')).toBeInTheDocument();
  const lastSeen = within(rowOf('Tablet T-07')).getByText((_, element) => element?.tagName === 'TIME');
  expect(lastSeen).toHaveAttribute('dateTime', busy.lastSeenAt);
  expect(lastSeen.textContent).toMatch(/^06\/11 08:00$/);
  expect(lastSeen.closest('td')).toHaveClass('font-mono');
  // An instant of another year says its year.
  expect(within(rowOf('Tablet T-10')).getByText('desde 30/12/2025 11:00')).toBeInTheDocument();
  // Each row offers only what can be done to it: «Liberar» on a held tablet, «Revocar» until it is revoked.
  expect(within(rowOf('Tablet T-09')).getAllByRole('button').map(button => button.textContent)).toEqual(['Liberar', 'Revocar']);
  expect(within(rowOf('Tablet T-08')).getAllByRole('button').map(button => button.textContent)).toEqual(['Revocar']);
  expect(within(rowOf('Tablet T-10')).queryByRole('button')).toBeNull();
});

it('revoking opens an alertdialog with the first focus on Cancelar', async () => {
  signedIn();
  loadOccDevices.mockResolvedValue(data());
  render(<DevicesRoute />);
  const list = await screen.findByRole('region', { name: 'Tablets de la estación' });
  const opener = within(list).getAllByRole('button', { name: 'Revocar' })[0];
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole('alertdialog', { name: 'Revocar Tablet T-07' });
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  // A hasty Enter changes nothing: the dialog starts on «Cancelar».
  const cancel = within(dialog).getByRole('button', { name: 'Cancelar' });
  await waitFor(() => expect(cancel).toHaveFocus());
  expect(cancel).toHaveAttribute('data-occ-dialog-cancel');
  // The sentence of the command describes the dialog, and the reason is required.
  expect(dialog).toHaveAccessibleDescription(/nunca más podrá vincularse con ELEVANT y se cierran todas las sesiones de Riley Ramp\./);
  expect(within(dialog).getByLabelText('Motivo')).toBeRequired();
  const submit = within(dialog).getByRole('button', { name: 'Revocar tablet' });
  expect(submit).toHaveAttribute('form', 'occ-device-command');
  expect(submit).toBeDisabled();
  // Esc closes it and gives the focus back to the row's «Revocar»; nothing was sent.
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  await waitFor(() => expect(opener).toHaveFocus());
  expect(revokeOccDevice).not.toHaveBeenCalled();

  // Freeing one asks without alarm: a plain dialog that starts on its reason.
  fireEvent.click(within(list).getByRole('button', { name: 'Liberar' }));
  const unbind = screen.getByRole('dialog', { name: 'Liberar Tablet T-07' });
  await waitFor(() => expect(within(unbind).getByLabelText('Motivo (opcional)')).toHaveFocus());
  expect(within(unbind).getByRole('button', { name: 'Liberar tablet' })).toBeEnabled();
});

it('reads the tablets again when the frame announces mobile_devices, without an observer of its own', async () => {
  signedIn();
  const signedOut = { ...busy, status: 'Unbound', unboundAt: '2026-11-06T14:00:00.000Z', agentHasOperationInProgress: false,
    version: 'tok-9' };
  // The first read, then the register after the agent signed out.
  loadOccDevices.mockResolvedValue(data({ devices: [signedOut, free] })).mockResolvedValueOnce(data());
  const view = render(<DevicesRoute />);
  await screen.findByRole('region', { name: 'Tablets de la estación' });
  const statusOf = name => within(screen.getByRole('table', { name: 'Tablets de la estación' })).getByText(name)
    .closest('tr').querySelector('[data-occ-status]');
  expect(statusOf('Tablet T-07')).toHaveTextContent('Operación en curso');
  // It listens on the shell's channel, to mobile_devices only: the tab's one observer stays the frame's (contratos 2.7).
  expect(shell.subscriptions()).toEqual(['mobile_devices']);
  expect(createPrivateWebAccountChangeObserver).not.toHaveBeenCalled();

  // What other modules announce reads nothing here.
  act(() => shell.announce(['occ_planning', 'operation_messages']));
  expect(loadOccDevices).toHaveBeenCalledTimes(1);

  // The agent signed out at the tablet: the register reads the station's tablets again and shows it free.
  act(() => shell.announce(['mobile_devices']));
  await waitFor(() => expect(statusOf('Tablet T-07')).toHaveTextContent('Libre'));
  expect(loadOccDevices.mock.calls.map(([id]) => id)).toEqual([stationId, stationId]);

  // Leaving the page stops listening.
  view.unmount();
  expect(shell.subscriptions()).toEqual([]);
});

describe('DevicesRoute in English', () => {
  afterEach(() => act(() => resetLanguageForTests('es')));

  it('renders the tablets in English inside the OCC scope', async () => {
    onFixedDay();
    act(() => resetLanguageForTests('en'));
    signedIn();
    loadOccDevices.mockResolvedValue(data());
    unbindOccDevice.mockResolvedValue({ ...busy, status: 'Unbound', version: 'tok-3' });
    render(<LanguageScope><DevicesRoute /></LanguageScope>);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the tablets…');
    expect(await screen.findByRole('heading', { level: 1, name: 'Tablets' })).toBeInTheDocument();
    const list = screen.getByRole('region', { name: 'Station tablets' });
    expect(within(within(list).getByRole('table')).getAllByRole('columnheader').map(header => header.textContent))
      .toEqual(['Tablet', 'Agent', 'Last connection', 'Status', '']);
    expect(within(list).getByText('Operation in progress')).toBeInTheDocument();
    expect(within(list).getByText('Free')).toBeInTheDocument();
    expect(within(list).getByText('Held by')).toBeInTheDocument();
    // The last connection in English order: month, then day.
    expect(within(list).getAllByText((_, element) => element?.tagName === 'TIME')[0].textContent).toBe('11/06 08:00');
    fireEvent.click(within(list).getByRole('button', { name: 'Release' }));
    const dialog = screen.getByRole('dialog', { name: 'Release Tablet T-07' });
    expect(within(dialog).getByText(/The tablet becomes free/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Reason (optional)'), { target: { value: 'Shift change' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Release tablet' }));
    expect(await screen.findByText('Tablet T-07 is free for the next agent.')).toBeInTheDocument();
    expect(screen.queryByText(/Tablets de la estación|Liberar|Revocar|Cancelar|En manos de/)).toBeNull();
  });
});
