import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DepartmentAccessProvider, administratorAccess } from '../../access/DepartmentAccessContext';
import InvoicesPage from './InvoicesPage';
import { getFinanceInvoice, listFinanceInvoices } from '../../../services/financeBookService';
import { getTreasuryAdjustments, getTreasuryStatement } from '../../../services/financeTreasuryService';
vi.mock('../../../services/financeBookService', async original => ({ ...(await original()), getFinanceInvoice: vi.fn(), listFinanceInvoices: vi.fn() }));
vi.mock('../../../services/financeTreasuryService', async original => ({ ...(await original()), getTreasuryAdjustments: vi.fn(), getTreasuryStatement: vi.fn() }));
import { getInvoiceCardPayments } from '../../../services/invoicingService';
vi.mock('../../../services/invoicingService', async original => ({ ...(await original()), getInvoiceCardPayments: vi.fn() }));
vi.mock('../../auth/authService', () => ({ readSession: () => ({ stationScopes: [{ stationId: 'st-1', stationCode: 'PUJ' }] }) }));
const summary = { id: 'i-1', number: 'NF-TEST-INV', airline: 'QA Airline', airlineId: 'a-1', stationId: 'st-1', stationCode: 'PUJ',
    currencyCode: 'USD', total: 1000, paid: 300, credited: 0, balance: 700, status: 'PartiallyPaid', issuedAt: '2026-10-18T12:00:00Z', daysOverdue: 0 };
afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => { vi.mocked(getInvoiceCardPayments).mockResolvedValue({ invoiceId: 'i-1', attempts: [] }); });
it('mounts real line adjustment notes and links a receipt application from the invoice', async () => {
    vi.mocked(listFinanceInvoices).mockResolvedValue({ invoices: [summary] });
    vi.mocked(getFinanceInvoice).mockResolvedValue({ summary, lines: [], payments: [], creditNotes: [] });
    vi.mocked(getTreasuryAdjustments).mockResolvedValue({ invoiceId: 'i-1', version: 'v1', legacyCredited: 0, lines: [], notes: [{ id: 'n-1', number: 'TC-QA', kind: 'Credit', currencyCode: 'USD', amount: 100, effectiveOn: '2026-10-18', reason: 'Service correction', lines: [] }] });
    vi.mocked(getTreasuryStatement).mockResolvedValue({ invoices: [{ id: 'i-1', total: 1000, legacyPaid: 0, legacyCredited: 0, credited: 100, debited: 0, applied: 300, balance: 600 }],
        receipts: [{ id: 'r-1', reference: 'RC-QA', currencyCode: 'USD', movements: [{ id: 'm-1', kind: 'Application', invoiceId: 'i-1', receiptAmount: 300, invoiceAmount: 300, receiptCurrency: 'USD', invoiceCurrency: 'USD', exchangeRate: 1, effectiveOn: '2026-10-18' }] }] });
    const onOpenReceipt = vi.fn();
    render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('finance', ['finance.reconciliation.read', 'finance.receipts.read', 'finance.receipts.apply', 'finance.adjustments.read'])}>
        <InvoicesPage initialStationId="st-1" onOpenReceipt={onOpenReceipt} />
    </DepartmentAccessProvider>);
    await userEvent.click(await screen.findByRole('button', { name: /NF-TEST-INV/ }));
    expect(await screen.findByText(/TC-QA/)).toBeInTheDocument();
    expect(getTreasuryAdjustments).toHaveBeenCalledWith('i-1', expect.anything());
    await userEvent.click(await screen.findByRole('button', { name: 'Ver cobro RC-QA' }));
    expect(onOpenReceipt).toHaveBeenCalledWith('r-1', expect.objectContaining({ invoiceId: 'i-1' }));
    expect(screen.queryByRole('button', { name: 'Registrar pago' })).not.toBeInTheDocument();
});

it('keeps the newest invoice filter when an older request finishes later', async () => {
    let finishOlder;
    listFinanceInvoices.mockResolvedValueOnce({ invoices: [summary] })
        .mockImplementationOnce(() => new Promise(resolve => { finishOlder = resolve; }))
        .mockResolvedValueOnce({ invoices: [{ ...summary, id: 'paid', number: 'NF-QA-PAID', status: 'Paid' }] });
    render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('finance', ['finance.reconciliation.read'])}>
        <InvoicesPage initialStationId="st-1" /></DepartmentAccessProvider>);
    await screen.findByRole('button', { name: /NF-TEST-INV/ });
    await userEvent.selectOptions(screen.getByLabelText('Estado'), 'Pending');
    await userEvent.selectOptions(screen.getByLabelText('Estado'), 'Paid');
    await screen.findByRole('button', { name: /NF-QA-PAID/ });
    await act(async () => finishOlder({ invoices: [summary] }));
    expect(screen.getByRole('button', { name: /NF-QA-PAID/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /NF-TEST-INV/ })).not.toBeInTheDocument();
});

it('shows the airline card attempts with brand and last four digits only', async () => {
    const paid = { ...summary, fiscalNumber: 'E310000000007', balance: 0, status: 'Paid' };
    vi.mocked(listFinanceInvoices).mockResolvedValue({ invoices: [paid] });
    vi.mocked(getFinanceInvoice).mockResolvedValue({ summary: paid, lines: [], payments: [], creditNotes: [] });
    vi.mocked(getInvoiceCardPayments).mockResolvedValue({ invoiceId: 'i-1', attempts: [
        { id: 'c-2', invoiceId: 'i-1', status: 'Approved', brand: 'Visa', last4: '1111', amount: 1000, currencyCode: 'USD',
            authorizationCode: 'ABC234', declineCode: null, receiptId: 'r-9', attemptedAt: '2026-11-05T12:05:00Z' },
        { id: 'c-1', invoiceId: 'i-1', status: 'Declined', brand: 'Visa', last4: '0002', amount: 1000, currencyCode: 'USD',
            authorizationCode: null, declineCode: 'insufficient_funds', receiptId: null, attemptedAt: '2026-11-05T12:00:00Z' }] });
    render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('finance', ['finance.reconciliation.read'])}>
        <InvoicesPage initialStationId="st-1" /></DepartmentAccessProvider>);
    await userEvent.click(await screen.findByRole('button', { name: 'E310000000007' }));
    const section = await screen.findByRole('region', { name: 'Pagos con tarjeta' });
    expect(section).toHaveTextContent('Aprobado');
    expect(section).toHaveTextContent('Visa •••• 1111');
    expect(section).toHaveTextContent('autorización ABC234');
    expect(section).toHaveTextContent('fondos insuficientes');
    expect(getInvoiceCardPayments).toHaveBeenCalledWith('i-1');
});

it('names an invoice credited in full without payments «Anulada» and filters by it (4-N24)', async () => {
    const voided = { ...summary, id: 'v-1', number: 'NF-QA-VOIDED', paid: 0, credited: 1000, balance: 0, status: 'Voided' };
    vi.mocked(listFinanceInvoices).mockResolvedValue({ invoices: [voided] });
    render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('finance', ['finance.reconciliation.read'])}>
        <InvoicesPage initialStationId="st-1" /></DepartmentAccessProvider>);
    const row = (await screen.findByRole('button', { name: /NF-QA-VOIDED/ })).closest('tr');
    expect(row).toHaveTextContent('Anulada');
    expect(row).not.toHaveTextContent('Pagada');
    await userEvent.selectOptions(screen.getByLabelText('Estado'), 'Voided');
    expect(listFinanceInvoices).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'Voided' }));
});

it('reads the invoices again when the window regains focus, keeping the page on screen (4-N11)', async () => {
    vi.mocked(listFinanceInvoices).mockResolvedValue({ invoices: [summary] });
    render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('finance', ['finance.reconciliation.read'])}>
        <InvoicesPage initialStationId="st-1" /></DepartmentAccessProvider>);
    await screen.findByRole('button', { name: /NF-TEST-INV/ });
    const calls = vi.mocked(listFinanceInvoices).mock.calls.length;
    vi.mocked(listFinanceInvoices).mockResolvedValue({ invoices: [{ ...summary, balance: 0, paid: 1000, status: 'Paid' }] });
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(screen.getByRole('button', { name: /NF-TEST-INV/ }).closest('tr')).toHaveTextContent('Pagada'));
    expect(listFinanceInvoices).toHaveBeenCalledTimes(calls + 1);
});
