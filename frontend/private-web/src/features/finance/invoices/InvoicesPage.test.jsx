import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DepartmentAccessProvider, administratorAccess } from '../../access/DepartmentAccessContext';
import InvoicesPage from './InvoicesPage';
import { getFinanceInvoice, listFinanceInvoices } from '../../../services/financeBookService';
import { getTreasuryOptions, getTreasuryStatement, listTreasuryReceipts } from '../../../services/financeTreasuryService';
import { getInvoiceCardPayments } from '../../../services/invoicingService';

vi.mock('../../../services/financeBookService', async original => ({ ...(await original()), getFinanceInvoice: vi.fn(), listFinanceInvoices: vi.fn() }));
vi.mock('../../../services/financeTreasuryService', async original => ({ ...(await original()),
  getTreasuryOptions: vi.fn(), getTreasuryStatement: vi.fn(), listTreasuryReceipts: vi.fn() }));
vi.mock('../../../services/invoicingService', async original => ({ ...(await original()), getInvoiceCardPayments: vi.fn() }));
vi.mock('../../auth/authService', () => ({ readSession: () => ({ stationScopes: [{ stationId: 'st-1', stationCode: 'PUJ' }] }) }));

const invoice = (index, values = {}) => ({ id: `i-${index}`, number: `NF-${String(index).padStart(32, '0')}`,
  fiscalNumber: `E3100000000${String(index).padStart(2, '0')}`, airline: 'QA Airline', airlineId: 'a-1', stationId: 'st-1',
  stationCode: 'PUJ', currencyCode: 'USD', total: 1180, paid: 0, credited: 0, balance: 1180, status: 'Pending',
  issuedAt: '2026-11-02T14:00:00Z', dueDate: '2026-12-02', daysOverdue: 0, ...values });
const page = (number, invoices, hasMore) => ({ page: number, limit: 25, hasMore, invoices });

function renderPage(codes = ['finance.reconciliation.read']) {
  return render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('finance', codes)}>
    <InvoicesPage initialStationId="st-1" /></DepartmentAccessProvider>);
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('InvoicesPage (4-N21)', () => {
  it('pages 25 invoices at a time with «Anterior» and «Siguiente»', async () => {
    vi.mocked(listFinanceInvoices).mockImplementation(async filters => (filters.page === 1
      ? page(1, [invoice(1)], true) : page(2, [invoice(2)], false)));
    renderPage();
    expect(await screen.findByRole('button', { name: 'E310000000001' })).toBeInTheDocument();
    expect(listFinanceInvoices).toHaveBeenCalledWith(expect.objectContaining({ stationId: 'st-1', page: 1, limit: 25, search: '' }));
    const pages = screen.getByRole('navigation', { name: 'Páginas de facturas' });
    expect(within(pages).getByText('Página 1')).toBeInTheDocument();
    expect(within(pages).getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await userEvent.click(within(pages).getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByRole('button', { name: 'E310000000002' })).toBeInTheDocument();
    expect(listFinanceInvoices).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, limit: 25 }));
    expect(within(pages).getByText('Página 2')).toBeInTheDocument();
    expect(within(pages).getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    await userEvent.click(within(pages).getByRole('button', { name: 'Anterior' }));
    expect(await screen.findByRole('button', { name: 'E310000000001' })).toBeInTheDocument();
  });

  it('searches by e-NCF, number or airline after a pause and starts again on the first page', async () => {
    vi.mocked(listFinanceInvoices).mockImplementation(async filters => (filters.search
      ? page(1, [invoice(7)], false)
      : filters.page === 1 ? page(1, [invoice(1)], true) : page(2, [invoice(2)], false)));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Siguiente' }));
    await screen.findByRole('button', { name: 'E310000000002' });
    const search = screen.getByRole('searchbox', { name: 'Buscar (e-NCF, número o aerolínea)' });
    expect(search).toHaveAttribute('maxLength', '40');
    await userEvent.type(search, '  E310000000007 ');
    expect(await screen.findByRole('button', { name: 'E310000000007' })).toBeInTheDocument();
    await waitFor(() => expect(listFinanceInvoices).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'E310000000007', page: 1 })));
    // One request for the whole search, not one per keystroke.
    expect(vi.mocked(listFinanceInvoices).mock.calls.filter(([filters]) => filters.search).length).toBe(1);
    expect(screen.getByText('Página 1')).toBeInTheDocument();
  });

  it('tells an empty search from an empty ledger and clears the search', async () => {
    vi.mocked(listFinanceInvoices).mockImplementation(async filters => page(1, filters.search ? [] : [invoice(1)], false));
    renderPage();
    await screen.findByRole('button', { name: 'E310000000001' });
    await userEvent.type(screen.getByRole('searchbox'), 'Sin coincidencias');
    expect(await screen.findByText('Ninguna factura coincide con la búsqueda')).toBeInTheDocument();
    expect(screen.queryByText('Sin facturas')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
    expect(await screen.findByRole('button', { name: 'E310000000001' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });

  it('shows the empty ledger when nothing was invoiced yet', async () => {
    vi.mocked(listFinanceInvoices).mockResolvedValue(page(1, [], false));
    renderPage();
    expect(await screen.findByText('Sin facturas')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Páginas de facturas' })).not.toBeInTheDocument();
  });

  it('explains a refused query by its code, never by the server title, and retries it', async () => {
    vi.mocked(listFinanceInvoices)
      .mockRejectedValueOnce(Object.assign(new Error('The invoice query is invalid.'), { status: 400, code: 'invalid_invoice_query' }))
      .mockResolvedValueOnce(page(1, [invoice(1)], false));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('La búsqueda no es válida. Escriba hasta 40 caracteres del e-NCF, del número o de la aerolínea.');
    expect(screen.queryByText(/The invoice query is invalid/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('button', { name: 'E310000000001' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a refused station as unauthorized, without data or retry', async () => {
    vi.mocked(listFinanceInvoices).mockRejectedValue(Object.assign(new Error('Invoices are forbidden in this scope.'), { status: 403, code: 'forbidden' }));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('No tiene permiso para consultar las facturas de esta estación.');
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(screen.queryByText('Cargando facturas…')).not.toBeInTheDocument();
  });

  it('keeps the visible page while it reloads and when a reload fails', async () => {
    let finish;
    vi.mocked(listFinanceInvoices).mockResolvedValueOnce(page(1, [invoice(1)], false))
      .mockRejectedValueOnce(new Error('network down'))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    vi.mocked(getFinanceInvoice).mockResolvedValue({ summary: invoice(1), lines: [], payments: [], creditNotes: [] });
    vi.mocked(getInvoiceCardPayments).mockResolvedValue({ invoiceId: 'i-1', attempts: [] });
    vi.mocked(getTreasuryStatement).mockResolvedValue({ invoices: [], receipts: [] });
    vi.mocked(getTreasuryOptions).mockResolvedValue({ stations: [{ id: 'st-1', code: 'PUJ' }], airlines: [] });
    vi.mocked(listTreasuryReceipts).mockResolvedValue({ page: 1, limit: 25, hasMore: false, items: [] });
    renderPage(['finance.reconciliation.read', 'finance.receipts.read']);
    // Coming back from the invoice's receipts reloads the same page of the list.
    await userEvent.click(await screen.findByRole('button', { name: 'E310000000001' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Gestionar cobros y aplicaciones' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Volver a facturas' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar las facturas. Revise la conexión e intente de nuevo.');
    expect(screen.queryByText('network down')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'E310000000001' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Actualizando…')).toBeInTheDocument();
    expect(screen.queryByText('Cargando facturas…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'E310000000001' })).toBeInTheDocument();
    finish(page(1, [invoice(3)], false));
    expect(await screen.findByRole('button', { name: 'E310000000003' })).toBeInTheDocument();
    expect(screen.queryByText('Actualizando…')).not.toBeInTheDocument();
  });

  it('does not show the rows of another query when that query fails', async () => {
    vi.mocked(listFinanceInvoices).mockResolvedValueOnce(page(1, [invoice(1)], false))
      .mockRejectedValueOnce(Object.assign(new Error('Server error.'), { status: 500 }))
      .mockResolvedValueOnce(page(1, [invoice(4, { status: 'Pending' })], false));
    renderPage();
    await screen.findByRole('button', { name: 'E310000000001' });
    await userEvent.selectOptions(screen.getByLabelText('Estado'), 'Pending');
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar las facturas.');
    expect(screen.queryByRole('button', { name: 'E310000000001' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('button', { name: 'E310000000004' })).toBeInTheDocument();
    expect(listFinanceInvoices).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'Pending', page: 1 }));
  });
});

describe('InvoicesPage tabs (4-A, 4-N19)', () => {
  it('opens «Cobros» and «Estados de cuenta» as tabs of «Facturas» and names invoices by their e-NCF', async () => {
    vi.mocked(listFinanceInvoices).mockResolvedValue(page(1, [invoice(1)], false));
    vi.mocked(getTreasuryOptions).mockResolvedValue({ stations: [{ id: 'st-1', code: 'PUJ' }], airlines: [] });
    vi.mocked(listTreasuryReceipts).mockResolvedValue({ page: 1, limit: 25, hasMore: false, items: [] });
    vi.mocked(getTreasuryStatement).mockResolvedValue({ asOf: '2026-11-08', invoices: [{ ...invoice(1), legacyPaid: 0,
      legacyCredited: 0, applied: 0, debited: 0, agingBucket: 'Current', version: 'v1' }], receipts: [], movements: [],
      aging: [{ currencyCode: 'USD', balance: 1180, current: 1180, days1To30: 0, days31To60: 0, days61To90: 0, days91Plus: 0,
        unallocated: 0, creditBalance: 0 }] });
    renderPage(['finance.reconciliation.read', 'finance.receipts.read', 'finance.statements.read']);
    const tabs = await screen.findByRole('tablist', { name: 'Facturas, cobros y estados de cuenta' });
    expect(within(tabs).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Facturas', 'Cobros', 'Estados de cuenta']);
    expect(await screen.findByRole('heading', { name: 'Facturas' })).toBeInTheDocument();
    await userEvent.click(within(tabs).getByRole('tab', { name: 'Cobros' }));
    expect(await screen.findByRole('heading', { name: 'Tesorería y cobros' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Facturas' })).not.toBeInTheDocument();
    await userEvent.click(within(tabs).getByRole('tab', { name: 'Estados de cuenta' }));
    const cutOff = await screen.findByRole('heading', { name: 'Facturas al corte' });
    expect(cutOff.parentElement).toHaveTextContent('E310000000001');
    expect(cutOff.parentElement).not.toHaveTextContent('NF-0000');
    await userEvent.click(within(tabs).getByRole('tab', { name: 'Facturas' }));
    expect(screen.getByRole('button', { name: 'E310000000001' })).toBeInTheDocument();
    // The list was kept while the other tabs were open.
    expect(listFinanceInvoices).toHaveBeenCalledTimes(1);
  });

  it('shows only «Facturas» without the treasury permissions', async () => {
    vi.mocked(listFinanceInvoices).mockResolvedValue(page(1, [invoice(1)], false));
    renderPage(['finance.reconciliation.read']);
    expect(await screen.findByRole('button', { name: 'E310000000001' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Cobros' })).not.toBeInTheDocument();
  });
});
