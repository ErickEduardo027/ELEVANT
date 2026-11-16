import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfilesPanel from './ProfilesPanel';
import { saveAccessProfile } from '../../services/departmentGovernanceService';

vi.mock('../../services/departmentGovernanceService', async importOriginal => ({
  ...(await importOriginal()), saveAccessProfile: vi.fn(), deactivateAccessProfile: vi.fn(),
}));

const action = (module, name, label, kind) => ({ code: `finance.${module}.${name}`, action: name, label, kind });
const catalog = { department: 'finance', label: 'Finanzas', modules: [
  { key: 'tariffs', label: 'Tarifario de servicios', section: 'Configuración', parent: null, actions: [
    action('tariffs', 'read', 'Ver', 'read'), action('tariffs', 'create', 'Crear borradores', 'create'),
    action('tariffs', 'update', 'Editar borradores', 'update'), action('tariffs', 'delete', 'Eliminar borradores', 'delete'),
    action('tariffs', 'publish', 'Publicar tarifas', 'other')] },
  { key: 'reports', label: 'Reportes', section: 'Reportes', parent: null, actions: [
    action('reports', 'read', 'Ver', 'read'), action('reports', 'export', 'Exportar', 'other')] },
] };

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('builds a role template with the four levels and saves the same catalog codes', async () => {
  saveAccessProfile.mockResolvedValue({ id: 'prof-1' });
  const onChanged = vi.fn();
  render(<ProfilesPanel department="finance" profiles={[]} catalog={catalog} onChanged={onChanged} />);
  await userEvent.click(screen.getByRole('button', { name: 'Nueva plantilla' }));
  const drawer = screen.getByRole('dialog', { name: 'Nueva plantilla de rol' });
  await userEvent.type(within(drawer).getByRole('textbox', { name: 'Nombre' }), 'Tarifas');

  const tariffs = within(drawer).getByRole('radiogroup', { name: 'Acceso: Tarifario de servicios' });
  expect(within(tariffs).getAllByRole('radio').map(radio => radio.textContent)).toEqual(['Sin acceso', 'Ver', 'Crear', 'Editar', 'Completo']);
  // Reading reports includes exporting them, so the option only offers «Ver».
  expect(within(within(drawer).getByRole('radiogroup', { name: 'Acceso: Reportes' })).getAllByRole('radio').map(radio => radio.textContent))
    .toEqual(['Sin acceso', 'Ver']);
  await userEvent.click(within(tariffs).getByRole('radio', { name: 'Editar' }));
  await userEvent.click(within(within(drawer).getByRole('radiogroup', { name: 'Acceso: Reportes' })).getByRole('radio', { name: 'Ver' }));
  await userEvent.click(screen.getByRole('button', { name: 'Guardar plantilla' }));

  expect(saveAccessProfile).toHaveBeenCalledWith('finance', undefined, expect.objectContaining({
    name: 'Tarifas', permissionCodes: ['finance.reports.export', 'finance.reports.read', 'finance.tariffs.create',
      'finance.tariffs.publish', 'finance.tariffs.read', 'finance.tariffs.update'],
  }), expect.any(String));
});

it('opens a stored template whose grants match no level as «Personalizado» without losing them', async () => {
  const profile = { id: 'prof-2', name: 'Solo borrar', description: null, members: 1, isActive: true, version: 'v1',
    permissions: ['finance.tariffs.delete', 'finance.tariffs.read'] };
  render(<ProfilesPanel department="finance" profiles={[profile]} catalog={catalog} onChanged={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
  const drawer = screen.getByRole('dialog', { name: 'Editar plantilla' });
  expect(within(drawer).getByText('Personalizado')).toBeInTheDocument();
  expect(within(drawer).getByRole('checkbox', { name: 'Tarifario de servicios: Eliminar borradores' })).toBeChecked();
  await userEvent.click(within(within(drawer).getByRole('radiogroup', { name: 'Acceso: Tarifario de servicios' })).getByRole('radio', { name: 'Completo' }));
  expect(within(drawer).queryByText('Personalizado')).not.toBeInTheDocument();
  expect(within(drawer).getByRole('checkbox', { name: 'Tarifario de servicios: Publicar tarifas' })).toBeChecked();
});
