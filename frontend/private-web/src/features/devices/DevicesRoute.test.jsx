import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import DevicesRoute from './DevicesRoute';
import { loadOccDevices, revokeOccDevice, unbindOccDevice } from '../../services/occDevicesService';

const stationId = '20000000-0000-7000-8000-000000000003';
const auth = vi.hoisted(() => ({ scopes: [] }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ session: { stationScopes: auth.scopes } }) }));
vi.mock('../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) }),
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

afterEach(() => { cleanup(); vi.clearAllMocks(); auth.scopes = []; });

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
