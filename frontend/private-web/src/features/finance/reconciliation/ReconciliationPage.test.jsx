import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ReconciliationPage from './ReconciliationPage';
import { getFinanceReconciliation } from '../../../services/reconciliationService';
import { readSession } from '../../auth/authService';

const observerFactory = vi.hoisted(() => vi.fn());
vi.mock('../../../services/reconciliationService', () => ({ getFinanceReconciliation: vi.fn() }));
vi.mock('../../auth/authService', () => ({ readSession: vi.fn() }));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: observerFactory,
}));

const stationId = '20000000-0000-7000-8000-000000000003';
const base = { airlineId: 'airline-one', airlineName: 'Synthetic Air',
  from: '2026-08-18', to: '2026-08-18', currencyCode: 'USD',
  preinvoiceTotal: 125.50 };
const accepted = { ...base, preinvoiceId: 'preinvoice-accepted',
  preinvoiceStatus: 'Accepted', invoiceId: null, invoiceNumber: null,
  invoiceTotal: null, issuedAt: null, paymentId: null, paymentReference: null,
  paymentAmount: null, paymentRecordedAt: null };
const invoiced = { ...base, preinvoiceId: 'preinvoice-invoiced',
  preinvoiceStatus: 'Invoiced', invoiceId: 'invoice-one', invoiceNumber: 'NF-ONE',
  invoiceTotal: 125.50, issuedAt: '2026-08-19T12:00:00Z',
  paymentId: null, paymentReference: null, paymentAmount: null,
  paymentRecordedAt: null };
const paid = { ...invoiced, preinvoiceId: 'preinvoice-paid',
  invoiceId: 'invoice-two', invoiceNumber: 'NF-TWO', paymentId: 'payment-one',
  paymentReference: 'DEV-PAY-ONE', paymentAmount: 125.50,
  paymentRecordedAt: '2026-08-19T13:00:00Z' };

beforeEach(() => {
  vi.mocked(readSession).mockReturnValue({ accountId: 'finance-account',
    stationScopes: [{ stationId, stationCode: 'PUJ' }] });
  vi.mocked(getFinanceReconciliation).mockReset();
  vi.mocked(getFinanceReconciliation).mockResolvedValue({ stationId,
    page: 1, limit: 20, hasMore: false, rows: [accepted, invoiced, paid] });
  observerFactory.mockReset();
  observerFactory.mockReturnValue({ start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined) });
});

it('does not read financial rows without a station grant', () => {
  vi.mocked(readSession).mockReturnValue({ accountId: 'finance-account', stationScopes: [] });
  render(<ReconciliationPage />);
  expect(screen.getByRole('alert')).toHaveTextContent('No hay una estación financiera autorizada');
  expect(getFinanceReconciliation).not.toHaveBeenCalled();
});

it('displays accepted, invoiced and manually paid facts without phantom reconciliation', async () => {
  render(<ReconciliationPage initialStationId={stationId} />);
  expect(await screen.findByText('NF-ONE')).toBeInTheDocument();
  expect(getFinanceReconciliation).toHaveBeenCalledWith({ stationId,
    page: 1, limit: 20 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(screen.getByText('DEV-PAY-ONE')).toBeInTheDocument();
  expect(screen.getByText(/no confirma un movimiento bancario/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Conciliar' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Filtrar seguimiento financiero'),
    { target: { value: 'awaiting-invoice' } });
  expect(screen.queryByText('NF-ONE')).not.toBeInTheDocument();
  expect(screen.getByText('preinvoice-accepted')).toBeInTheDocument();
});

it('revalidates on durable finance changes and recovers from read errors', async () => {
  render(<ReconciliationPage />);
  await screen.findByText('NF-ONE');
  await act(async () => observerFactory.mock.calls[0][0](['finance_preinvoices']));
  await waitFor(() => expect(getFinanceReconciliation).toHaveBeenCalledTimes(2));
});

it('drops stale rows on error and retries', async () => {
  vi.mocked(getFinanceReconciliation).mockRejectedValueOnce(new Error('offline'));
  render(<ReconciliationPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar el seguimiento');
  expect(screen.queryByText('NF-ONE')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('NF-ONE')).toBeInTheDocument();
});