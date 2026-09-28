import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import TariffsPage from './TariffsPage';
import { getFinanceTariffs } from '../../../services/financeTariffsService';
import { readSession } from '../../auth/authService';

const observerFactory = vi.hoisted(() => vi.fn());
vi.mock('../../../services/financeTariffsService', () => ({ getFinanceTariffs: vi.fn() }));
vi.mock('../../auth/authService', () => ({ readSession: vi.fn() }));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: observerFactory,
}));

const stationId = '20000000-0000-7000-8000-000000000003';
const tariff = { id: 'rate-one', contractId: 'contract-one',
  contractCode: 'DEV-CONTRACT-0001', airlineId: 'airline-one',
  airlineName: 'Synthetic Air', versionNumber: 1, versionStatus: 'Approved',
  validFrom: '2026-01-01', validTo: null, currencyCode: 'USD',
  serviceCode: 'GPU', serviceName: 'Ground power', billingUnit: 'operation',
  unitPrice: 125.50, minimumQuantity: 1 };

beforeEach(() => {
  vi.mocked(readSession).mockReturnValue({ accountId: 'finance-account',
    stationScopes: [{ stationId, stationCode: 'PUJ' }] });
  vi.mocked(getFinanceTariffs).mockReset();
  vi.mocked(getFinanceTariffs).mockResolvedValue({ stationId, page: 1, limit: 20,
    hasMore: false, tariffs: [tariff] });
  observerFactory.mockReset();
  observerFactory.mockReturnValue({ start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined) });
});

it('requires a station grant and never issues an unscoped read', () => {
  vi.mocked(readSession).mockReturnValue({ accountId: 'finance-account', stationScopes: [] });
  render(<TariffsPage />);
  expect(screen.getByRole('alert')).toHaveTextContent('No hay una estación financiera autorizada');
  expect(getFinanceTariffs).not.toHaveBeenCalled();
});

it('shows published contract rates without a fake mutation action', async () => {
  render(<TariffsPage initialStationId={stationId} />);
  expect(await within(await screen.findByRole('table')).findByText('Ground power')).toBeInTheDocument();
  expect(getFinanceTariffs).toHaveBeenCalledWith({ stationId, page: 1, limit: 20 },
    expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(screen.getByText('125.5000')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Modificar' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Programar cambio' })).not.toBeInTheDocument();
});

it('pages through real rates and revalidates after a durable change', async () => {
  vi.mocked(getFinanceTariffs).mockResolvedValueOnce({ stationId, page: 1,
    limit: 20, hasMore: true, tariffs: [tariff] })
    .mockResolvedValue({ stationId, page: 2, limit: 20,
      hasMore: false, tariffs: [{ ...tariff, id: 'rate-two', serviceName: 'Baggage' }] });
  render(<TariffsPage />);
  await screen.findByText('Ground power');
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente página' }));
  expect(await screen.findByText('Baggage')).toBeInTheDocument();
  expect(getFinanceTariffs).toHaveBeenLastCalledWith({ stationId, page: 2, limit: 20 },
    expect.objectContaining({ signal: expect.any(AbortSignal) }));
  await act(async () => observerFactory.mock.calls[0][0](['finance_tariffs']));
  await waitFor(() => expect(getFinanceTariffs).toHaveBeenCalledTimes(3));
});

it('shows a recoverable error without retaining stale prices', async () => {
  vi.mocked(getFinanceTariffs).mockRejectedValueOnce(new Error('offline'));
  render(<TariffsPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar las tarifas');
  expect(screen.queryByText('Ground power')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('Ground power')).toBeInTheDocument();
});
