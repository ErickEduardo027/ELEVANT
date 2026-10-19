import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DepartmentAccessProvider } from '../../access/DepartmentAccessContext';
import { AUTH_STORAGE_KEY, clearSession } from '../../auth/authService';
import { commercialApi } from '../../../services/commercialGovernanceApi';
import ExpensesPage from './ExpensesPage';
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
const claim = { ...invoice, id: 'expense', employeeId: 'emp-other', employeeNumber: 'QA-2', requesterId: 'other', description: 'Traslado aprobado',
  expenseDate: '2026-10-18', department: 'HumanResources', receipts: [], reimbursements: [] };
const payment = { id: 'payment', supplierId: 'supplier', scopeStationId: 'st1', reference: 'DOP-600', paidOn: '2026-10-18',
  fx: dopFx, amount: 600, amountDop: 600, applied: 0, remaining: 600, version: 'payment-v1', applications: [] };
const writes = () => commercialApi.mock.calls.filter(([, request]) => request?.method);
function mount(ui, permissions, department = 'finance') {
  return render(<DepartmentAccessProvider observe={false} initialAccess={{ kind: 'Administrator', department, permissions }}>{ui}</DepartmentAccessProvider>);
}
function expenseHttp(expense, capabilities = options) {
  commercialApi.mockImplementation(async (path, request) => {
    if (request?.method) return { id: expense.id, replayed: false };
    if (path.includes('/options')) return capabilities;
    if (path === '/finance/expenses/expense') return expense;
    if (path.startsWith('/finance/expenses?')) return [expense];
    throw new Error('Unexpected HTTP path: ' + path);
  });
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
async function fillReimbursement(amount) {
  await userEvent.click(await screen.findByRole('button', { name: /Traslado aprobado/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Registrar reembolso' }));
  await userEvent.selectOptions(screen.getByLabelText('Moneda'), 'DOP');
  await userEvent.type(screen.getByLabelText('Tasa a DOP'), '1');
  await userEvent.type(screen.getByLabelText('Fuente de la tasa'), 'Tasa revisada');
  await userEvent.type(screen.getByLabelText('Referencia del pago'), 'DOP-SETTLEMENT');
  await userEvent.type(screen.getByLabelText('Importe del pago'), amount);
}

beforeEach(() => {
  window.sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accountId: 'me', token: 'test-session', name: 'QA', email: 'qa@elevant.test',
    role: 'CUSTOM_QA', expiresAt: new Date(Date.now() + 3_600_000).toISOString(), stationScopes: stations }));
});
afterEach(() => { cleanup(); clearSession(); vi.clearAllMocks(); });

describe('AP source-review regressions', () => {
  it('lets an HR administrator approve a peer claim using the hyphenated session department without Finance grants', async () => {
    expenseHttp({ ...claim, status: 'Submitted' }, { ...options, department: 'HumanResources', canReadFinanceExpenses: false,
      canApproveFinanceExpenses: false, canPayFinanceExpenses: false });
    mount(<ExpensesPage />, [], 'human-resources');
    await userEvent.click(await screen.findByRole('button', { name: /Traslado aprobado/ }));
    expect(screen.getByRole('button', { name: 'Rechazar gasto' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Aprobar departamento' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar decisión' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1].body)).toMatchObject({ decision: 'DepartmentApproved', expectedVersion: 'bill-v1', requestId: expect.any(String) });
  });

  it.each([
    ['another department', { department: 'Operations' }, true],
    ['the requester', { requesterId: 'me', employeeId: 'emp-me' }, true],
    ['missing server capability', {}, false],
  ])('still hides HR review actions for %s', async (_name, changes, canReviewDepartmentExpenses) => {
    expenseHttp({ ...claim, status: 'Submitted', ...changes }, { ...options, canReviewDepartmentExpenses });
    mount(<ExpensesPage />, [], 'human-resources');
    await userEvent.click(await screen.findByRole('button', { name: /Traslado aprobado/ }));
    await screen.findByRole('region', { name: 'Detalle de gasto' });
    expect(screen.queryByRole('button', { name: 'Aprobar departamento' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rechazar gasto' })).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('settles a USD 10 expense with DOP 600 using the eight-decimal rate and four-decimal applied amount', async () => {
    expenseHttp(claim); mount(<ExpensesPage />, ['finance.expenses.read', 'finance.expenses.pay']);
    await fillReimbursement('600');
    expect(screen.getByRole('button', { name: 'Confirmar pago' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar pago' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1].body)).toMatchObject({ amount: 600, rateToExpense: 0.01666667, expectedVersion: 'bill-v1', fx: { currency: 'DOP', rateToDop: 1 } });
  });

  it.each([
    ['a rounded excess', '600.0029', 60, 10],
    ['a midpoint rounded away from zero', '2.4689', 2, 1.2344],
    ['a conversion that rounds to zero', '0.0001', 1000000, 1],
  ])('blocks reimbursement for %s', async (_name, amount, rateToDop, remaining) => {
    expenseHttp({ ...claim, fx: { ...fx, rateToDop }, remaining });
    mount(<ExpensesPage />, ['finance.expenses.read', 'finance.expenses.pay']); await fillReimbursement(amount);
    expect(screen.getByRole('button', { name: 'Confirmar pago' })).toBeDisabled();
    expect(writes()).toHaveLength(0);
  });

  it('allows a rounded midpoint that exactly settles the four-decimal balance', async () => {
    expenseHttp({ ...claim, fx: { ...fx, rateToDop: 2 }, remaining: 1.2345 });
    mount(<ExpensesPage />, ['finance.expenses.read', 'finance.expenses.pay']); await fillReimbursement('2.4689');
    expect(screen.getByRole('button', { name: 'Confirmar pago' })).toBeEnabled();
    expect(screen.getByText(/A reembolsar:/)).toHaveTextContent('1.2345');
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
    mount(<SuppliersPage />, ['finance.suppliers.read', 'finance.suppliers.manage']);
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
