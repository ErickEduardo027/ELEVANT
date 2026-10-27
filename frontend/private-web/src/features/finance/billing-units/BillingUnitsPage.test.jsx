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
  expect(saveBillingUnit).toHaveBeenCalledWith(null, { code: 'gallon', name: 'Galón', quantityScale: 0, isActive: true, expectedVersion: null });
  expect(await screen.findByText('Unidad «Galón» creada.')).toBeInTheDocument();

  await user.click(screen.getAllByRole('button', { name: 'Editar' })[1]);
  await user.click(screen.getByRole('checkbox', { name: /Activa/ }));
  await user.click(screen.getByRole('button', { name: 'Guardar' }));
  expect(saveBillingUnit).toHaveBeenLastCalledWith('u2', expect.objectContaining({ code: 'hour', isActive: true, expectedVersion: 'v2' }));
});
