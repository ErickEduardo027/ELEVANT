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
const invoice = { id: 'bill', supplierId: 'supplier', supplierName: 'Proveedor de rampa', scopeStationId: 'st1', documentReference: 'SUP-1', documentDate: '2026-10-18', dueDate: '2026-11-18', status: 'Approved', fx, dimensions: {}, total: 1000, totalDop: 60000, paid: 300, remaining: 700, version: 'bill-v1', lines: [{ id: 'line', number: 1, description: 'Combustible', quantity: 1, unitPrice: 1000, taxAmount: 0, total: 1000 }], attachments: [], reviews: [] };
let failure;
const writes = () => commercialApi.mock.calls.filter(([, o]) => o?.method);
function mount(ui, permissions, department = 'finance', kind = 'Administrator') {
  return render(<DepartmentAccessProvider observe={false} initialAccess={{ kind, department, permissions }}>{ui}</DepartmentAccessProvider>);
}
beforeEach(() => {
  failure = null; invoice.status = 'Approved';
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
    failure = Object.assign(new Error('Private SQL exception'), { status: 409 });
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
