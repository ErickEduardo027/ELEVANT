import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ProviderFlightsDialog from './ProviderFlightsDialog';
import {
  dismissOccFlightProposal, importOccFlight, loadOccFlightFeed, refreshOccFlightFeed,
} from '../../../services/occFlightFeedService';

vi.mock('../../../services/occFlightFeedService', async importOriginal => ({
  ...(await importOriginal()),
  loadOccFlightFeed: vi.fn(), refreshOccFlightFeed: vi.fn(), importOccFlight: vi.fn(), dismissOccFlightProposal: vi.fn(),
}));

const stationId = '20000000-0000-7000-8000-000000000003';
const leg = (id, direction, number, extra = {}) => ({
  proposalId: id, direction, flightNumber: number, airlineId: 'a1', airlineName: 'Demo Airlines', airlineIataCode: 'ZZ',
  counterpartIata: direction === 'Arrival' ? 'SDQ' : 'JFK', counterpartName: null, counterpartKnown: true,
  scheduledAt: '2026-11-03T14:05:00Z', revisedAt: null, runwayAt: null, providerStatus: 'Expected',
  aircraftRegistration: 'HI1055', aircraftModel: null, terminal: 'B', gate: null, status: 'Proposed', turnaroundId: null,
  suggestedDepartureId: null, lastSeenAt: '2026-11-03T12:00:00Z', ...extra,
});
const feed = (proposals, budget = {}) => ({ stationId, stationCode: 'PUJ', date: '2026-11-03', lastReadAt: null,
  nextManualRefreshAt: null, canImport: true, proposals,
  budget: { configured: true, provider: 'AeroDataBox', unitsToday: 12, dailyUnits: 1200, unitsThisMonth: 300, monthlyUnits: 38000,
    pausedUntil: null, pauseReason: null, ...budget } });

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('imports an arrival with its suggested departure and refreshes planning', async () => {
  loadOccFlightFeed.mockResolvedValue(feed([leg('arr', 'Arrival', 'ZZ161', { suggestedDepartureId: 'dep' }),
    leg('dep', 'Departure', 'ZZ162'), leg('lone', 'Departure', 'ZZ900')]));
  importOccFlight.mockResolvedValue({ turnaroundId: 't1', operationCode: 'EXT-1', replayed: false });
  const onImported = vi.fn();
  render(<ProviderFlightsDialog stationId={stationId} date="2026-11-03" onClose={() => {}} onImported={onImported} />);

  const arrivals = await screen.findByRole('list', { name: 'Llegadas propuestas' });
  expect(screen.getByText(/hoy 12 de 1200 · este mes 300 de 38000/)).toBeInTheDocument();
  expect(within(arrivals).getByLabelText('Sale como')).toHaveValue('dep');
  expect(within(screen.getByRole('list', { name: 'Salidas sin llegada' })).getByText('ZZ900')).toBeInTheDocument();
  fireEvent.click(within(arrivals).getByRole('button', { name: 'Importar escala' }));
  expect(await screen.findByText('Escala importada (EXT-1).')).toBeInTheDocument();
  expect(importOccFlight).toHaveBeenCalledWith('arr', 'dep');
  expect(onImported).toHaveBeenCalled();
  expect(loadOccFlightFeed).toHaveBeenCalledTimes(2);
});

it('refreshes through the server, explains its answer and dismisses a leg', async () => {
  loadOccFlightFeed.mockResolvedValue(feed([leg('arr', 'Arrival', 'ZZ161')]));
  refreshOccFlightFeed.mockResolvedValue({ status: 'Reused', retryAt: null, flightsReceived: null, contractedLegs: null, newProposals: null });
  dismissOccFlightProposal.mockResolvedValue(undefined);
  render(<ProviderFlightsDialog stationId={stationId} date="2026-11-03" onClose={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Actualizar ahora' }));
  expect(await screen.findByText(/se usó sin gastar unidades/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
  expect(await screen.findByText('ZZ161 descartado.')).toBeInTheDocument();
  expect(dismissOccFlightProposal).toHaveBeenCalledWith('arr');
});

it('says when the provider is not configured and shows the empty and error states', async () => {
  loadOccFlightFeed.mockResolvedValueOnce(feed([], { configured: false }));
  render(<ProviderFlightsDialog stationId={stationId} date="2026-11-03" onClose={() => {}} />);
  expect(await screen.findByText(/no está configurado en este entorno/)).toBeInTheDocument();
  expect(screen.getByText(/No hay vuelos propuestos para esta fecha/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Actualizar ahora' })).toBeDisabled();
  cleanup();

  loadOccFlightFeed.mockRejectedValueOnce(Object.assign(new Error('Tu acceso no permite esta acción.'), { status: 403 }));
  render(<ProviderFlightsDialog stationId={stationId} date="2026-11-03" onClose={() => {}} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Tu acceso no permite');
  expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
});
