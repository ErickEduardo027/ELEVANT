import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DepartmentAccessProvider, administratorAccess } from '../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../access/testAccess';
import ContractApprovalsPage from './contract-approvals/ContractApprovalsPage';
import InvoicesPage from './invoices/InvoicesPage';
import ChargesPage, { RULES_BY_METHOD } from './charges/ChargesPage';
import ExchangeRatesPage from './exchange-rates/ExchangeRatesPage';
import PreinvoiceLinesEditor from './preinvoices/PreinvoiceLinesEditor';
import {
  addPreinvoiceAdjustment, decideContractApproval, editPreinvoiceLine, getContractApproval, getFinanceInvoice, listBillingUnits,
  listCharges, listContractApprovals, listExchangeRates, listFinanceInvoices, listFinanceServices, recordExchangeRate,
  recordPartialPayment, saveCharge,
} from '../../services/financeBookService';

vi.mock('../../services/financeBookService', async importOriginal => ({
  ...(await importOriginal()),
  listContractApprovals: vi.fn(), getContractApproval: vi.fn(), decideContractApproval: vi.fn(),
  listFinanceInvoices: vi.fn(), getFinanceInvoice: vi.fn(), recordPartialPayment: vi.fn(), issueCreditNote: vi.fn(),
  listCharges: vi.fn(), saveCharge: vi.fn(), listFinanceServices: vi.fn(), listBillingUnits: vi.fn(),
  listChargeTariffs: vi.fn().mockResolvedValue([]), editPreinvoiceLine: vi.fn(), addPreinvoiceAdjustment: vi.fn(),
  listExchangeRates: vi.fn(), recordExchangeRate: vi.fn(),
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
    ratesBelowBase: 1, ratesWithoutBase: 0, version: 'AAA=', contractStatus: 'Draft' };

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
    expect(decideContractApproval).toHaveBeenCalledWith('v-1', { decision: 'Returned', reason: 'Precio por debajo de la base', expectedVersion: 'AAA=' },
      expect.any(String));
  });

  it('tells Finance that the airline never sees the internal reason of a return', async () => {
    listContractApprovals.mockResolvedValue([summary]);
    getContractApproval.mockResolvedValue({ summary, terms: null, stations: ['PUJ'], history: [], rates: [], charges: [] });
    renderWith(<ContractApprovalsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Demo Airlines/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Devolver a Contratos' }));
    expect(screen.getByText(/La aerolínea solo verá que la versión fue devuelta, sin el motivo/)).toBeInTheDocument();
  });

  it.each([
    ['package_not_eligible', /Un paquete del contrato ya no corresponde a su moneda o vigencia/],
    ['package_retired', /Finanzas retiró un paquete que el contrato incluye/],
    ['service_retired', /incluye un servicio dado de baja/],
    ['valid_from_not_after_current', /La vigencia empieza antes que la versión aprobada vigente/],
  ])('explains an approval blocked by %s instead of a generic conflict', async (code, text) => {
    listContractApprovals.mockResolvedValue([summary]);
    getContractApproval.mockResolvedValue({ summary, terms: null, stations: ['PUJ'], history: [], rates: [], charges: [] });
    decideContractApproval.mockRejectedValue(Object.assign(new Error('Finance record conflicts with current state.'),
      { status: 409, code }));
    renderWith(<ContractApprovalsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Demo Airlines/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Aprobar precios' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Aprobar precios' }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByText(/Finance record conflicts/)).not.toBeInTheDocument();
    expect(listContractApprovals).toHaveBeenCalledTimes(2);
  });

  it('shows a recoverable error or the unauthorized state instead of an empty inbox', async () => {
    listContractApprovals.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce([]);
    const { unmount } = renderWith(<ContractApprovalsPage />);
    expect(await screen.findByText(/No se pudieron cargar los contratos por aprobar/)).toBeInTheDocument();
    expect(screen.queryByText('Sin contratos por aprobar')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Sin contratos por aprobar')).toBeInTheDocument();
    unmount();
    listContractApprovals.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    renderWith(<ContractApprovalsPage />);
    expect(await screen.findByText('No tiene permiso para ver las aprobaciones de contratos.')).toBeInTheDocument();
  });

  it('hides decisions from accounts that can only read', async () => {
    listContractApprovals.mockResolvedValue([summary]);
    getContractApproval.mockResolvedValue({ summary, terms: null, stations: [], history: [], rates: [], charges: [] });
    renderWith(<ContractApprovalsPage />, ['finance.contract_approvals.read']);
    await userEvent.click(await screen.findByRole('button', { name: /Demo Airlines/ }));
    await screen.findByText(/QA-1 · USD/);
    expect(screen.queryByRole('button', { name: 'Aprobar precios' })).not.toBeInTheDocument();
  });

  it('approves the prices without promising an activation the server does not do (1-F)', async () => {
    listContractApprovals.mockResolvedValue([summary]);
    getContractApproval.mockResolvedValue({ summary, terms: null, stations: ['PUJ'], history: [], rates: [], charges: [] });
    decideContractApproval.mockResolvedValue({ id: 'v-1' });
    renderWith(<ContractApprovalsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Demo Airlines/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Aprobar precios' }));
    const dialog = screen.getByRole('dialog', { name: 'Aprobar precios' });
    expect(within(dialog).getByText(/firman la aerolínea y AVIAM.*permiso de operación/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/quedará activo/)).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar precios' }));
    expect(decideContractApproval).toHaveBeenCalledWith('v-1', { decision: 'Approved', reason: null, expectedVersion: 'AAA=' },
      expect.any(String));
    expect(await screen.findByText(/^Precios aprobados\./)).toBeInTheDocument();
    expect(screen.queryByText(/activado/)).not.toBeInTheDocument();
  });

  it.each([
    ['Active', /El contrato ya está activo: al aprobar, estos precios rigen desde el 1 de septiembre de 2026 y la versión vigente termina el día anterior, sin esperar firmas ni otra activación\./,
      /^Precios aprobados\. Rigen desde el 1 de septiembre de 2026; la versión anterior termina el día anterior\.$/],
    ['Suspended', /El contrato está suspendido: al aprobar, estos precios reemplazan a la versión vigente desde el 1 de septiembre de 2026 .*se aplican cuando el contrato se reactive\./,
      /^Precios aprobados\. Reemplazan a la versión vigente desde el 1 de septiembre de 2026 y se aplican cuando el contrato se reactive\.$/],
  ])('explains that approving an amendment of a %s contract replaces the version in force (1-F)', async (contractStatus, explained, done) => {
    const amendment = { ...summary, contractStatus };
    listContractApprovals.mockResolvedValue([amendment]);
    getContractApproval.mockResolvedValue({ summary: amendment, terms: null, stations: ['PUJ'], history: [], rates: [], charges: [] });
    decideContractApproval.mockResolvedValue({ id: 'v-1' });
    renderWith(<ContractApprovalsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Demo Airlines/ }));
    // The validity is the date the new prices apply from, not a step still pending before the signatures.
    expect(await screen.findByText(/desde esa fecha/)).toBeInTheDocument();
    expect(screen.queryByText(/Contratos la confirma después de tu aprobación/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Aprobar precios' }));
    const dialog = screen.getByRole('dialog', { name: 'Aprobar precios' });
    expect(within(dialog).getByText(explained)).toBeInTheDocument();
    expect(within(dialog).queryByText(/solo entonces el contrato se activa/)).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar precios' }));
    expect(await screen.findByText(done)).toBeInTheDocument();
    expect(screen.queryByText(/el contrato se activa después/)).not.toBeInTheDocument();
  });

  it('never shows the previous contract while another one loads or fails, and retries it', async () => {
    const other = { ...summary, versionId: 'v-2', contractId: 'c-2', contractCode: 'QA-2', airline: 'Otra Aerolínea' };
    listContractApprovals.mockResolvedValue([summary, other]);
    let failOther;
    getContractApproval.mockImplementation(id => (id === 'v-1'
      ? Promise.resolve({ summary, terms: null, stations: ['PUJ'], history: [], rates: [], charges: [] })
      : new Promise((_, reject) => { failOther = reject; })));
    renderWith(<ContractApprovalsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Demo Airlines/ }));
    expect(await screen.findByRole('heading', { name: 'Demo Airlines · QA-1' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Otra Aerolínea/ }));
    // While the other contract loads, neither the first one nor its decisions stay on screen.
    expect(screen.getByText('Cargando contrato…')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Demo Airlines · QA-1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprobar precios' })).not.toBeInTheDocument();
    failOther(new TypeError('offline'));
    expect(await screen.findByText('No se pudo cargar el contrato. Revise la conexión e intente de nuevo.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprobar precios' })).not.toBeInTheDocument();
    getContractApproval.mockResolvedValue({ summary: other, terms: null, stations: ['SDQ'], history: [], rates: [], charges: [] });
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'Otra Aerolínea · QA-2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aprobar precios' })).toBeInTheDocument();
  });

  it('shows the unauthorized state of a contract the analyst cannot read, without its decisions', async () => {
    listContractApprovals.mockResolvedValue([summary]);
    getContractApproval.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
    renderWith(<ContractApprovalsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Demo Airlines/ }));
    expect(await screen.findByText(/No tiene permiso para ver este contrato/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprobar precios' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('names package scopes, units and replaced versions in Spanish (1-N26)', async () => {
    const replaced = { ...summary, versionId: 'v-0', status: 'Superseded', airline: 'Old Airlines' };
    listContractApprovals.mockResolvedValue([replaced]);
    getContractApproval.mockResolvedValue({ summary: replaced, terms: null, stations: ['PUJ'], history: [],
      rates: [{ rateId: 'r-1', serviceCode: 'BAGGAGE', serviceName: 'Baggage', billingUnit: 'operation', contractPrice: 104,
        contractMinimum: 1, basePrice: 130, baseMinimum: 1, differencePercent: -20 }], charges: [],
      packages: [{ id: 'pk-1', code: 'PKG-TURN', name: 'Escala completa', versionNumber: 2, scope: 'Turnaround', basePrice: 500,
        currencyCode: 'USD' }] });
    renderWith(<ContractApprovalsPage />);
    const item = await screen.findByRole('button', { name: /Old Airlines/ });
    expect(within(item).getByText('Reemplazado por una versión posterior')).toBeInTheDocument();
    expect(screen.queryByText('Superseded')).not.toBeInTheDocument();
    await userEvent.click(item);
    expect(await screen.findByText(/versión 2 · Por escala · base/)).toBeInTheDocument();
    expect(screen.getByText(/Por operación · mín\. 1/)).toBeInTheDocument();
    expect(screen.queryByText(/Turnaround/)).not.toBeInTheDocument();
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
      quantityRule: 'ServiceDuration', serviceIds: null }), expect.any(String));
  });

  it('retries an uncertain charge creation with the same Idempotency-Key (1-E)', async () => {
    listCharges.mockResolvedValue([]);
    listFinanceServices.mockResolvedValue([]);
    listBillingUnits.mockResolvedValue([]);
    saveCharge.mockRejectedValueOnce(new TypeError('Network down')).mockResolvedValueOnce({ id: 'ch-1' });
    renderWith(<ChargesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo cargo' }));
    const drawer = screen.getByRole('dialog', { name: 'Nuevo cargo' });
    await userEvent.type(within(drawer).getByRole('textbox', { name: 'Código' }), 'night');
    await userEvent.type(within(drawer).getByRole('textbox', { name: 'Nombre' }), 'Nocturno');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cargo' }));
    expect(await within(drawer).findByRole('alert')).toHaveTextContent('No se pudo guardar el cargo. Intente de nuevo.');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cargo' }));
    expect(await screen.findByText(/^Cargo creado\./)).toBeInTheDocument();
    const [first, second] = saveCharge.mock.calls;
    expect(second[1]).toEqual(first[1]);
    expect(second[2]).toBe(first[2]);
  });
});

describe('ChargesPage errors (1-E)', () => {
  it('explains a rejected charge by its code instead of the server title', async () => {
    listCharges.mockResolvedValue([]);
    listFinanceServices.mockResolvedValue([]);
    listBillingUnits.mockResolvedValue([{ code: 'hour', name: 'Hora', isActive: true }]);
    saveCharge.mockRejectedValue(Object.assign(new Error('Finance record conflicts with current state.'),
      { status: 409, code: 'charge_code_exists' }));
    renderWith(<ChargesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo cargo' }));
    const drawer = screen.getByRole('dialog', { name: 'Nuevo cargo' });
    await userEvent.type(within(drawer).getByRole('textbox', { name: 'Código' }), 'night');
    await userEvent.type(within(drawer).getByRole('textbox', { name: 'Nombre' }), 'Nocturno');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cargo' }));
    expect(await screen.findByText('Ya existe un cargo con ese código.')).toBeInTheDocument();
    expect(screen.queryByText(/Finance record/)).not.toBeInTheDocument();
  });
});

describe('Finance list errors (1-E)', () => {
  it('shows the charge catalog error with «Reintentar» instead of an empty catalog', async () => {
    listCharges.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue([]);
    listFinanceServices.mockResolvedValue([]);
    listBillingUnits.mockResolvedValue([]);
    renderWith(<ChargesPage />);
    expect(await screen.findByText(/No se pudieron cargar los cargos/)).toBeInTheDocument();
    expect(screen.queryByText('Sin cargos')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Sin cargos')).toBeInTheDocument();
  });

  it('shows a failed period of exchange rates as an error and a duplicate rate by its code', async () => {
    const rate = { id: 'x-1', rateDate: '2026-11-02', fromCurrency: 'USD', toCurrency: 'DOP', rate: 59.1, source: 'Banco Central RD',
      recordedBy: 'Finanzas', isCurrent: true, version: 'AAA=' };
    listExchangeRates.mockRejectedValueOnce(Object.assign(new Error('Server error'), { status: 503 })).mockResolvedValue([rate]);
    recordExchangeRate.mockRejectedValue(Object.assign(new Error('Finance record conflicts with current state.'),
      { status: 409, code: 'exchange_rate_exists' }));
    renderWith(<ExchangeRatesPage />);
    expect(await screen.findByText(/No se pudieron cargar las tasas/)).toBeInTheDocument();
    expect(screen.queryByText('Sin tasas en el período')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Banco Central RD')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar tasa' }));
    const dialog = screen.getByRole('dialog', { name: 'Registrar tasa USD → DOP' });
    await userEvent.type(within(dialog).getByLabelText('DOP por 1 USD'), '59.2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('Ya hay una tasa vigente para esa fecha. Corríjala en lugar de registrar otra.'))
      .toBeInTheDocument();
    expect(screen.queryByText(/Finance record/)).not.toBeInTheDocument();
  });

  it('records an exchange rate again with the same Idempotency-Key after a lost answer (1-E)', async () => {
    listExchangeRates.mockResolvedValue([]);
    recordExchangeRate.mockRejectedValueOnce(new TypeError('Network down')).mockResolvedValueOnce({ id: 'x-2' });
    renderWith(<ExchangeRatesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar tasa' }));
    const dialog = screen.getByRole('dialog', { name: 'Registrar tasa USD → DOP' });
    await userEvent.type(within(dialog).getByLabelText('DOP por 1 USD'), '59.2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('No se pudo guardar la tasa. Intente de nuevo.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Tasa registrada.')).toBeInTheDocument();
    const [first, second] = recordExchangeRate.mock.calls;
    expect(first[0]).toEqual({ rateDate: expect.any(String), fromCurrency: 'USD', toCurrency: 'DOP', rate: 59.2,
      source: 'Banco Central RD' });
    expect(second).toEqual(first);
    expect(first[1]).toEqual(expect.any(String));
  });

  it('shows the unauthorized state of exchange rates without «Reintentar»', async () => {
    listExchangeRates.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
    renderWith(<ExchangeRatesPage />);
    expect(await screen.findByText('No tiene permiso para consultar las tasas de cambio.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
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
