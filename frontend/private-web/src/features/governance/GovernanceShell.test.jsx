import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GovernanceShell from './GovernanceShell';
import { createRole, createUser, getGovernance } from '../../services/commercialGovernanceApi';

vi.mock('../../services/commercialGovernanceApi', () => ({
  getGovernance: vi.fn(),
  getProvisioning: vi.fn().mockResolvedValue([]),
  getManagedAirlines: vi.fn().mockResolvedValue([]),
  listGovernanceRampMobileAccessRequests: vi.fn().mockResolvedValue([]),
  createRole: vi.fn().mockResolvedValue({ id: 'role-new' }),
  createUser: vi.fn().mockResolvedValue({ id: 'user-new' }),
}));
vi.mock('../../hooks/useCommercialRevalidation', () => ({ useCommercialRevalidation: vi.fn() }));
vi.mock('../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({ start: vi.fn(), stop: vi.fn() }),
}));

const snapshot = {
  roles: [{ id: 'role-occ', code: 'OCC', name: 'OCC', description: null, portal: 'BackOffice',
    isCustom: false, isActive: true, permissions: [], activeUsers: 0 }],
  users: [],
  permissionCodes: ['commercial.catalog.read', 'commercial.catalog.create', 'commercial.catalog.edit',
    'commercial.catalog.full', 'commercial.catalog.write', 'commercial.requests.read',
    'commercial.requests.edit', 'commercial.requests.full', 'commercial.requests.write'],
  recentAudit: [],
  rampProfiles: [],
};

beforeEach(() => { getGovernance.mockResolvedValue(snapshot); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function openUsersTab(tab) {
  render(<GovernanceShell user={{ name: 'Super Admin' }} onLogout={vi.fn()} />);
  await userEvent.click(within(await screen.findByRole('navigation')).getByText('Usuarios'));
  await userEvent.click(screen.getByRole('tab', { name: tab }));
}

describe('GovernanceShell roles', () => {
  it('offers independent capabilities starting at Ver', async () => {
    await openUsersTab('Roles y permisos');
    const catalog = screen.getByRole('combobox', { name: 'Servicios' });
    const requests = screen.getByRole('combobox', { name: 'Solicitudes y borradores' });
    expect(within(catalog).getAllByRole('option').map(option => option.textContent))
      .toEqual(['Ver', 'Crear', 'Editar', 'Acceso completo']);
    expect(within(requests).getAllByRole('option').map(option => option.textContent))
      .toEqual(['Ver', 'Editar', 'Acceso completo']);
    expect(catalog).toHaveValue('read');
    expect(requests).toHaveValue('read');
  });

  it.each([
    ['read', ['commercial.catalog.read']],
    ['create', ['commercial.catalog.read', 'commercial.catalog.create']],
    ['edit', ['commercial.catalog.read', 'commercial.catalog.edit']],
    ['full', ['commercial.catalog.read', 'commercial.catalog.create', 'commercial.catalog.edit', 'commercial.catalog.full']],
  ])('sends the existing permission codes for %s', async (level, catalogCodes) => {
    await openUsersTab('Roles y permisos');
    await userEvent.type(screen.getByRole('textbox', { name: 'Nombre' }), 'Analista');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Servicios' }), level);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar rol' }));
    expect(createRole).toHaveBeenCalledWith({ name: 'Analista', description: '',
      permissionCodes: [...catalogCodes, 'commercial.requests.read'], isActive: true });
  });
});

describe('GovernanceShell users', () => {
  async function fillUser(password) {
    await openUsersTab('Usuarios');
    await userEvent.type(screen.getByRole('textbox', { name: 'Nombre' }), 'Ana');
    await userEvent.type(screen.getByRole('textbox', { name: 'Apellido' }), 'Prueba');
    await userEvent.type(screen.getByRole('textbox', { name: 'Correo de acceso' }), 'ana@example.test');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Rol' }), 'role-occ');
    await userEvent.type(screen.getByLabelText('Contraseña temporal'), password);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar usuario' }));
  }

  it('blocks a temporary password that the API password policy rejects', async () => {
    await fillUser('abcdefghijklmn');
    expect(createUser).not.toHaveBeenCalled();
  });

  it('creates the user and refreshes the governance snapshot', async () => {
    await fillUser('Synthetic-Pass!1234');
    expect(createUser).toHaveBeenCalledWith({ firstName: 'Ana', lastName: 'Prueba',
      email: 'ana@example.test', roleId: 'role-occ', rampAgentId: null,
      temporaryPassword: 'Synthetic-Pass!1234', isActive: true, avatarMediaUrl: null });
    expect(await screen.findByText('Usuario creado. Entregue la contraseña temporal manualmente.')).toBeInTheDocument();
    expect(getGovernance).toHaveBeenCalledTimes(2);
  });
});
