import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSession } from '../../auth/authService';
import { getApprovedServices, createPreinvoiceDraft, getPreinvoiceDraft } from '../../../services/approvedServicesService';
import ApprovedServicesPage from './ApprovedServicesPage';

const observer = vi.hoisted(() => ({ factory: vi.fn(), start: vi.fn(), stop: vi.fn() }));
vi.mock('../../auth/authService', () => ({ readSession: vi.fn() }));
vi.mock('../../../services/approvedServicesService', () => ({
  getApprovedServices: vi.fn(), createPreinvoiceDraft: vi.fn(), getPreinvoiceDraft: vi.fn(),
}));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: observer.factory,
}));

const STATION_ID = '20000000-0000-7000-8000-000000000003';
const SERVICES = [
  { id: '70000000-0000-7000-8000-000000000017', airlineName: 'Demo Airlines',
    airlineId: '50000000-0000-7000-8000-000000000006', preinvoiceId: null,
    flightNumber: 'ZZ102', operationCode: 'DEV-TAT-0002', operationDate: '2026-08-19',
    serviceName: 'Baggage', serviceCode: 'BAG', contractCode: 'DEV-CTR',
    executedQuantity: 2, billingUnit: 'operation', frozenCurrency: 'USD',
    amount: 80, ready: true, blockingReason: null },
  { id: '70000000-0000-7000-8000-000000000018', airlineName: 'Other Airline',
    airlineId: '50000000-0000-7000-8000-000000000007', preinvoiceId: null,
    flightNumber: 'XX201', operationCode: 'DEV-TAT-0003', operationDate: '2026-08-20',
    serviceName: 'GPU', serviceCode: 'GPU', contractCode: null,
    executedQuantity: 0, billingUnit: 'hour', frozenCurrency: null,
    amount: null, ready: false, blockingReason: 'no_executed_quantity' },
];
const DRAFT_LINE = {
  id: '90000000-0000-7000-8000-000000000020', serviceName: 'Baggage',
  serviceCode: 'BAG', operationCode: 'DEV-TAT-0002', operationDate: '2026-08-19',
  executedQuantity: 2, billingUnit: 'operation', unitPrice: 40,
  amount: 80, currencyCode: 'USD',
};

beforeEach(() => {
  vi.mocked(readSession).mockReturnValue({
    accountId: '40000000-0000-7000-8000-000000000006',
    stationScopes: [{ stationId: STATION_ID, stationCode: 'PUJ' }],
  });
  observer.factory.mockReset();
  observer.factory.mockReturnValue({ start: observer.start, stop: observer.stop });
  vi.mocked(getApprovedServices).mockReset();
  vi.mocked(getApprovedServices).mockResolvedValue({ services: SERVICES, hasMore: false });
  vi.mocked(createPreinvoiceDraft).mockReset();
  vi.mocked(getPreinvoiceDraft).mockReset();
});

describe('ApprovedServicesPage', () => {
  it('opens the station selected in the Finance summary', async () => {
    vi.mocked(readSession).mockReturnValue({ accountId: 'finance-account',
      stationScopes: [{ stationId: STATION_ID, stationCode: 'PUJ' },
        { stationId: 'station-two', stationCode: 'SDQ' }] });
    render(<ApprovedServicesPage initialStationId="station-two" />);
    await waitFor(() => expect(getApprovedServices).toHaveBeenCalledWith(
      expect.objectContaining({ stationId: 'station-two' }), expect.any(Object)));
  });
  it('reads canonical finance evidence and filters by airline without a fake review action', async () => {
    render(<ApprovedServicesPage />);
    expect(await screen.findByText('Baggage')).toBeInTheDocument();
    expect(getApprovedServices).toHaveBeenCalledWith(
      expect.objectContaining({ stationId: STATION_ID }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByText('Lista para prefactura')).toBeInTheDocument();
    expect(screen.getByText('Sin cantidad ejecutada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Marcar revisado' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filtrar por aerolínea'),
      { target: { value: 'Demo Airlines' } });
    expect(screen.getByText('ZZ102')).toBeInTheDocument();
    expect(screen.queryByText('XX201')).not.toBeInTheDocument();
  });

  it('rejects an oversized range before a request and recovers on retry', async () => {
    vi.mocked(getApprovedServices).mockRejectedValueOnce(new Error('network'));
    render(<ApprovedServicesPage />);
    expect(await screen.findByText('No se pudieron cargar los servicios aprobados.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Baggage')).toBeInTheDocument();
    const requests = vi.mocked(getApprovedServices).mock.calls.length;
    fireEvent.change(screen.getByLabelText('Servicios desde'), { target: { value: '2025-01-01' } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('hasta 31 días'));
    expect(getApprovedServices).toHaveBeenCalledTimes(requests);
  });

  it('does not query without station access', async () => {
    vi.mocked(readSession).mockReturnValue({ stationScopes: [] });
    render(<ApprovedServicesPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('no tiene acceso vigente');
    expect(getApprovedServices).not.toHaveBeenCalled();
  });

  it('distinguishes a filter with no matches from an empty station period', async () => {
    render(<ApprovedServicesPage />);
    await screen.findByText('Baggage');
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'no-such-flight' } });
    expect(screen.getByText('Ningún servicio coincide con los filtros.')).toBeInTheDocument();
    expect(screen.queryByText('No hay servicios aprobados para esta estación y período.')).not.toBeInTheDocument();
  });

  it('reconciles after a durable finance change hint', async () => {
    render(<ApprovedServicesPage />);
    await screen.findByText('Baggage');
    expect(getApprovedServices).toHaveBeenCalledTimes(1);
    observer.factory.mock.calls[0][0](['finance_approved_services']);
    await waitFor(() => expect(getApprovedServices).toHaveBeenCalledTimes(2));
  });

  it('creates a real draft and opens its saved snapshot', async () => {
    const draftId = '80000000-0000-7000-8000-000000000019';
    vi.mocked(createPreinvoiceDraft).mockResolvedValue({ id: draftId, replayed: false });
    vi.mocked(getPreinvoiceDraft).mockResolvedValue({ id: draftId, airlineName: 'Demo Airlines',
      currencyCode: 'USD', total: 80, status: 'Draft', lines: [DRAFT_LINE] });
    render(<ApprovedServicesPage />);
    await screen.findByText('Baggage');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Baggage' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crear prefactura' }));
    await waitFor(() => expect(createPreinvoiceDraft).toHaveBeenCalledWith(
      expect.objectContaining({ stationId: STATION_ID,
        serviceIds: [SERVICES[0].id], requestId: expect.any(String) })));
    expect(await screen.findByText('Prefactura guardada')).toBeInTheDocument();
    expect(getPreinvoiceDraft).toHaveBeenCalledWith(draftId, STATION_ID);
  });

  it('keeps an uncertain command key stable across retry', async () => {
    vi.mocked(createPreinvoiceDraft).mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ id: crypto.randomUUID(), replayed: true });
    vi.mocked(getPreinvoiceDraft).mockResolvedValue({ airlineName: 'Demo Airlines',
      currencyCode: 'USD', total: 80, status: 'Draft', lines: [DRAFT_LINE] });
    render(<ApprovedServicesPage />);
    await screen.findByText('Baggage');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Baggage' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crear prefactura' }));
    await screen.findByText(/No se pudo confirmar la creación/);
    fireEvent.click(screen.getByRole('button', { name: 'Crear prefactura' }));
    await waitFor(() => expect(createPreinvoiceDraft).toHaveBeenCalledTimes(2));
    expect(vi.mocked(createPreinvoiceDraft).mock.calls[0][0].requestId)
      .toBe(vi.mocked(createPreinvoiceDraft).mock.calls[1][0].requestId);
  });

  it('shows an existing reservation and opens it without selecting again', async () => {
    const draftId = crypto.randomUUID();
    vi.mocked(getApprovedServices).mockResolvedValue({
      services: [{ ...SERVICES[0], preinvoiceId: draftId }], hasMore: false,
    });
    vi.mocked(getPreinvoiceDraft).mockResolvedValue({ id: draftId,
      airlineName: 'Demo Airlines', currencyCode: 'USD', total: 80,
      status: 'Draft', lines: [DRAFT_LINE] });
    render(<ApprovedServicesPage />);
    expect(await screen.findByRole('button', { name: 'Ver prefactura guardada' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Seleccionar Baggage' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Ver prefactura guardada' }));
    expect(await screen.findByText('Prefactura guardada')).toBeInTheDocument();
    expect(getPreinvoiceDraft).toHaveBeenCalledWith(draftId, STATION_ID);
  });

  it('drops a selected service when a fresh canonical read shows it was reserved elsewhere', async () => {
    render(<ApprovedServicesPage />);
    await screen.findByText('Baggage');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Baggage' }));
    expect(screen.getByRole('button', { name: 'Crear prefactura' })).toBeEnabled();
    vi.mocked(getApprovedServices).mockResolvedValue({
      services: [{ ...SERVICES[0], preinvoiceId: crypto.randomUUID() }], hasMore: false,
    });
    act(() => observer.factory.mock.calls[0][0](['finance_preinvoices']));
    expect(await screen.findByRole('button', { name: 'Ver prefactura guardada' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button',
      { name: 'Crear prefactura' })).toBeDisabled());
    expect(createPreinvoiceDraft).not.toHaveBeenCalled();
  });

  it('does not display a late draft response after the station changes', async () => {
    const otherStationId = crypto.randomUUID();
    let completeCreation;
    vi.mocked(createPreinvoiceDraft).mockImplementation(() => new Promise(resolve => {
      completeCreation = resolve;
    }));
    vi.mocked(readSession).mockReturnValue({ accountId: crypto.randomUUID(), stationScopes: [
      { stationId: STATION_ID, stationCode: 'PUJ' },
      { stationId: otherStationId, stationCode: 'SDQ' },
    ] });
    render(<ApprovedServicesPage />);
    await screen.findByText('Baggage');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Baggage' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crear prefactura' }));
    fireEvent.change(screen.getByLabelText('Estación de servicios'),
      { target: { value: otherStationId } });
    await act(async () => completeCreation({ id: crypto.randomUUID(), replayed: false }));
    expect(screen.queryByText('Prefactura guardada')).not.toBeInTheDocument();
    expect(getPreinvoiceDraft).not.toHaveBeenCalled();
  });

  it('keeps the latest opened draft when an earlier detail resolves late', async () => {
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    vi.mocked(getApprovedServices).mockResolvedValue({ services: [
      { ...SERVICES[0], preinvoiceId: firstId },
      { ...SERVICES[1], id: crypto.randomUUID(), serviceName: 'GPU',
        preinvoiceId: secondId },
    ], hasMore: false });
    let completeFirst;
    let completeSecond;
    vi.mocked(getPreinvoiceDraft).mockImplementation(id => new Promise(resolve => {
      if (id === firstId) completeFirst = resolve;
      else completeSecond = resolve;
    }));
    render(<ApprovedServicesPage />);
    await screen.findByText('Baggage');
    const opens = screen.getAllByRole('button', { name: 'Ver prefactura guardada' });
    fireEvent.click(opens[0]);
    fireEvent.click(opens[1]);
    await act(async () => completeSecond({ id: secondId, airlineName: 'Second',
      currencyCode: 'USD', total: 9, status: 'Draft', lines: [] }));
    expect(screen.getByText('Second')).toBeInTheDocument();
    await act(async () => completeFirst({ id: firstId, airlineName: 'First',
      currencyCode: 'USD', total: 10, status: 'Draft', lines: [] }));
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.queryByText('First')).not.toBeInTheDocument();
  });

  it('shows the saved frozen line amounts with DOP cents', async () => {
    const draftId = crypto.randomUUID();
    vi.mocked(getApprovedServices).mockResolvedValue({ services: [
      { ...SERVICES[0], frozenCurrency: 'DOP', preinvoiceId: draftId },
    ], hasMore: false });
    vi.mocked(getPreinvoiceDraft).mockResolvedValue({ id: draftId,
      airlineName: 'Demo Airlines', currencyCode: 'DOP', total: 80.49,
      status: 'Draft', lines: [{ id: crypto.randomUUID(),
        serviceName: 'Baggage', serviceCode: 'BAG', operationCode: 'DEV-TAT-0002',
        operationDate: '2026-08-19', executedQuantity: 2, billingUnit: 'operation',
        unitPrice: 40.245, amount: 80.49, currencyCode: 'DOP' }] });
    render(<ApprovedServicesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ver prefactura guardada' }));
    const detail = await screen.findByRole('region', { name: 'Prefactura guardada' });
    expect(within(detail).getByText('DEV-TAT-0002')).toBeInTheDocument();
    expect(within(detail).getAllByText(/80[.,]49/).length).toBeGreaterThan(0);
    expect(within(detail).getByText(/40[.,]245/)).toBeInTheDocument();
  });
});