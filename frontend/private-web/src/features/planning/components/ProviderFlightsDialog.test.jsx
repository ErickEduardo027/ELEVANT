import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProviderFlightsDialog from './ProviderFlightsDialog';
import {
  dismissOccFlightProposal, importOccFlightProposals, loadOccFlightFeed, refreshOccFlightFeed, restoreOccFlightProposal,
} from '../../../services/occFlightFeedService';
import { getManualTurnaroundOptions } from '../../../services/planningService';

vi.mock('../../../services/occFlightFeedService', async importOriginal => ({
  ...(await importOriginal()),
  loadOccFlightFeed: vi.fn(), refreshOccFlightFeed: vi.fn(), importOccFlightProposals: vi.fn(),
  dismissOccFlightProposal: vi.fn(), restoreOccFlightProposal: vi.fn(),
}));
vi.mock('../../../services/planningService', () => ({ getManualTurnaroundOptions: vi.fn() }));

const stationId = '20000000-0000-7000-8000-000000000003';
const a320 = { id: 't-a320', icaoCode: 'A320', iataCode: '320', manufacturer: 'Airbus', model: 'A320', sizeCategory: 'Narrowbody' };
const b738 = { id: 't-b738', icaoCode: 'B738', iataCode: '73H', manufacturer: 'Boeing', model: '737-800', sizeCategory: 'Narrowbody' };
const options = { aircraftTypes: [a320, b738],
  stands: [{ id: 's-a01', code: 'A01', terminal: { id: 'ta', code: 'A', name: 'Terminal A' } }] };
const leg = (id, direction, number, extra = {}) => ({
  proposalId: id, direction, flightNumber: number, airlineId: 'a1', airlineName: 'Demo Airlines', airlineIataCode: 'ZZ',
  counterpartIata: direction === 'Arrival' ? 'SDQ' : 'JFK', counterpartName: null, counterpartKnown: true,
  scheduledAt: '2026-11-03T14:05:00Z', revisedAt: null, runwayAt: null, providerStatus: 'Expected',
  aircraftRegistration: 'HI1055', aircraftModel: 'Airbus A320', terminal: 'B', gate: null, status: 'Proposed', turnaroundId: null,
  suggestedDepartureId: null, lastSeenAt: '2026-11-03T12:00:00Z', version: `v-${id}`, suggestedAircraftTypeId: null, ...extra,
});
const feed = (proposals, budget = {}) => ({ stationId, stationCode: 'PUJ', date: '2026-11-03', lastReadAt: null,
  nextManualRefreshAt: null, canImport: true, proposals,
  budget: { configured: true, provider: 'AeroDataBox', unitsToday: 12, dailyUnits: 1200, unitsThisMonth: 300, monthlyUnits: 38000,
    pausedUntil: null, pauseReason: null, ...budget } });
const problem = (status, code, reasons = []) => Object.assign(new Error('The proposed flights cannot be imported together.'),
  { status, code, reasons, title: 'The proposed flights cannot be imported together.' });

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('imports an arrival with its suggested departure, type and a stand, with the versions and a key', async () => {
  getManualTurnaroundOptions.mockResolvedValue(options);
  loadOccFlightFeed.mockResolvedValue(feed([leg('arr', 'Arrival', 'ZZ161', { suggestedDepartureId: 'dep', suggestedAircraftTypeId: 't-a320' }),
    leg('dep', 'Departure', 'ZZ162'), leg('lone', 'Departure', 'ZZ900')]));
  importOccFlightProposals.mockResolvedValue({ turnaroundId: 't1', operationCode: 'EXT-1', replayed: false });
  const onImported = vi.fn();
  render(<ProviderFlightsDialog stationId={stationId} date="2026-11-03" onClose={() => {}} onImported={onImported} />);

  const arrivals = await screen.findByRole('list', { name: 'Llegadas propuestas' });
  expect(screen.getByText(/hoy 12 de 1200 · este mes 300 de 38000/)).toBeInTheDocument();
  expect(within(arrivals).getByLabelText('Sale como')).toHaveValue('dep');
  // The provider's model suggests the type; OCC confirms it or changes it.
  expect(await within(arrivals).findByLabelText(/^Tipo de avión \(sugerido\)/)).toHaveValue('t-a320');
  fireEvent.change(within(arrivals).getByLabelText('Posición'), { target: { value: 's-a01' } });
  expect(within(screen.getByRole('list', { name: 'Salidas sin llegada' })).getByText('ZZ900')).toBeInTheDocument();
  fireEvent.click(within(arrivals).getByRole('button', { name: 'Importar escala' }));
  expect(await screen.findByText('Escala importada (EXT-1).')).toBeInTheDocument();
  expect(importOccFlightProposals).toHaveBeenCalledWith({ arrivalProposalId: 'arr', departureProposalId: 'dep',
    expectedArrivalVersion: 'v-arr', expectedDepartureVersion: 'v-dep', aircraftTypeId: 't-a320', standId: 's-a01',
    charter: false }, expect.stringMatching(/^[0-9a-f-]{36}$/));
  expect(onImported).toHaveBeenCalled();
  expect(loadOccFlightFeed).toHaveBeenCalledTimes(2);
  expect(loadOccFlightFeed).toHaveBeenLastCalledWith(stationId, '2026-11-03', expect.objectContaining({ view: 'Contracted' }));
});

it('says the proposal joined the flight OCC had already planned instead of creating another one (3-N07)', async () => {
  getManualTurnaroundOptions.mockResolvedValue(options);
  loadOccFlightFeed.mockResolvedValue(feed([leg('arr', 'Arrival', 'ZZ161', { suggestedDepartureId: 'dep' }),
    leg('dep', 'Departure', 'ZZ162')]));
  importOccFlightProposals.mockResolvedValue({ turnaroundId: 't1', operationCode: 'PUJ-20261103-001', replayed: false,
    linked: true });
  const onImported = vi.fn();
  render(<ProviderFlightsDialog stationId={stationId} date="2026-11-03" onClose={() => {}} onImported={onImported} />);

  const arrivals = await screen.findByRole('list', { name: 'Llegadas propuestas' });
  fireEvent.click(within(arrivals).getByRole('button', { name: 'Importar escala' }));
  expect(await screen.findByText('La propuesta se vinculó a la escala ya planificada (PUJ-20261103-001); no se creó otra.'))
    .toBeInTheDocument();
  expect(screen.queryByText(/^Escala importada/)).not.toBeInTheDocument();
  expect(onImported).toHaveBeenCalled();
});

it('explains a taken stand by its rules and reads the list again; a retry after a network failure keeps the key', async () => {
  getManualTurnaroundOptions.mockResolvedValue(options);
  loadOccFlightFeed.mockResolvedValue(feed([leg('arr', 'Arrival', 'ZZ161', { suggestedDepartureId: 'dep' }),
    leg('dep', 'Departure', 'ZZ162')]));
  importOccFlightProposals.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockRejectedValueOnce(problem(409, 'stand_unavailable', ['stand_taken', 'stand_narrowbody_only']));
  render(<ProviderFlightsDialog stationId={stationId} date="2026-11-03" onClose={() => {}} />);
  const arrivals = await screen.findByRole('list', { name: 'Llegadas propuestas' });
  fireEvent.change(await within(arrivals).findByLabelText('Posición'), { target: { value: 's-a01' } });
  fireEvent.click(within(arrivals).getByRole('button', { name: 'Importar escala' }));
  await screen.findByRole('alert');
  fireEvent.click(within(arrivals).getByRole('button', { name: 'Importar escala' }));
  const alert = await screen.findByText('La posición no está disponible para ese horario.');
  expect(alert.closest('[role="alert"]')).toHaveTextContent('Otro vuelo ocupa esa posición en ese horario.');
  expect(alert.closest('[role="alert"]')).toHaveTextContent(/solo admite aviones de fuselaje estrecho/);
  expect(screen.queryByText(/cannot be imported/)).not.toBeInTheDocument();
  const [first, second] = importOccFlightProposals.mock.calls;
  expect(second[1]).toBe(first[1]);
  await waitFor(() => expect(loadOccFlightFeed).toHaveBeenCalledTimes(2));
});

it('imports a carrier without contract as a charter and refuses one whose contract is not in force', async () => {
  getManualTurnaroundOptions.mockResolvedValue(options);
  loadOccFlightFeed.mockImplementation((id, day, { view }) => Promise.resolve(view === 'Charter'
    ? feed([leg('carr', 'Arrival', 'C9100', { airlineName: 'Charter Air', suggestedDepartureId: 'cdep' }),
      leg('cdep', 'Departure', 'C9101', { airlineName: 'Charter Air' })])
    : feed([leg('arr', 'Arrival', 'ZZ161', { suggestedDepartureId: 'dep' }), leg('dep', 'Departure', 'ZZ162')])));
  importOccFlightProposals.mockRejectedValueOnce(problem(409, 'contract_not_in_force'))
    .mockResolvedValueOnce({ turnaroundId: 't2', operationCode: 'EXT-2', replayed: false });
  render(<ProviderFlightsDialog stationId={stationId} date="2026-11-03" onClose={() => {}} />);

  fireEvent.click(within(await screen.findByRole('list', { name: 'Llegadas propuestas' })).getByRole('button', { name: 'Importar escala' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/suspendido o vencido/);

  fireEvent.click(screen.getByRole('button', { name: 'Charter sin contrato' }));
  expect(await screen.findByText(/se importan como charter sin contrato/)).toBeInTheDocument();
  const charter = await screen.findByRole('list', { name: 'Llegadas propuestas' });
  fireEvent.click(within(charter).getByRole('button', { name: 'Importar como charter' }));
  expect(await screen.findByText(/Charter importado \(EXT-2\)/)).toBeInTheDocument();
  expect(importOccFlightProposals).toHaveBeenLastCalledWith(expect.objectContaining({ arrivalProposalId: 'carr',
    departureProposalId: 'cdep', charter: true }), expect.any(String));
  expect(loadOccFlightFeed).toHaveBeenCalledWith(stationId, '2026-11-03', expect.objectContaining({ view: 'Charter' }));
});

it('restores a dismissed proposal with its version from «Descartadas»', async () => {
  getManualTurnaroundOptions.mockResolvedValue(options);
  loadOccFlightFeed.mockImplementation((id, day, { view }) => Promise.resolve(view === 'Dismissed'
    ? feed([leg('gone', 'Arrival', 'ZZ171', { status: 'Dismissed' })]) : feed([])));
  restoreOccFlightProposal.mockResolvedValueOnce({ proposalId: 'gone', status: 'Proposed', version: 'v2', replayed: false })
    .mockRejectedValueOnce(problem(409, 'flight_proposal_passed'));
  render(<ProviderFlightsDialog stationId={stationId} date="2026-11-03" onClose={() => {}} />);
  expect(await screen.findByText(/No hay vuelos propuestos para esta fecha/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Descartadas' }));
  const dismissed = await screen.findByRole('list', { name: 'Llegadas descartadas' });
  fireEvent.click(within(dismissed).getByRole('button', { name: 'Restaurar' }));
  expect(await screen.findByText('ZZ171 volvió a la revisión.')).toBeInTheDocument();
  expect(restoreOccFlightProposal).toHaveBeenCalledWith('gone', 'v-gone', expect.stringMatching(/^[0-9a-f-]{36}$/));
  fireEvent.click(within(await screen.findByRole('list', { name: 'Llegadas descartadas' })).getByRole('button', { name: 'Restaurar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Ese vuelo ya pasó: no se puede restaurar.');
});

it('refreshes through the server, explains its answer and dismisses a leg', async () => {
  getManualTurnaroundOptions.mockResolvedValue(options);
  loadOccFlightFeed.mockResolvedValue(feed([leg('arr', 'Arrival', 'ZZ161')]));
  refreshOccFlightFeed.mockResolvedValue({ status: 'Reused', retryAt: null, flightsReceived: null, contractedLegs: null, newProposals: null });
  dismissOccFlightProposal.mockResolvedValue(undefined);
  render(<ProviderFlightsDialog stationId={stationId} date="2026-11-03" onClose={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Actualizar ahora' }));
  expect(await screen.findByText(/se usó sin gastar unidades/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
  expect(await screen.findByText(/ZZ161 descartado/)).toBeInTheDocument();
  expect(dismissOccFlightProposal).toHaveBeenCalledWith('arr');
});

it('explains a paused feed in Spanish, never by its raw code (2-N29)', async () => {
  getManualTurnaroundOptions.mockResolvedValue(options);
  loadOccFlightFeed.mockResolvedValue(feed([], { pausedUntil: '2026-11-04T00:05:00Z', pauseReason: 'quota_exceeded' }));
  render(<ProviderFlightsDialog stationId={stationId} date="2026-11-03" onClose={() => {}} />);
  expect(await screen.findByText(/Lecturas en pausa hasta las .*: se agotó la cuota del plan del proveedor\./)).toBeInTheDocument();
  expect(screen.queryByText(/quota_exceeded/)).not.toBeInTheDocument();
});

it('says when the provider is not configured and shows the empty, unauthorized and error states', async () => {
  getManualTurnaroundOptions.mockResolvedValue(options);
  loadOccFlightFeed.mockResolvedValueOnce(feed([], { configured: false }));
  render(<ProviderFlightsDialog stationId={stationId} date="2026-11-03" onClose={() => {}} />);
  expect(await screen.findByText(/no está configurado en este entorno/)).toBeInTheDocument();
  expect(screen.getByText(/No hay vuelos propuestos para esta fecha/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Actualizar ahora' })).toBeDisabled();
  cleanup();

  loadOccFlightFeed.mockRejectedValueOnce(problem(403, 'forbidden'));
  render(<ProviderFlightsDialog stationId={stationId} date="2026-11-03" onClose={() => {}} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Tu acceso no permite esta acción');
  expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  cleanup();

  loadOccFlightFeed.mockRejectedValueOnce(Object.assign(new Error('Internal'), { status: 503 }))
    .mockResolvedValueOnce(feed([]));
  render(<ProviderFlightsDialog stationId={stationId} date="2026-11-03" onClose={() => {}} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No fue posible completar la acción');
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText(/No hay vuelos propuestos para esta fecha/)).toBeInTheDocument();
});
