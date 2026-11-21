import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DepartmentAccessProvider } from '../../access/DepartmentAccessContext';
import { AUTH_STORAGE_KEY, clearSession } from '../../auth/authService';
import { commercialApi } from '../../../services/commercialGovernanceApi';
import PayablesPage from './PayablesPage';
import SuppliersPage from './SuppliersPage';

vi.mock('../../../services/commercialGovernanceApi', () => ({ commercialApi: vi.fn() }));

const stations = [{ stationId: 'st1', stationCode: 'PUJ' }, { stationId: 'st2', stationCode: 'SDQ' }];
const fx = { currency: 'USD', rateToDop: 60, source: 'Tasa revisada', rateDate: '2026-10-18' };
const dopFx = { currency: 'DOP', rateToDop: 1, source: 'Tasa revisada', rateDate: '2026-10-18' };
const options = { stations: [{ id: 'st1', code: 'PUJ', name: 'Punta Cana' }], suppliers: [{ id: 'supplier', code: 'SP', name: 'Proveedor de rampa' }],
  airlines: [], services: [], turnarounds: [], currencies: ['USD', 'DOP'], employeeId: 'emp-me', department: 'Finance',
  canCreateOwnExpense: true, canReadOwnExpenses: true, canReviewDepartmentExpenses: true, canReadFinanceExpenses: true,
  canApproveFinanceExpenses: true, canPayFinanceExpenses: true };
const invoice = { id: 'bill', supplierId: 'supplier', supplierName: 'Proveedor de rampa', scopeStationId: 'st1', documentReference: 'SUP-1',
  documentDate: '2026-10-18', dueDate: '2026-11-18', status: 'Approved', fx, dimensions: { stationId: null, airlineId: null, turnaroundId: null, serviceId: null },
  total: 10, totalDop: 600, paid: 0, remaining: 10, version: 'bill-v1',
  lines: [{ id: 'line', number: 1, description: 'Transporte', quantity: 1, unitPrice: 10, taxAmount: 0, total: 10 }], attachments: [], reviews: [] };
const payment = { id: 'payment', supplierId: 'supplier', scopeStationId: 'st1', reference: 'DOP-600', paidOn: '2026-10-18',
  fx: dopFx, amount: 600, amountDop: 600, applied: 0, remaining: 600, version: 'payment-v1', applications: [] };
const writes = () => commercialApi.mock.calls.filter(([, request]) => request?.method);
function mount(ui, permissions, department = 'finance') {
  return render(<DepartmentAccessProvider observe={false} initialAccess={{ kind: 'Administrator', department, permissions }}>{ui}</DepartmentAccessProvider>);
}
function payablesHttp(invoices = [invoice], available = payment) {
  commercialApi.mockImplementation(async (path, request) => {
    if (request?.method) return { id: available.id, replayed: false };
    if (path.includes('/options')) return options;
    if (path.startsWith('/finance/payable-payments?')) return [available];
    if (path.startsWith('/finance/payables?')) return invoices;
    if (path.startsWith('/finance/payables/')) return invoices.find(row => path.endsWith('/' + row.id));
    throw new Error('Unexpected HTTP path: ' + path);
  });
}
async function openApplications() {
  mount(<PayablesPage />, ['finance.payables.read', 'finance.payables.pay']);
  await userEvent.click(await screen.findByRole('button', { name: /SUP-1/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Aplicar pago existente' }));
  await userEvent.selectOptions(screen.getByLabelText('Pago registrado'), 'payment');
}

beforeEach(() => {
  window.sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accountId: 'me', token: 'test-session', name: 'QA', email: 'qa@elevant.test',
    role: 'CUSTOM_QA', expiresAt: new Date(Date.now() + 3_600_000).toISOString(), stationScopes: stations }));
});
afterEach(() => { cleanup(); clearSession(); vi.clearAllMocks(); });

describe('AP source-review regressions', () => {

  it('removes an attachment of a draft supplier invoice with the edit code (4-N13)', async () => {
    const draft = { ...invoice, status: 'Draft', paid: 0, attachments: [{ id: 'file-1', contentType: 'application/pdf', length: 4096, sha256: 'AB', uploadedAt: '2026-10-18T12:00:00Z' }] };
    payablesHttp([draft]);
    mount(<PayablesPage />, ['finance.payables.read', 'finance.payables.update']);
    await userEvent.click(await screen.findByRole('button', { name: /SUP-1/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Quitar comprobante 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sí, quitar el comprobante' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/finance/payables/bill/attachments/file-1/removals');
    expect(JSON.parse(writes()[0][1].body)).toEqual({ expectedVersion: 'bill-v1', requestId: expect.any(String) });
  });

  it('applies all DOP 600 to a USD 10 supplier invoice without flooring the payment limit', async () => {
    payablesHttp(); await openApplications();
    const amount = screen.getByLabelText('Importe a aplicar de SUP-1');
    await userEvent.type(amount, '600'); expect(amount).toBeValid();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar aplicaciones' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1].body)).toMatchObject({ expectedVersion: 'payment-v1',
      applications: [{ invoiceId: 'bill', expectedVersion: 'bill-v1', paymentAmount: 600, rateToInvoice: 0.01666667 }] });
  });

  it('blocks an application whose rounded invoice amount exceeds its balance', async () => {
    payablesHttp([invoice], { ...payment, amount: 1000, remaining: 1000 }); await openApplications();
    await userEvent.type(screen.getByLabelText('Importe a aplicar de SUP-1'), '600.0029');
    expect(screen.getByRole('button', { name: 'Confirmar aplicaciones' })).toBeDisabled();
    expect(writes()).toHaveLength(0);
  });

  it('sums four-decimal application amounts without falsely exceeding the payment remainder', async () => {
    payablesHttp([{ ...invoice, total: 0.1, remaining: 0.1 }, { ...invoice, id: 'bill-two', documentReference: 'SUP-2', total: 0.2, remaining: 0.2 }],
      { ...payment, fx, amount: 0.3, remaining: 0.3 }); await openApplications();
    await userEvent.type(screen.getByLabelText('Importe a aplicar de SUP-1'), '0.1');
    await userEvent.type(screen.getByLabelText('Importe a aplicar de SUP-2'), '0.2');
    expect(screen.getByRole('button', { name: 'Confirmar aplicaciones' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar aplicaciones' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1].body).applications).toEqual([
      { invoiceId: 'bill', expectedVersion: 'bill-v1', paymentAmount: 0.1, rateToInvoice: 1 },
      { invoiceId: 'bill-two', expectedVersion: 'bill-v1', paymentAmount: 0.2, rateToInvoice: 1 },
    ]);
  });

  it('reverses an application of the supplier payment with its reason and reloads the payments (4-N04)', async () => {
    const applied = { ...payment, applied: 300, remaining: 300, applications: [
      { id: 'app-this', invoiceId: 'bill', paymentAmount: 300, invoiceAmount: 5, rateToInvoice: 0.01666667, appliedAt: '2026-10-18T12:00:00Z', reversedAt: null, reversalReason: null },
      { id: 'app-old', invoiceId: 'bill-other', paymentAmount: 10, invoiceAmount: 1, rateToInvoice: 0.1, appliedAt: '2026-10-17T12:00:00Z', reversedAt: '2026-10-18T13:00:00Z', reversalReason: 'Factura equivocada' }] };
    payablesHttp([invoice], applied);
    mount(<PayablesPage />, ['finance.payables.read', 'finance.payables.reverse']);
    await userEvent.click(await screen.findByRole('button', { name: /SUP-1/ }));
    const panel = await screen.findByRole('region', { name: 'Pagos del proveedor' });
    const item = await within(panel).findByRole('listitem', { name: 'Pago DOP-600' });
    expect(within(item).getByText('Esta factura')).toBeInTheDocument();
    expect(within(item).getByText(/Revertida: Factura equivocada/)).toBeInTheDocument();
    expect(within(item).getByRole('button', { name: 'Anular pago' })).toBeDisabled();
    expect(within(item).getByText('Revierta sus aplicaciones activas antes de anular el pago.')).toBeInTheDocument();
    expect(within(item).getAllByRole('button', { name: 'Revertir aplicación' })).toHaveLength(1);
    await userEvent.click(within(item).getByRole('button', { name: 'Revertir aplicación' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar reverso' }));
    expect(writes()).toHaveLength(0);
    const reads = commercialApi.mock.calls.filter(([path]) => path.startsWith('/finance/payable-payments?')).length;
    await userEvent.type(screen.getByLabelText('Motivo de la decisión'), 'Aplicado a la factura equivocada');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar reverso' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/finance/payable-payments/payment/reversals');
    expect(JSON.parse(writes()[0][1].body)).toEqual({ expectedVersion: 'payment-v1', reason: 'Aplicado a la factura equivocada',
      applicationId: 'app-this', requestId: expect.any(String) });
    await waitFor(() => expect(commercialApi.mock.calls.filter(([path]) => path.startsWith('/finance/payable-payments?')).length).toBeGreaterThan(reads));
  });

  it('voids a payment without active applications and shows a voided one with its reason (4-N04)', async () => {
    const voided = { ...payment, id: 'voided', reference: 'ANULADO-1', applied: 0, remaining: 0, applications: [],
      voidedAt: '2026-10-18T14:00:00Z', voidReason: 'Pago registrado por error' };
    commercialApi.mockImplementation(async (path, request) => {
      if (request?.method) return { id: 'payment', replayed: false };
      if (path.includes('/options')) return options;
      if (path.startsWith('/finance/payable-payments?')) return [payment, voided];
      if (path.startsWith('/finance/payables?')) return [invoice];
      if (path.startsWith('/finance/payables/')) return invoice;
      throw new Error('Unexpected HTTP path: ' + path);
    });
    mount(<PayablesPage />, ['finance.payables.read', 'finance.payables.reverse', 'finance.payables.pay']);
    await userEvent.click(await screen.findByRole('button', { name: /SUP-1/ }));
    const panel = await screen.findByRole('region', { name: 'Pagos del proveedor' });
    const gone = await within(panel).findByRole('listitem', { name: 'Pago ANULADO-1' });
    expect(gone).toHaveTextContent('Anulado'); expect(gone).toHaveTextContent('Pago registrado por error');
    expect(within(gone).queryByRole('button')).not.toBeInTheDocument();
    const open = within(panel).getByRole('listitem', { name: 'Pago DOP-600' });
    expect(open).toHaveTextContent('Disponible');
    await userEvent.click(within(open).getByRole('button', { name: 'Anular pago' }));
    await userEvent.type(screen.getByLabelText('Motivo de la decisión'), 'Pago registrado por error');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar anulación' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1].body)).toEqual({ expectedVersion: 'payment-v1', reason: 'Pago registrado por error', requestId: expect.any(String) });
    // The apply form never offers a voided payment.
    await userEvent.click(await screen.findByRole('button', { name: 'Aplicar pago existente' }));
    const choices = await screen.findByLabelText('Pago registrado');
    await waitFor(() => expect(within(choices).getAllByRole('option')).toHaveLength(2));
    expect(within(choices).getAllByRole('option').map(option => option.textContent).join(' ')).toMatch(/DOP-600/);
    expect(within(choices).queryByRole('option', { name: /ANULADO-1/ })).not.toBeInTheDocument();
  });

  it('pages the supplier payments by 25 and hides the reversal actions without the reversal code (4-N04)', async () => {
    const page = Array.from({ length: 25 }, (_, index) => ({ ...payment, id: 'p' + index, reference: 'PAGO-' + index }));
    commercialApi.mockImplementation(async (path, request) => {
      if (request?.method) return { id: 'payment', replayed: false };
      if (path.includes('/options')) return options;
      if (path.startsWith('/finance/payable-payments?')) return new URL(path, 'https://elevant.test').searchParams.get('skip') === '25'
        ? [{ ...payment, id: 'p25', reference: 'PAGO-25' }] : page;
      if (path.startsWith('/finance/payables?')) return [invoice];
      if (path.startsWith('/finance/payables/')) return invoice;
      throw new Error('Unexpected HTTP path: ' + path);
    });
    mount(<PayablesPage />, ['finance.payables.read']);
    await userEvent.click(await screen.findByRole('button', { name: /SUP-1/ }));
    const panel = await screen.findByRole('region', { name: 'Pagos del proveedor' });
    await within(panel).findByRole('listitem', { name: 'Pago PAGO-24' });
    expect(within(panel).queryByRole('button', { name: /Anular pago|Revertir/ })).not.toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Ver más' }));
    await within(panel).findByRole('listitem', { name: 'Pago PAGO-25' });
    expect(within(panel).getAllByRole('listitem', { name: /^Pago PAGO-/ })).toHaveLength(26);
    expect(within(panel).queryByRole('button', { name: 'Ver más' })).not.toBeInTheDocument();
    expect(commercialApi.mock.calls.some(([path]) => path.startsWith('/finance/payable-payments?') && path.includes('skip=25') && path.includes('take=25'))).toBe(true);
  });

  it.each(['success', 'conflict'])('refreshes the current station and search after an old command retry returns %s', async outcome => {
    let attempts = 0;
    commercialApi.mockImplementation(async (path, request) => {
      if (request?.method) {
        attempts += 1;
        if (attempts === 1) throw new Error('Lost response');
        if (outcome === 'conflict') throw Object.assign(new Error('Stale version'), { status: 409 });
        return { id: 'created', replayed: true };
      }
      if (path.includes('/options')) return options;
      if (path.startsWith('/finance/suppliers?')) {
        const scope = new URL(path, 'https://elevant.test').searchParams.get('scopeStationId');
        return [{ id: 'supplier-' + scope, scopeStationId: scope, code: scope, name: scope === 'st1' ? 'Proveedor A' : 'Proveedor B',
          taxReference: null, contactEmail: null, isActive: true, version: 'supplier-v1' }];
      }
      throw new Error('Unexpected HTTP path: ' + path);
    });
    mount(<SuppliersPage />, ['finance.suppliers.read', 'finance.suppliers.create', 'finance.suppliers.update', 'finance.suppliers.delete']);
    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo proveedor' }));
    await userEvent.type(screen.getByLabelText('Código'), 'RETRY-A');
    await userEvent.type(screen.getByLabelText('Nombre del proveedor'), 'Original station A command');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar proveedor' }));
    await screen.findByRole('button', { name: 'Reintentar acción' });
    await userEvent.selectOptions(screen.getByLabelText('Estación'), 'st2');
    await screen.findByRole('button', { name: 'Proveedor B' });
    await userEvent.type(screen.getByLabelText('Buscar'), 'B');
    await screen.findByRole('button', { name: 'Proveedor B' });
    const readsBeforeRetry = commercialApi.mock.calls.filter(([path]) => path.startsWith('/finance/suppliers?')).length;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar acción' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    await waitFor(() => expect(screen.getByLabelText('Estación')).toBeEnabled());
    expect(screen.getByLabelText('Estación')).toHaveValue('st2');
    expect(screen.getByRole('button', { name: 'Proveedor B' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Proveedor A' })).not.toBeInTheDocument();
    expect(writes()[1][1].body).toBe(writes()[0][1].body);
    expect(JSON.parse(writes()[1][1].body)).toMatchObject({ scopeStationId: 'st1', code: 'RETRY-A', requestId: expect.any(String) });
    const refreshed = commercialApi.mock.calls.filter(([path]) => path.startsWith('/finance/suppliers?')).slice(readsBeforeRetry);
    expect(refreshed.length).toBeGreaterThan(0);
    expect(refreshed.every(([path]) => path.includes('scopeStationId=st2') && path.includes('search=B'))).toBe(true);
  });
});
