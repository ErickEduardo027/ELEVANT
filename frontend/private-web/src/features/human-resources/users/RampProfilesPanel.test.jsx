import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RampProfilesPanel from './RampProfilesPanel';
import { getRampProfiles, saveRampProfile } from '../../../services/commercialGovernanceApi';

vi.mock('../../../services/commercialGovernanceApi', () => ({
  getRampProfiles: vi.fn(), saveRampProfile: vi.fn(), uploadCommercialMedia: vi.fn(),
}));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) }),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

const agent = { id: 'agent-1', firstName: 'Lucia', lastName: 'Ramos', employeeNumber: 'RA-2',
  category: 'Agente', hireDate: '2025-04-01', stations: [{ id: 'station-1', code: 'PUJ' }], terminals: [],
  isActive: true, hasAccount: true, accountStatus: 'Active' };

it('is a read-only directory for Human Resources', async () => {
  getRampProfiles.mockResolvedValue({ profiles: [agent], availableStations: [] });
  render(<RampProfilesPanel />);
  await screen.findByText('Lucia Ramos');
  expect(screen.queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Guardar perfil' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Solicitar acceso móvil/)).not.toBeInTheDocument();
});

it('lets Operations limit terminals to chosen stations and only offer its own stations', async () => {
  getRampProfiles.mockResolvedValue({ profiles: [agent], availableStations: [
    { id: 'station-1', code: 'PUJ', name: 'Punta Cana' },
    { id: 'station-2', code: 'MIA', name: 'Miami' },
    { id: 'station-3', code: 'SDQ', name: 'Santo Domingo' },
  ], availableTerminals: [
    { id: 'terminal-a', stationId: 'station-1', code: 'A', name: 'Terminal A' },
    { id: 'terminal-b', stationId: 'station-2', code: 'B', name: 'Terminal B' },
  ] });
  saveRampProfile.mockResolvedValue({ id: 'agent-1' });
  render(<RampProfilesPanel canEdit stationFilter={['station-1', 'station-2']} />);
  await screen.findByText('Lucia Ramos');
  await userEvent.click(screen.getByRole('button', { name: 'Editar perfil operativo' }));
  expect(screen.queryByRole('checkbox', { name: /SDQ/ })).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: /Terminal A/ })).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: /Terminal B/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: /Terminal A/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }));
  await waitFor(() => expect(saveRampProfile).toHaveBeenCalledWith('agent-1',
    expect.objectContaining({ terminalIds: ['terminal-a'], stationIds: ['station-1'] })));
  expect(screen.getByRole('status')).toHaveTextContent('Perfil operativo guardado.');
});

it('labels IAM lifecycle without implying effective mobile access', async () => {
  const profile = (id, firstName, hasAccount, accountStatus) => ({ id, firstName,
    lastName: 'Rampa', employeeNumber: id, category: 'Agente', hireDate: '2025-01-01',
    stations: [], terminals: [], isActive: true, hasAccount, accountStatus });
  getRampProfiles.mockResolvedValue({ profiles: [
    profile('RA-1', 'Lucia', true, 'Active'),
    profile('RA-2', 'Miguel', true, 'Disabled'),
    profile('RA-3', 'Ana', false, null),
  ], availableStations: [], availableTerminals: [] });
  render(<RampProfilesPanel />);
  await screen.findByText('Lucia Rampa');
  expect(screen.getByText(/Cuenta IAM activa; acceso móvil según permisos/)).toBeInTheDocument();
  expect(screen.getByText(/Cuenta IAM deshabilitada/)).toBeInTheDocument();
  expect(screen.getByText(/Sin cuenta móvil vinculada/)).toBeInTheDocument();
});

it('loads persisted terminal and supervisor and clears both on deactivation', async () => {
  getRampProfiles.mockResolvedValue({ profiles: [
    { id: 'supervisor-1', firstName: 'Ana', lastName: 'Pérez', employeeNumber: 'RA-1',
      category: 'Supervisora', hireDate: '2025-01-01', stations: [], terminals: [],
      isActive: true, hasAccount: true, accountStatus: 'Active' },
    { id: 'agent-1', firstName: 'Lucia', lastName: 'Ramos', employeeNumber: 'RA-2',
      category: 'Agente', hireDate: '2025-04-01',
      stations: [{ id: 'station-1', code: 'PUJ' }],
      terminals: [{ id: 'terminal-a', stationId: 'station-1', code: 'A', name: 'Terminal A' }],
      supervisorProfileId: 'supervisor-1', isActive: true, hasAccount: true,
      accountStatus: 'Active' },
  ], availableStations: [{ id: 'station-1', code: 'PUJ', name: 'Punta Cana' }],
  availableTerminals: [{ id: 'terminal-a', stationId: 'station-1', code: 'A', name: 'Terminal A' }] });
  saveRampProfile.mockResolvedValue({ id: 'agent-1' });
  render(<RampProfilesPanel canEdit />);
  await screen.findByText('Lucia Ramos');
  await userEvent.click(screen.getAllByRole('button', { name: 'Editar perfil operativo' })[1]);
  expect(screen.getByRole('checkbox', { name: /Terminal A/ })).toBeChecked();
  expect(screen.getByRole('combobox', { name: 'Supervisor' })).toHaveValue('supervisor-1');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Perfil activo' }));
  await userEvent.click(screen.getByRole('checkbox', { name: /Terminal A/ }));
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Supervisor' }), '');
  await userEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }));
  await waitFor(() => expect(saveRampProfile).toHaveBeenCalledWith('agent-1',
    expect.objectContaining({ isActive: false, terminalIds: [], supervisor: { id: null } })));
});

it('shows an inactive linked supervisor and keeps that relationship on an unrelated edit', async () => {
  getRampProfiles.mockResolvedValue({ profiles: [
    { id: 'supervisor-1', firstName: 'Ana', lastName: 'Pérez', employeeNumber: 'RA-1',
      category: 'Supervisora', hireDate: '2025-01-01', stations: [], terminals: [],
      isActive: false, hasAccount: true, accountStatus: 'Disabled' },
    { id: 'agent-1', firstName: 'Lucia', lastName: 'Ramos', employeeNumber: 'RA-2',
      category: 'Agente', hireDate: '2025-04-01',
      stations: [{ id: 'station-1', code: 'PUJ' }], terminals: [],
      supervisorProfileId: 'supervisor-1', isActive: true, hasAccount: true,
      accountStatus: 'Active' },
  ], availableStations: [{ id: 'station-1', code: 'PUJ', name: 'Punta Cana' }] });
  saveRampProfile.mockResolvedValue({ id: 'agent-1' });
  render(<RampProfilesPanel canEdit />);
  await screen.findByText('Lucia Ramos');
  await userEvent.click(screen.getAllByRole('button', { name: 'Editar perfil operativo' })[1]);
  const supervisor = screen.getByRole('combobox', { name: 'Supervisor' });
  expect(supervisor).toHaveValue('supervisor-1');
  expect(screen.getByRole('option', { name: /Ana Pérez.*inactiva/i })).toBeInTheDocument();
  await userEvent.clear(screen.getByRole('textbox', { name: 'Categoría' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Categoría' }), 'Agente líder');
  await userEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }));
  await waitFor(() => expect(saveRampProfile).toHaveBeenCalledWith('agent-1',
    expect.objectContaining({ category: 'Agente líder', supervisor: { id: 'supervisor-1' } })));
});

it('hides a previously visible profile after an authorized revalidation fails', async () => {
  getRampProfiles.mockResolvedValueOnce({ profiles: [{ id: 'old-profile', firstName: 'Old', lastName: 'Agent',
    employeeNumber: 'RA-OLD', category: 'Rampa', hireDate: '2026-01-01', stations: [], isActive: true, hasAccount: true }],
  availableStations: [] }).mockRejectedValueOnce(new Error('private server details'));
  render(<RampProfilesPanel canEdit />);
  expect(await screen.findByText('Old Agent')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Editar perfil operativo' }));
  expect(screen.getByRole('textbox', { name: 'Nombre' })).toHaveValue('Old');
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByRole('alert')).toHaveTextContent(/No fue posible actualizar los perfiles/);
  expect(screen.queryByText('Old Agent')).not.toBeInTheDocument();
  expect(screen.queryByText(/Cargando perfiles/)).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Nombre' })).not.toBeInTheDocument();
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

it('keeps an unsaved edit without exposing a server exception', async () => {
  getRampProfiles.mockResolvedValue({ profiles: [agent], availableStations: [
    { id: 'station-1', code: 'PUJ', name: 'Punta Cana' },
  ] });
  saveRampProfile.mockRejectedValue(new Error('SQL connection string and internal trace'));
  render(<RampProfilesPanel canEdit />);
  await screen.findByText('Lucia Ramos');
  await userEvent.click(screen.getByRole('button', { name: 'Editar perfil operativo' }));
  await userEvent.clear(screen.getByRole('textbox', { name: 'Nombre' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Nombre' }), 'Lucía');
  await userEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/No fue posible guardar el perfil/);
  expect(screen.queryByText(/SQL connection string/)).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Nombre' })).toHaveValue('Lucía');
});
