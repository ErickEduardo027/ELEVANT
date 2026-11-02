import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GovernanceShell from './GovernanceShell';
import { DepartmentAccessProvider } from '../access/DepartmentAccessContext';
import { getGovernance, getProvisioning, provisionAirline } from '../../services/commercialGovernanceApi';
import { convertLegacyRole, getDepartmentsOverview, listLegacyRoles } from '../../services/departmentGovernanceService';

vi.mock('../../services/commercialGovernanceApi', () => ({
  commercialApi: vi.fn(),
  getGovernance: vi.fn(),
  getGovernanceAudit: vi.fn().mockResolvedValue({ entries: [], hasMore: false }),
  getProvisioning: vi.fn().mockResolvedValue([]),
  getManagedAirlines: vi.fn().mockResolvedValue([]),
  provisionAirline: vi.fn().mockResolvedValue({ accountId: 'acc-1' }),
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

  it('creates the airline account by emailed invitation unless a temporary password is chosen', async () => {
    getProvisioning.mockResolvedValue([{ requestId: 'req-1', reference: 'REQ-2026-000001', airline: 'Demo Air',
      representativeName: 'Ana Pérez', suggestedEmail: 'ana@demo-air.test', contractId: 'c-1', approvedAt: '2026-11-01T00:00:00Z' }]);
    renderShell();
    const create = await screen.findByRole('button', { name: 'Crear y enviar invitación' });
    expect(screen.queryByLabelText('Contraseña temporal')).not.toBeInTheDocument();
    await userEvent.click(create);
    expect(provisionAirline).toHaveBeenCalledWith('req-1', 'ana@demo-air.test', '');
    expect(await screen.findByText(/enlace de activación válido por 72 horas/)).toBeInTheDocument();
  });
});
