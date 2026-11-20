import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  // The list is read again by an effect after the answer is shown: wait for it instead of racing it under load.
  await waitFor(() => expect(loadOccFlightFeed).toHaveBeenCalledTimes(2));
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
  // The dismissal carries the version on screen and the intent's key (2-N36).
  expect(dismissOccFlightProposal).toHaveBeenCalledWith('arr', 'v-arr', expect.stringMatching(/^[0-9a-f-]{36}$/));
});

it('retries an uncertain dismissal with the same key and reads the list again when the proposal changed (2-N36)', async () => {
  getManualTurnaroundOptions.mockResolvedValue(options);
  loadOccFlightFeed.mockResolvedValue(feed([leg('arr', 'Arrival', 'ZZ161')]));
  dismissOccFlightProposal.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockRejectedValueOnce(problem(409, 'version_conflict'));
  render(<ProviderFlightsDialog stationId={stationId} date="2026-11-03" onClose={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Descartar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('No fue posible completar la acción. Intenta nuevamente.');
  fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
  expect(await screen.findByText(/El vuelo propuesto cambió mientras lo revisabas/)).toBeInTheDocument();
  const [first, second] = dismissOccFlightProposal.mock.calls;
  expect(second).toEqual(first);
  expect(first).toEqual(['arr', 'v-arr', expect.stringMatching(/^[0-9a-f-]{36}$/)]);
  await waitFor(() => expect(loadOccFlightFeed).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(/cannot be imported/)).not.toBeInTheDocument();
});

it('explains a paused feed in Spanish, never by its raw code (2-N29)', async () => {
  getManualTurnaroundOptions.mockResolvedValue(options);
  loadOccFlightFeed.mockResolvedValue(feed([], { pausedUntil: '2026-11-04T00:05:00Z', pauseReason: 'quota_exceeded' }));
  render(<ProviderFlightsDialog stationId={stationId} date="2026-11-03" onClose={() => {}} />);
  expect(await screen.findByText(/Lecturas en pausa hasta las .*: se agotó la cuota del plan del proveedor\./)).toBeInTheDocument();
  expect(screen.queryByText(/quota_exceeded/)).not.toBeInTheDocument();
});

it('writes every time on 24 hours in the station zone, as the OCC console does (N28)', async () => {
  getManualTurnaroundOptions.mockResolvedValue(options);
  // Punta Cana is UTC−4: 14:05Z is 10:05 there, 23:53Z is 19:53 and 01:30Z the next day is 21:30.
  loadOccFlightFeed.mockResolvedValue({
    ...feed([leg('arr', 'Arrival', 'ZZ161', { suggestedDepartureId: 'dep', revisedAt: '2026-11-03T23:53:00Z',
      runwayAt: '2026-11-03T23:58:00Z' }), leg('dep', 'Departure', 'ZZ162', { scheduledAt: '2026-11-04T01:30:00Z' })],
    { pausedUntil: '2026-11-04T00:05:00Z', pauseReason: 'quota_exceeded' }),
    lastReadAt: '2026-11-03T16:00:00Z', nextManualRefreshAt: '2026-11-03T22:40:00Z',
  });
  render(<ProviderFlightsDialog stationId={stationId} date="2026-11-03" onClose={() => {}} />);

  const arrival = within(await screen.findByRole('list', { name: 'Llegadas propuestas' })).getByRole('listitem');
  expect(arrival).toHaveTextContent('10:05 → 19:53 · aterrizó 19:58');
  expect(within(arrival).getByRole('option', { name: 'ZZ162 · hacia JFK · 21:30' })).toBeInTheDocument();
  expect(screen.getByText(/Lecturas en pausa hasta las 20:05:/)).toBeInTheDocument();
  expect(screen.getByText(/última lectura 12:00$/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Actualizar ahora' })).toHaveAttribute('title', 'Disponible a las 18:40');
  // Never «7:53 p. m.»: the dialog has no 12-hour clock.
  expect(screen.getByRole('dialog')).not.toHaveTextContent(/[ap]\.\s?m\./i);
});

it('names the provider’s status of each arrival as the board does, in every view (N22)', async () => {
  getManualTurnaroundOptions.mockResolvedValue(options);
  loadOccFlightFeed.mockImplementation((id, day, { view }) => Promise.resolve(view === 'Dismissed'
    ? feed([leg('gone', 'Arrival', 'ZZ171', { status: 'Dismissed', providerStatus: 'Approaching' }),
      leg('late', 'Arrival', 'ZZ173', { status: 'Dismissed', providerStatus: 'Delayed', aircraftRegistration: null,
        revisedAt: '2026-11-03T15:00:00Z' })])
    : feed([leg('exp', 'Arrival', 'ZZ161'), leg('app', 'Arrival', 'ZZ163', { providerStatus: 'Approaching' }),
      leg('arr', 'Arrival', 'ZZ165', { providerStatus: 'Arrived' }),
      leg('rwy', 'Arrival', 'ZZ167', { runwayAt: '2026-11-03T14:01:00Z' }),
      leg('odd', 'Arrival', 'ZZ169', { providerStatus: 'Holding' })])));
  render(<ProviderFlightsDialog stationId={stationId} date="2026-11-03" onClose={() => {}} />);

  const proposed = await screen.findByRole('list', { name: 'Llegadas propuestas' });
  const [expected, approaching, arrived, landed, odd] = within(proposed).getAllByRole('listitem');
  expect(expected).toHaveTextContent('Programado · HI1055 · Airbus A320 · Terminal B');
  expect(approaching).toHaveTextContent('En aproximación · HI1055');
  // The provider's «Arrived» only says that it landed, as on the board; a runway time says so whatever the word.
  expect(arrived).toHaveTextContent('Aterrizó · HI1055');
  expect(landed).toHaveTextContent('· aterrizó 10:01');
  expect(landed).toHaveTextContent('Aterrizó · HI1055');
  // A word the board does not know is «Sin estado», never the word itself.
  expect(odd).toHaveTextContent('Sin estado · HI1055');
  expect(screen.getByRole('dialog')).not.toHaveTextContent(/Expected|Approaching|Arrived|Holding/);

  fireEvent.click(screen.getByRole('button', { name: 'Descartadas' }));
  const dismissed = await screen.findByRole('list', { name: 'Llegadas descartadas' });
  const [gone, late] = within(dismissed).getAllByRole('listitem');
  expect(gone).toHaveTextContent('En aproximación · HI1055');
  // «Delayed» is scheduled, as on the board: the revised time says how late it comes.
  expect(late).toHaveTextContent('10:05 → 11:00');
  expect(late).toHaveTextContent('Programado · Airbus A320 · Terminal B');
  expect(screen.getByRole('dialog')).not.toHaveTextContent(/Approaching|Delayed/);
});

it('names the runway time «aterrizó» on an arrival and «despegó» on a departure, never «real» (N23)', async () => {
  getManualTurnaroundOptions.mockResolvedValue(options);
  // Punta Cana is UTC−4: ZZ161 touched down at 10:01; ZZ900 took off at 11:12.
  loadOccFlightFeed.mockResolvedValue(feed([leg('arr', 'Arrival', 'ZZ161', { runwayAt: '2026-11-03T14:01:00Z' }),
    leg('gone', 'Departure', 'ZZ900', { runwayAt: '2026-11-03T15:12:00Z' })]));
  render(<ProviderFlightsDialog stationId={stationId} date="2026-11-03" onClose={() => {}} />);

  const arrival = within(await screen.findByRole('list', { name: 'Llegadas propuestas' })).getByRole('listitem');
  expect(arrival).toHaveTextContent('ZZ161 · Demo Airlines · desde SDQ · 10:05 · aterrizó 10:01');
  const departure = within(screen.getByRole('list', { name: 'Salidas sin llegada' })).getByRole('listitem');
  expect(departure).toHaveTextContent('ZZ900 · Demo Airlines · hacia JFK · 10:05 · despegó 11:12');
  expect(screen.getByRole('dialog')).not.toHaveTextContent(/· real /);
});

it('names each aircraft type by its code first and every chosen option whole (N37)', async () => {
  // The seed's type carries «Development» in its model: cut at 14 rem, «Airbus A320 Development · A320» lost its code.
  getManualTurnaroundOptions.mockResolvedValue({ ...options, aircraftTypes: [{ ...a320, model: 'A320 Development' }, b738] });
  loadOccFlightFeed.mockResolvedValue(feed([leg('arr', 'Arrival', 'ZZ161', { suggestedDepartureId: 'dep',
    suggestedAircraftTypeId: 't-a320' }), leg('dep', 'Departure', 'ZZ162')]));
  render(<ProviderFlightsDialog stationId={stationId} date="2026-11-03" onClose={() => {}} />);

  const arrival = within(await screen.findByRole('list', { name: 'Llegadas propuestas' })).getByRole('listitem');
  const type = await within(arrival).findByLabelText('Tipo de avión (sugerido)');
  expect(within(type).getAllByRole('option').map(option => option.textContent))
    .toEqual(['Sin tipo de avión', 'A320 · Airbus A320 Development', 'B738 · Boeing 737-800']);
  // Each field is as wide as its longest option, never wider than its row.
  const fields = within(arrival).getAllByRole('combobox');
  expect(fields).toHaveLength(3);
  for (const select of fields) {
    expect(select).toHaveClass('max-w-full');
    expect(select).not.toHaveClass('max-w-56');
  }
  // Each one names the option it shows, whole, and follows the choice.
  expect(within(arrival).getByLabelText('Sale como')).toHaveAttribute('title', 'ZZ162 · hacia JFK · 10:05');
  expect(type).toHaveAttribute('title', 'A320 · Airbus A320 Development');
  const stand = within(arrival).getByLabelText('Posición');
  expect(stand).toHaveAttribute('title', 'Sin posición (asignar después)');
  fireEvent.change(stand, { target: { value: 's-a01' } });
  expect(stand).toHaveAttribute('title', 'A1 · Terminal A');
  fireEvent.change(type, { target: { value: 't-b738' } });
  expect(type).toHaveAttribute('title', 'B738 · Boeing 737-800');
  fireEvent.change(type, { target: { value: '' } });
  expect(type).toHaveAttribute('title', 'Sin tipo de avión');
});

describe('demo flights (ADR-0041)', () => {
  const terminalA = { id: 'ta', code: 'A', name: 'Terminal A' };
  const stand = (id, code, terminal = terminalA) => ({ id, code, terminal });
  const demoCatalog = { aircraftTypes: [a320, b738],
    stands: [stand('s-a10', 'A10'), stand('s-a05', 'A05'), stand('s-a02', 'A02'), stand('s-an1', 'AN1'),
      stand('s-b20', 'B20', { id: 'tb', code: 'B', name: 'Terminal B' }), stand('s-a01', 'A01')] };
  const demoArrival = (extra = {}) => leg('arr', 'Arrival', 'ZZ9001', { isDemo: true, gate: 'A5', terminal: 'A',
    providerStatus: 'Approaching', aircraftRegistration: 'HIDM01', suggestedDepartureId: 'dep', suggestedAircraftTypeId: 't-a320',
    ...extra });
  const demoDeparture = (extra = {}) => leg('dep', 'Departure', 'ZZ9002', { isDemo: true, gate: 'A5', terminal: 'A',
    aircraftRegistration: 'HIDM01', ...extra });
  const optionTexts = list => within(list).getAllByRole('option').map(option => option.textContent);

  it('marks a demo proposal «Demo» and preselects the stand of its gate', async () => {
    getManualTurnaroundOptions.mockResolvedValue(demoCatalog);
    loadOccFlightFeed.mockResolvedValue(feed([demoArrival(),
      leg('real', 'Arrival', 'ZZ161', { gate: 'A2', suggestedDepartureId: 'rdep' }), demoDeparture(),
      leg('rdep', 'Departure', 'ZZ162'), leg('lone', 'Departure', 'ZZ9004', { isDemo: true })]));
    render(<ProviderFlightsDialog stationId={stationId} date="2026-11-12" onClose={() => {}} />);

    const arrivals = await screen.findByRole('list', { name: 'Llegadas propuestas' });
    const [demo, real] = within(arrivals).getAllByRole('listitem');
    expect(within(demo).getByText('Demo')).toBeInTheDocument();
    expect(within(real).queryByText('Demo')).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Salidas sin llegada' })).getByText('Demo')).toBeInTheDocument();
    // «A5» is the stand A05 of the station (ADR-0041): one rule compares the codes.
    expect(await within(demo).findByLabelText('Posición (sugerida)')).toHaveValue('s-a05');
    // A real flight's gate suggests nothing: OCC chooses.
    expect(within(real).getByLabelText('Posición')).toHaveValue('');

    // «Sin posición» chosen by hand is kept.
    fireEvent.change(within(demo).getByLabelText('Posición (sugerida)'), { target: { value: '' } });
    expect(within(demo).getByLabelText('Posición')).toHaveValue('');
    fireEvent.change(within(demo).getByLabelText('Tipo de avión (sugerido)'), { target: { value: 't-b738' } });
    expect(within(demo).getByLabelText('Posición')).toHaveValue('');
  });

  it('lists the stands in natural order (A1, A2, A10)', async () => {
    getManualTurnaroundOptions.mockResolvedValue(demoCatalog);
    loadOccFlightFeed.mockResolvedValue(feed([leg('arr', 'Arrival', 'ZZ161', { suggestedDepartureId: 'dep' }),
      leg('dep', 'Departure', 'ZZ162')]));
    render(<ProviderFlightsDialog stationId={stationId} date="2026-11-12" onClose={() => {}} />);

    const select = await within(await screen.findByRole('list', { name: 'Llegadas propuestas' })).findByLabelText('Posición');
    // Each stand by the code the map draws (N27): the station's A01, A02 and A05 are A1, A2 and A5.
    expect(optionTexts(select)).toEqual(['Sin posición (asignar después)', 'A1 · Terminal A', 'A2 · Terminal A',
      'A5 · Terminal A', 'A10 · Terminal A', 'AN1 · Terminal A', 'B20 · Terminal B']);
  });

  it('names the gate by the code the map draws, as the stand it preselects (N27)', async () => {
    getManualTurnaroundOptions.mockResolvedValue(demoCatalog);
    // The server writes the chosen stand's code, as the station stores it, in the gate of a demo flight (ADR-0041).
    loadOccFlightFeed.mockResolvedValue(feed([demoArrival({ gate: 'A05' }), demoDeparture({ gate: 'A05' }),
      leg('real', 'Arrival', 'ZZ161', { gate: 'E2E-XXXX-1', suggestedDepartureId: 'rdep' }), leg('rdep', 'Departure', 'ZZ162')]));
    render(<ProviderFlightsDialog stationId={stationId} date="2026-11-12" onClose={() => {}} />);

    const [demo, real] = within(await screen.findByRole('list', { name: 'Llegadas propuestas' })).getAllByRole('listitem');
    const select = await within(demo).findByLabelText('Posición (sugerida)');
    expect(demo).toHaveTextContent('En aproximación · HIDM01 · Airbus A320 · Terminal A · Puerta A5');
    expect(select).toHaveValue('s-a05');
    expect(select).toHaveDisplayValue('A5 · Terminal A');
    expect(demo).not.toHaveTextContent('A05');
    // A code that is not capitals, a number and capitals is shown as the provider wrote it.
    expect(real).toHaveTextContent('Terminal B · Puerta E2E-XXXX-1');
  });

  it('re-reads when the planning revision changes and keeps what the user chose', async () => {
    getManualTurnaroundOptions.mockResolvedValue(demoCatalog);
    loadOccFlightFeed.mockResolvedValueOnce(feed([demoArrival(), demoDeparture(), leg('other', 'Departure', 'ZZ9006')]));
    const view = render(<ProviderFlightsDialog stationId={stationId} date="2026-11-12" onClose={() => {}} revision={0} />);
    const arrivals = await screen.findByRole('list', { name: 'Llegadas propuestas' });
    await within(arrivals).findByLabelText('Posición (sugerida)');
    fireEvent.change(within(arrivals).getByLabelText('Sale como'), { target: { value: 'other' } });
    fireEvent.change(within(arrivals).getByLabelText('Tipo de avión (sugerido)'), { target: { value: 't-b738' } });
    fireEvent.change(within(arrivals).getByLabelText('Posición (sugerida)'), { target: { value: 's-b20' } });

    // The worker or OCC changed the planning: the list is read again while the old one stays on screen.
    let answer;
    loadOccFlightFeed.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    view.rerender(<ProviderFlightsDialog stationId={stationId} date="2026-11-12" onClose={() => {}} revision={1} />);
    await waitFor(() => expect(loadOccFlightFeed).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Cargando vuelos propuestos…')).not.toBeInTheDocument();
    expect(within(arrivals).getByLabelText('Posición')).toHaveValue('s-b20');
    await act(async () => answer(feed([demoArrival({ version: 'v-arr-2', providerStatus: 'Arrived' }), demoDeparture(),
      leg('other', 'Departure', 'ZZ9006')])));
    // The provider's «Arrived» in the board's words (N22): it landed.
    expect(await screen.findByText(/^Aterrizó · HIDM01/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/Approaching|Arrived|Expected/);
    const refreshed = screen.getByRole('list', { name: 'Llegadas propuestas' });
    expect(within(refreshed).getByLabelText('Sale como')).toHaveValue('other');
    expect(within(refreshed).getByLabelText('Tipo de avión')).toHaveValue('t-b738');
    expect(within(refreshed).getByLabelText('Posición')).toHaveValue('s-b20');

    // A re-read that fails keeps the list and the choices, and says so; the next one clears the notice.
    loadOccFlightFeed.mockRejectedValueOnce(Object.assign(new Error('Internal'), { status: 503 }));
    view.rerender(<ProviderFlightsDialog stationId={stationId} date="2026-11-12" onClose={() => {}} revision={2} />);
    expect(await screen.findByText('No se pudo actualizar la lista: se muestra la última lectura.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Llegadas propuestas' })).getByLabelText('Posición')).toHaveValue('s-b20');
    loadOccFlightFeed.mockResolvedValueOnce(feed([demoArrival({ version: 'v-arr-3' }), demoDeparture(),
      leg('other', 'Departure', 'ZZ9006')]));
    view.rerender(<ProviderFlightsDialog stationId={stationId} date="2026-11-12" onClose={() => {}} revision={3} />);
    await waitFor(() => expect(screen.queryByText(/se muestra la última lectura/)).not.toBeInTheDocument());
    expect(loadOccFlightFeed).toHaveBeenCalledTimes(4);
  });

  it('imports a demo arrival with the version it read and the preselected stand', async () => {
    getManualTurnaroundOptions.mockResolvedValue(demoCatalog);
    loadOccFlightFeed.mockResolvedValueOnce(feed([demoArrival(), demoDeparture()]))
      .mockResolvedValue(feed([demoArrival({ version: 'v-arr-2', providerStatus: 'Arrived', runwayAt: '2026-11-12T14:06:00Z' }),
        demoDeparture({ version: 'v-dep-2' })]));
    importOccFlightProposals.mockResolvedValue({ turnaroundId: 't1', operationCode: 'PUJ-20261112-003', replayed: false });
    const onImported = vi.fn();
    const view = render(<ProviderFlightsDialog stationId={stationId} date="2026-11-12" onClose={() => {}} onImported={onImported}
      revision={4} />);
    await within(await screen.findByRole('list', { name: 'Llegadas propuestas' })).findByLabelText('Posición (sugerida)');

    // The aircraft landed meanwhile: the planning changed and the dialog read the new versions before the import.
    view.rerender(<ProviderFlightsDialog stationId={stationId} date="2026-11-12" onClose={() => {}} onImported={onImported}
      revision={5} />);
    expect(await screen.findByText(/· aterrizó \d/)).toBeInTheDocument();
    const arrivals = screen.getByRole('list', { name: 'Llegadas propuestas' });
    fireEvent.click(within(arrivals).getByRole('button', { name: 'Importar escala' }));
    expect(await screen.findByText('Escala importada (PUJ-20261112-003).')).toBeInTheDocument();
    expect(importOccFlightProposals).toHaveBeenCalledWith({ arrivalProposalId: 'arr', departureProposalId: 'dep',
      expectedArrivalVersion: 'v-arr-2', expectedDepartureVersion: 'v-dep-2', aircraftTypeId: 't-a320', standId: 's-a05',
      charter: false }, expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(onImported).toHaveBeenCalled();
  });
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

it('calls preventDefault when Escape closes the dialog', async () => {
  getManualTurnaroundOptions.mockResolvedValue(options);
  loadOccFlightFeed.mockResolvedValue(feed([]));
  const onClose = vi.fn();
  render(<ProviderFlightsDialog stationId={stationId} date="2026-11-03" onClose={onClose} />);
  expect(await screen.findByText(/No hay vuelos propuestos para esta fecha/)).toBeInTheDocument();

  const press = key => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    screen.getByRole('dialog').dispatchEvent(event);
    return event;
  };
  expect(press('Enter').defaultPrevented).toBe(false);
  expect(onClose).not.toHaveBeenCalled();
  // Escape closes the dialog and is marked as used, so the map keys under it leave the selection alone.
  expect(press('Escape').defaultPrevented).toBe(true);
  expect(onClose).toHaveBeenCalledOnce();
});
