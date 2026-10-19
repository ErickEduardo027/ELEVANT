import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DepartmentAccessProvider, administratorAccess } from '../../access/DepartmentAccessContext';
import InvoicesPage from './InvoicesPage';
import { getFinanceInvoice, listFinanceInvoices } from '../../../services/financeBookService';
import { getTreasuryAdjustments, getTreasuryStatement } from '../../../services/financeTreasuryService';
vi.mock('../../../services/financeBookService', async original => ({ ...(await original()), getFinanceInvoice: vi.fn(), listFinanceInvoices: vi.fn() }));
vi.mock('../../../services/financeTreasuryService', async original => ({ ...(await original()), getTreasuryAdjustments: vi.fn(), getTreasuryStatement: vi.fn() }));
vi.mock('../../auth/authService', () => ({ readSession: () => ({ stationScopes: [{ stationId: 'st-1', stationCode: 'PUJ' }] }) }));
const summary = { id: 'i-1', number: 'NF-TEST-INV', airline: 'QA Airline', airlineId: 'a-1', stationId: 'st-1', stationCode: 'PUJ',
    currencyCode: 'USD', total: 1000, paid: 300, credited: 0, balance: 700, status: 'PartiallyPaid', issuedAt: '2026-10-18T12:00:00Z', daysOverdue: 0 };
afterEach(() => { cleanup(); vi.clearAllMocks(); });
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
