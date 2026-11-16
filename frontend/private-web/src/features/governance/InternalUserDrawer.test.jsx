import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InternalUserDrawer from './InternalUserDrawer';
import { createInternalUser } from '../../services/departmentGovernanceService';

vi.mock('../../services/departmentGovernanceService', async importOriginal => ({
  ...(await importOriginal()),
  createInternalUser: vi.fn(),
  getDepartmentOptions: vi.fn().mockResolvedValue({ stations: [{ id: 'st-puj', code: 'PUJ', name: 'Punta Cana' }], terminals: [], supervisors: [] }),
  getPermissionCatalog: vi.fn().mockResolvedValue([{ department: 'contracts', label: 'Contratos', modules: [
    { key: 'home', label: 'Inicio', section: 'Gestión contractual', parent: null, actions: [
      { code: 'contracts.home.read', action: 'read', label: 'Ver', kind: 'read' }] },
    { key: 'catalog', label: 'Servicios', section: 'Oferta', parent: null, actions: [
      { code: 'contracts.catalog.read', action: 'read', label: 'Ver', kind: 'read' },
      { code: 'contracts.catalog.create', action: 'create', label: 'Crear', kind: 'create' }] },
    { key: 'service_closures', label: 'Solicitudes de clausura', section: 'Oferta', parent: 'catalog', actions: [
      { code: 'contracts.service_closures.read', action: 'read', label: 'Ver', kind: 'read' }] },
  ] }]),
}));
vi.mock('../../services/humanResourcesEmployeesService', async importOriginal => ({
  ...(await importOriginal()),
  listPositions: vi.fn().mockResolvedValue([
    { id: 'pos-analyst', name: 'Analista comercial', isActive: true, isRampPosition: false },
    { id: 'pos-ramp', name: 'Agente de rampa', isActive: true, isRampPosition: true }]),
}));

beforeEach(() => { createInternalUser.mockResolvedValue({ id: 'acc-1' }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('creates a Contracts member with only «Servicios: Ver» in one step, without HR', async () => {
  const onCreated = vi.fn();
  render(<InternalUserDrawer open initialDepartment="contracts" onClose={vi.fn()} onCreated={onCreated} />);
  const type = (label, value) => userEvent.type(screen.getByLabelText(label), value);
  await type('Nombre', 'Sofía');
  await type('Apellido', 'Catálogo');
  await userEvent.selectOptions(screen.getByLabelText('Tipo de documento'), 'CEDULA');
  await type('Número de documento', '402-1234567-8');
  await type('Número de empleado', 'QA-CON-020');
  const position = await screen.findByRole('option', { name: 'Analista comercial' });
  expect(screen.queryByRole('option', { name: 'Agente de rampa' })).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Puesto'), position);
  await type('Correo corporativo (usuario de acceso)', 'sofia.catalogo@dev.elevant.test');
  await userEvent.click(await screen.findByRole('checkbox', { name: 'PUJ · Punta Cana' }));

  // Submitting without permissions is refused before calling the API.
  await userEvent.click(screen.getByRole('button', { name: 'Crear usuario' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Marca al menos un permiso');

  const services = await screen.findByRole('radiogroup', { name: 'Acceso: Servicios' });
  await userEvent.click(within(services).getByRole('radio', { name: 'Ver' }));
  await userEvent.click(screen.getByRole('button', { name: 'Generar contraseña' }));
  await userEvent.click(screen.getByRole('button', { name: 'Crear usuario' }));

  expect(createInternalUser).toHaveBeenCalledTimes(1);
  const [department, payload] = createInternalUser.mock.calls[0];
  expect(department).toBe('contracts');
  expect(payload).toMatchObject({
    kind: 'member', stationIds: ['st-puj'], permissionCodes: ['contracts.catalog.read'],
    employee: { firstName: 'Sofía', department: 'contracts', positionId: 'pos-analyst', identificationType: 'CEDULA',
      corporateEmail: 'sofia.catalogo@dev.elevant.test', stationIds: ['st-puj'] },
  });
  expect(payload.temporaryPassword.length).toBeGreaterThanOrEqual(14);
  expect(onCreated).toHaveBeenCalledWith({ id: 'acc-1' }, expect.stringContaining('Sofía Catálogo ya puede entrar'));
  // The whole form is typed key by key: a loaded full run needs more than the default 5 s.
}, 15_000);

it('opens with a Dominican passport whose «RD» the form writes', async () => {
  render(<InternalUserDrawer open initialDepartment="contracts" onClose={vi.fn()} onCreated={vi.fn()} />);
  expect(screen.getByLabelText('Tipo de documento')).toHaveValue('PASAPORTE');
  await userEvent.type(screen.getByLabelText('Número de documento'), '1234567');
  expect(screen.getByLabelText('Número de documento')).toHaveValue('1234567');
  expect(screen.queryByText(/pasaporte dominicano/i)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pasaporte extranjero' }));
  expect(screen.getByLabelText('Número de documento')).toHaveValue('1234567');
});

it('grants a member one level per option in the superadmin matrix', async () => {
  render(<InternalUserDrawer open initialDepartment="contracts" onClose={vi.fn()} onCreated={vi.fn()} />);
  const services = await screen.findByRole('radiogroup', { name: 'Acceso: Servicios' });
  expect(within(services).getAllByRole('radio').map(radio => radio.textContent)).toEqual(['Sin acceso', 'Ver', 'Crear']);
  await userEvent.click(within(services).getByRole('radio', { name: 'Crear' }));
  expect(within(services).getByRole('radio', { name: 'Crear' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('checkbox', { name: 'Servicios: Crear' })).toBeChecked();
  expect(within(screen.getByRole('radiogroup', { name: 'Acceso: Inicio' })).getAllByRole('radio')).toHaveLength(2);
});
