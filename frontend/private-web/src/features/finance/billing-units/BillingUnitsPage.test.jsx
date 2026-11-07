import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BillingUnitsPage from './BillingUnitsPage';
import { listBillingUnits, saveBillingUnit } from '../../../services/financeBookService';

vi.mock('../../../services/financeBookService', () => ({ listBillingUnits: vi.fn(), saveBillingUnit: vi.fn() }));

const units = [
  { id: 'u1', code: 'operation', name: 'Operación', quantityScale: 0, isActive: true, version: 'v1' },
  { id: 'u2', code: 'hour', name: 'Hora', quantityScale: 2, isActive: false, version: 'v2' },
];

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('lists units read-only and explains that delay is a charge, not a unit', async () => {
  listBillingUnits.mockResolvedValue(units);
  render(<BillingUnitsPage />);
  expect(await screen.findByText('Por operación')).toBeInTheDocument();
  expect(screen.getByText('Inactiva')).toBeInTheDocument();
  expect(screen.getByText(/DELAY/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Nueva unidad' })).not.toBeInTheDocument();
});

it('creates and edits units with optimistic concurrency', async () => {
  listBillingUnits.mockResolvedValue(units);
  saveBillingUnit.mockResolvedValue({ id: 'u3' });
  const user = userEvent.setup();
  render(<BillingUnitsPage canCreate canUpdate />);
  await user.click(await screen.findByRole('button', { name: 'Nueva unidad' }));
  const dialog = screen.getByRole('dialog', { name: 'Nueva unidad de cobro' });
  await user.type(within(dialog).getByRole('textbox', { name: /Nombre/ }), 'Galón');
  await user.type(within(dialog).getByRole('textbox', { name: /Código/ }), 'gallon');
  await user.click(screen.getByRole('button', { name: 'Guardar' }));
  expect(saveBillingUnit).toHaveBeenCalledWith(null, { code: 'gallon', name: 'Galón', quantityScale: 0, isActive: true, expectedVersion: null },
    expect.any(String));
  expect(await screen.findByText('Unidad «Galón» creada.')).toBeInTheDocument();

  await user.click(screen.getAllByRole('button', { name: 'Editar' })[1]);
  await user.click(screen.getByRole('checkbox', { name: /Activa/ }));
  await user.click(screen.getByRole('button', { name: 'Guardar' }));
  expect(saveBillingUnit).toHaveBeenLastCalledWith('u2', expect.objectContaining({ code: 'hour', isActive: true, expectedVersion: 'v2' }),
    expect.any(String));
  // Every save is its own intent with its own Idempotency-Key.
  expect(saveBillingUnit.mock.calls[1][2]).not.toBe(saveBillingUnit.mock.calls[0][2]);
});

it('retries an uncertain save with the same Idempotency-Key instead of creating the unit twice (1-E)', async () => {
  listBillingUnits.mockResolvedValue(units);
  saveBillingUnit.mockRejectedValueOnce(new TypeError('Network down')).mockResolvedValueOnce({ id: 'u3' });
  const user = userEvent.setup();
  render(<BillingUnitsPage canCreate />);
  await user.click(await screen.findByRole('button', { name: 'Nueva unidad' }));
  const dialog = screen.getByRole('dialog', { name: 'Nueva unidad de cobro' });
  await user.type(within(dialog).getByRole('textbox', { name: /Nombre/ }), 'Galón');
  await user.type(within(dialog).getByRole('textbox', { name: /Código/ }), 'gallon');
  await user.click(screen.getByRole('button', { name: 'Guardar' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('No se pudo guardar la unidad.');
  await user.click(screen.getByRole('button', { name: 'Guardar' }));
  expect(await screen.findByText('Unidad «Galón» creada.')).toBeInTheDocument();
  const [first, second] = saveBillingUnit.mock.calls;
  expect(second.slice(0, 2)).toEqual(first.slice(0, 2));
  expect(second[2]).toBe(first[2]);
});

it('shows a recoverable error instead of an empty list and no retry without permission (1-E)', async () => {
  listBillingUnits.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(units);
  render(<BillingUnitsPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar las unidades de cobro.');
  expect(screen.queryByText('Sin unidades de cobro')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('Por operación')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  cleanup();
  listBillingUnits.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
  render(<BillingUnitsPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No tiene acceso a las unidades de cobro.');
  expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
});

it('explains a rejected unit by its code instead of the server title (1-E)', async () => {
  listBillingUnits.mockResolvedValue(units);
  saveBillingUnit.mockRejectedValue(Object.assign(new Error('Finance record conflicts with current state.'),
    { status: 409, code: 'billing_unit_exists' }));
  const user = userEvent.setup();
  render(<BillingUnitsPage canCreate />);
  await user.click(await screen.findByRole('button', { name: 'Nueva unidad' }));
  const dialog = screen.getByRole('dialog', { name: 'Nueva unidad de cobro' });
  await user.type(within(dialog).getByRole('textbox', { name: /Nombre/ }), 'Operación');
  await user.type(within(dialog).getByRole('textbox', { name: /Código/ }), 'operation');
  await user.click(screen.getByRole('button', { name: 'Guardar' }));
  expect(await screen.findByText('Ya existe una unidad con ese código.')).toBeInTheDocument();
  expect(screen.queryByText(/Finance record/)).not.toBeInTheDocument();
});
