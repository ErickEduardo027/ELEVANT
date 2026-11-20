import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DepartmentAccessProvider, administratorAccess } from '../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../access/testAccess';
import ContractApprovalsPage from './contract-approvals/ContractApprovalsPage';
import InvoicesPage from './invoices/InvoicesPage';
import ChargesPage, { RULES_BY_METHOD } from './charges/ChargesPage';
import ExchangeRatesPage from './exchange-rates/ExchangeRatesPage';
import {
  decideContractApproval, getChargeTariff, getContractApproval, getFinanceInvoice, listBillingUnits, listCharges,
  listChargeTariffs, listContractApprovals, listExchangeRates, listFinanceInvoices, listFinanceServices, publishChargeTariff,
  recordExchangeRate, saveCharge,
} from '../../services/financeBookService';
import * as financeBook from '../../services/financeBookService';

vi.mock('../../services/financeBookService', async importOriginal => ({
  ...(await importOriginal()),
  listContractApprovals: vi.fn(), getContractApproval: vi.fn(), decideContractApproval: vi.fn(),
  listFinanceInvoices: vi.fn(), getFinanceInvoice: vi.fn(),
  listCharges: vi.fn(), saveCharge: vi.fn(), listFinanceServices: vi.fn(), listBillingUnits: vi.fn(),
  listChargeTariffs: vi.fn().mockResolvedValue([]), getChargeTariff: vi.fn(), publishChargeTariff: vi.fn(),
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

/** The «term → value» pairs of a record. */
const facts = region => Object.fromEntries(within(region).getAllByRole('term')
  .map(term => [term.textContent, term.nextElementSibling.textContent]));
/** A charge of «Cargos en este contrato», found by its name: its title line and its values. */
function contractCharge(name) {
  const title = screen.getByText(name, { selector: 'strong' }).parentElement;
  return { title: title.textContent, ...facts(title.closest('li')) };
}

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
    // N34: the negotiated percentage beside the base one, each with its sign.
    expect(contractCharge('Nocturno')).toEqual({ title: 'Nocturno NIGHT', Contrato: '20 %', 'Tarifa base': '25 %' });
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
    expect(await screen.findByText('No se pudieron cargar los contratos por aprobar. Revisa la conexión e intenta de nuevo.'))
      .toBeInTheDocument();
    expect(screen.queryByText('Sin contratos por aprobar')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Sin contratos por aprobar')).toBeInTheDocument();
    unmount();
    listContractApprovals.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    renderWith(<ContractApprovalsPage />);
    expect(await screen.findByText('No tienes permiso para ver las aprobaciones de contratos.')).toBeInTheDocument();
  });

  it('asks Finanzas as tú to compare each price, and explains a blocked approval as tú (N36)', async () => {
    listContractApprovals.mockResolvedValue([summary]);
    getContractApproval.mockResolvedValue({ summary, terms: null, stations: ['PUJ'], history: [], rates: [], charges: [] });
    decideContractApproval.mockRejectedValue(Object.assign(new Error('Finance record conflicts with current state.'),
      { status: 409, code: 'package_retired' }));
    renderWith(<ContractApprovalsPage />);
    expect(await screen.findByText('Versiones que envía Contratos. Compara cada precio con la tarifa base antes de aprobarlos.'))
      .toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /Demo Airlines/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Aprobar precios' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Aprobar precios' }));
    expect(await screen.findByText('Finanzas retiró un paquete que el contrato incluye. Devuélvelo a Contratos para que lo quite.'))
      .toBeInTheDocument();
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
    ['Active', /El contrato ya está activo: al aprobar, estos precios todavía no rigen\. Contratos confirma la vigencia y firman la aerolínea y AVIAM; con la segunda firma rigen desde el 1 de septiembre de 2026 y la versión vigente termina el día anterior\./,
      /^Precios aprobados\. Rigen desde el 1 de septiembre de 2026 cuando firmen la aerolínea y AVIAM; hasta entonces se factura con la versión vigente\.$/],
    ['Suspended', /El contrato está suspendido: al aprobar, estos precios todavía no rigen\. .*reemplazan a la versión vigente desde el 1 de septiembre de 2026 .*se aplican cuando el contrato se reactive\./,
      /^Precios aprobados\. Reemplazan a la versión vigente desde el 1 de septiembre de 2026 cuando firmen la aerolínea y AVIAM, y se aplican cuando el contrato se reactive\.$/],
  ])('explains that approving an amendment of a %s contract replaces the version in force at its second signature (1-F, 2-C)', async (contractStatus, explained, done) => {
    const amendment = { ...summary, contractStatus };
    listContractApprovals.mockResolvedValue([amendment]);
    getContractApproval.mockResolvedValue({ summary: amendment, terms: null, stations: ['PUJ'], history: [], rates: [], charges: [] });
    decideContractApproval.mockResolvedValue({ id: 'v-1' });
    renderWith(<ContractApprovalsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Demo Airlines/ }));
    // The validity is the date the new prices apply from once both parties sign.
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
    expect(await screen.findByText('No se pudo cargar el contrato. Revisa la conexión e intenta de nuevo.')).toBeInTheDocument();
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
    expect(await screen.findByText('No tienes permiso para ver este contrato: alguna de sus estaciones no está en tu alcance.'))
      .toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprobar precios' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('writes the validity dd/mm/aaaa in the list and in the detail (N36)', async () => {
    const dated = { ...summary, validTo: '2027-08-31' };
    listContractApprovals.mockResolvedValue([dated]);
    getContractApproval.mockResolvedValue({ summary: dated, terms: null, stations: ['PUJ'], history: [], rates: [], charges: [] });
    renderWith(<ContractApprovalsPage />);
    const item = await screen.findByRole('button', { name: /Demo Airlines/ });
    expect(within(item).getByText('QA-1 · USD · desde 01/09/2026')).toBeInTheDocument();
    await userEvent.click(item);
    expect(await screen.findByText('USD · 01/09/2026 a 31/08/2027 · Estaciones PUJ')).toBeInTheDocument();
    expect(screen.queryByText(/2026-09-01|2027-08-31/)).not.toBeInTheDocument();
  });

  it('names a new contract «Borrador» and the start of its id instead of its DRAFT- code (N35)', async () => {
    const code = 'DRAFT-1cc18541e2a94f3b8c7d6e5f4a3b2c1d';
    const draft = { ...summary, contractCode: code };
    listContractApprovals.mockResolvedValue([draft]);
    getContractApproval.mockResolvedValue({ summary: draft, terms: null, stations: ['PUJ'], history: [], rates: [], charges: [] });
    renderWith(<ContractApprovalsPage />);
    const item = await screen.findByRole('button', { name: /Demo Airlines/ });
    expect(within(item).getByText('Borrador 1cc18541… · USD · desde 01/09/2026')).toHaveAttribute('title', code);
    await userEvent.click(item);
    expect(await screen.findByRole('heading', { name: 'Demo Airlines · Borrador 1cc18541…' })).toHaveAttribute('title', code);
    expect(screen.queryByText(/DRAFT-/)).not.toBeInTheDocument();
  });

  it('names each service and charge first and writes every charge value with its currency or unit (N34)', async () => {
    listContractApprovals.mockResolvedValue([summary]);
    getContractApproval.mockResolvedValue({ summary, terms: null, stations: ['PUJ'], history: [],
      rates: [{ rateId: 'r-1', serviceCode: 'BAGGAGE', serviceName: 'Manejo de equipaje', billingUnit: 'operation',
        contractPrice: 104, contractMinimum: 1, basePrice: 130, baseMinimum: 1, differencePercent: -20 }],
      charges: [
        { chargeId: 'ch-fee', chargeCode: 'ADMIN-FEE', chargeName: 'Cargo administrativo', method: 'FixedAmount',
          isExcluded: false, contractValue: null, baseValue: 15 },
        { chargeId: 'ch-delay', chargeCode: 'DELAY', chargeName: 'Espera', method: 'PerHour', isExcluded: false,
          contractValue: 50, baseValue: 40 },
        { chargeId: 'ch-gpu', chargeCode: 'GPU-LATE', chargeName: 'Planta fuera de horario', method: 'FixedAmount',
          isExcluded: true, contractValue: null, baseValue: 30 },
        { chargeId: 'ch-tow', chargeCode: 'TOW-WAIT', chargeName: 'Espera del remolque', method: 'PerMinute',
          isExcluded: false, contractValue: null, baseValue: null },
      ] });
    renderWith(<ContractApprovalsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Demo Airlines/ }));
    // The name is the title and the code the secondary text (D-N34).
    expect((await screen.findByText('Manejo de equipaje', { selector: 'strong' })).closest('td'))
      .toHaveTextContent(/^Manejo de equipaje\s*BAGGAGE$/);
    expect(contractCharge('Cargo administrativo')).toEqual({ title: 'Cargo administrativo ADMIN-FEE',
      Contrato: 'Se aplica la tarifa base', 'Tarifa base': 'USD 15.00' });
    expect(contractCharge('Espera')).toEqual({ title: 'Espera DELAY', Contrato: 'Por hora: USD 50.00',
      'Tarifa base': 'Por hora: USD 40.00' });
    expect(contractCharge('Planta fuera de horario')).toEqual({ title: 'Planta fuera de horario GPU-LATE',
      Contrato: 'Excluido', 'Tarifa base': 'USD 30.00' });
    expect(contractCharge('Espera del remolque')).toEqual({ title: 'Espera del remolque TOW-WAIT',
      Contrato: 'Se aplica la tarifa base', 'Tarifa base': 'Sin importe' });
    // No bare number, and the method is not said twice: «DELAY · Por hora: tarifa base 40» is gone.
    expect(screen.queryByText(/tarifa base \d|negociado \d|Por hora: tarifa/)).not.toBeInTheDocument();
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
    const onOpenReceipt = vi.fn();
    renderWith(<InvoicesPage initialStationId="st-1" onOpenReceipt={onOpenReceipt} />);
    await userEvent.click(await screen.findByRole('button', { name: /NF-0123456789ab/ }));
    const drawer = await screen.findByRole('dialog', { name: /Factura Demo Airlines/ });
    expect(within(drawer).getByText('Acordado')).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Gestionar cobros y aplicaciones' }));
    expect(onOpenReceipt).toHaveBeenCalledWith(null, expect.objectContaining({ invoiceId: 'inv-1', airlineId: 'a-1', stationId: 'st-1' }));
    // 4-N12: the legacy payment and credit-note writers are retired; only the treasury flow remains.
    expect(Object.keys(financeBook)).not.toContain('recordPartialPayment');
    expect(Object.keys(financeBook)).not.toContain('issueCreditNote');
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
    expect(await within(drawer).findByRole('alert')).toHaveTextContent('No se pudo guardar el cargo. Intenta de nuevo.');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cargo' }));
    expect(await screen.findByText('Cargo creado. Asígnale un importe en el tarifario de cargos.')).toBeInTheDocument();
    const [first, second] = saveCharge.mock.calls;
    expect(second[1]).toEqual(first[1]);
    expect(second[2]).toBe(first[2]);
  });
});

describe('ChargesPage tariff dates (N36)', () => {
  it('lists its versions dd/mm/aaaa and writes in full the start a new version must follow', async () => {
    listCharges.mockResolvedValue([]);
    listFinanceServices.mockResolvedValue([]);
    listBillingUnits.mockResolvedValue([]);
    const published = { id: 'ct-1', currencyCode: 'USD', status: 'Published', validFrom: '2026-10-01', validTo: null,
      note: null, rateCount: 0, publishedBy: 'Finanzas', publishedAt: '2026-09-20T12:00:00Z', version: 'v1' };
    const draft = { ...published, id: 'ct-2', status: 'Draft', validFrom: '2026-09-15', publishedBy: null, publishedAt: null };
    listChargeTariffs.mockResolvedValueOnce([draft, published]);
    getChargeTariff.mockResolvedValueOnce({ summary: draft, rates: [] });
    renderWith(<ChargesPage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Importes' }));
    expect(await screen.findByText('USD · desde 15/09/2026')).toBeInTheDocument();
    expect(screen.getByText('USD · desde 01/10/2026')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Publicar' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('La versión pasa a ser la vigente y la anterior queda como '
      + 'histórica. Guarda antes los cambios pendientes.');
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Publicar' }));
    expect(await screen.findByText('La vigencia debe empezar después del 1 de octubre de 2026, inicio de la última versión '
      + 'publicada. Cambia «Vigente desde» y guarda.')).toBeInTheDocument();
    expect(publishChargeTariff).not.toHaveBeenCalled();
    expect(getChargeTariff).toHaveBeenCalledWith('ct-2');
  });
});

describe('ChargesPage names and read-only versions (N34)', () => {
  const delay = { id: 'ch-delay', code: 'DELAY', name: 'Espera', description: null, category: 'AdditionalCharge',
    method: 'PerHour', quantityRule: 'ArrivalDelay', graceMinutes: 15, roundingIncrement: 0.25, appliesToAllServices: true,
    serviceIds: [], allowMultiple: false, visibleToAgents: true, isActive: true, billingUnit: 'hour', version: 'c1' };
  const published = { id: 'ct-1', currencyCode: 'USD', status: 'Published', validFrom: '2026-10-01', validTo: null,
    note: null, rateCount: 1, publishedBy: 'Finanzas', publishedAt: '2026-09-20T12:00:00Z', version: 'v1' };
  const cellsOf = name => within(screen.getByText(name, { selector: 'strong' }).closest('tr')).getAllByRole('cell')
    .map(cell => cell.textContent);

  it('names each charge of the catalog first, with its code as secondary text', async () => {
    listCharges.mockResolvedValue([delay]);
    listFinanceServices.mockResolvedValue([]);
    listBillingUnits.mockResolvedValue([]);
    renderWith(<ChargesPage />);
    expect((await screen.findByText('Espera', { selector: 'strong' })).closest('td')).toHaveTextContent(/^Espera\s*DELAY$/);
  });

  it('shows a published version as text, not as fields that look editable', async () => {
    listCharges.mockResolvedValue([delay]);
    listFinanceServices.mockResolvedValue([]);
    listBillingUnits.mockResolvedValue([]);
    listChargeTariffs.mockResolvedValueOnce([published]);
    getChargeTariff.mockResolvedValueOnce({ summary: published, rates: [{ chargeId: 'ch-delay', chargeCode: 'DELAY',
      chargeName: 'Espera', method: 'PerHour', value: 40, minimumAmount: 0 }] });
    renderWith(<ChargesPage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Importes' }));
    await screen.findByText('Espera', { selector: 'strong' });
    expect(cellsOf('Espera')).toEqual([expect.stringMatching(/^Espera\s*DELAY$/), 'Por hora', 'USD 40.00', 'USD 0.00']);
    expect(facts(document.body)).toEqual({ 'Vigente desde': '01/10/2026' });
    expect(screen.queryByLabelText('Vigente desde')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument();
  });

  it('keeps the fields of a draft its account can edit', async () => {
    listCharges.mockResolvedValue([delay]);
    listFinanceServices.mockResolvedValue([]);
    listBillingUnits.mockResolvedValue([]);
    const draft = { ...published, id: 'ct-2', status: 'Draft', validFrom: '2026-11-15', publishedBy: null, publishedAt: null };
    listChargeTariffs.mockResolvedValueOnce([draft]);
    getChargeTariff.mockResolvedValueOnce({ summary: draft, rates: [] });
    renderWith(<ChargesPage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Importes' }));
    expect(await screen.findByLabelText('Vigente desde')).toHaveValue('2026-11-15');
    expect(screen.getByLabelText('Importe de DELAY')).toHaveAttribute('placeholder', 'Sin importe');
    expect(screen.queryByRole('term')).not.toBeInTheDocument();
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
    expect(await screen.findByText('No se pudieron cargar los cargos. Revisa la conexión e intenta de nuevo.')).toBeInTheDocument();
    expect(screen.queryByText('Sin cargos')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Sin cargos')).toBeInTheDocument();
    // N36: the empty catalog tells Finanzas what to do as tú.
    expect(screen.getByText('Crea los cargos y recargos que los agentes podrán aplicar.')).toBeInTheDocument();
  });

  it('says as tú that the account cannot read the charges or their amounts (N36)', async () => {
    listCharges.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 })).mockResolvedValue([]);
    listChargeTariffs.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    listFinanceServices.mockResolvedValue([]);
    listBillingUnits.mockResolvedValue([]);
    renderWith(<ChargesPage />);
    expect(await screen.findByText('No tienes permiso para consultar los cargos.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Importes' }));
    expect(await screen.findByText('No tienes permiso para consultar el tarifario de cargos.')).toBeInTheDocument();
  });

  it('asks as tú to sign in again when the session of the charge catalog expired (N36)', async () => {
    listCharges.mockRejectedValueOnce(Object.assign(new Error('Expired'), { status: 401 }));
    listFinanceServices.mockResolvedValue([]);
    listBillingUnits.mockResolvedValue([]);
    renderWith(<ChargesPage />);
    expect(await screen.findByText('La sesión expiró. Vuelve a iniciar sesión.')).toBeInTheDocument();
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
