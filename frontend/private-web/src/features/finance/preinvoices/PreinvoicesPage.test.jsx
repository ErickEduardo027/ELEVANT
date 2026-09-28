import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PreinvoicesPage from './PreinvoicesPage';
import { getFinancePreinvoices } from '../../../services/financePreinvoiceService';
import { getPreinvoiceDraft } from '../../../services/approvedServicesService';

vi.mock('../../../features/auth/authService', () => ({ readSession: () => ({
  accountId: 'finance-account', stationScopes: [
    { stationId: 'station-one', stationCode: 'PUJ' },
    { stationId: 'station-two', stationCode: 'SDQ' },
  ],
}) }));
vi.mock('../../../services/financePreinvoiceService', () => ({ getFinancePreinvoices: vi.fn() }));
vi.mock('../../../services/approvedServicesService', () => ({ getPreinvoiceDraft: vi.fn() }));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({ start: async () => {}, stop: async () => {} }),
}));

const item = { id: 'preinvoice-one', airlineId: 'airline-one', airlineName: 'Synthetic Air',
  stationId: 'station-one', from: '2026-08-18', to: '2026-08-18', currencyCode: 'USD',
  total: 42.0001, status: 'Draft', lineCount: 1, createdAt: '2026-08-19T12:00:00Z' };

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('shows the persisted station-scoped list and read-only detail', async () => {
  getFinancePreinvoices.mockResolvedValue({ page: 1, limit: 20, hasMore: false, preinvoices: [item] });
  getPreinvoiceDraft.mockResolvedValue({ ...item, lines: [{ id: 'line-one',
    operationCode: 'DEV-TAT-1', serviceName: 'Ground power', amount: 42.0001 }] });
  render(<PreinvoicesPage />);
  expect(await screen.findByText('Synthetic Air')).toBeInTheDocument();
  expect(screen.getByText('USD 42.0001')).toBeInTheDocument();
  expect(getFinancePreinvoices).toHaveBeenCalledWith({ stationId: 'station-one', page: 1, limit: 20 }, expect.any(Object));
  expect(screen.queryByRole('button', { name: /aprobar|enviar|generar pre-factura/i })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
  expect(await screen.findByText(/Ground power/)).toBeInTheDocument();
  expect(getPreinvoiceDraft).toHaveBeenCalledWith('preinvoice-one', 'station-one');
});

it('paginates and renders honest empty, forbidden and retry states', async () => {
  const firstPage = Array.from({ length: 20 }, (_, index) => ({ ...item,
    id: `preinvoice-${index}`, airlineName: index === 0 ? 'Synthetic Air' : `Airline ${index}` }));
  getFinancePreinvoices.mockResolvedValueOnce({ page: 1, limit: 20, hasMore: true, preinvoices: firstPage })
    .mockResolvedValueOnce({ page: 2, limit: 20, hasMore: false, preinvoices: [] });
  const view = render(<PreinvoicesPage />);
  await screen.findByText('Synthetic Air');
  await userEvent.click(screen.getByRole('button', { name: 'Siguiente página' }));
  expect(await screen.findByText('No hay prefacturas en esta página.')).toBeInTheDocument();
  expect(getFinancePreinvoices).toHaveBeenLastCalledWith({ stationId: 'station-one', page: 2, limit: 20 }, expect.any(Object));
  view.unmount();

  getFinancePreinvoices.mockRejectedValueOnce({ status: 403 });
  const denied = render(<PreinvoicesPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No tiene acceso');
  denied.unmount();

  getFinancePreinvoices.mockRejectedValueOnce(new Error('network'));
  render(<PreinvoicesPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar');
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
});

it('does not show stale detail after switching stations', async () => {
  let finishDetail;
  getFinancePreinvoices.mockResolvedValue({ page: 1, limit: 20, hasMore: false,
    preinvoices: [item] });
  getPreinvoiceDraft.mockReturnValue(new Promise(resolve => { finishDetail = resolve; }));
  render(<PreinvoicesPage />);
  await screen.findByText('Synthetic Air');
  await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
  await userEvent.selectOptions(screen.getByLabelText('Estación de prefacturas'), 'station-two');
  await waitFor(() => expect(getFinancePreinvoices).toHaveBeenLastCalledWith(
    { stationId: 'station-two', page: 1, limit: 20 }, expect.any(Object)));
  await act(async () => finishDetail({ ...item, lines: [{ id: 'line-one',
    operationCode: 'DEV-TAT-1', serviceName: 'Ground power', amount: 42.0001 }] }));
  expect(screen.queryByText(/Ground power/)).not.toBeInTheDocument();
});

it('hides open detail when a fresh authorization check denies access', async () => {
  getFinancePreinvoices.mockResolvedValueOnce({ page: 1, limit: 20, hasMore: false,
    preinvoices: [item] }).mockRejectedValueOnce({ status: 403 });
  getPreinvoiceDraft.mockResolvedValue({ ...item, lines: [{ id: 'line-one',
    operationCode: 'DEV-TAT-1', serviceName: 'Ground power', amount: 42.0001 }] });
  render(<PreinvoicesPage />);
  await screen.findByText('Synthetic Air');
  await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
  expect(await screen.findByText(/Ground power/)).toBeInTheDocument();
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByRole('alert')).toHaveTextContent('No tiene acceso');
  expect(screen.queryByText(/Ground power/)).not.toBeInTheDocument();
});
