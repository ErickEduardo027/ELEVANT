import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSession } from '../../auth/authService';
import { getApprovedServices } from '../../../services/approvedServicesService';
import ApprovedServicesPage from './ApprovedServicesPage';

const observer = vi.hoisted(() => ({ factory: vi.fn(), start: vi.fn(), stop: vi.fn() }));
vi.mock('../../auth/authService', () => ({ readSession: vi.fn() }));
vi.mock('../../../services/approvedServicesService', () => ({ getApprovedServices: vi.fn() }));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: observer.factory,
}));

const STATION_ID = '20000000-0000-7000-8000-000000000003';
const SERVICES = [
  { id: '70000000-0000-7000-8000-000000000017', airlineName: 'Demo Airlines',
    flightNumber: 'ZZ102', operationCode: 'DEV-TAT-0002', operationDate: '2026-08-19',
    serviceName: 'Baggage', serviceCode: 'BAG', contractCode: 'DEV-CTR',
    executedQuantity: 2, billingUnit: 'operation', frozenCurrency: 'USD',
    amount: 80, ready: true, blockingReason: null },
  { id: '70000000-0000-7000-8000-000000000018', airlineName: 'Other Airline',
    flightNumber: 'XX201', operationCode: 'DEV-TAT-0003', operationDate: '2026-08-20',
    serviceName: 'GPU', serviceCode: 'GPU', contractCode: null,
    executedQuantity: 0, billingUnit: 'hour', frozenCurrency: null,
    amount: null, ready: false, blockingReason: 'no_executed_quantity' },
];

beforeEach(() => {
  vi.mocked(readSession).mockReturnValue({
    accountId: '40000000-0000-7000-8000-000000000006',
    stationScopes: [{ stationId: STATION_ID, stationCode: 'PUJ' }],
  });
  observer.factory.mockReset();
  observer.factory.mockReturnValue({ start: observer.start, stop: observer.stop });
  vi.mocked(getApprovedServices).mockReset();
  vi.mocked(getApprovedServices).mockResolvedValue({ services: SERVICES, hasMore: false });
});

describe('ApprovedServicesPage', () => {
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
});
