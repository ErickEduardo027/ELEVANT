import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DepartmentAccessProvider, administratorAccess } from '../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../access/testAccess';
import ContractApprovalsPage from './contract-approvals/ContractApprovalsPage';
import InvoicesPage from './invoices/InvoicesPage';
import ChargesPage, { RULES_BY_METHOD } from './charges/ChargesPage';
import PreinvoiceLinesEditor from './preinvoices/PreinvoiceLinesEditor';
import {
  addPreinvoiceAdjustment, decideContractApproval, editPreinvoiceLine, getContractApproval, getFinanceInvoice, listBillingUnits,
  listCharges, listContractApprovals, listFinanceInvoices, listFinanceServices, recordPartialPayment, saveCharge,
} from '../../services/financeBookService';

vi.mock('../../services/financeBookService', async importOriginal => ({
  ...(await importOriginal()),
  listContractApprovals: vi.fn(), getContractApproval: vi.fn(), decideContractApproval: vi.fn(),
  listFinanceInvoices: vi.fn(), getFinanceInvoice: vi.fn(), recordPartialPayment: vi.fn(), issueCreditNote: vi.fn(),
  listCharges: vi.fn(), saveCharge: vi.fn(), listFinanceServices: vi.fn(), listBillingUnits: vi.fn(),
  listChargeTariffs: vi.fn().mockResolvedValue([]), editPreinvoiceLine: vi.fn(), addPreinvoiceAdjustment: vi.fn(),
}));
vi.mock('../../services/financeTreasuryService', async original => ({ ...(await original()),
  getTreasuryStatement: vi.fn().mockResolvedValue({ invoices: [], receipts: [] }),
  getTreasuryAdjustments: vi.fn().mockResolvedValue({ invoiceId: 'inv-1', legacyCredited: 0, notes: [], lines: [], version: '0' }),
}));
vi.mock('../auth/authService', () => ({ readSession: () => ({ stationScopes: [{ stationId: 'st-1', stationCode: 'PUJ' }] }) }));
vi.mock('../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() }),
}));

function renderWith(ui, codes = DepartmentPermissionCodes.finance) {
  return render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('finance', codes)}>{ui}</DepartmentAccessProvider>);
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ContractApprovalsPage', () => {
  const summary = { versionId: 'v-1', contractId: 'c-1', contractCode: 'QA-1', airline: 'Demo Airlines', currencyCode: 'USD',
    validFrom: '2026-09-01', validTo: null, status: 'PendingFinanceApproval', submittedAt: '2026-10-08T10:00:00Z',
    ratesBelowBase: 1, ratesWithoutBase: 0, version: 'AAA=' };

  it('compares each price with the base tariff and requires a reason to return', async () => {
    listContractApprovals.mockResolvedValue([summary]);
    getContractApproval.mockResolvedValue({ summary, terms: 'QA', stations: ['PUJ'], history: [],
      rates: [{ rateId: 'r-1', serviceCode: 'BAGGAGE', serviceName: 'Baggage', billingUnit: 'operation', contractPrice: 104,
        contractMinimum: 1, basePrice: 130, baseMinimum: 1, differencePercent: -20 }],
      charges: [{ chargeId: 'ch-1', chargeCode: 'NIGHT', chargeName: 'Nocturno', method: 'PercentOfService', isExcluded: false,
        contractValue: 20, baseValue: 25 }] });
    decideContractApproval.mockResolvedValue({ id: 'v-1' });
    renderWith(<ContractApprovalsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Demo Airlines/ }));
    expect(await screen.findByText('-20 %')).toBeInTheDocument();
    expect(screen.getByText(/negociado 20 \(base 25\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Devolver a Contratos' }));
    await userEvent.click(screen.getByRole('button', { name: 'Devolver' }));
    expect(decideContractApproval).not.toHaveBeenCalled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Motivo' }), 'Precio por debajo de la base');
    await userEvent.click(screen.getByRole('button', { name: 'Devolver' }));
    expect(decideContractApproval).toHaveBeenCalledWith('v-1', { decision: 'Returned', reason: 'Precio por debajo de la base', expectedVersion: 'AAA=' });
  });

  it('hides decisions from accounts that can only read', async () => {
    listContractApprovals.mockResolvedValue([summary]);
    getContractApproval.mockResolvedValue({ summary, terms: null, stations: [], history: [], rates: [], charges: [] });
    renderWith(<ContractApprovalsPage />, ['finance.contract_approvals.read']);
    await userEvent.click(await screen.findByRole('button', { name: /Demo Airlines/ }));
    await screen.findByText(/QA-1 · USD/);
    expect(screen.queryByRole('button', { name: 'Aprobar y activar' })).not.toBeInTheDocument();
  });
});

describe('InvoicesPage', () => {
  it('opens the receipt and application flow instead of writing a legacy payment', async () => {
    const invoice = { id: 'inv-1', number: 'NF-0123456789abcdef', preinvoiceId: 'p-1', airlineId: 'a-1', airline: 'Demo Airlines',
      stationId: 'st-1', stationCode: 'PUJ', currencyCode: 'USD', total: 135.5, paid: 0, credited: 0, balance: 135.5,
      issuedAt: '2026-10-08T10:00:00Z', dueDate: '2026-11-07', status: 'Pending', daysOverdue: 0 };
    listFinanceInvoices.mockResolvedValue({ page: 1, limit: 50, hasMore: false, invoices: [invoice] });
    getFinanceInvoice.mockResolvedValue({ summary: invoice, payments: [], creditNotes: [],
      lines: [{ lineNumber: 1, kind: 'Service', parentLineNumber: null, operationCode: 'OP', operationDate: '2026-10-08',
        serviceCode: 'BAGGAGE', serviceName: 'Baggage', quantity: 1, billingUnit: 'operation', unitPrice: 125.5, amount: 125.5, reason: null },
      { lineNumber: 2, kind: 'Charge', parentLineNumber: 1, operationCode: 'OP', operationDate: '2026-10-08', serviceCode: 'NIGHT',
        serviceName: 'Nocturno', quantity: 1, billingUnit: 'operation', unitPrice: 10, amount: 10, reason: 'Acordado' }] });
    recordPartialPayment.mockResolvedValue({ id: 'pay-1' });
    const onOpenReceipt = vi.fn();
    renderWith(<InvoicesPage initialStationId="st-1" onOpenReceipt={onOpenReceipt} />);
    await userEvent.click(await screen.findByRole('button', { name: /NF-0123456789ab/ }));
    const drawer = await screen.findByRole('dialog', { name: /Factura Demo Airlines/ });
    expect(within(drawer).getByText('Acordado')).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Gestionar cobros y aplicaciones' }));
    expect(onOpenReceipt).toHaveBeenCalledWith(null, expect.objectContaining({ invoiceId: 'inv-1', airlineId: 'a-1', stationId: 'st-1' }));
    expect(recordPartialPayment).not.toHaveBeenCalled();
  });
});

describe('ChargesPage', () => {
  it('only offers quantity rules the calculation method accepts', async () => {
    listCharges.mockResolvedValue([]);
    listFinanceServices.mockResolvedValue([]);
    listBillingUnits.mockResolvedValue([{ code: 'hour', name: 'Hora', isActive: true }]);
    saveCharge.mockResolvedValue({ id: 'ch-1' });
    renderWith(<ChargesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo cargo' }));
    const drawer = screen.getByRole('dialog', { name: 'Nuevo cargo' });
    await userEvent.type(within(drawer).getByRole('textbox', { name: 'Código' }), 'overtime');
    await userEvent.type(within(drawer).getByRole('textbox', { name: 'Nombre' }), 'Tiempo extra');
    await userEvent.selectOptions(within(drawer).getByRole('combobox', { name: 'Cálculo' }), 'PerHour');
    const rules = within(within(drawer).getByRole('combobox', { name: 'Cantidad' })).getAllByRole('option').map(option => option.value);
    expect(rules).toEqual(RULES_BY_METHOD.PerHour);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cargo' }));
    expect(saveCharge).toHaveBeenCalledWith(undefined, expect.objectContaining({ code: 'OVERTIME', method: 'PerHour',
      quantityRule: 'ServiceDuration', serviceIds: null }));
  });
});

describe('PreinvoiceLinesEditor', () => {
  const preinvoice = { id: 'p-1', status: 'Draft', currencyCode: 'USD', version: 'AAA=', lines: [
    { id: 'l-1', kind: 'Service', parentLineId: null, operationCode: 'OP-1', serviceName: 'Baggage', executedQuantity: 1,
      billingUnit: 'operation', amount: 125.5, computedAmount: 125.5, isExcluded: false },
    { id: 'l-2', kind: 'Charge', parentLineId: 'l-1', operationCode: 'OP-1', serviceName: 'Recargo nocturno', executedQuantity: 1,
      billingUnit: 'operation', amount: 31.38, computedAmount: 31.38, isExcluded: false },
  ] };

  it('excludes a charge with a reason and the draft version', async () => {
    editPreinvoiceLine.mockResolvedValue({ id: 'p-1' });
    const onChanged = vi.fn();
    render(<PreinvoiceLinesEditor preinvoice={preinvoice} canEdit onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('button', { name: 'Editar Recargo nocturno' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'No cobrar este cargo' }));
    await userEvent.type(screen.getByRole('textbox', { name: /Motivo/ }), 'Servicio diurno');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(editPreinvoiceLine).toHaveBeenCalledWith('p-1', 'l-2', { amount: null, exclude: true, reason: 'Servicio diurno', expectedVersion: 'AAA=' });
    expect(onChanged).toHaveBeenCalledWith('Línea actualizada.');
  });

  it('adds a discount under a service and is read-only once submitted', async () => {
    addPreinvoiceAdjustment.mockResolvedValue({ id: 'p-1' });
    const { rerender } = render(<PreinvoiceLinesEditor preinvoice={preinvoice} canEdit onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ajustar Baggage' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Descripción' }), 'Descuento comercial');
    await userEvent.type(screen.getByRole('spinbutton', { name: /Importe/ }), '-5');
    await userEvent.type(screen.getByRole('textbox', { name: /Motivo/ }), 'Acuerdo');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(addPreinvoiceAdjustment).toHaveBeenCalledWith('p-1', expect.objectContaining({ amount: -5, parentLineId: 'l-1' }));
    rerender(<PreinvoiceLinesEditor preinvoice={{ ...preinvoice, status: 'Submitted' }} canEdit onChanged={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument();
  });
});
