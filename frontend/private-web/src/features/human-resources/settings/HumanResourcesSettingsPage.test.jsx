import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HumanResourcesSettingsPage from './HumanResourcesSettingsPage';
import {
  listEquipmentTypes, listPermitTypes, saveEquipmentType, savePermitType,
} from '../../../services/humanResourcesSettingsService';

vi.mock('../../../services/humanResourcesSettingsService', async importOriginal => ({
  ...(await importOriginal()),
  listPermitTypes: vi.fn(), savePermitType: vi.fn(), listEquipmentTypes: vi.fn(), saveEquipmentType: vi.fn(),
}));

const system = [
  { id: null, code: 'AirportId', name: 'Carnet aeroportuario', description: null, isActive: true, isSystem: true, inUse: true, version: null },
  { id: null, code: 'RampDriverLicense', name: 'Licencia de conducir en rampa', description: null, isActive: true, isSystem: true, inUse: true, version: null },
];
const restricted = { id: 'p1', code: 'ZONA-RESTRINGIDA', name: 'Carnet de zona restringida', description: null, isActive: true,
  isSystem: false, inUse: true, version: 'v1' };
const bridge = { id: 'e1', code: 'BOARDING-BRIDGE', name: 'Puente de abordaje', requiresQualification: true, isActive: true,
  isLocked: true, inUse: true, version: 'v2' };
const problem = (status, code) => Object.assign(new Error(code), { status, code });

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('lists the system permit types as not editable and creates a custom one with its key', async () => {
  listPermitTypes.mockResolvedValue({ permitTypes: [...system], canCreate: true, canUpdate: true });
  savePermitType.mockResolvedValue(restricted);
  const user = userEvent.setup();
  render(<HumanResourcesSettingsPage />);
  expect(await screen.findByText('Carnet aeroportuario')).toBeInTheDocument();
  expect(screen.getAllByText('Del sistema')).toHaveLength(2);
  expect(screen.getAllByText('No editable')).toHaveLength(2);

  await user.click(screen.getByRole('button', { name: 'Nuevo tipo de carnet' }));
  const dialog = screen.getByRole('dialog', { name: 'Nuevo tipo de carnet' });
  await user.type(within(dialog).getByRole('textbox', { name: /Nombre/ }), 'Carnet de zona restringida');
  await user.type(within(dialog).getByRole('textbox', { name: /Código/ }), 'zona-restringida');
  listPermitTypes.mockResolvedValue({ permitTypes: [...system, restricted], canCreate: true, canUpdate: true });
  await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
  expect(await screen.findByText('Tipo «Carnet de zona restringida» creado.')).toBeInTheDocument();
  expect(savePermitType).toHaveBeenCalledWith(null, { code: 'ZONA-RESTRINGIDA', name: 'Carnet de zona restringida',
    description: null }, expect.stringMatching(/^[0-9a-f-]{36}$/));
});

it('explains a refused deactivation by its code and re-reads the list', async () => {
  listPermitTypes.mockResolvedValue({ permitTypes: [...system, restricted], canCreate: false, canUpdate: true });
  savePermitType.mockRejectedValue(problem(409, 'code_in_use'));
  const user = userEvent.setup();
  render(<HumanResourcesSettingsPage />);
  await user.click(await screen.findByRole('button', { name: 'Editar' }));
  const dialog = screen.getByRole('dialog', { name: 'Editar «Carnet de zona restringida»' });
  // In use: its code is fixed.
  expect(within(dialog).getByRole('textbox', { name: /Código/ })).toBeDisabled();
  await user.click(within(dialog).getByRole('checkbox', { name: /Activo/ }));
  await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Está en uso/);
  expect(savePermitType).toHaveBeenCalledWith('p1', expect.objectContaining({ isActive: false, expectedVersion: 'v1' }),
    expect.any(String));
  expect(listPermitTypes).toHaveBeenCalledTimes(2);
});

it('shows the unauthorized state without retry, a recoverable error with retry, and the equipment tab', async () => {
  listPermitTypes.mockRejectedValueOnce(problem(403, 'forbidden'));
  const user = userEvent.setup();
  const view = render(<HumanResourcesSettingsPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Tu acceso no permite gestionar la configuración');
  expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  view.unmount();

  listPermitTypes.mockRejectedValueOnce(new TypeError('network')).mockResolvedValue({ permitTypes: system, canCreate: false, canUpdate: false });
  render(<HumanResourcesSettingsPage />);
  await user.click(await screen.findByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('Carnet aeroportuario')).toBeInTheDocument();

  listEquipmentTypes.mockResolvedValue({ equipmentTypes: [bridge], canCreate: true, canUpdate: true });
  saveEquipmentType.mockResolvedValue({ ...bridge, name: 'Pasarela' });
  await user.click(screen.getByRole('tab', { name: 'Equipos de habilitación' }));
  expect(await screen.findByText('Puente de abordaje')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Editar' }));
  const dialog = screen.getByRole('dialog', { name: 'Editar «Puente de abordaje»' });
  expect(within(dialog).getByRole('textbox', { name: /Código/ })).toBeDisabled();
  expect(within(dialog).getByRole('checkbox', { name: 'Activo' })).toBeDisabled();
});

it('shows the empty state of the equipment tab', async () => {
  listPermitTypes.mockResolvedValue({ permitTypes: system, canCreate: false, canUpdate: false });
  listEquipmentTypes.mockResolvedValue({ equipmentTypes: [], canCreate: false, canUpdate: false });
  const user = userEvent.setup();
  render(<HumanResourcesSettingsPage />);
  await user.click(screen.getByRole('tab', { name: 'Equipos de habilitación' }));
  expect(await screen.findByText('Sin equipos de habilitación')).toBeInTheDocument();
});
