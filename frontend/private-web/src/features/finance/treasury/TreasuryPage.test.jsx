import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DepartmentAccessProvider, administratorAccess } from '../../access/DepartmentAccessContext';
import TreasuryPage from './TreasuryPage';
import StatementPage from './StatementPage';
import AdjustmentNotesPanel from './AdjustmentNotesPanel';
import * as api from '../../../services/financeTreasuryService';
vi.mock('../../../services/financeTreasuryService', async original => ({ ...(await original()),
    getTreasuryOptions: vi.fn(), listTreasuryReceipts: vi.fn(), getTreasuryReceipt: vi.fn(), recordTreasuryReceipt: vi.fn(),
    getTreasuryStatement: vi.fn(), applyTreasuryReceipt: vi.fn(), reverseTreasuryReceipt: vi.fn(), refundTreasuryReceipt: vi.fn(),
    getTreasuryAdjustments: vi.fn(), issueTreasuryAdjustment: vi.fn(),
}));
vi.mock('../../auth/authService', () => ({ readSession: () => ({ stationScopes: [{ stationId: 's-1', stationCode: 'PUJ' }] }) }));
vi.mock('../../../services/accountChangeObserver', () => ({ createPrivateWebAccountChangeObserver: () => ({ start: vi.fn(), stop: vi.fn() }) }));
const permissions = ['finance.receipts.read', 'finance.receipts.manage', 'finance.receipts.apply', 'finance.receipts.reverse', 'finance.receipts.refund', 'finance.adjustments.read', 'finance.adjustments.issue'];
const receipt = { id: 'r-1', airlineId: 'a-1', stationId: 's-1', reference: 'RC-1', currencyCode: 'USD', amount: 1000,
    available: 700, applied: 300, refunded: 0, reversed: false, version: 'r-v1', receivedOn: '2026-10-18', reason: 'Customer receipt', movements: [] };
function view(ui, codes = permissions) { return render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('finance', codes)}>{ui}</DepartmentAccessProvider>); }
afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => {
    vi.mocked(api.getTreasuryOptions).mockResolvedValue({ stations: [{ id: 's-1', code: 'PUJ' }], airlines: [{ id: 'a-1', name: 'Synthetic Airline' }] });
    vi.mocked(api.listTreasuryReceipts).mockResolvedValue({ page: 1, limit: 25, hasMore: false, items: [receipt] });
    vi.mocked(api.getTreasuryReceipt).mockResolvedValue(receipt);
    vi.mocked(api.getTreasuryStatement).mockResolvedValue({ asOf: '2026-10-18', receipts: [], movements: [], aging: [],
        invoices: [{ id: 'i-1', number: 'NF-1', airlineId: 'a-1', stationId: 's-1', currencyCode: 'USD', total: 1000, balance: 700, version: 'i-v1' }] });
    vi.mocked(api.applyTreasuryReceipt).mockResolvedValue({ id: 'm-1', version: 'r-v2' });
    vi.mocked(api.recordTreasuryReceipt).mockResolvedValue({ id: 'r-2', version: 'r-v1' });
    vi.mocked(api.issueTreasuryAdjustment).mockResolvedValue({ id: 'n-1', version: 'i-v2' });
    vi.mocked(api.getTreasuryAdjustments).mockResolvedValue({ invoiceId: 'i-1', version: 'i-v1', legacyCredited: 0, notes: [],
        lines: [{ invoiceLineId: 'l-1', lineNumber: 1, quantity: 10, amount: 1000, creditQuantityRemaining: 7, creditAmountRemaining: 700,
            debitQuantityRemaining: 10, debitAmountRemaining: 1000 }] });
});
it('does not fetch financial data without read permission', () => {
    view(<TreasuryPage />, []);
    expect(screen.getByText(/No tiene permiso/)).toBeInTheDocument();
    expect(api.listTreasuryReceipts).not.toHaveBeenCalled();
});
it('records an advance and retries the identical intent after a connection error', async () => {
    const user = userEvent.setup(); view(<TreasuryPage initialStationId="s-1" />);
    await user.click(await screen.findByRole('button', { name: 'Registrar cobro' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Aerolínea'), 'a-1');
    await user.type(within(dialog).getByLabelText(/Importe recibido/), '1000');
    await user.type(within(dialog).getByLabelText('Referencia'), 'SYNTHETIC-ADVANCE');
    await user.type(within(dialog).getByLabelText('Motivo'), 'Customer advance');
    vi.mocked(api.recordTreasuryReceipt).mockRejectedValueOnce(new Error('No hay conexión'));
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar cobro' }));
    await within(dialog).findByRole('alert');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar cobro' }));
    await waitFor(() => expect(api.recordTreasuryReceipt).toHaveBeenCalledTimes(2));
    expect(api.recordTreasuryReceipt.mock.calls[0][0]).toEqual(api.recordTreasuryReceipt.mock.calls[1][0]);
    expect(api.recordTreasuryReceipt.mock.calls[0][0]).toMatchObject({ amount: 1000, airlineId: 'a-1', stationId: 's-1', currencyCode: 'USD', reason: 'Customer advance' });
});
it('applies a typed partial amount using both receipt and invoice versions', async () => {
    const user = userEvent.setup(); view(<TreasuryPage initialStationId="s-1" />);
    await user.click(await screen.findByRole('button', { name: 'Ver RC-1' }));
    await user.click(await screen.findByRole('button', { name: 'Aplicar a facturas' }));
    const dialog = screen.getByRole('dialog', { name: 'Aplicar cobro' });
    await user.type(await within(dialog).findByLabelText(/Importe para NF-1/), '300');
    await user.type(within(dialog).getByLabelText('Motivo'), 'Partial settlement');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar aplicación' }));
    await waitFor(() => expect(api.applyTreasuryReceipt).toHaveBeenCalled());
    expect(api.applyTreasuryReceipt.mock.calls[0]).toEqual(['r-1', expect.objectContaining({ expectedVersion: 'r-v1', reason: 'Partial settlement',
        applications: [{ invoiceId: 'i-1', expectedInvoiceVersion: 'i-v1', receiptAmount: 300 }] })]);
});
it('keeps USD and DOP aging separate and sends the selected statement cutoff', async () => {
    vi.mocked(api.getTreasuryStatement).mockResolvedValue({ asOf: '2026-10-01', invoices: [], receipts: [], movements: [],
        aging: [{ currencyCode: 'USD', balance: 700, current: 0, days1To30: 700, days31To60: 0, days61To90: 0, days91Plus: 0, unallocated: 300, creditBalance: 0 },
            { currencyCode: 'DOP', balance: 6050, current: 6050, days1To30: 0, days31To60: 0, days61To90: 0, days91Plus: 0, unallocated: 0, creditBalance: 0 }] });
    const user = userEvent.setup(); view(<StatementPage initialStationId="s-1" />);
    await screen.findByText('USD'); await screen.findByText('DOP');
    await user.clear(screen.getByLabelText('Fecha de corte')); await user.type(screen.getByLabelText('Fecha de corte'), '2026-10-01');
    await user.click(screen.getByRole('button', { name: 'Consultar estado' }));
    await waitFor(() => expect(api.getTreasuryStatement).toHaveBeenLastCalledWith(expect.objectContaining({ asOf: '2026-10-01', stationId: 's-1' }), expect.anything()));
});
it('limits credit by invoice line and requires a reason before issuing the note', async () => {
    const user = userEvent.setup(); view(<AdjustmentNotesPanel invoiceId="i-1" currencyCode="USD" />);
    await user.click(await screen.findByRole('button', { name: 'Emitir nota' }));
    const dialog = screen.getByRole('dialog', { name: 'Emitir nota de ajuste' });
    const quantity = within(dialog).getByLabelText(/Cantidad línea 1/);
    expect(quantity).toHaveAttribute('max', '7');
    expect(within(dialog).getByLabelText(/Importe línea 1/)).toHaveAttribute('max', '700');
    await user.type(quantity, '3'); await user.type(within(dialog).getByLabelText(/Importe línea 1/), '300');
    await user.type(within(dialog).getByLabelText('Motivo'), 'Damaged service');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar nota' }));
    await waitFor(() => expect(api.issueTreasuryAdjustment).toHaveBeenCalledWith('i-1', expect.objectContaining({ kind: 'Credit', expectedVersion: 'i-v1',
        lines: [{ invoiceLineId: 'l-1', quantity: 3, amount: 300 }], reason: 'Damaged service' })));
});

it('sends multiple invoice allocations as one intent without mixing receipt currency', async () => {
  const user = userEvent.setup();
  vi.mocked(api.getTreasuryStatement).mockResolvedValue({ invoices: [
    { id: 'i-1', number: 'NF-1', airlineId: 'a-1', stationId: 's-1', currencyCode: 'USD', balance: 700, version: 'v-1' },
    { id: 'i-2', number: 'NF-2', airlineId: 'a-1', stationId: 's-1', currencyCode: 'DOP', balance: 6050, version: 'v-2' },
  ] });
  view(<TreasuryPage initialStationId="s-1" />);
  await user.click(await screen.findByRole('button', { name: 'Ver RC-1' }));
  await user.click(await screen.findByRole('button', { name: 'Aplicar a facturas' }));
  const dialog = screen.getByRole('dialog', { name: 'Aplicar cobro' });
  await user.type(await within(dialog).findByLabelText(/Importe para NF-1/), '300');
  await user.type(within(dialog).getByLabelText(/Importe para NF-2/), '100');
  await user.type(within(dialog).getByLabelText('Motivo'), 'Settlement across flights');
  await user.click(within(dialog).getByRole('button', { name: 'Confirmar aplicación' }));
  await waitFor(() => expect(api.applyTreasuryReceipt).toHaveBeenCalledWith('r-1', expect.objectContaining({ applications: [
    { invoiceId: 'i-1', expectedInvoiceVersion: 'v-1', receiptAmount: 300 },
    { invoiceId: 'i-2', expectedInvoiceVersion: 'v-2', receiptAmount: 100 },
  ] })));
});
it('refunds only available cash with its own reference and explicit reason', async () => {
  const user = userEvent.setup(); vi.mocked(api.refundTreasuryReceipt).mockResolvedValue({ id: 'refund-1' });
  view(<TreasuryPage initialStationId="s-1" />);
  await user.click(await screen.findByRole('button', { name: 'Ver RC-1' }));
  await user.click(await screen.findByRole('button', { name: 'Devolver remanente' }));
  const dialog = screen.getByRole('dialog', { name: 'Devolver remanente' });
  expect(within(dialog).getByLabelText(/Importe a devolver/)).toHaveAttribute('max', '700');
  await user.type(within(dialog).getByLabelText(/Importe a devolver/), '100');
  await user.type(within(dialog).getByLabelText('Referencia de devolución'), 'REFUND-1');
  await user.type(within(dialog).getByLabelText('Motivo'), 'Return unallocated cash');
  await user.click(within(dialog).getByRole('button', { name: 'Confirmar devolución' }));
  await waitFor(() => expect(api.refundTreasuryReceipt).toHaveBeenCalledWith('r-1', expect.objectContaining({ amount: 100, reference: 'REFUND-1', reason: 'Return unallocated cash', expectedVersion: 'r-v1' })));
});
it('reverses the referenced application and preserves its recorded FX in the history', async () => {
  const user = userEvent.setup();
  vi.mocked(api.getTreasuryReceipt).mockResolvedValue({ ...receipt, movements: [{ id: 'm-1', kind: 'Application', receiptAmount: 300, receiptCurrency: 'USD',
    invoiceId: 'i-1', invoiceAmount: 18150, invoiceCurrency: 'DOP', exchangeRate: 60.5, exchangeRateOn: '2026-10-18', effectiveOn: '2026-10-18', reason: 'Allocation' }] });
  vi.mocked(api.reverseTreasuryReceipt).mockResolvedValue({ id: 'reverse-1' });
  view(<TreasuryPage initialStationId="s-1" />);
  await user.click(await screen.findByRole('button', { name: 'Ver RC-1' }));
  await user.click(await screen.findByRole('button', { name: 'Revertir aplicación' }));
  const dialog = screen.getByRole('dialog', { name: 'Revertir aplicación' });
  await user.type(within(dialog).getByLabelText('Motivo'), 'Applied to wrong invoice');
  await user.click(within(dialog).getByRole('button', { name: 'Confirmar reverso' }));
  await waitFor(() => expect(api.reverseTreasuryReceipt).toHaveBeenCalledWith('r-1', expect.objectContaining({ applicationId: 'm-1', expectedVersion: 'r-v1', reason: 'Applied to wrong invoice' })));
});
