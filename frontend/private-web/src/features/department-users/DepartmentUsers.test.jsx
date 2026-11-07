import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DepartmentAccessProvider } from '../access/DepartmentAccessContext';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import DepartmentUsersPage from './DepartmentUsersPage';
import AccessValidationsPage from './AccessValidationsPage';
import { togglePermission } from './PermissionMatrix';
import {
  createDepartmentAdministrator, getDepartmentOptions, getDepartmentSummary, getPermissionCatalog, listAccessProfiles,
  listAccessRequests, listDepartmentUsers, rejectAccessRequest, requestDepartmentUserAccess, updateDepartmentUser,
  validateAccessRequest,
} from '../../services/departmentGovernanceService';
import { listAccessCandidates, listDepartmentActivity } from '../../services/humanResourcesEmployeesService';
import { generateTemporaryPassword } from './temporaryPassword';

vi.mock('../../services/departmentGovernanceService', async importOriginal => ({
  ...(await importOriginal()),
  getDepartmentSummary: vi.fn(), listDepartmentUsers: vi.fn(), listAccessProfiles: vi.fn(), listAccessRequests: vi.fn(),
  getDepartmentOptions: vi.fn(), getPermissionCatalog: vi.fn(), requestDepartmentUserAccess: vi.fn(),
  validateAccessRequest: vi.fn(), rejectAccessRequest: vi.fn(), createDepartmentAdministrator: vi.fn(),
  updateDepartmentUser: vi.fn(),
}));
vi.mock('../../services/humanResourcesEmployeesService', async importOriginal => ({
  ...(await importOriginal()),
  listAccessCandidates: vi.fn(), listDepartmentActivity: vi.fn(),
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

const candidate = { employeeId: 'emp-1', firstName: 'Luis', lastName: 'Pérez', employeeNumber: 'CON-010',
  position: { id: 'pos-1', name: 'Analista comercial', isRampPosition: false }, suggestedAccessProfileId: null,
  stations: [{ id: 'st-1', code: 'PUJ' }], email: 'luis@example.test', accountStatus: null };

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
  listAccessCandidates.mockResolvedValue([candidate]);
  listDepartmentActivity.mockResolvedValue({ entries: [], nextCursor: null });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); act(() => resetLanguageForTests('es')); });

describe('permission matrix', () => {
  it('grants read with any action and clears the module when read is removed', () => {
    const verify = requestsModule.actions[1];
    const read = requestsModule.actions[0];
    expect(togglePermission([], requestsModule, verify, true)).toEqual(['contracts.requests.read', 'contracts.requests.verify']);
    expect(togglePermission(['contracts.requests.read', 'contracts.requests.verify'], requestsModule, read, false)).toEqual([]);
  });
});

describe('DepartmentUsersPage', () => {
  it('requests access for a registered employee with custom permissions and a stable request id', async () => {
    requestDepartmentUserAccess.mockResolvedValue({ id: 'req-2' });
    renderWith(admin, <DepartmentUsersPage department="contracts" />);
    expect(await screen.findByText('Pendientes de validar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nombrar administrador' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Solicitar acceso' }));
    const form = screen.getByRole('dialog', { name: 'Solicitar acceso para un empleado' });
    expect(within(form).queryByRole('textbox', { name: 'Nombre' })).not.toBeInTheDocument();
    await userEvent.click(await within(form).findByRole('button', { name: /Luis Pérez/ }));
    expect(within(form).getByRole('checkbox', { name: 'PUJ' })).toBeChecked();
    await userEvent.click(within(form).getByRole('radio', { name: 'Permisos personalizados' }));
    await userEvent.click(within(form).getByRole('checkbox', { name: 'Solicitudes: Aprobar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar a Gestión Humana' }));
    expect(requestDepartmentUserAccess).toHaveBeenCalledWith('contracts', expect.objectContaining({
      employeeId: 'emp-1', stationIds: ['st-1'], accessProfileId: null,
      permissionCodes: ['contracts.requests.approve', 'contracts.requests.read'],
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    }));
    expect(requestDepartmentUserAccess.mock.calls[0][1]).not.toHaveProperty('email');
    expect(await screen.findByText(/Gestión Humana la validará/)).toBeInTheDocument();
  });

  it('lets only the super administrator name an administrator from an employee', async () => {
    createDepartmentAdministrator.mockResolvedValue({ id: 'acc-9' });
    renderWith({ ...admin, kind: 'SuperAdministrator', department: null }, <DepartmentUsersPage department="contracts" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Nombrar administrador' }));
    const form = screen.getByRole('dialog', { name: 'Nombrar administrador' });
    await userEvent.click(await within(form).findByRole('button', { name: /Luis Pérez/ }));
    await userEvent.click(within(form).getByRole('button', { name: 'Generar contraseña' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    // 2-N39: the naming carries the intent's Idempotency-Key, so a retry after a lost answer replays it.
    expect(createDepartmentAdministrator).toHaveBeenCalledWith('contracts', expect.objectContaining({
      employeeId: 'emp-1', stationIds: ['st-1'],
      temporaryPassword: expect.stringMatching(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{16}$/),
    }), expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(screen.queryByRole('button', { name: 'Crear sub-usuario' })).not.toBeInTheDocument();
  });

  it('edits a member within the stations of its employee record and explains a transferred account', async () => {
    const member = { id: 'acc-3', firstName: 'Rosa', lastName: 'Solicitudes', email: 'rosa@example.test', kind: 'Member',
      status: 'Active', accessProfileId: null, accessProfileName: null, permissions: ['contracts.requests.read'],
      stations: [{ id: 'st-1', code: 'PUJ' }], mustChangePassword: false, lastLoginAt: null, avatarMediaUrl: null,
      version: 'v-acc-3', employeeStations: [{ id: 'st-1', code: 'PUJ' }] };
    listDepartmentUsers.mockResolvedValue({ page: 1, limit: 25, total: 1, hasMore: false, users: [member] });
    getDepartmentOptions.mockResolvedValue({ stations: [{ id: 'st-1', code: 'PUJ' }, { id: 'st-2', code: 'SDQ' }],
      terminals: [], supervisors: [] });
    renderWith(admin, <DepartmentUsersPage department="contracts" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    const form = screen.getByRole('dialog', { name: 'Editar acceso' });
    // 2-N21: SDQ is the actor's but not the employee's; the edit only offers the employee's stations.
    expect(await within(form).findByRole('checkbox', { name: 'PUJ' })).toBeInTheDocument();
    expect(within(form).queryByRole('checkbox', { name: 'SDQ' })).not.toBeInTheDocument();
    expect(within(form).getByText('Estaciones del expediente del empleado que usted también tiene asignadas.'))
      .toBeInTheDocument();
    // 2-N07: the employee moved to another department; the code is explained, never the server title.
    updateDepartmentUser.mockRejectedValueOnce(Object.assign(new Error('Raw server title'),
      { status: 409, code: 'employee_transferred' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(updateDepartmentUser).toHaveBeenCalledWith('contracts', 'acc-3', expect.objectContaining({
      stationIds: ['st-1'], expectedVersion: 'v-acc-3' }), expect.stringMatching(/^[0-9a-f-]{36}$/));
    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent('se trasladó a otro departamento');
    expect(alert).not.toHaveTextContent('Raw server title');
  });
});

describe('DepartmentUsersPage language', () => {
  it('follows English inside a language scope', async () => {
    act(() => resetLanguageForTests('en'));
    renderWith(admin, <LanguageScope><DepartmentUsersPage department="contracts" /></LanguageScope>);
    expect(await screen.findByRole('heading', { name: 'Department users' })).toBeInTheDocument();
    expect(screen.getByText('Pending validation')).toBeInTheDocument();
    expect(screen.getByText('No users')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Requests/ }));
    expect(screen.getByText('Requested by')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel request' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(await screen.findByText('No activity')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sign-ins' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Request access' }));
    const form = screen.getByRole('dialog', { name: 'Request access for an employee' });
    await userEvent.click(await within(form).findByRole('button', { name: /Luis Pérez/ }));
    expect(within(form).getByRole('radio', { name: 'Custom permissions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send to Human Resources' })).toBeInTheDocument();
  });

  it('stays in Spanish outside a language scope even when English was chosen', async () => {
    act(() => resetLanguageForTests('en'));
    renderWith(admin, <DepartmentUsersPage department="contracts" />);
    expect(await screen.findByRole('heading', { name: 'Usuarios del departamento' })).toBeInTheDocument();
    expect(screen.getByText('Pendientes de validar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Solicitar acceso' })).toBeInTheDocument();
  });
});

describe('temporary password generator', () => {
  it('always satisfies the policy and avoids look-alike characters', () => {
    for (let index = 0; index < 200; index += 1) {
      const password = generateTemporaryPassword();
      expect(password).toMatch(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{16}$/);
      expect(password).not.toMatch(/[0O1lI]/);
    }
    expect(() => generateTemporaryPassword(10)).toThrow(RangeError);
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

  it('explains a request whose administrator left the department and re-reads the queue (2-N33)', async () => {
    validateAccessRequest.mockRejectedValue(Object.assign(new Error('Raw server title'),
      { status: 409, code: 'requester_no_longer_administrator' }));
    renderWith(validator, <AccessValidationsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Validar' }));
    await userEvent.type(screen.getByLabelText('Contraseña temporal'), 'Synthetic-Member!5678');
    await userEvent.click(screen.getByRole('button', { name: 'Validar y crear cuenta' }));
    const alert = await screen.findByText(/Quien pidió este acceso ya no administra el departamento/);
    expect(alert).not.toHaveTextContent('Raw server title');
    expect(listAccessRequests.mock.calls.length).toBeGreaterThan(1);
  });

  it('hides decisions from accounts that cannot validate', async () => {
    renderWith({ ...validator, canValidateAccessRequests: false }, <AccessValidationsPage />);
    expect(await screen.findByText('Rosa Solicitudes')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Validar' })).not.toBeInTheDocument();
  });
});
