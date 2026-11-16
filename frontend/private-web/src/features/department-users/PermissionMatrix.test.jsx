import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
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

afterEach(() => { cleanup(); act(() => resetLanguageForTests('es')); });

it('groups menu options like the sidebar and nests the functions that live inside an option', () => {
  const sections = matrixSections(catalog);
  expect(sections.map(section => section.name)).toEqual(['Gestión contractual', 'Oferta']);
  expect(sections[1].rows.map(row => [row.module.key, row.depth])).toEqual([['catalog', 0], ['service_closures', 1]]);
});

it('shows one level selector per option with only the levels that grant something new', () => {
  render(<PermissionMatrix catalog={catalog} value={[]} onChange={vi.fn()} />);
  const offer = screen.getByRole('region', { name: 'Oferta' });
  expect(within(offer).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Opción del menú', 'Acceso']);
  const radios = name => within(screen.getByRole('radiogroup', { name: `Acceso: ${name}` })).getAllByRole('radio').map(radio => radio.textContent);
  expect(radios('Servicios')).toEqual(['Sin acceso', 'Ver', 'Crear', 'Editar', 'Completo']);
  expect(radios('Contratos')).toEqual(['Sin acceso', 'Ver']);
  // «Aprobar o denegar» is day-to-day work: the closures go from «Ver» straight to «Editar».
  expect(radios('Solicitudes de clausura')).toEqual(['Sin acceso', 'Ver', 'Editar']);
  // Closures live inside Servicios: while Servicios has no access they cannot be granted.
  expect(within(screen.getByRole('radiogroup', { name: 'Acceso: Solicitudes de clausura' })).getByRole('radio', { name: 'Ver' })).toBeDisabled();
  expect(screen.getByText('Bloqueada: Servicios está sin acceso')).toBeInTheDocument();
});

function Stateful({ initial = [] }) {
  const [value, setValue] = useState(initial);
  return <><PermissionMatrix catalog={catalog} value={value} onChange={setValue} /><output data-testid="codes">{value.join(' ')}</output></>;
}
const codes = () => screen.getByTestId('codes').textContent.split(' ').filter(Boolean);

it('applies Ver, Crear, Editar and Completo cumulatively, with delete only in Completo', async () => {
  render(<Stateful />);
  const services = screen.getByRole('radiogroup', { name: 'Acceso: Servicios' });
  await userEvent.click(within(services).getByRole('radio', { name: 'Ver' }));
  expect(codes()).toEqual(['contracts.catalog.read']);
  expect(within(services).getByRole('radio', { name: 'Ver' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByText('dentro de Servicios')).toBeInTheDocument();
  await userEvent.click(within(services).getByRole('radio', { name: 'Crear' }));
  expect(codes()).toEqual(['contracts.catalog.create', 'contracts.catalog.read']);
  await userEvent.click(within(services).getByRole('radio', { name: 'Editar' }));
  expect(codes()).toEqual(['contracts.catalog.create', 'contracts.catalog.read', 'contracts.catalog.update']);
  await userEvent.click(within(services).getByRole('radio', { name: 'Completo' }));
  expect(codes()).toEqual(['contracts.catalog.create', 'contracts.catalog.delete', 'contracts.catalog.read', 'contracts.catalog.update']);

  const closures = screen.getByRole('radiogroup', { name: 'Acceso: Solicitudes de clausura' });
  await userEvent.click(within(closures).getByRole('radio', { name: 'Editar' }));
  expect(codes()).toContain('contracts.service_closures.decide');

  // No access to Servicios also removes the closures that live inside it.
  await userEvent.click(within(services).getByRole('radio', { name: 'Sin acceso' }));
  expect(codes()).toEqual([]);
});

it('shows stored grants that match no level as «Personalizado» and keeps every action in the detail', async () => {
  render(<Stateful initial={['contracts.catalog.delete', 'contracts.catalog.read']} />);
  const services = screen.getByRole('radiogroup', { name: 'Acceso: Servicios' });
  expect(within(services).getAllByRole('radio').every(radio => radio.getAttribute('aria-checked') === 'false')).toBe(true);
  const row = screen.getByRole('row', { name: /^Servicios/ });
  expect(within(row).getByText('Personalizado')).toBeInTheDocument();
  expect(within(row).getByText('Ver detalle')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Servicios: Retirar' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Servicios: Crear' })).not.toBeChecked();

  // Ticking the missing actions turns the row into a level again; choosing a level replaces the custom set.
  await userEvent.click(screen.getByRole('checkbox', { name: 'Servicios: Crear' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Servicios: Modificar' }));
  expect(within(services).getByRole('radio', { name: 'Completo' })).toHaveAttribute('aria-checked', 'true');
  expect(within(row).queryByText('Personalizado')).not.toBeInTheDocument();
  await userEvent.click(within(services).getByRole('radio', { name: 'Ver' }));
  expect(codes()).toEqual(['contracts.catalog.read']);
});

it('follows English inside a language scope', () => {
  act(() => resetLanguageForTests('en'));
  render(<LanguageScope><PermissionMatrix catalog={catalog} value={[]} onChange={vi.fn()} /></LanguageScope>);
  expect(within(screen.getByRole('radiogroup', { name: 'Access: Servicios' })).getAllByRole('radio').map(radio => radio.textContent))
    .toEqual(['No access', 'View', 'Create', 'Edit', 'Full']);
});

it('grants the containing screen when a sub-window is granted', () => {
  const closures = catalog.modules[2];
  expect(setAccessLevel([], closures, 'read', catalog)).toEqual(['contracts.catalog.read', 'contracts.service_closures.read']);
  expect(accessLevel(['contracts.catalog.read', 'contracts.catalog.update'], catalog.modules[1])).toBe('custom');
  expect(accessLevel(['contracts.catalog.read', 'contracts.catalog.create'], catalog.modules[1])).toBe('create');
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
