import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DepartmentAccessProvider } from '../../access/DepartmentAccessContext';
import { readSession } from '../../auth/authService';
import { getApprovedServices } from '../../../services/approvedServicesService';
import { downloadInvoiceDocument, issueInvoiceFromOperations } from '../../../services/invoicingService';
import ToInvoicePage from './ToInvoicePage';
import { calendarMonth, groupOperations } from './useToInvoiceData';

const observer = vi.hoisted(() => ({ factory: vi.fn() }));
vi.mock('../../auth/authService', () => ({ readSession: vi.fn() }));
vi.mock('../../../services/approvedServicesService', () => ({ getApprovedServices: vi.fn() }));
vi.mock('../../../services/invoicingService', async importOriginal => ({
  ...(await importOriginal()), issueInvoiceFromOperations: vi.fn(), downloadInvoiceDocument: vi.fn(),
}));
vi.mock('../../../services/accountChangeObserver', () => ({ createPrivateWebAccountChangeObserver: observer.factory }));

const STATION_ID = '20000000-0000-7000-8000-000000000003';
const DEMO = '50000000-0000-7000-8000-000000000006';
const OTHER = '50000000-0000-7000-8000-000000000007';
const service = (id, operationId, operationCode, airlineId, airlineName, extra = {}) => ({
  id, operationId, operationCode, airlineId, airlineName, preinvoiceId: null, flightNumber: `${operationCode}-F`,
  operationDate: '2026-08-19', serviceName: 'Baggage', serviceCode: 'BAG', contractCode: 'DEV-CTR',
  executionStatus: 'Completed', executedQuantity: 1, billingUnit: 'operation', frozenCurrency: 'USD',
  amount: 100, ready: true, blockingReason: null, ...extra,
});
const SERVICES = [
  service('s1', 'op-1', 'DEV-TAT-0001', DEMO, 'Demo Airlines'),
  service('s2', 'op-1', 'DEV-TAT-0001', DEMO, 'Demo Airlines', { amount: 50 }),
  service('s3', 'op-2', 'DEV-TAT-0002', DEMO, 'Demo Airlines'),
  service('s4', 'op-3', 'DEV-TAT-0003', OTHER, 'Other Airline'),
  service('s5', 'op-4', 'DEV-TAT-0004', DEMO, 'Demo Airlines', { ready: false, blockingReason: 'missing_frozen_rate' }),
  service('s6', 'op-5', 'DEV-TAT-0005', DEMO, 'Demo Airlines', { preinvoiceId: 'invoiced' }),
];

function renderPage(permissions = ['finance.invoicing.read', 'finance.invoicing.issue']) {
  return render(<DepartmentAccessProvider observe={false} initialAccess={{ kind: 'Member', department: 'finance', permissions }}>
    <ToInvoicePage />
  </DepartmentAccessProvider>);
}

beforeEach(() => {
  vi.mocked(readSession).mockReturnValue({ accountId: 'finance', stationScopes: [{ stationId: STATION_ID, stationCode: 'PUJ' }] });
  observer.factory.mockReset();
  observer.factory.mockReturnValue({ start: vi.fn().mockResolvedValue(), stop: vi.fn() });
  vi.mocked(getApprovedServices).mockReset();
  vi.mocked(getApprovedServices).mockResolvedValue({ services: SERVICES, hasMore: false });
  vi.mocked(issueInvoiceFromOperations).mockReset();
  vi.mocked(downloadInvoiceDocument).mockReset();
});

describe('groupOperations', () => {
  it('groups services per operation, skips invoiced ones and blocks an operation with a service not ready', () => {
    const operations = groupOperations(SERVICES);
    expect(operations.map(item => item.operationCode)).toEqual(['DEV-TAT-0001', 'DEV-TAT-0002', 'DEV-TAT-0003', 'DEV-TAT-0004']);
    expect(operations[0]).toMatchObject({ estimate: 150, currency: 'USD', ready: true });
    expect(operations[3]).toMatchObject({ ready: false, blockingReason: 'missing_frozen_rate' });
  });

  it('a calendar month never exceeds the 31 days the API accepts', () => {
    expect(calendarMonth('2026-08-19')).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(calendarMonth('2026-03-05', -1)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(calendarMonth('2026-01-10', -1)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
});

describe('ToInvoicePage', () => {
  it('selects operations of one airline only and issues one e-CF invoice with a stable request id', async () => {
    vi.mocked(issueInvoiceFromOperations).mockRejectedValueOnce(Object.assign(new Error('network'), { status: 0 }))
      .mockResolvedValueOnce({ invoiceId: 'inv-1', number: 'NF-1', fiscalNumber: 'E310000000001', total: 295, currencyCode: 'USD', replayed: false });
    renderPage();
    fireEvent.click(await screen.findByLabelText('Seleccionar DEV-TAT-0001'));
    expect(screen.getByLabelText('Seleccionar DEV-TAT-0003')).toBeDisabled();
    expect(screen.getByLabelText('Seleccionar DEV-TAT-0004')).toBeDisabled();
    expect(screen.queryByLabelText('Seleccionar DEV-TAT-0005')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Seleccionar DEV-TAT-0002'));
    expect(screen.getByText(/2 operaciones · Demo Airlines/)).toBeInTheDocument();
    expect(screen.getByText(/ITBIS 18 %/)).toHaveTextContent('45.00');

    fireEvent.click(screen.getByRole('button', { name: 'Emitir factura' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Puede reintentar');
    fireEvent.click(screen.getByRole('button', { name: 'Emitir factura' }));
    expect(await screen.findByText('e-NCF E310000000001')).toBeInTheDocument();
    const [first, second] = vi.mocked(issueInvoiceFromOperations).mock.calls.map(([request]) => request);
    expect(first).toEqual({ stationId: STATION_ID, operationIds: ['op-1', 'op-2'], requestId: expect.any(String) });
    expect(second.requestId).toBe(first.requestId);

    fireEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
    await waitFor(() => expect(downloadInvoiceDocument).toHaveBeenCalledWith('inv-1', 'factura-E310000000001.pdf'));
  });

  it('explains a mixed-airline rejection from the server', async () => {
    vi.mocked(issueInvoiceFromOperations).mockRejectedValue(Object.assign(new Error('422'), { status: 422, reasons: ['mixed_airline'] }));
    renderPage();
    fireEvent.click(await screen.findByLabelText('Seleccionar DEV-TAT-0001'));
    fireEvent.click(screen.getByRole('button', { name: 'Emitir factura' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('misma aerolínea');
  });

  it('hides issuing without the issue permission and shows the empty state', async () => {
    vi.mocked(getApprovedServices).mockResolvedValue({ services: [], hasMore: false });
    renderPage(['finance.invoicing.read']);
    expect(await screen.findByText(/No hay operaciones aprobadas pendientes/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Emitir factura' })).not.toBeInTheDocument();
  });

  it('shows a recoverable error', async () => {
    vi.mocked(getApprovedServices).mockRejectedValueOnce(Object.assign(new Error('x'), { status: 500 }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByLabelText('Seleccionar DEV-TAT-0001')).toBeInTheDocument();
  });
});
