import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RampProfilesPanel from './RampProfilesPanel';
import { getRampProfiles, saveRampProfile } from '../../../services/commercialGovernanceApi';

vi.mock('../../../services/commercialGovernanceApi', () => ({
  getRampProfiles: vi.fn(), saveRampProfile: vi.fn(),
}));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({ start: vi.fn(), stop: vi.fn() }),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

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
