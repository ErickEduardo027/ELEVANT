import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
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

it('expands and collapses the contracted services of a row', async () => {
  const quiet = { ...contract, contractId: 'c2', contractCode: 'CTR-2026-0002', airlineId: 'a2',
    airlineName: 'Aerolínea de prueba', airlineIataCode: null, versionId: 'v2', versionNumber: 1, validFrom: '2026-02-01',
    validTo: '2026-12-31', renewalMode: null, services: [], flightsOnDate: 0 };
  listOccReadyContracts.mockResolvedValue({ stationId, stationCode: 'PUJ', date: '2026-11-03', contracts: [contract, quiet] });
  render(<ReadyContractsRoute />);
  const list = await screen.findByRole('list', { name: 'Contratos listos para operar' });
  // The page is a region named by its h1, and the count sits on the title's line.
  const heading = screen.getByRole('heading', { level: 1, name: 'Contratos listos para operar' });
  expect(screen.getByRole('region', { name: 'Contratos listos para operar' })).toContainElement(list);
  expect(heading.parentElement).toHaveTextContent('2 contratos listos');
  const [first, second] = within(list).getAllByRole('listitem');

  // Each row folds its services under a disclosure named by them; the detail is always there, hidden while folded.
  const toggle = within(first).getByRole('button', { name: 'Servicios contratados (1)' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const detail = document.getElementById(toggle.getAttribute('aria-controls'));
  expect(first).toContainElement(detail);
  expect(detail).not.toBeVisible();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(detail).toBeVisible();
  expect(within(detail).getByRole('list', { name: 'Servicios contratados' })).toHaveTextContent('Turnaround completo');
  // The other row stays folded until it is opened, and folding the first hides its services again.
  const other = within(second).getByRole('button', { name: 'Servicios contratados (0)' });
  expect(other).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(detail).not.toBeVisible();

  // A contract with an end date, no renewal mode, no services and no flights says each of them.
  expect(second).toHaveTextContent('1 feb 2026 a 31 dic 2026');
  expect(second).toHaveTextContent('Sin definir');
  expect(second).toHaveTextContent('Sin vuelos planificados ese día');
  fireEvent.click(other);
  expect(within(second).getByText('Sin servicios activos')).toBeVisible();
  expect(within(second).getByRole('link', { name: 'Planificar vuelos' })).toHaveAttribute('href', '/admin-occ/planning');
});

describe('ReadyContractsRoute in English', () => {
  afterEach(() => act(() => resetLanguageForTests('es')));

  it('renders the ready contracts in English inside the OCC scope', async () => {
    act(() => resetLanguageForTests('en'));
    listOccReadyContracts.mockResolvedValue({ stationId, stationCode: 'PUJ', date: '2026-11-03', contracts: [contract] });
    render(<LanguageScope><ReadyContractsRoute /></LanguageScope>);
    expect(screen.getByRole('heading', { level: 1, name: 'Contracts ready to operate' })).toBeInTheDocument();
    expect(screen.getByLabelText('Operation date')).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Contracts ready to operate' });
    expect(screen.getByRole('region', { name: 'Contracts ready to operate' })).toContainElement(list);
    const card = within(list).getAllByRole('listitem')[0];
    expect(card).toHaveTextContent('CTR-2026-0001 · Version 2');
    expect(card).toHaveTextContent('From Jan 1, 2026, no end date');
    expect(card).toHaveTextContent('Automatic');
    expect(card).toHaveTextContent('1 flight planned that day');
    expect(within(card).getByRole('link', { name: 'Plan flights' })).toHaveAttribute('href', '/admin-occ/planning');
    const toggle = within(card).getByRole('button', { name: 'Contracted services (1)' });
    fireEvent.click(toggle);
    expect(within(card).getByRole('list', { name: 'Contracted services' })).toHaveTextContent('Turnaround completo');
    expect(screen.getByRole('status')).toHaveTextContent('1 contract ready');
    expect(screen.queryByText(/Contratos|Vigencia|Renovación|Planificar|Servicios contratados|Fecha de operación/)).toBeNull();
  });
});
