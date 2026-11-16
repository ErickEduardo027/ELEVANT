import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FinanceShell from './FinanceShell';
import { administratorAccess, DepartmentAccessProvider } from '../../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../../access/testAccess';
import { listFinanceInvoices } from '../../../services/financeBookService';

vi.mock('../../../services/financeBookService', async original => ({ ...(await original()),
  listFinanceInvoices: vi.fn().mockResolvedValue({ page: 1, limit: 25, hasMore: false, invoices: [] }) }));

/** The label of each first-level entry of the sidebar: its own button, not the sub-items of a group. */
const topLevel = navigation => [...navigation.children]
  .map(item => (item.matches('button, a') ? item : item.querySelector('button, a')).textContent.trim());

function renderShell(codes = DepartmentPermissionCodes.finance) {
  return render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('finance', codes)}><FinanceShell /></DepartmentAccessProvider>);
}

describe('FinanceShell', () => {
  it('does not show invented finance data or an unimplemented notification feed', async () => {
    renderShell();
    expect(await screen.findByRole('heading', { name: 'Resumen financiero' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('No hay una estación financiera autorizada');
    expect(screen.queryByText(/Datos sintéticos/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Notificaciones' })).not.toBeInTheDocument();
  });

  it('does not expose deferred prototype departmental chat', async () => {
    renderShell();
    expect(await screen.findByRole('heading', { name: 'Resumen financiero' })).toBeInTheDocument();
    expect(screen.getByRole('navigation')).not.toHaveTextContent('Comunicaciones');
  });

  it('shows the simplified menu: Inicio · Facturación · Cuentas por pagar · Reportes · Configuración · Usuarios (4-A)', async () => {
    renderShell();
    const navigation = await screen.findByRole('navigation', { name: 'Navegación principal' });
    expect(topLevel(navigation)).toEqual(['Inicio', 'Facturación', 'Cuentas por pagar', 'Reportes', 'Configuración', 'Usuarios del departamento']);
    for (const retired of ['Pre-facturación', 'Servicios aprobados', 'Tratamientos tributarios', 'Documentos fiscales',
      'Cobros y aplicaciones', 'Estados de cuenta', 'Tarifarios'])
      expect(navigation).not.toHaveTextContent(retired);
  });

  it('opens «Facturas» from «Facturación» with its «Cobros» and «Estados de cuenta» tabs', async () => {
    renderShell();
    const navigation = await screen.findByRole('navigation', { name: 'Navegación principal' });
    await userEvent.click(within(navigation).getByRole('button', { name: /Facturación/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Facturas' }));
    expect(await screen.findByRole('heading', { name: 'Facturas' })).toBeInTheDocument();
    const tabs = screen.getByRole('tablist', { name: 'Facturas, cobros y estados de cuenta' });
    expect(within(tabs).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Facturas', 'Cobros', 'Estados de cuenta']);
    expect(listFinanceInvoices).toHaveBeenCalled();
  });

  it('opens «Mis gastos» for a member without the expenses grants (4-N28)', async () => {
    render(<DepartmentAccessProvider observe={false} initialAccess={{ kind: 'Member', department: 'finance', permissions: ['finance.home.read'],
      stations: [], canManageDepartmentUsers: false, canValidateAccessRequests: false }}><FinanceShell /></DepartmentAccessProvider>);
    const navigation = await screen.findByRole('navigation', { name: 'Navegación principal' });
    expect(topLevel(navigation)).toEqual(['Inicio', 'Cuentas por pagar']);
    await userEvent.click(within(navigation).getByRole('button', { name: /Cuentas por pagar/ }));
    expect(within(navigation).queryByRole('button', { name: 'Gastos de empleados' })).not.toBeInTheDocument();
    await userEvent.click(await within(navigation).findByRole('button', { name: 'Mis gastos' }));
    expect(await screen.findByRole('heading', { name: 'Mis gastos' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Todos los gastos' })).not.toBeInTheDocument();
  });

  it('keeps only the groups and tabs the template allows', async () => {
    renderShell(['finance.home.read', 'finance.invoicing.read', 'finance.invoicing.issue', 'finance.reconciliation.read']);
    const navigation = await screen.findByRole('navigation', { name: 'Navegación principal' });
    // «Mis gastos» needs no grant (4-N28), so «Cuentas por pagar» keeps it alone.
    expect(topLevel(navigation)).toEqual(['Inicio', 'Facturación', 'Cuentas por pagar', 'Usuarios del departamento']);
    await userEvent.click(within(navigation).getByRole('button', { name: /Facturación/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Facturas' }));
    expect(await screen.findByRole('heading', { name: 'Facturas' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });
});
