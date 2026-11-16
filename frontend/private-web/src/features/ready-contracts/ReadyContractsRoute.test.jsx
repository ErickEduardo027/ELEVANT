import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ReadyContractsRoute from './ReadyContractsRoute';
import { listOccReadyContracts } from '../../services/occReadyContractsService';

const stationId = '20000000-0000-0000-0000-000000000001';
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ session: { stationScopes: [{ stationId, stationCode: 'PUJ' }] } }) }));
vi.mock('../../services/occReadyContractsService', () => ({ listOccReadyContracts: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a> }));

const contract = { contractId: 'c1', contractCode: 'CTR-2026-0001', airlineId: 'a1', airlineName: 'Arajet', airlineIataCode: 'DM',
  versionId: 'v1', versionNumber: 2, validFrom: '2026-01-01', validTo: null, renewalMode: 'Automatic',
  services: [{ code: 'TURN', name: 'Turnaround completo', billingUnit: 'PerTurnaround' }], flightsOnDate: 1 };

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('lists the ready contracts for the station and re-reads when the date changes', async () => {
  listOccReadyContracts.mockResolvedValue({ stationId, stationCode: 'PUJ', date: '2026-11-03', contracts: [contract] });
  render(<ReadyContractsRoute />);
  const list = await screen.findByRole('list', { name: 'Contratos listos para operar' });
  const card = within(list).getAllByRole('listitem')[0];
  expect(card).toHaveTextContent('Arajet');
  expect(card).toHaveTextContent('CTR-2026-0001 · Versión 2');
  expect(card).toHaveTextContent('sin fecha fin');
  expect(card).toHaveTextContent('Automática');
  expect(card).toHaveTextContent('Turnaround completo');
  expect(card).toHaveTextContent('1 vuelo planificado ese día');
  expect(within(card).getByRole('link', { name: 'Planificar vuelos' })).toHaveAttribute('href', '/admin-occ/planning');
  expect(screen.getByText('1 contrato listo')).toBeInTheDocument();
  expect(listOccReadyContracts).toHaveBeenCalledWith(stationId, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), expect.anything());

  fireEvent.change(screen.getByLabelText('Fecha de operación'), { target: { value: '2026-12-01' } });
  await screen.findByText('1 contrato listo');
  expect(listOccReadyContracts).toHaveBeenLastCalledWith(stationId, '2026-12-01', expect.anything());
});

it('shows the empty state and a forbidden error without retry', async () => {
  listOccReadyContracts.mockResolvedValueOnce({ stationId, stationCode: 'PUJ', date: '2026-11-03', contracts: [] });
  render(<ReadyContractsRoute />);
  expect(await screen.findByText(/No hay contratos listos para esta fecha/)).toBeInTheDocument();
  cleanup();

  listOccReadyContracts.mockRejectedValueOnce(Object.assign(new Error('Tu acceso no incluye la planificación de esta estación.'),
    { status: 403 }));
  render(<ReadyContractsRoute />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Tu acceso no incluye');
  expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
});

it('offers a retry after a recoverable error', async () => {
  listOccReadyContracts.mockRejectedValueOnce(Object.assign(new Error('No se pudieron cargar.'), { status: 500 }))
    .mockResolvedValueOnce({ stationId, stationCode: 'PUJ', date: '2026-11-03', contracts: [contract] });
  render(<ReadyContractsRoute />);
  fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('1 contrato listo')).toBeInTheDocument();
});
