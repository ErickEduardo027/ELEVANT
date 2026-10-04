import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import FinanceReportsPage from './FinanceReportsPage';
import { getFinanceReport } from '../../../services/financeReportsService';
import { readSession } from '../../auth/authService';

const observerFactory = vi.hoisted(() => vi.fn());
vi.mock('../../../services/financeReportsService', () => ({ getFinanceReport: vi.fn() }));
vi.mock('../../auth/authService', () => ({ readSession: vi.fn() }));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: observerFactory,
}));

const report = { counts: { drafts: 1, submitted: 0, disputed: 1,
  accepted: 0, invoiced: 1, voided: 0 }, hasMore: true,
rows: [
  { airlineId: 'airline-one', airlineName: 'Arajet', currencyCode: 'USD',
    drafts: 1, submitted: 0, disputed: 0, accepted: 0, invoiced: 1, voided: 0 },
  { airlineId: 'airline-two', airlineName: 'Air Century', currencyCode: 'DOP',
    drafts: 0, submitted: 0, disputed: 1, accepted: 0, invoiced: 0, voided: 0 },
] };

beforeEach(() => {
  vi.mocked(readSession).mockReturnValue({ accountId: 'finance-account',
    stationScopes: [{ stationId: 'station-one', stationCode: 'PUJ' },
      { stationId: 'station-two', stationCode: 'SDQ' }] });
  vi.mocked(getFinanceReport).mockReset();
  vi.mocked(getFinanceReport).mockResolvedValue(report);
  observerFactory.mockReset();
  observerFactory.mockReturnValue({ start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined) });
});

it('does not issue an unscoped report read without a station grant', () => {
  vi.mocked(readSession).mockReturnValue({ accountId: 'finance-account', stationScopes: [] });
  render(<FinanceReportsPage />);
  expect(screen.getByRole('alert')).toHaveTextContent('No hay una estación financiera autorizada');
  expect(getFinanceReport).not.toHaveBeenCalled();
});

it('renders a bounded station-scoped report with no fake export or old 404 route', async () => {
  render(<FinanceReportsPage initialStationId="station-two" />);
  expect(await within(await screen.findByRole('table')).findByText('Arajet')).toBeInTheDocument();
  expect(getFinanceReport).toHaveBeenCalledWith({ stationId: 'station-two' },
    expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(screen.getByText(/hasta 50 prefacturas/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Exportar/i })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Filtrar reporte por aerolínea'), {
    target: { value: 'Arajet' },
  });
  expect(within(screen.getByRole('table')).queryByText('Air Century')).not.toBeInTheDocument();
});

it('revalidates after a durable finance change and handles read errors', async () => {
  const { unmount } = render(<FinanceReportsPage />);
  await within(await screen.findByRole('table')).findByText('Arajet');
  await act(async () => observerFactory.mock.calls[0][0](['finance_preinvoices']));
  await waitFor(() => expect(getFinanceReport).toHaveBeenCalledTimes(2));
  unmount();

  vi.mocked(getFinanceReport).mockRejectedValueOnce(new Error('offline'));
  render(<FinanceReportsPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar el reporte');
  expect(screen.queryByText('Arajet')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await within(await screen.findByRole('table')).findByText('Arajet')).toBeInTheDocument();
});