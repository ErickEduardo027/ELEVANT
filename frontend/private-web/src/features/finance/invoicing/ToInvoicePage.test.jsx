import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DepartmentAccessProvider } from '../../access/DepartmentAccessContext';
import { readSession } from '../../auth/authService';
import {
  closeOperationsWithoutCharge, downloadInvoiceDocument, getFinancePendingOperations, getInvoiceEmailDeliveries,
  issueInvoiceFromOperations,
} from '../../../services/invoicingService';
import ToInvoicePage from './ToInvoicePage';
import { calendarMonth, selectionProblem, toRow } from './useToInvoiceData';

const observer = vi.hoisted(() => ({ factory: vi.fn() }));
vi.mock('../../auth/authService', () => ({ readSession: vi.fn() }));
vi.mock('../../../services/invoicingService', async importOriginal => ({
  ...(await importOriginal()), issueInvoiceFromOperations: vi.fn(), downloadInvoiceDocument: vi.fn(),
  getInvoiceEmailDeliveries: vi.fn(), getFinancePendingOperations: vi.fn(), closeOperationsWithoutCharge: vi.fn(),
}));
vi.mock('../../../services/accountChangeObserver', () => ({ createPrivateWebAccountChangeObserver: observer.factory }));

const STATION_ID = '20000000-0000-7000-8000-000000000003';
const DEMO = '50000000-0000-7000-8000-000000000006';
const OTHER = '50000000-0000-7000-8000-000000000007';
const LIMITS = { maxOperations: 100, maxLines: 500, maxDays: 31 };
const operation = (id, operationCode, airlineId, airlineName, extra = {}) => ({
  operationId: id, version: `v-${id}`, operationCode, operationDate: '2026-08-19', airlineId, airlineName,
  flightNumber: `${operationCode}-F`, contractCode: 'DEV-CTR', currencyCode: 'USD', serviceCount: 1, lineEstimate: 2,
  estimatedNet: 150, ready: true, blockingReasons: [],
  services: [{ serviceId: `s-${id}`, serviceCode: 'BAG', serviceName: 'Baggage', ready: true, blockingReason: null,
    amount: 150, chargeCount: 1 }],
  ...extra,
});
const OPERATIONS = [
  operation('op-1', 'DEV-TAT-0001', DEMO, 'Demo Airlines', { operationDate: '2026-08-18' }),
  operation('op-2', 'DEV-TAT-0002', DEMO, 'Demo Airlines', { estimatedNet: 100 }),
  operation('op-3', 'DEV-TAT-0003', OTHER, 'Other Airline'),
  operation('op-4', 'DEV-TAT-0004', DEMO, 'Demo Airlines', { ready: false, blockingReasons: ['exchange_rate_missing'] }),
];
const page = (operations = OPERATIONS, extra = {}) => ({
  stationId: STATION_ID, limits: LIMITS, airlines: [{ airlineId: DEMO, airlineName: 'Demo Airlines', pendingCount: 3 },
    { airlineId: OTHER, airlineName: 'Other Airline', pendingCount: 1 }], operations, nextCursor: null,
  totalPending: operations.length, ...extra,
});

function renderPage(permissions = ['finance.invoicing.read', 'finance.invoicing.issue'], props = {}) {
  return render(<DepartmentAccessProvider observe={false} initialAccess={{ kind: 'Member', department: 'finance', permissions }}>
    <ToInvoicePage {...props} />
  </DepartmentAccessProvider>);
}

beforeEach(() => {
  vi.mocked(readSession).mockReturnValue({ accountId: 'finance', stationScopes: [{ stationId: STATION_ID, stationCode: 'PUJ' }] });
  observer.factory.mockReset();
  observer.factory.mockReturnValue({ start: vi.fn().mockResolvedValue(), stop: vi.fn() });
  vi.mocked(getFinancePendingOperations).mockReset();
  vi.mocked(getFinancePendingOperations).mockResolvedValue(page());
  vi.mocked(issueInvoiceFromOperations).mockReset();
  vi.mocked(closeOperationsWithoutCharge).mockReset();
  vi.mocked(downloadInvoiceDocument).mockReset();
  vi.mocked(getInvoiceEmailDeliveries).mockReset();
  vi.mocked(getInvoiceEmailDeliveries).mockResolvedValue({ invoiceId: 'inv-1', smtpConfigured: true, deliveries: [] });
});

describe('selection limits (4-N06)', () => {
  it('a calendar month stays a calendar month', () => {
    expect(calendarMonth('2026-08-19')).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(calendarMonth('2026-03-05', -1)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(calendarMonth('2026-01-10', -1)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('names the limit an operation would break, never cutting silently', () => {
    const rows = OPERATIONS.map(toRow);
    expect(selectionProblem([], rows[0], LIMITS)).toBeNull();
    expect(selectionProblem([rows[0]], rows[2], LIMITS)).toMatch(/misma aerolínea/);
    expect(selectionProblem([rows[0]], { ...rows[1], currency: 'DOP' }, LIMITS)).toMatch(/misma moneda/);
    expect(selectionProblem([rows[0]], { ...rows[1], lineEstimate: 499 }, LIMITS)).toMatch(/500 líneas/);
    expect(selectionProblem([rows[0]], { ...rows[1], operationDate: '2026-09-18' }, LIMITS)).toMatch(/31 días/);
    expect(selectionProblem([rows[0]], { ...rows[1], operationDate: '2026-09-17' }, LIMITS)).toBeNull();
    expect(selectionProblem([rows[0]], rows[1], { ...LIMITS, maxOperations: 1 })).toMatch(/hasta 1 operaciones/);
    expect(selectionProblem([], rows[3], LIMITS)).toMatch(/no está lista/);
  });
});

describe('ToInvoicePage', () => {
  it('lists the oldest first, publishes the limits and names every block in Spanish', async () => {
    renderPage();
    const rows = await screen.findAllByRole('checkbox');
    expect(rows.map(row => row.getAttribute('aria-label'))).toEqual(['Seleccionar DEV-TAT-0001', 'Seleccionar DEV-TAT-0002',
      'Seleccionar DEV-TAT-0003', 'Seleccionar DEV-TAT-0004']);
    expect(screen.getByRole('region', { name: 'Límites de una factura' })).toHaveTextContent('100 operaciones, 500 líneas');
    expect(screen.getByLabelText('Motivos de DEV-TAT-0004')).toHaveTextContent('Falta la tasa de cambio del día de la operación');
    expect(screen.getByLabelText('Seleccionar DEV-TAT-0004')).toBeDisabled();
    expect(screen.getByText('Mostrando 4 de 4 pendientes.')).toBeInTheDocument();
    // Dates are optional filters: everything pending is read without them.
    expect(getFinancePendingOperations).toHaveBeenCalledWith({ stationId: STATION_ID, from: null, to: null, airlineId: null,
      limit: 50 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('issues one airline with the versions on screen and keeps the key after an uncertain result', async () => {
    vi.mocked(issueInvoiceFromOperations).mockRejectedValueOnce(Object.assign(new Error('network'), { status: 0 }))
      .mockResolvedValueOnce({ invoiceId: 'inv-1', number: 'NF-1', fiscalNumber: 'E310000000001', total: 295, currencyCode: 'USD', replayed: false });
    renderPage();
    fireEvent.click(await screen.findByLabelText('Seleccionar DEV-TAT-0001'));
    expect(screen.getByLabelText('Seleccionar DEV-TAT-0003')).toBeDisabled();
    expect(screen.getByLabelText('Seleccionar DEV-TAT-0003')).toHaveAccessibleDescription(/misma aerolínea/);
    fireEvent.click(screen.getByLabelText('Seleccionar DEV-TAT-0002'));
    const summary = screen.getByRole('region', { name: 'Resumen de la factura' });
    expect(summary).toHaveTextContent('2 operaciones · Demo Airlines');
    expect(summary).toHaveTextContent('4 de 500 líneas');
    expect(screen.getByText(/ITBIS 18 %/)).toHaveTextContent('45.00');

    fireEvent.click(screen.getByRole('button', { name: 'Emitir factura' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Puede reintentar');
    fireEvent.click(screen.getByRole('button', { name: 'Emitir factura' }));
    expect(await screen.findByText('e-NCF E310000000001')).toBeInTheDocument();
    const [first, second] = vi.mocked(issueInvoiceFromOperations).mock.calls.map(([request]) => request);
    expect(first).toEqual({ stationId: STATION_ID, operationIds: ['op-1', 'op-2'], requestId: expect.any(String),
      operationVersions: [{ operationId: 'op-1', version: 'v-op-1' }, { operationId: 'op-2', version: 'v-op-2' }] });
    expect(second).toEqual(first);

    fireEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
    await waitFor(() => expect(downloadInvoiceDocument).toHaveBeenCalledWith('inv-1', 'factura-E310000000001.pdf'));
    expect(await screen.findByText(/No quedó ningún correo en cola/)).toBeInTheDocument();
  });

  it('reads what the invoice queued and follows the queue until the server reports it (1-N08)', async () => {
    vi.mocked(issueInvoiceFromOperations).mockResolvedValue({ invoiceId: 'inv-1', number: 'NF-1',
      fiscalNumber: 'E310000000001', total: 295, currencyCode: 'USD', replayed: false });
    const queued = { recipient: 'billing@demo.example.com', status: 'Pending', reason: null,
      createdAt: '2026-11-06T10:00:00Z', sentAt: null };
    vi.mocked(getInvoiceEmailDeliveries)
      .mockResolvedValueOnce({ invoiceId: 'inv-1', smtpConfigured: true, deliveries: [queued] })
      .mockResolvedValue({ invoiceId: 'inv-1', smtpConfigured: true,
        deliveries: [{ ...queued, status: 'Failed', reason: 'smtp_rejected' }] });
    renderPage(undefined, { emailPollMs: 10 });
    fireEvent.click(await screen.findByLabelText('Seleccionar DEV-TAT-0001'));
    fireEvent.click(screen.getByRole('button', { name: 'Emitir factura' }));
    const status = await screen.findByLabelText('Correo de la factura');
    expect(status).toHaveTextContent('Correo en cola para 1 destinatario(s)');
    await waitFor(() => expect(screen.getByLabelText('Correo de la factura'))
      .toHaveTextContent('Falló · El servidor de correo rechazó el mensaje o el destinatario.'));
  });

  it('explains a refusal by its code, never by the server title, and re-reads the list', async () => {
    vi.mocked(issueInvoiceFromOperations).mockRejectedValue(Object.assign(new Error('The operations changed.'),
      { status: 409, code: 'version_conflict', title: 'The operations changed.' }));
    renderPage();
    fireEvent.click(await screen.findByLabelText('Seleccionar DEV-TAT-0001'));
    fireEvent.click(screen.getByRole('button', { name: 'Emitir factura' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Alguna operación cambió desde que cargó la lista');
    expect(alert).not.toHaveTextContent('The operations changed');
    await waitFor(() => expect(getFinancePendingOperations).toHaveBeenCalledTimes(2));
  });

  it('selects a whole airline from the oldest until the limit and says where it stopped', async () => {
    vi.mocked(getFinancePendingOperations).mockResolvedValue(page([
      operation('op-1', 'DEV-TAT-0001', DEMO, 'Demo Airlines', { lineEstimate: 300, operationDate: '2026-08-01' }),
      operation('op-2', 'DEV-TAT-0002', DEMO, 'Demo Airlines', { lineEstimate: 150, operationDate: '2026-08-02' }),
      operation('op-3', 'DEV-TAT-0003', DEMO, 'Demo Airlines', { lineEstimate: 100, operationDate: '2026-08-03' }),
    ]));
    renderPage();
    fireEvent.click(await screen.findByLabelText('Seleccionar DEV-TAT-0001'));
    expect(screen.getByLabelText('Seleccionar DEV-TAT-0003')).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Toda la aerolínea del período' }));
    expect(screen.getByLabelText('Seleccionar DEV-TAT-0001')).toBeChecked();
    expect(screen.getByLabelText('Seleccionar DEV-TAT-0002')).toBeChecked();
    expect(screen.getByLabelText('Seleccionar DEV-TAT-0003')).not.toBeChecked();
    expect(screen.getByLabelText('Seleccionar DEV-TAT-0003')).toBeDisabled();
    expect(screen.getByLabelText('Seleccionar DEV-TAT-0003')).toHaveAccessibleDescription(/500 líneas/);
    expect(screen.getByText(/Se eligieron 2 de 3 operaciones de Demo Airlines/)).toHaveTextContent('Superaría las 500 líneas');
  });

  it('loads more pages after the cursor and keeps the list when the next page fails', async () => {
    vi.mocked(getFinancePendingOperations)
      .mockResolvedValueOnce(page(OPERATIONS.slice(0, 2), { nextCursor: 'cursor-2', totalPending: 4 }))
      .mockRejectedValueOnce(Object.assign(new Error('x'), { status: 503 }))
      .mockResolvedValueOnce(page(OPERATIONS.slice(2), { nextCursor: null, totalPending: 4 }));
    renderPage();
    expect(await screen.findByText('Mostrando 2 de 4 pendientes.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(await screen.findByText(/No se pudieron cargar más operaciones/)).toBeInTheDocument();
    expect(screen.getByLabelText('Seleccionar DEV-TAT-0002')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Mostrando 4 de 4 pendientes.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
    expect(vi.mocked(getFinancePendingOperations).mock.calls[2][0]).toMatchObject({ cursor: 'cursor-2', limit: 50 });
  });

  it('closes a selection valued at zero without charge with a reason and the same key on a retry (4-N07)', async () => {
    vi.mocked(issueInvoiceFromOperations).mockRejectedValue(Object.assign(new Error('zero'), { status: 422, code: 'zero_total' }));
    vi.mocked(closeOperationsWithoutCharge)
      .mockRejectedValueOnce(Object.assign(new Error('gateway'), { status: 503 }))
      .mockResolvedValueOnce({ closureId: 'c-1', operationIds: ['op-1'], replayed: false });
    renderPage();
    fireEvent.click(await screen.findByLabelText('Seleccionar DEV-TAT-0001'));
    fireEvent.click(screen.getByRole('button', { name: 'Emitir factura' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no se emite una factura de 0');
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sin cargo' }));
    const dialog = screen.getByRole('dialog', { name: 'Cerrar sin cargo' });
    const confirm = within(dialog).getByRole('button', { name: 'Confirmar cierre' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Motivo del cierre sin cargo'), { target: { value: 'Servicios sin tarifa' } });
    fireEvent.click(confirm);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('No se pudo confirmar el cierre');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar cierre' }));
    expect(await screen.findByText('1 operación cerrada sin cargo.')).toBeInTheDocument();
    const [[firstCommand, firstKey], [secondCommand, secondKey]] = vi.mocked(closeOperationsWithoutCharge).mock.calls;
    expect(firstCommand).toEqual({ stationId: STATION_ID, reason: 'Servicios sin tarifa',
      operations: [{ operationId: 'op-1', version: 'v-op-1' }] });
    expect([secondCommand, secondKey]).toEqual([firstCommand, firstKey]);
  });

  it('hides issuing without the issue permission and shows the empty state', async () => {
    vi.mocked(getFinancePendingOperations).mockResolvedValue(page([]));
    renderPage(['finance.invoicing.read']);
    expect(await screen.findByText(/No hay operaciones aprobadas pendientes/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Emitir factura' })).not.toBeInTheDocument();
  });

  it('shows a recoverable error, then the list', async () => {
    vi.mocked(getFinancePendingOperations).mockRejectedValueOnce(Object.assign(new Error('x'), { status: 500 }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByLabelText('Seleccionar DEV-TAT-0001')).toBeInTheDocument();
  });

  it('tells an expired session and a station without access apart', async () => {
    vi.mocked(getFinancePendingOperations).mockRejectedValueOnce(Object.assign(new Error('x'), { status: 401 }));
    const { unmount } = renderPage();
    expect(await screen.findByText(/Su sesión expiró/)).toBeInTheDocument();
    unmount();
    vi.mocked(getFinancePendingOperations).mockRejectedValueOnce(Object.assign(new Error('x'), { status: 403 }));
    renderPage();
    expect(await screen.findByText(/no tiene acceso vigente a la estación/)).toBeInTheDocument();
  });
});
