import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClientsPanel from './ClientsPanel';
import {
  listClientAirlines, listClientUsers, resetClientUserPassword, setClientUserPortalRole, setClientUserStatus,
} from '../../services/departmentGovernanceService';
import { resendAirlineInvitation } from '../../services/commercialGovernanceApi';

vi.mock('../../services/departmentGovernanceService', () => ({
  createClientUser: vi.fn(), listClientAirlines: vi.fn(), listClientUsers: vi.fn(), resetClientUserPassword: vi.fn(),
  setClientUserStatus: vi.fn(), setClientUserPortalRole: vi.fn(),
}));
vi.mock('../../services/commercialGovernanceApi', () => ({ resendAirlineInvitation: vi.fn() }));

const airline = { organizationId: 'org-1', name: 'Demo Air', iataCode: 'DA', users: 1, activeUsers: 1 };
const invited = { id: 'user-1', firstName: 'Ana', lastName: 'Rivera', email: 'ana@demo-air.test', status: 'Active',
  mustChangePassword: false, lastLoginAt: null, version: 'AAAAAAAAB9E=', invitationPending: true };
const problem = (status, code) => Object.assign(new Error('Raw server title'), { status, code });

beforeEach(() => {
  listClientAirlines.mockResolvedValue([airline]);
  listClientUsers.mockResolvedValue([invited]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function openAirline() {
  render(<ClientsPanel />);
  await userEvent.click(await screen.findByRole('button', { name: /Demo Air/ }));
  return screen.findByText('ana@demo-air.test');
}

describe('Superadministrador Clientes', () => {
  it('closes a pending invitation with a temporary password and says so (1-N12)', async () => {
    resetClientUserPassword.mockResolvedValue({ id: 'user-1' });
    await openAirline();
    await userEvent.click(screen.getByRole('button', { name: 'Asignar contraseña temporal' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('la invitación se da por aceptada');
    fireEvent.change(within(dialog).getByLabelText('Nueva contraseña temporal'), { target: { value: 'Synthetic-Temporary!2026' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Asignar contraseña' }));
    expect(resetClientUserPassword).toHaveBeenCalledWith('org-1', 'user-1', 'Synthetic-Temporary!2026', 'AAAAAAAAB9E=',
      expect.any(String));
    expect(await screen.findByRole('status')).toHaveTextContent('La invitación quedó cerrada');
  });

  it('queues a new invitation with the account version and never claims it was sent (1-N08)', async () => {
    resendAirlineInvitation.mockResolvedValue({ accountId: 'user-1' });
    await openAirline();
    await userEvent.click(screen.getByRole('button', { name: 'Reenviar invitación' }));
    expect(resendAirlineInvitation).toHaveBeenCalledWith('user-1', 'AAAAAAAAB9E=', expect.any(String));
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('Nuevo enlace de activación en cola para ana@demo-air.test');
    expect(notice).not.toHaveTextContent(/Enviamos/);
  });

  it('explains a refusal by its code and re-reads the users after a conflict', async () => {
    resetClientUserPassword.mockRejectedValue(problem(409, 'version_conflict'));
    await openAirline();
    await userEvent.click(screen.getByRole('button', { name: 'Asignar contraseña temporal' }));
    fireEvent.change(screen.getByLabelText('Nueva contraseña temporal'), { target: { value: 'Synthetic-Temporary!2026' } });
    await userEvent.click(screen.getByRole('button', { name: 'Asignar contraseña' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('El registro cambió mientras lo editaba.');
    expect(alert).not.toHaveTextContent('Raw server title');
    expect(listClientUsers).toHaveBeenCalledTimes(2);
  });

  it('designates a representative and a signer with the account version and a key (2-N20)', async () => {
    setClientUserPortalRole.mockResolvedValue({ id: 'user-1' });
    await openAirline();
    expect(screen.queryByText('Representante')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Designar representante' }));
    expect(setClientUserPortalRole).toHaveBeenCalledWith('org-1', 'user-1',
      { representative: true, signer: false, expectedVersion: 'AAAAAAAAB9E=' }, expect.stringMatching(/^[0-9a-f-]{36}$/));
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('Ana Rivera ahora es representante.');
    // The notice to the representatives is only queued: the copy never says it was sent.
    expect(notice).toHaveTextContent('su aviso quedó en cola');
    expect(listClientUsers).toHaveBeenCalledTimes(2);
  });

  it('shows the roles and keeps the last representative with its explanation', async () => {
    listClientUsers.mockResolvedValue([{ ...invited, invitationPending: false, representative: true, signer: true }]);
    setClientUserPortalRole.mockRejectedValue(problem(409, 'last_representative'));
    await openAirline();
    expect(screen.getByText('Representante')).toBeInTheDocument();
    expect(screen.getByText('Firmante')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Quitar representante' }));
    expect(setClientUserPortalRole).toHaveBeenCalledWith('org-1', 'user-1',
      { representative: false, signer: true, expectedVersion: 'AAAAAAAAB9E=' }, expect.any(String));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Es el último representante activo de la aerolínea');
    expect(alert).not.toHaveTextContent('Raw server title');
  });

  it('deactivates a user with its version and key (2-N39)', async () => {
    setClientUserStatus.mockResolvedValue({ id: 'user-1' });
    await openAirline();
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Desactivar' }));
    expect(setClientUserStatus).toHaveBeenCalledWith('org-1', 'user-1', false, 'AAAAAAAAB9E=',
      expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(await screen.findByRole('status')).toHaveTextContent('Usuario desactivado.');
  });

  it('shows the unauthorized state and a retry instead of an empty list', async () => {
    listClientAirlines.mockRejectedValueOnce(problem(403)).mockRejectedValueOnce(problem(503))
      .mockResolvedValue([airline]);
    const { unmount } = render(<ClientsPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Solo el superadministrador gestiona');
    expect(screen.queryByText('Sin aerolíneas')).not.toBeInTheDocument();
    unmount();
    render(<ClientsPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar las aerolíneas.');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('button', { name: /Demo Air/ })).toBeInTheDocument();
  });
});
