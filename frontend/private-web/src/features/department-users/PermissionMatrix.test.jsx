import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import PermissionMatrix, { accessLevel, actionKind, matrixSections, setAccessLevel } from './PermissionMatrix';

const action = (module, name, label, kind) => ({ code: `contracts.${module}.${name}`, action: name, label, kind });
const catalog = {
  department: 'contracts', label: 'Contratos', modules: [
    { key: 'agreements', label: 'Contratos', section: 'Gestión contractual', parent: null,
      actions: [action('agreements', 'read', 'Ver', 'read')] },
    { key: 'catalog', label: 'Servicios', section: 'Oferta', parent: null, actions: [
      action('catalog', 'read', 'Ver', 'read'), action('catalog', 'create', 'Crear', 'create'),
      action('catalog', 'update', 'Modificar', 'update'), action('catalog', 'delete', 'Retirar', 'delete')] },
    { key: 'service_closures', label: 'Solicitudes de clausura', section: 'Oferta', parent: 'catalog', actions: [
      action('service_closures', 'read', 'Ver', 'read'), action('service_closures', 'decide', 'Aprobar o denegar', 'other')] },
  ],
};

afterEach(cleanup);

it('groups menu options like the sidebar and nests the functions that live inside an option', () => {
  const sections = matrixSections(catalog);
  expect(sections.map(section => section.name)).toEqual(['Gestión contractual', 'Oferta']);
  expect(sections[1].rows.map(row => [row.module.key, row.depth])).toEqual([['catalog', 0], ['service_closures', 1]]);
});

it('shows one row per option with Ver, Crear, Modificar, Eliminar and other actions', async () => {
  const onChange = vi.fn();
  render(<PermissionMatrix catalog={catalog} value={[]} onChange={onChange} />);

  const offer = screen.getByRole('region', { name: 'Oferta' });
  expect(within(offer).getAllByRole('columnheader').map(cell => cell.textContent))
    .toEqual(['Opción del menú', 'Acceso', 'Ver', 'Crear', 'Modificar', 'Eliminar', 'Otras acciones']);
  const services = within(offer).getByRole('row', { name: /^Servicios/ });
  expect(within(services).getAllByRole('checkbox')).toHaveLength(4);
  expect(within(services).getByText('Retirar')).toBeInTheDocument();
  const closures = within(offer).getByRole('row', { name: /Solicitudes de clausura/ });

  await userEvent.click(screen.getByRole('checkbox', { name: 'Servicios: Crear' }));
  expect(onChange).toHaveBeenCalledWith(['contracts.catalog.create', 'contracts.catalog.read']);
  // Closures live inside Servicios: while Servicios is forbidden they cannot be granted.
  expect(screen.getByRole('checkbox', { name: 'Solicitudes de clausura: Aprobar o denegar' })).toBeDisabled();
  expect(within(closures).getByText('Bloqueada: Servicios está prohibida')).toBeInTheDocument();
});

function Stateful({ initial = [] }) {
  const [value, setValue] = useState(initial);
  return <><PermissionMatrix catalog={catalog} value={value} onChange={setValue} /><output data-testid="codes">{value.join(' ')}</output></>;
}
const codes = () => screen.getByTestId('codes').textContent.split(' ').filter(Boolean);

it('applies the quick levels Prohibido, Ver and Editar per option and sub-window', async () => {
  render(<Stateful />);
  const services = screen.getByRole('radiogroup', { name: 'Acceso: Servicios' });
  await userEvent.click(within(services).getByRole('radio', { name: 'Ver' }));
  expect(codes()).toEqual(['contracts.catalog.read']);
  expect(within(services).getByRole('radio', { name: 'Ver' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByText('dentro de Servicios')).toBeInTheDocument();

  await userEvent.click(within(services).getByRole('radio', { name: 'Editar' }));
  expect(codes()).toEqual(['contracts.catalog.create', 'contracts.catalog.delete', 'contracts.catalog.read', 'contracts.catalog.update']);

  const closures = screen.getByRole('radiogroup', { name: 'Acceso: Solicitudes de clausura' });
  // A read-and-workflow option has no «Editar» level.
  expect(within(closures).queryByRole('radio', { name: 'Editar' })).not.toBeInTheDocument();
  await userEvent.click(within(closures).getByRole('radio', { name: 'Ver' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Solicitudes de clausura: Aprobar o denegar' }));
  expect(within(closures).getByText('Personalizado')).toBeInTheDocument();

  // Forbidding Servicios also forbids the closures that live inside it.
  await userEvent.click(within(services).getByRole('radio', { name: 'Prohibido' }));
  expect(codes()).toEqual([]);
});

it('grants the containing screen when a sub-window is granted', () => {
  const closures = catalog.modules[2];
  expect(setAccessLevel([], closures, 'read', catalog)).toEqual(['contracts.catalog.read', 'contracts.service_closures.read']);
  expect(accessLevel(['contracts.catalog.read', 'contracts.catalog.create'], catalog.modules[1])).toBe('custom');
  expect(accessLevel([], catalog.modules[1])).toBe('none');
});

it('clears an option entirely when «Ver» is removed', async () => {
  const onChange = vi.fn();
  render(<PermissionMatrix catalog={catalog} value={['contracts.catalog.create', 'contracts.catalog.read']} onChange={onChange} />);
  await userEvent.click(screen.getByRole('checkbox', { name: 'Servicios: Ver' }));
  expect(onChange).toHaveBeenCalledWith([]);
});

it('understands catalogs published before actions carried a kind', () => {
  expect(actionKind({ action: 'edit' })).toBe('update');
  expect(actionKind({ action: 'retire' })).toBe('delete');
  expect(actionKind({ action: 'approve' })).toBe('other');
});
