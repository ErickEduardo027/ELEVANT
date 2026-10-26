import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ManagedAgreementsPage from './ManagedAgreementsPage';
import { getManagedContracts } from '../../../services/commercialGovernanceApi';

vi.mock('../../../services/commercialGovernanceApi', () => ({ getManagedContracts: vi.fn() }));
vi.mock('../../../hooks/useCommercialRevalidation', () => ({ useCommercialRevalidation: vi.fn() }));

const agreement = {
  id: 'contract-one', code: 'CTR-2026-1', airline: 'Synthetic Air',
  airlineCode: 'SY', status: 'Active', signedOn: null, terminatedOn: null,
  approvedVersions: [{ id: 'version-one', versionNumber: 2, status: 'Approved', validFrom: '2026-09-01',
    validTo: null, currencyCode: 'USD', terms: 'Servicios de rampa',
    stations: [{ id: 'station-one', code: 'PUJ', name: 'Punta Cana' }],
    rates: [{ id: 'rate-one', serviceCode: 'GPU', serviceName: 'Unidad de potencia',
      billingUnit: 'operation', unitPrice: 100.0001, minimumQuantity: 1 }] }],
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('shows only published agreements and no unsupported write action', async () => {
  getManagedContracts.mockResolvedValue({ page: 1, limit: 20, hasMore: false,
    contracts: [agreement] });
  render(<ManagedAgreementsPage mode="contracts" />);
  expect(await screen.findByText('CTR-2026-1')).toBeInTheDocument();
  expect(screen.getByText('Synthetic Air')).toBeInTheDocument();
  expect(screen.getByText('PUJ')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /modelo/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /registrar contrato|actualizar/i })).not.toBeInTheDocument();
  expect(getManagedContracts).toHaveBeenCalledWith(1);
});

it('paginates real agreed service rates without invoking legacy routes', async () => {
  getManagedContracts.mockResolvedValueOnce({ page: 1, limit: 20, hasMore: true,
    contracts: [agreement] }).mockResolvedValueOnce({ page: 2, limit: 20, hasMore: false,
    contracts: [] });
  render(<ManagedAgreementsPage mode="services" />);
  expect(await screen.findByText('Unidad de potencia')).toBeInTheDocument();
  expect(screen.getByText('USD 100.0001')).toBeInTheDocument();
  expect(screen.getByText('PUJ')).toBeInTheDocument();
  expect(screen.getByText('Aprobada')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Siguiente página' }));
  expect(await screen.findByText('No hay servicios pactados en esta página.')).toBeInTheDocument();
  expect(getManagedContracts).toHaveBeenLastCalledWith(2);
});

it('marks superseded tariffs as historical even if their dates overlap', async () => {
  getManagedContracts.mockResolvedValue({ page: 1, limit: 20, hasMore: false,
    contracts: [{ ...agreement, approvedVersions: [agreement.approvedVersions[0], {
      ...agreement.approvedVersions[0], id: 'version-old', versionNumber: 1,
      status: 'Superseded', rates: [{ ...agreement.approvedVersions[0].rates[0],
        id: 'rate-old', unitPrice: 85 }],
    }] }],
  });
  render(<ManagedAgreementsPage mode="services" />);
  expect(await screen.findByText('Reemplazada')).toBeInTheDocument();
  expect(screen.getByText('USD 85.0000')).toBeInTheDocument();
});

it('distinguishes permission denial from a recoverable transport failure', async () => {
  getManagedContracts.mockRejectedValueOnce({ status: 403 });
  const view = render(<ManagedAgreementsPage mode="reports" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No tiene permiso');
  expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  view.unmount();
  getManagedContracts.mockRejectedValueOnce(new Error('network'));
  render(<ManagedAgreementsPage mode="reports" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron consultar');
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
});

it.each([
  [{ kind: 'malformed-response', status: 200 }, 'formato incompatible'],
  [{ kind: 'http', status: 500 }, 'El servidor no pudo consultar'],
  [new TypeError('Failed to fetch'), 'No hay conexión con la API'],
])('explains the agreement loading failure without exposing raw errors', async (failure, message) => {
  getManagedContracts.mockRejectedValueOnce(failure);
  render(<ManagedAgreementsPage mode="contracts" />);
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
});
