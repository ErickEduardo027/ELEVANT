import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RampProfilesPanel from './RampProfilesPanel';
import { getRampProfiles, saveRampProfile } from '../../../services/commercialGovernanceApi';

vi.mock('../../../services/commercialGovernanceApi', () => ({
  getRampProfiles: vi.fn(), saveRampProfile: vi.fn(),
}));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) }),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

it('creates an operational profile and hands account creation to Superadministración', async () => {
  getRampProfiles.mockResolvedValue({ profiles: [], availableStations: [
    { id: 'station-1', code: 'PUJ', name: 'Punta Cana' },
  ] });
  saveRampProfile.mockResolvedValue({ id: 'profile-1' });
  render(<RampProfilesPanel />);
  await screen.findByText('Aún no hay perfiles.');
  await userEvent.type(screen.getByRole('textbox', { name: 'Nombre' }), 'Lucia');
  await userEvent.type(screen.getByRole('textbox', { name: 'Apellido' }), 'Ramos');
  await userEvent.type(screen.getByRole('textbox', { name: 'Número de empleado' }), 'RA-100');
  await userEvent.type(screen.getByRole('textbox', { name: 'Categoría' }), 'Agente de rampa');
  await userEvent.click(screen.getByRole('checkbox', { name: /PUJ/ }));
  await userEvent.type(screen.getByLabelText('Fecha de ingreso'), '2026-09-01');
  await userEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }));
  await waitFor(() => expect(saveRampProfile).toHaveBeenCalledWith(null, expect.objectContaining({
    firstName: 'Lucia', employeeNumber: 'RA-100', stationIds: ['station-1'],
  })));
  expect(screen.getByRole('status')).toHaveTextContent(/Superadministración ya puede vincular su cuenta/);
});

it('hides a previously visible profile after an authorized revalidation fails', async () => {
  getRampProfiles.mockResolvedValueOnce({ profiles: [{ id: 'old-profile', firstName: 'Old', lastName: 'Agent',
    employeeNumber: 'RA-OLD', category: 'Rampa', hireDate: '2026-01-01', stations: [], isActive: true, hasAccount: true }],
  availableStations: [] }).mockRejectedValueOnce(new Error('private server details'));
  render(<RampProfilesPanel />);
  expect(await screen.findByText('Old Agent')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
  expect(screen.getByRole('textbox', { name: 'Nombre' })).toHaveValue('Old');
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByRole('alert')).toHaveTextContent(/No fue posible actualizar los perfiles/);
  expect(screen.queryByText('Old Agent')).not.toBeInTheDocument();
  expect(screen.queryByText(/Cargando perfiles/)).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Nombre' })).toHaveValue('');
  expect(screen.queryByText('private server details')).not.toBeInTheDocument();
});

it('does not restore an older profile snapshot after a newer refresh resolves', async () => {
  let finishFirst;
  getRampProfiles.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
    .mockResolvedValueOnce({ profiles: [{ id: 'new-profile', firstName: 'New', lastName: 'Agent',
      employeeNumber: 'RA-NEW', category: 'Rampa', stations: [], isActive: true, hasAccount: true }],
    availableStations: [] });
  render(<RampProfilesPanel />);
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByText('New Agent')).toBeInTheDocument();
  await act(async () => finishFirst({ profiles: [{ id: 'old-profile', firstName: 'Old', lastName: 'Agent',
    employeeNumber: 'RA-OLD', category: 'Rampa', stations: [], isActive: true, hasAccount: true }],
  availableStations: [] }));
  expect(screen.queryByText('Old Agent')).not.toBeInTheDocument();
});

it('revalidates the persistent profile list through polling when no change hint arrives', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  getRampProfiles.mockResolvedValueOnce({ profiles: [], availableStations: [] })
    .mockResolvedValueOnce({ profiles: [{ id: 'polled-profile', firstName: 'Polled', lastName: 'Agent',
      employeeNumber: 'RA-POLL', category: 'Rampa', stations: [], isActive: true, hasAccount: true }],
    availableStations: [] });
  render(<RampProfilesPanel />);
  expect(await screen.findByText('Aún no hay perfiles.')).toBeInTheDocument();
  await act(async () => vi.advanceTimersByTimeAsync(25_000));
  expect(await screen.findByText('Polled Agent')).toBeInTheDocument();
});

it('keeps an unsaved profile editable without exposing a server exception', async () => {
  getRampProfiles.mockResolvedValue({ profiles: [], availableStations: [
    { id: 'station-1', code: 'PUJ', name: 'Punta Cana' },
  ] });
  saveRampProfile.mockRejectedValue(new Error('SQL connection string and internal trace'));
  render(<RampProfilesPanel />);
  await screen.findByText('Aún no hay perfiles.');
  await userEvent.type(screen.getByRole('textbox', { name: 'Nombre' }), 'Lucia');
  await userEvent.type(screen.getByRole('textbox', { name: 'Apellido' }), 'Ramos');
  await userEvent.type(screen.getByRole('textbox', { name: 'Número de empleado' }), 'RA-100');
  await userEvent.type(screen.getByRole('textbox', { name: 'Categoría' }), 'Rampa');
  await userEvent.click(screen.getByRole('checkbox', { name: /PUJ/ }));
  await userEvent.type(screen.getByLabelText('Fecha de ingreso'), '2026-09-01');
  await userEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/No fue posible guardar el perfil/);
  expect(screen.queryByText(/SQL connection string/)).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Nombre' })).toHaveValue('Lucia');
});