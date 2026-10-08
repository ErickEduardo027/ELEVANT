import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DepartmentAccessProvider } from '../access/DepartmentAccessContext';
import DepartmentUsersPage from './DepartmentUsersPage';
import AccessValidationsPage from './AccessValidationsPage';
import { togglePermission } from './PermissionMatrix';
import {
  getDepartmentOptions, getDepartmentSummary, getPermissionCatalog, listAccessProfiles, listAccessRequests,
  listDepartmentUsers, rejectAccessRequest, requestDepartmentUserAccess, validateAccessRequest,
} from '../../services/departmentGovernanceService';

vi.mock('../../services/departmentGovernanceService', async importOriginal => ({
  ...(await importOriginal()),
  getDepartmentSummary: vi.fn(), listDepartmentUsers: vi.fn(), listAccessProfiles: vi.fn(), listAccessRequests: vi.fn(),
  getDepartmentOptions: vi.fn(), getPermissionCatalog: vi.fn(), requestDepartmentUserAccess: vi.fn(),
  validateAccessRequest: vi.fn(), rejectAccessRequest: vi.fn(),
}));
vi.mock('../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() }),
}));
vi.mock('../../services/commercialGovernanceApi', () => ({ commercialApi: vi.fn(), uploadCommercialMedia: vi.fn(), getRampProfiles: vi.fn(), saveRampProfile: vi.fn() }));

const requestsModule = { key: 'requests', label: 'Solicitudes', actions: [
  { code: 'contracts.requests.read', action: 'read', label: 'Ver' },
  { code: 'contracts.requests.verify', action: 'verify', label: 'Verificar aerolínea' },
  { code: 'contracts.requests.approve', action: 'approve', label: 'Aprobar' },
] };
const catalog = [{ department: 'contracts', label: 'Contratos', modules: [requestsModule] }];
const summary = { department: 'contracts', label: 'Contratos', administrators: 1, members: 0, rampAgents: 0, inactive: 0,
  pendingRequests: 1, pendingFirstLogin: 0, activeProfiles: 0 };
const pending = { id: 'req-1', department: 'contracts', kind: 'BackOfficeUser', status: 'Pending', requestedBy: 'Carla Admin',
  requestedAt: '2026-10-07T10:00:00Z', firstName: 'Rosa', lastName: 'Solicitudes', email: 'rosa@example.test',
  permissions: ['contracts.requests.read'], stations: [{ id: 'st-1', code: 'PUJ' }], terminals: [], version: 'v1' };
const admin = { kind: 'Administrator', department: 'contracts', permissions: [], stations: [{ id: 'st-1', code: 'PUJ' }],
  canManageDepartmentUsers: true, canValidateAccessRequests: false };

function renderWith(access, ui) {
  return render(<DepartmentAccessProvider observe={false} initialAccess={access}>{ui}</DepartmentAccessProvider>);
}

beforeEach(() => {
  getDepartmentSummary.mockResolvedValue(summary);
  listDepartmentUsers.mockResolvedValue({ page: 1, limit: 25, total: 0, hasMore: false, users: [] });
  listAccessProfiles.mockResolvedValue([]);
  listAccessRequests.mockResolvedValue({ page: 1, limit: 50, hasMore: false, requests: [pending] });
  getDepartmentOptions.mockResolvedValue({ stations: [{ id: 'st-1', code: 'PUJ' }], terminals: [], supervisors: [] });
  getPermissionCatalog.mockResolvedValue(catalog);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('permission matrix', () => {
  it('grants read with any action and clears the module when read is removed', () => {
    const verify = requestsModule.actions[1];
    const read = requestsModule.actions[0];
    expect(togglePermission([], requestsModule, verify, true)).toEqual(['contracts.requests.read', 'contracts.requests.verify']);
    expect(togglePermission(['contracts.requests.read', 'contracts.requests.verify'], requestsModule, read, false)).toEqual([]);
  });
});

describe('DepartmentUsersPage', () => {
  it('lets an administrator request an account with custom permissions and a stable request id', async () => {
    requestDepartmentUserAccess.mockResolvedValue({ id: 'req-2' });
    renderWith(admin, <DepartmentUsersPage department="contracts" />);
    expect(await screen.findByText('Pendientes de validar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear administrador' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Solicitar alta' }));
    const form = screen.getByRole('dialog', { name: 'Solicitar alta de usuario' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'Nombre' }), 'Luis');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Apellido' }), 'Pérez');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Correo de acceso' }), 'luis@example.test');
    await userEvent.click(within(form).getByRole('checkbox', { name: 'PUJ' }));
    await userEvent.click(within(form).getByRole('radio', { name: 'Permisos personalizados' }));
    await userEvent.click(within(form).getByRole('checkbox', { name: 'Aprobar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar a Gestión Humana' }));
    expect(requestDepartmentUserAccess).toHaveBeenCalledWith('contracts', expect.objectContaining({
      kind: 'BackOfficeUser', email: 'luis@example.test', stationIds: ['st-1'], accessProfileId: null,
      permissionCodes: ['contracts.requests.approve', 'contracts.requests.read'],
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    }));
    expect(await screen.findByText(/Gestión Humana la validará/)).toBeInTheDocument();
  });

  it('offers direct creation of administrators only to the super administrator', async () => {
    renderWith({ ...admin, kind: 'SuperAdministrator', department: null }, <DepartmentUsersPage department="contracts" />);
    expect(await screen.findByRole('button', { name: 'Crear administrador' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Solicitar alta' })).not.toBeInTheDocument();
  });
});

describe('AccessValidationsPage', () => {
  const validator = { kind: 'Administrator', department: 'human-resources', permissions: [], stations: [],
    canManageDepartmentUsers: true, canValidateAccessRequests: true };

  it('validates a request with the temporary password and its version', async () => {
    validateAccessRequest.mockResolvedValue({ id: 'account-1' });
    renderWith(validator, <AccessValidationsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Validar' }));
    await userEvent.type(screen.getByLabelText('Contraseña temporal'), 'Synthetic-Member!5678');
    await userEvent.click(screen.getByRole('button', { name: 'Validar y crear cuenta' }));
    expect(validateAccessRequest).toHaveBeenCalledWith('req-1', 'Synthetic-Member!5678', 'v1');
    expect(await screen.findByText(/Cuenta de Rosa Solicitudes creada/)).toBeInTheDocument();
  });

  it('requires a reason to reject and reports a concurrent decision', async () => {
    rejectAccessRequest.mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }));
    renderWith(validator, <AccessValidationsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Rechazar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Rechazar solicitud' }));
    expect(rejectAccessRequest).not.toHaveBeenCalled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Motivo del rechazo' }), 'Correo personal');
    await userEvent.click(screen.getByRole('button', { name: 'Rechazar solicitud' }));
    expect(rejectAccessRequest).toHaveBeenCalledWith('req-1', 'Correo personal', 'v1');
    expect(await screen.findByText(/ya fue resuelta/)).toBeInTheDocument();
  });

  it('hides decisions from accounts that cannot validate', async () => {
    renderWith({ ...validator, canValidateAccessRequests: false }, <AccessValidationsPage />);
    expect(await screen.findByText('Rosa Solicitudes')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Validar' })).not.toBeInTheDocument();
  });
});
