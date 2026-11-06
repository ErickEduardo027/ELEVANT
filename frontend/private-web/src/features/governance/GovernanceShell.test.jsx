import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GovernanceShell from './GovernanceShell';
import { DepartmentAccessProvider } from '../access/DepartmentAccessContext';
import { getGovernance, getProvisioning, linkProvisioningAccount, provisionAirline } from '../../services/commercialGovernanceApi';
import { convertLegacyRole, getDepartmentsOverview, listLegacyRoles } from '../../services/departmentGovernanceService';

vi.mock('../../services/commercialGovernanceApi', () => ({
  commercialApi: vi.fn(),
  getGovernance: vi.fn(),
  getGovernanceAudit: vi.fn().mockResolvedValue({ entries: [], hasMore: false }),
  getProvisioning: vi.fn().mockResolvedValue([]),
  getManagedAirlines: vi.fn().mockResolvedValue([]),
  provisionAirline: vi.fn().mockResolvedValue({ accountId: 'acc-1' }),
  linkProvisioningAccount: vi.fn().mockResolvedValue({ accountId: 'acc-2' }),
}));
vi.mock('../../services/departmentGovernanceService', async importOriginal => ({
  ...(await importOriginal()),
  getMyDepartmentAccess: vi.fn().mockResolvedValue({ kind: 'SuperAdministrator', department: null, permissions: [],
    stations: [], canManageDepartmentUsers: true, canValidateAccessRequests: false }),
  getDepartmentsOverview: vi.fn(),
  listLegacyRoles: vi.fn(),
  convertLegacyRole: vi.fn().mockResolvedValue({ id: 'profile-1' }),
}));
vi.mock('../../hooks/useCommercialRevalidation', () => ({ useCommercialRevalidation: vi.fn() }));
vi.mock('../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() }),
}));

const summary = (department, label, extra = {}) => ({ department, label, administrators: 1, members: 2, rampAgents: 0,
  inactive: 0, pendingRequests: 0, pendingFirstLogin: 0, activeProfiles: 1, ...extra });
const overview = {
  totalInternalUsers: 14, administrators: 4, members: 9, pendingRequests: 3,
  departments: [
    summary('human-resources', 'Gestión Humana'),
    summary('contracts', 'Contratos', { pendingRequests: 2 }),
    summary('operations', 'Centro de Operaciones', { rampAgents: 5, pendingRequests: 1 }),
    summary('finance', 'Finanzas', { inactive: 1 }),
  ],
};

beforeEach(() => {
  getGovernance.mockResolvedValue({ roles: [], users: [], permissionCodes: [], recentAudit: [], rampProfiles: [] });
  getDepartmentsOverview.mockResolvedValue(overview);
  listLegacyRoles.mockResolvedValue([{ id: 'role-1', code: 'CUSTOM_A', name: 'Revisor', permissions: ['contracts.requests.read'], activeUsers: 2 }]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function renderShell() {
  return render(<DepartmentAccessProvider observe={false}><GovernanceShell user={{ name: 'Super Admin' }} onLogout={vi.fn()} /></DepartmentAccessProvider>);
}

describe('GovernanceShell', () => {
  it('groups Clientes and Usuarios internos under Usuarios and shows department counts', async () => {
    renderShell();
    const navigation = await screen.findByRole('navigation');
    const group = within(navigation).getByRole('button', { name: 'Usuarios' });
    expect(group).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(group);
    expect(group).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(within(navigation).getByRole('button', { name: 'Usuarios internos' }));
    expect(await screen.findByText('Usuarios internos activos')).toBeInTheDocument();
    const operations = screen.getByRole('button', { name: /Centro de Operaciones/ });
    expect(within(operations).getByText('Agentes de rampa')).toBeInTheDocument();
    expect(within(operations).getByText('5')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /^Contratos/ })).queryByText('Agentes de rampa')).not.toBeInTheDocument();
  });

  it('converts a legacy role into a Contracts template after confirmation', async () => {
    renderShell();
    await userEvent.click(within(await screen.findByRole('navigation')).getByRole('button', { name: 'Configuración' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Convertir en plantilla de Contratos' }));
    await userEvent.click(screen.getByRole('button', { name: 'Convertir' }));
    expect(convertLegacyRole).toHaveBeenCalledWith('role-1');
  });

  const task = { requestId: 'req-1', reference: 'REQ-2026-000001', airline: 'Demo Air', representativeName: 'Ana Pérez',
    suggestedEmail: 'ana@demo-air.test', contractId: 'c-1', approvedAt: '2026-11-01T00:00:00Z', version: 'AAAAAAAAB9E=' };

  it('creates the airline account by emailed invitation unless a temporary password is chosen', async () => {
    getProvisioning.mockResolvedValue([task]);
    renderShell();
    const create = await screen.findByRole('button', { name: 'Crear y enviar invitación' });
    expect(screen.queryByLabelText('Contraseña temporal')).not.toBeInTheDocument();
    // 1-N21: the invitation is the default and the temporary password the explicit alternative.
    expect(screen.getByText(/Por defecto, ELEVANT deja en cola una invitación por correo/)).toBeInTheDocument();
    await userEvent.click(create);
    expect(provisionAirline).toHaveBeenCalledWith('req-1',
      { email: 'ana@demo-air.test', temporaryPassword: null, expectedVersion: 'AAAAAAAAB9E=' }, expect.any(String));
    // ADR-0022, 1-N08: the email is queued, never claimed as sent.
    const notice = await screen.findByText(/La invitación quedó en cola para ana@demo-air.test/);
    expect(notice).toHaveTextContent('vence en 72 horas');
    expect(notice).not.toHaveTextContent(/Enviamos/);
  });

  it('explains a refused provisioning by its code, never by the server title', async () => {
    getProvisioning.mockResolvedValue([task]);
    provisionAirline.mockRejectedValueOnce(Object.assign(new Error('Provisioning request is no longer available.'),
      { status: 409, code: 'email_in_use_internal' }));
    renderShell();
    await userEvent.click(await screen.findByRole('button', { name: 'Crear y enviar invitación' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Ese correo es una cuenta interna de AVIAM.');
    expect(alert).not.toHaveTextContent('Provisioning request');
    expect(screen.queryByRole('button', { name: 'Vincular cuenta existente' })).not.toBeInTheDocument();
  });

  it('offers to link the existing portal account of the email and keeps one key per intent (1-N13)', async () => {
    getProvisioning.mockResolvedValue([task]);
    provisionAirline.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { status: 409, code: 'email_has_account' }));
    linkProvisioningAccount.mockRejectedValueOnce(Object.assign(new Error('timeout'), { status: 503 }));
    renderShell();
    await userEvent.click(await screen.findByRole('button', { name: 'Crear y enviar invitación' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Puede vincularla a esta solicitud sin cambiar su contraseña.');
    const link = screen.getByRole('button', { name: 'Vincular cuenta existente' });
    await userEvent.click(link);
    expect(await screen.findByRole('alert')).toHaveTextContent('Revise la conexión');
    await userEvent.click(screen.getByRole('button', { name: 'Vincular cuenta existente' }));
    expect(await screen.findByText(/La cuenta existente de ana@demo-air.test quedó vinculada a Demo Air/)).toBeInTheDocument();
    const [first, second] = linkProvisioningAccount.mock.calls;
    expect(first[1]).toEqual({ email: 'ana@demo-air.test', expectedVersion: 'AAAAAAAAB9E=' });
    // The uncertain attempt is retried with the same Idempotency-Key.
    expect(second[2]).toBe(first[2]);
  });

  it('describes the invitation by email as the credential delivery in the access policy (1-N21)', async () => {
    renderShell();
    await userEvent.click(within(await screen.findByRole('navigation')).getByRole('button', { name: 'Configuración' }));
    expect(await screen.findByText('Invitación por correo (en cola); contraseña temporal como alternativa')).toBeInTheDocument();
    expect(screen.queryByText('Manual, sin correo automático')).not.toBeInTheDocument();
  });

  it('offers a retry when governance cannot be loaded', async () => {
    getGovernance.mockRejectedValueOnce(Object.assign(new Error('Internal'), { status: 503 }));
    renderShell();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la gobernanza.');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(getGovernance).toHaveBeenCalledTimes(2);
  });
});
