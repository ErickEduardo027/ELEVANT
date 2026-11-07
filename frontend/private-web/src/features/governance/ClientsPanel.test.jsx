import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClientsPanel from './ClientsPanel';
import {
  createClientUser, listClientAirlines, listClientUsers, resetClientUserPassword, setClientUserPortalRole,
  setClientUserStatus,
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

/** Opens «Añadir usuario» and fills an invitation for a new user; returns the drawer. */
async function fillNewUser() {
  await userEvent.click(screen.getByRole('button', { name: 'Añadir usuario' }));
  const drawer = screen.getByRole('dialog', { name: 'Añadir usuario a Demo Air' });
  await userEvent.type(within(drawer).getByLabelText('Nombre'), 'Luis');
  await userEvent.type(within(drawer).getByLabelText('Apellido'), 'Linares');
  await userEvent.type(within(drawer).getByLabelText('Correo de acceso'), 'luis@demo-air.test');
  return drawer;
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

  it('explains a conflict inside the reset dialog and retries with the version it re-read', async () => {
    const reread = { ...invited, version: 'AAAAAAAAB+E=' };
    listClientUsers.mockResolvedValueOnce([invited]).mockResolvedValue([reread]);
    resetClientUserPassword.mockRejectedValueOnce(problem(409, 'version_conflict')).mockResolvedValue({ id: 'user-1' });
    await openAirline();
    await userEvent.click(screen.getByRole('button', { name: 'Asignar contraseña temporal' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Nueva contraseña temporal'),
      { target: { value: 'Synthetic-Temporary!2026' } });
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Asignar contraseña' }));
    // The reason is in the open dialog, not on the page behind it, and never the server title.
    const alert = await within(screen.getByRole('dialog')).findByRole('alert');
    expect(alert).toHaveTextContent('La cuenta cambió mientras la editaba');
    expect(alert).not.toHaveTextContent('Raw server title');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    await waitFor(() => expect(listClientUsers).toHaveBeenCalledTimes(2));

    // The next attempt carries the re-read version with a new key, and closes the dialog.
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Asignar contraseña' }));
    expect(await screen.findByRole('status')).toHaveTextContent('La invitación quedó cerrada');
    const [first, second] = resetClientUserPassword.mock.calls;
    expect(first.slice(0, 4)).toEqual(['org-1', 'user-1', 'Synthetic-Temporary!2026', 'AAAAAAAAB9E=']);
    expect(second.slice(0, 4)).toEqual(['org-1', 'user-1', 'Synthetic-Temporary!2026', 'AAAAAAAAB+E=']);
    expect(second[4]).not.toBe(first[4]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows why «Añadir usuario» failed inside the drawer and creates the user once while it runs', async () => {
    let finish;
    createClientUser.mockRejectedValueOnce(problem(400, 'invitations_unavailable'))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await openAirline();
    const drawer = await fillNewUser();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Crear usuario' }));
    const alert = await within(drawer).findByRole('alert');
    expect(alert).toHaveTextContent('Las invitaciones por correo no están configuradas. Entregue una contraseña temporal.');
    expect(alert).not.toHaveTextContent('Raw server title');
    expect(screen.getAllByRole('alert')).toHaveLength(1);

    // A double click sends one request: the button stays disabled until the answer arrives.
    await userEvent.dblClick(within(drawer).getByRole('button', { name: 'Crear usuario' }));
    expect(within(drawer).getByRole('button', { name: 'Creando…' })).toBeDisabled();
    expect(within(drawer).queryByRole('alert')).not.toBeInTheDocument();
    expect(createClientUser).toHaveBeenCalledTimes(2);
    expect(createClientUser).toHaveBeenLastCalledWith('org-1',
      { firstName: 'Luis', lastName: 'Linares', email: 'luis@demo-air.test' }, expect.stringMatching(/^[0-9a-f-]{36}$/));
    await act(async () => { finish({ id: 'user-2' }); });
    expect(await screen.findByRole('status')).toHaveTextContent('La invitación quedó en cola para luis@demo-air.test');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says an email in use is already registered, without claiming it is not a portal account', async () => {
    createClientUser.mockRejectedValue(problem(409, 'email_in_use'));
    await openAirline();
    const drawer = await fillNewUser();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Crear usuario' }));
    const alert = await within(drawer).findByRole('alert');
    expect(alert).toHaveTextContent('Ese correo ya está registrado en ELEVANT. Use otro correo o revise los usuarios existentes.');
    expect(alert).not.toHaveTextContent('no es una cuenta del portal');
    // A conflict re-reads the users, which may already list that account.
    await waitFor(() => expect(listClientUsers).toHaveBeenCalledTimes(2));
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
