import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DepartmentAccessProvider } from '../../access/DepartmentAccessContext';
import { commercialApi } from '../../../services/commercialGovernanceApi';
import SuppliersPage from './SuppliersPage';
import PayablesPage from './PayablesPage';
import ExpensesPage from './ExpensesPage';
import DepartmentExpensesPage from './DepartmentExpensesPage';
vi.mock('../../../services/commercialGovernanceApi', () => ({ commercialApi: vi.fn() }));
vi.mock('../../auth/authService', () => ({ readSession: () => ({ accountId: 'me', stationScopes: [{ stationId: 'st1', stationCode: 'PUJ' }] }), handleUnauthorizedResponse: vi.fn() }));
const options = { stations: [{ id: 'st1', code: 'PUJ', name: 'Punta Cana' }], suppliers: [{ id: 'supplier', code: 'SP', name: 'Proveedor de rampa' }], airlines: [], services: [], turnarounds: [], currencies: ['USD', 'DOP'], employeeId: 'emp-me', department: 'Finance', canCreateOwnExpense: true, canReadOwnExpenses: true, canReviewDepartmentExpenses: true, canReadFinanceExpenses: true, canApproveFinanceExpenses: true, canPayFinanceExpenses: true };
const fx = { currency: 'USD', rateToDop: 60, source: 'Tasa revisada', rateDate: '2026-10-18' };
const invoice = { id: 'bill', supplierId: 'supplier', supplierName: 'Proveedor de rampa', scopeStationId: 'st1', documentReference: 'SUP-1', documentDate: '2026-10-18', dueDate: '2026-11-18', status: 'Approved', fx, dimensions: {}, total: 1000, totalDop: 60000, paid: 300, remaining: 700, version: 'bill-v1', lines: [{ id: 'line', number: 1, description: 'Combustible', quantity: 1, unitPrice: 1000, taxAmount: 0, total: 1000 }], attachments: [], reviews: [], approvalBlocked: false };
let failure;
const writes = () => commercialApi.mock.calls.filter(([, o]) => o?.method);
function mount(ui, permissions, department = 'finance', kind = 'Administrator') {
  return render(<DepartmentAccessProvider observe={false} initialAccess={{ kind, department, permissions }}>{ui}</DepartmentAccessProvider>);
}
beforeEach(() => {
  failure = null; invoice.status = 'Approved'; invoice.approvalBlocked = false;
  commercialApi.mockImplementation(async (path, optionsArg) => {
    if (optionsArg?.method) { if (failure) { const e = failure; failure = null; throw e; } return { id: 'created', replayed: false }; }
    if (path.includes('/options')) return options;
    if (path.startsWith('/finance/suppliers?')) return [];
    if (path.startsWith('/finance/payable-payments?')) return [{ id: 'payment', supplierId: 'supplier', scopeStationId: 'st1', reference: 'Transferencia', fx, amount: 900, applied: 100, remaining: 800, version: 'payment-v1', applications: [] }];
    if (path === '/finance/payables/bill') return invoice;
    if (path.startsWith('/finance/payables?')) return [invoice];
    if (path.startsWith('/finance/expenses?')) return [];
    throw new Error('Unexpected path ' + path);
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('Finance supplier, payable and expense pages', () => {
  it('creates a station-scoped supplier and retries the same command after a lost response', async () => {
    mount(<SuppliersPage />, ['finance.suppliers.read', 'finance.suppliers.create', 'finance.suppliers.update', 'finance.suppliers.delete']);
    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo proveedor' }));
    await userEvent.type(screen.getByLabelText('Código'), 'RAMP');
    await userEvent.type(screen.getByLabelText('Nombre del proveedor'), 'Servicios de rampa');
    failure = new Error('Private exception text');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar proveedor' }));
    expect(await screen.findByRole('alert')).not.toHaveTextContent('Private exception');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar acción' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(JSON.parse(writes()[0][1].body)).toEqual(JSON.parse(writes()[1][1].body));
    expect(JSON.parse(writes()[0][1].body)).toMatchObject({ scopeStationId: 'st1', code: 'RAMP', name: 'Servicios de rampa', requestId: expect.any(String) });
  });
  it('applies an existing payment partially with both persisted versions', async () => {
    mount(<PayablesPage />, ['finance.payables.read', 'finance.payables.pay']);
    await userEvent.click(await screen.findByRole('button', { name: /SUP-1/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar pago existente' }));
    await userEvent.selectOptions(screen.getByLabelText('Pago registrado'), 'payment');
    await userEvent.type(screen.getByLabelText('Importe a aplicar de SUP-1'), '300');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar aplicaciones' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/finance/payable-payments/payment/applications');
    expect(JSON.parse(writes()[0][1].body)).toMatchObject({ expectedVersion: 'payment-v1', applications: [{ invoiceId: 'bill', expectedVersion: 'bill-v1', paymentAmount: 300, rateToInvoice: 1 }] });
  });
  it('never exposes mutation buttons to readers', async () => {
    mount(<PayablesPage />, ['finance.payables.read']);
    await userEvent.click(await screen.findByRole('button', { name: /SUP-1/ }));
    expect(screen.queryByRole('button', { name: 'Aprobar factura' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar pago' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Detalle de cuenta por pagar' })).getByText(/700/)).toBeInTheDocument();
  });
  it('shows own-department review and hides self approval', async () => {
    const claim = { ...invoice, id: 'expense', employeeId: 'emp-other', employeeNumber: 'QA-2', requesterId: 'other', description: 'Traslado de rampa', expenseDate: '2026-10-18', department: 'Operations', status: 'Submitted', receipts: [], reimbursements: [] };
    commercialApi.mockImplementation(async path => path.includes('/options') ? { ...options, department: 'Operations' } : path === '/finance/expenses/expense' ? claim : [claim]);
    mount(<ExpensesPage />, ['finance.expenses.read'], 'operations');
    await userEvent.click(await screen.findByRole('button', { name: /Traslado de rampa/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Aprobar departamento' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar decisión' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1].body)).toMatchObject({ decision: 'DepartmentApproved', expectedVersion: 'bill-v1' });
  });
  it('refreshes a stale bill after a 409 and requires a new review', async () => {
    invoice.status = 'Submitted';
    mount(<PayablesPage />, ['finance.payables.read', 'finance.payables.approve']);
    await userEvent.click(await screen.findByRole('button', { name: /SUP-1/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Aprobar factura' }));
    failure = Object.assign(new Error('Private SQL exception'), { status: 409, code: 'version_conflict' });
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar decisión' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('versión');
    await waitFor(() => expect(commercialApi.mock.calls.filter(([p]) => p === '/finance/payables/bill').length).toBeGreaterThan(1));
    expect(screen.queryByText('Private SQL exception')).not.toBeInTheDocument(); invoice.status = 'Approved';
  });
  it('requires explicit FX before saving a bill and sends decimal line inputs with scope', async () => {
    mount(<PayablesPage />, ['finance.payables.read', 'finance.payables.create', 'finance.payables.update']);
    await userEvent.click(await screen.findByRole('button', { name: 'Nueva factura de proveedor' }));
    await userEvent.selectOptions(screen.getByLabelText('Proveedor'), 'supplier');
    await userEvent.type(screen.getByLabelText('Referencia del proveedor'), 'SUP-NEW');
    await userEvent.type(screen.getByLabelText('Descripción de línea 1'), 'Servicio de rampa');
    await userEvent.type(screen.getByLabelText('Precio unitario de línea 1'), '100.125');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(writes()).toHaveLength(0); expect(screen.getByLabelText('Tasa a DOP')).toBeInvalid();
    await userEvent.type(screen.getByLabelText('Tasa a DOP'), '60');
    await userEvent.type(screen.getByLabelText('Fuente de la tasa'), 'Tasa revisada');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1].body)).toMatchObject({ supplierId: 'supplier', scopeStationId: 'st1', documentReference: 'SUP-NEW', fx: { currency: 'USD', rateToDop: 60, source: 'Tasa revisada' },
      lines: [{ description: 'Servicio de rampa', quantity: 1, unitPrice: 100.125, taxAmount: 0 }], expectedVersion: null });
  });
  it('keeps the bill editor open on a duplicate reference and explains it in Spanish without re-reading (4-N27)', async () => {
    mount(<PayablesPage />, ['finance.payables.read', 'finance.payables.create', 'finance.payables.update']);
    await userEvent.click(await screen.findByRole('button', { name: 'Nueva factura de proveedor' }));
    await userEvent.selectOptions(screen.getByLabelText('Proveedor'), 'supplier');
    await userEvent.type(screen.getByLabelText('Referencia del proveedor'), 'SUP-1');
    await userEvent.type(screen.getByLabelText('Descripción de línea 1'), 'Servicio de rampa');
    await userEvent.type(screen.getByLabelText('Precio unitario de línea 1'), '100');
    await userEvent.type(screen.getByLabelText('Tasa a DOP'), '60');
    await userEvent.type(screen.getByLabelText('Fuente de la tasa'), 'Tasa revisada');
    const reads = commercialApi.mock.calls.length;
    failure = Object.assign(new Error('Violation of UNIQUE KEY'), { status: 409, code: 'duplicate_reference' });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe una factura activa de este proveedor con ese número de documento.');
    expect(screen.queryByText(/UNIQUE KEY/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Referencia del proveedor')).toHaveValue('SUP-1');
    expect(screen.queryByRole('button', { name: 'Reintentar acción' })).not.toBeInTheDocument();
    expect(commercialApi.mock.calls.slice(reads).filter(([, request]) => !request?.method)).toHaveLength(0);
    // A corrected reference is a new intent with a new request id.
    await userEvent.clear(screen.getByLabelText('Referencia del proveedor'));
    await userEvent.type(screen.getByLabelText('Referencia del proveedor'), 'SUP-2');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(JSON.parse(writes()[1][1].body).requestId).not.toBe(JSON.parse(writes()[0][1].body).requestId);
  });
  it('requires a reason to reject a supplier bill', async () => {
    invoice.status = 'Submitted'; mount(<PayablesPage />, ['finance.payables.read', 'finance.payables.approve']);
    await userEvent.click(await screen.findByRole('button', { name: /SUP-1/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Rechazar factura' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar decisión' }));
    expect(writes()).toHaveLength(0);
    await userEvent.type(screen.getByLabelText('Motivo de la decisión'), 'Referencia incorrecta');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar decisión' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1].body)).toMatchObject({ decision: 'Rejected', reason: 'Referencia incorrecta', expectedVersion: 'bill-v1' });
  });
  it('voids a draft only with a reason of 5 to 500 characters (4-N03)', async () => {
    invoice.status = 'Draft';
    mount(<PayablesPage />, ['finance.payables.read', 'finance.payables.update']);
    await userEvent.click(await screen.findByRole('button', { name: /SUP-1/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Anular borrador' }));
    expect(screen.getByRole('heading', { name: 'Anular la factura' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar anulación' }));
    expect(writes()).toHaveLength(0);
    await userEvent.type(screen.getByLabelText('Motivo de la decisión'), 'Mal');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar anulación' }));
    expect(writes()).toHaveLength(0);
    await userEvent.type(screen.getByLabelText('Motivo de la decisión'), ' digitado');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar anulación' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/finance/payables/bill/decisions');
    expect(JSON.parse(writes()[0][1].body)).toMatchObject({ decision: 'Voided', reason: 'Mal digitado', expectedVersion: 'bill-v1' });
  });
  it('corrects or voids a rejected bill and never reopens an approved one (4-N03)', async () => {
    invoice.status = 'Rejected';
    const { unmount } = mount(<PayablesPage />, ['finance.payables.read', 'finance.payables.update']);
    await userEvent.click(await screen.findByRole('button', { name: /SUP-1/ }));
    expect(screen.getByRole('button', { name: 'Anular factura' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Corregir factura' }));
    await userEvent.type(screen.getByLabelText('Motivo de la decisión'), 'Corregir el importe');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar corrección' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1].body)).toMatchObject({ decision: 'Draft', reason: 'Corregir el importe' });
    unmount();
    invoice.status = 'Approved';
    mount(<PayablesPage />, ['finance.payables.read', 'finance.payables.update']);
    await userEvent.click(await screen.findByRole('button', { name: /SUP-1/ }));
    await screen.findByRole('region', { name: 'Detalle de cuenta por pagar' });
    for (const name of ['Corregir factura', 'Anular factura', 'Anular borrador', 'Editar borrador'])
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  });
  it('voids an approved bill with the reversal code only while nothing is applied to it (4-N03)', async () => {
    invoice.paid = 0; invoice.remaining = 1000;
    try {
      const { unmount } = mount(<PayablesPage />, ['finance.payables.read', 'finance.payables.reverse']);
      await userEvent.click(await screen.findByRole('button', { name: /SUP-1/ }));
      await userEvent.click(await screen.findByRole('button', { name: 'Anular factura' }));
      await userEvent.type(screen.getByLabelText('Motivo de la decisión'), 'Monto aprobado por error');
      await userEvent.click(screen.getByRole('button', { name: 'Confirmar anulación' }));
      await waitFor(() => expect(writes()).toHaveLength(1));
      expect(JSON.parse(writes()[0][1].body)).toMatchObject({ decision: 'Voided', reason: 'Monto aprobado por error' });
      unmount();
    } finally { invoice.paid = 300; invoice.remaining = 700; }
    mount(<PayablesPage />, ['finance.payables.read', 'finance.payables.reverse']);
    await userEvent.click(await screen.findByRole('button', { name: /SUP-1/ }));
    expect(await screen.findByText('Para anular esta factura, revierta antes los pagos aplicados.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anular factura' })).not.toBeInTheDocument();
  });
  it('labels a voided bill «Anulada», filters by it and shows its history in Spanish (4-N03)', async () => {
    invoice.status = 'Voided'; const reviews = invoice.reviews;
    invoice.reviews = [{ stage: 'Submission', decision: 'Submitted', actorId: 'me', at: '2026-10-18T12:00:00Z', reason: null },
      { stage: 'Void', decision: 'Voided', actorId: 'other', at: '2026-10-19T12:00:00Z', reason: 'Monto aprobado por error' }];
    try {
      mount(<PayablesPage />, ['finance.payables.read', 'finance.payables.update', 'finance.payables.approve', 'finance.payables.pay', 'finance.payables.reverse']);
      expect(await screen.findByRole('option', { name: 'Anulada' })).toBeInTheDocument();
      await userEvent.selectOptions(screen.getByLabelText('Estado'), 'Voided');
      await waitFor(() => expect(commercialApi.mock.calls.some(([path]) => path.startsWith('/finance/payables?') && path.includes('status=Voided'))).toBe(true));
      await userEvent.click(await screen.findByRole('button', { name: /SUP-1/ }));
      const region = await screen.findByRole('region', { name: 'Detalle de cuenta por pagar' });
      expect(within(region).getByText('Anulada')).toBeInTheDocument();
      expect(within(region).getByText(/Presentación · Enviado a revisión/)).toBeInTheDocument();
      expect(within(region).getByText(/Anulación · Anulado/)).toBeInTheDocument();
      expect(within(region).queryByText(/Void|Submission/)).not.toBeInTheDocument();
      // The voided invoice offers no action of its own; 4-N04, 4-N15: the payments of its supplier stay voidable below.
      const payments = within(region).getByRole('region', { name: 'Pagos del proveedor' });
      await within(payments).findByRole('listitem', { name: 'Pago Transferencia' });
      const actions = within(region).queryAllByRole('button').filter(button => !payments.contains(button));
      for (const name of [/Anular/, /Corregir/, /Aprobar/, /Rechazar/, /Enviar/, /Registrar pago/, /Aplicar pago/, /Editar/])
        expect(actions.filter(button => name.test(button.textContent ?? '')).map(button => button.textContent)).toEqual([]);
    } finally { invoice.reviews = reviews; }
  });
  it('voids from a voided invoice the payment its reversed application left unapplied (4-N04, 4-N15)', async () => {
    // The only approved invoice of the supplier had its application reversed and was voided: the payment keeps its remainder.
    invoice.status = 'Voided';
    const reversed = { id: 'app-reversed', invoiceId: 'bill', paymentAmount: 100, invoiceAmount: 100, rateToInvoice: 1, appliedAt: '2026-10-18T12:00:00Z',
      reversedAt: '2026-10-19T12:00:00Z', reversalReason: 'Aplicado a la factura equivocada' };
    const payment = { id: 'payment', supplierId: 'supplier', scopeStationId: 'st1', reference: 'Transferencia', paidOn: '2026-10-18', fx, amount: 900,
      applied: 0, remaining: 900, version: 'payment-v1', applications: [reversed], voidedAt: null, voidReason: null };
    commercialApi.mockImplementation(async (path, request) => {
      if (request?.method) return { id: 'payment', replayed: false };
      if (path.includes('/options')) return options;
      if (path.startsWith('/finance/payable-payments?')) return [payment];
      if (path === '/finance/payables/bill') return { ...invoice, paid: 0, remaining: 0 };
      if (path.startsWith('/finance/payables?')) return [{ ...invoice, paid: 0, remaining: 0 }];
      throw new Error('Unexpected path ' + path);
    });
    mount(<PayablesPage />, ['finance.payables.read', 'finance.payables.reverse']);
    await userEvent.click(await screen.findByRole('button', { name: /SUP-1/ }));
    const panel = await screen.findByRole('region', { name: 'Pagos del proveedor' });
    const item = await within(panel).findByRole('listitem', { name: 'Pago Transferencia' });
    expect(item).toHaveTextContent('Disponible');
    expect(within(item).getByText('Esta factura')).toBeInTheDocument();
    expect(within(item).getByText(/Revertida: Aplicado a la factura equivocada/)).toBeInTheDocument();
    expect(within(item).queryByRole('button', { name: 'Revertir aplicación' })).not.toBeInTheDocument();
    await userEvent.click(within(item).getByRole('button', { name: 'Anular pago' }));
    await userEvent.type(within(panel).getByLabelText('Motivo de la decisión'), 'Pago registrado por error');
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirmar anulación' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/finance/payable-payments/payment/reversals');
    expect(JSON.parse(writes()[0][1].body)).toEqual({ expectedVersion: 'payment-v1', reason: 'Pago registrado por error', requestId: expect.any(String) });
  });
  it.each(['Draft', 'Submitted', 'Rejected'])('lists and voids the supplier payments from a %s invoice too (4-N04, 4-N15)', async status => {
    invoice.status = status;
    mount(<PayablesPage />, ['finance.payables.read', 'finance.payables.reverse']);
    await userEvent.click(await screen.findByRole('button', { name: /SUP-1/ }));
    const panel = await screen.findByRole('region', { name: 'Pagos del proveedor' });
    const item = await within(panel).findByRole('listitem', { name: 'Pago Transferencia' });
    expect(item).toHaveTextContent('Disponible');
    expect(within(item).getByRole('button', { name: 'Anular pago' })).toBeEnabled();
  });
  it.each([
    ['who submitted it', 'me'],
    ['who created the draft another person submitted', 'other'],
  ])('does not offer the approval to %s, as the server says (4-N14)', async (_name, submitter) => {
    const reviews = invoice.reviews;
    try {
      invoice.status = 'Submitted'; invoice.approvalBlocked = true;
      invoice.reviews = [{ stage: 'Submission', decision: 'Submitted', actorId: submitter, at: '2026-10-18T12:00:00Z', reason: null }];
      mount(<PayablesPage />, ['finance.payables.read', 'finance.payables.approve', 'finance.payables.pay']);
      await userEvent.click(await screen.findByRole('button', { name: /SUP-1/ }));
      expect(await screen.findByText('Otra persona de Finanzas debe aprobar esta factura.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Aprobar factura' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Rechazar factura' })).toBeInTheDocument();
    } finally { invoice.reviews = reviews; }
  });
  it('offers the approval to another person of Finance, whoever submitted the bill (4-N14)', async () => {
    const reviews = invoice.reviews;
    try {
      invoice.status = 'Submitted';
      invoice.reviews = [{ stage: 'Submission', decision: 'Submitted', actorId: 'other', at: '2026-10-18T12:00:00Z', reason: null }];
      mount(<PayablesPage />, ['finance.payables.read', 'finance.payables.approve']);
      await userEvent.click(await screen.findByRole('button', { name: /SUP-1/ }));
      expect(await screen.findByRole('button', { name: 'Aprobar factura' })).toBeInTheDocument();
      expect(screen.queryByText('Otra persona de Finanzas debe aprobar esta factura.')).not.toBeInTheDocument();
    } finally { invoice.reviews = reviews; }
  });
  it('does not offer the payment to who approved the bill (4-N14)', async () => {
    const reviews = invoice.reviews;
    try {
      invoice.status = 'Approved';
      invoice.reviews = [{ stage: 'Submission', decision: 'Submitted', actorId: 'other', at: '2026-10-18T12:00:00Z', reason: null },
        { stage: 'Finance', decision: 'Approved', actorId: 'me', at: '2026-10-18T13:00:00Z', reason: null }];
      mount(<PayablesPage />, ['finance.payables.read', 'finance.payables.approve', 'finance.payables.pay']);
      await userEvent.click(await screen.findByRole('button', { name: /SUP-1/ }));
      expect(await screen.findByText('Usted aprobó esta factura: otra persona de Finanzas debe registrar y aplicar sus pagos.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Registrar pago' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Aplicar pago existente' })).not.toBeInTheDocument();
    } finally { invoice.reviews = reviews; }
  });
  it('explains a segregation refusal the screen could not foresee (4-N14)', async () => {
    invoice.status = 'Submitted';
    mount(<PayablesPage />, ['finance.payables.read', 'finance.payables.approve']);
    await userEvent.click(await screen.findByRole('button', { name: /SUP-1/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Aprobar factura' }));
    failure = Object.assign(new Error('Another person must approve or pay this document.'), { status: 403, code: 'segregation_of_duties' });
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar decisión' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Otra persona de Finanzas debe aprobar o pagar este documento.');
    expect(screen.queryByText(/Another person/)).not.toBeInTheDocument();
  });
  it.each([
    ['Draft', ['Anular borrador'], ['Editar borrador', 'Enviar a revisión']],
    ['Submitted', [], ['Aprobar factura', 'Rechazar factura']],
    ['Rejected', ['Anular factura'], ['Corregir factura']],
    ['Approved', ['Aplicar pago existente'], ['Registrar pago']],
  ])('keeps only voiding and applying payments for a retired supplier (%s, 4-N15)', async (status, kept, hidden) => {
    invoice.status = status;
    commercialApi.mockImplementation(async (path, request) => {
      if (request?.method) return { id: 'created', replayed: false };
      if (path.includes('/options')) return { ...options, suppliers: [] };
      if (path.startsWith('/finance/payable-payments?')) return [];
      if (path === '/finance/payables/bill') return invoice;
      if (path.startsWith('/finance/payables?')) return [invoice];
      throw new Error('Unexpected path ' + path);
    });
    mount(<PayablesPage />, ['finance.payables.read', 'finance.payables.update', 'finance.payables.approve', 'finance.payables.pay']);
    await userEvent.click(await screen.findByRole('button', { name: /SUP-1/ }));
    expect(await screen.findByText('Proveedor retirado: reactívelo en Proveedores para continuar.')).toBeInTheDocument();
    for (const name of kept) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    for (const name of hidden) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  });
  it('explains why a supplier with open balances is not retired (4-N15)', async () => {
    const supplier = { id: 'supplier', scopeStationId: 'st1', code: 'SP', name: 'Proveedor de rampa', taxReference: null, contactEmail: null, isActive: true, version: 'supplier-v1' };
    commercialApi.mockImplementation(async (path, request) => {
      if (request?.method) throw Object.assign(new Error('The request conflicts.'), { status: 409, code: 'supplier_has_open_balance' });
      if (path.includes('/options')) return options;
      if (path === '/finance/suppliers/supplier') return supplier;
      if (path.startsWith('/finance/suppliers?')) return [supplier];
      throw new Error('Unexpected path ' + path);
    });
    mount(<SuppliersPage />, ['finance.suppliers.read', 'finance.suppliers.update', 'finance.suppliers.delete']);
    await userEvent.click(await screen.findByRole('button', { name: 'Proveedor de rampa' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Retirar proveedor' }));
    expect(screen.getByText('Solo se puede retirar un proveedor sin facturas en curso, saldo pendiente ni pagos sin aplicar. Se conserva todo el historial.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Motivo del retiro'), 'Proveedor sin contrato');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar retiro' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El proveedor tiene facturas en curso, saldo pendiente o pagos sin aplicar: anúlelos o liquídelos en Facturas de proveedores antes de retirarlo.');
    expect(writes()[0][0]).toBe('/finance/suppliers/supplier');
    expect(JSON.parse(writes()[0][1].body)).toMatchObject({ decision: 'Retired', reason: 'Proveedor sin contrato', expectedVersion: 'supplier-v1' });
  });
  it('never offers approval or reimbursement for the current employee own claim', async () => {
    const claim = { ...invoice, id: 'own', employeeId: 'emp-me', requesterId: 'me', employeeNumber: 'QA-1', description: 'Gasto propio', expenseDate: '2026-10-18', department: 'Finance', status: 'DepartmentApproved', receipts: [], reimbursements: [] };
    commercialApi.mockImplementation(async path => path.includes('/options') ? options : path === '/finance/expenses/own' ? claim : [claim]);
    mount(<ExpensesPage />, ['finance.expenses.read', 'finance.expenses.approve', 'finance.expenses.pay']);
    await userEvent.click(await screen.findByRole('button', { name: /Gasto propio/ }));
    await screen.findByRole('region', { name: 'Detalle de gasto' });
    expect(screen.queryByRole('button', { name: 'Aprobar Finanzas' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar reembolso' })).not.toBeInTheDocument();
  });
  it('records a partial employee reimbursement separately from the approved claim', async () => {
    const claim = { ...invoice, id: 'expense-paid', employeeId: 'emp-other', requesterId: 'other', employeeNumber: 'QA-2', description: 'Traslado aprobado', expenseDate: '2026-10-18', department: 'Operations', status: 'Approved', receipts: [], reimbursements: [] };
    commercialApi.mockImplementation(async (path, request) => {
      if (request?.method) return { id: 'reimbursement' };
      return path.includes('/options') ? options : path === '/finance/expenses/expense-paid' ? claim : [claim];
    });
    mount(<ExpensesPage />, ['finance.expenses.read', 'finance.expenses.pay']);
    await userEvent.click(await screen.findByRole('button', { name: /Traslado aprobado/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar reembolso' }));
    await userEvent.type(screen.getByLabelText('Importe del pago'), '300');
    await userEvent.type(screen.getByLabelText('Referencia del pago'), 'TR-300');
    await userEvent.type(screen.getByLabelText('Tasa a DOP'), '60');
    await userEvent.type(screen.getByLabelText('Fuente de la tasa'), 'Tasa revisada');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar pago' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/finance/expenses/expense-paid/reimbursements');
    expect(JSON.parse(writes()[0][1].body)).toMatchObject({ expectedVersion: 'bill-v1', reference: 'TR-300', amount: 300, rateToExpense: 1, fx: { currency: 'USD', rateToDop: 60 } });
  });
  it('lets an ordinary department member start own expenses from server capability flags', async () => {
    const ownOptions = { ...options, department: 'Contracts', canCreateOwnExpense: true, canReadOwnExpenses: true,
      canReviewDepartmentExpenses: false, canReadFinanceExpenses: false, canApproveFinanceExpenses: false, canPayFinanceExpenses: false };
    commercialApi.mockImplementation(async (path, request) => request?.method ? { id: 'own' } : path.includes('/options') ? ownOptions : []);
    mount(<DepartmentExpensesPage />, [], 'contracts', 'Member');
    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo gasto' }));
    expect(screen.getByRole('heading', { name: 'Mis gastos' })).toBeInTheDocument();
    expect(commercialApi.mock.calls.some(([p]) => p.includes('/finance/expenses?') && p.includes('ownOnly=true'))).toBe(true);
    expect(screen.queryByLabelText('Empleado')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Concepto del gasto'), 'Traslado de contratos');
    await userEvent.type(screen.getByLabelText('Descripción de línea 1'), 'Transporte');
    await userEvent.type(screen.getByLabelText('Precio unitario de línea 1'), '50');
    await userEvent.type(screen.getByLabelText('Tasa a DOP'), '60');
    await userEvent.type(screen.getByLabelText('Fuente de la tasa'), 'Tasa revisada');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/finance/expenses');
    expect(JSON.parse(writes()[0][1].body)).not.toHaveProperty('employeeId');
  });
  it('lets a department administrator review its queue without Finance grants', async () => {
    const departmentOptions = { ...options, department: 'Contracts', canCreateOwnExpense: true, canReadOwnExpenses: true,
      canReviewDepartmentExpenses: true, canReadFinanceExpenses: false, canApproveFinanceExpenses: false, canPayFinanceExpenses: false };
    const claim = { ...invoice, id: 'dept-claim', employeeId: 'peer', employeeNumber: 'QA-2', requesterId: 'peer-account', description: 'Gasto por revisar', expenseDate: '2026-10-18', department: 'Contracts', status: 'Submitted', receipts: [], reimbursements: [] };
    commercialApi.mockImplementation(async (path, request) => {
      if (request?.method) return { id: 'dept-claim' };
      if (path.includes('/options')) return departmentOptions;
      if (path === '/finance/expenses/dept-claim') return claim;
      return path.includes('departmentOnly=true') ? [claim] : [];
    });
    mount(<DepartmentExpensesPage />, [], 'contracts');
    await userEvent.click(await screen.findByRole('button', { name: 'Revisión de departamento' }));
    await userEvent.click(await screen.findByRole('button', { name: /Gasto por revisar/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Aprobar departamento' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar decisión' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1].body)).toMatchObject({ decision: 'DepartmentApproved', expectedVersion: 'bill-v1' });
    expect(screen.queryByRole('button', { name: 'Aprobar Finanzas' })).not.toBeInTheDocument();
  });
  it('does not offer own creation when the server has no active employee', async () => {
    const ownOptions = { ...options, employeeId: null, canCreateOwnExpense: false, canReadOwnExpenses: false,
      canReviewDepartmentExpenses: true, canReadFinanceExpenses: false, canApproveFinanceExpenses: false, canPayFinanceExpenses: false };
    commercialApi.mockImplementation(async path => path.includes('/options') ? ownOptions : []);
    mount(<DepartmentExpensesPage />, [], 'contracts');
    await screen.findByText('Sin gastos para estos filtros.');
    expect(screen.queryByRole('button', { name: 'Nuevo gasto' })).not.toBeInTheDocument();
  });
  it('offers retry after a forbidden list without rendering private errors', async () => {
    commercialApi.mockRejectedValue(Object.assign(new Error('SQL private detail'), { status: 403 }));
    mount(<SuppliersPage />, ['finance.suppliers.read']);
    expect(await screen.findByRole('alert')).toHaveTextContent('permiso');
    expect(screen.getByRole('button', { name: 'Reintentar carga' })).toBeInTheDocument();
    expect(screen.queryByText('SQL private detail')).not.toBeInTheDocument();
  });
});
