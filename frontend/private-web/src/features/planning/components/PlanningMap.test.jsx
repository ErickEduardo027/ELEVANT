import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PlanningMap from './PlanningMap';
import { boardStand, boardVisit, standPoint } from '../../maps/testing/mapFixtures';
import { createMapFlights, TRAFFIC_FLIGHT_KEY, TRAFFIC_HEX, TRAFFIC_NOON } from '../../maps/testing/trafficFixtures';
import { administratorAccess, DepartmentAccessProvider } from '../../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../../access/testAccess';
import { OccShellTestProvider } from '../../admin-occ/shell/testing/occShellFixtures';
import { loadOccPositions } from '../../../services/occPositionsService';
import { weatherService } from '../../../services/weatherService';

vi.mock('next/dynamic', () => ({ default: () => function MapStub({ positions, selectedPositionId, onSelectPosition, weather, traffic, trafficSelection, children }) {
  return <div data-testid="map" data-selected={selectedPositionId ?? ''} data-weather={weather?.apiStatus ?? ''}
    data-traffic={traffic ? traffic.aircraft.map(item => item.id).join(' ') : ''}
    data-traffic-selection={trafficSelection ? `${trafficSelection.kind}:${trafficSelection.id}` : ''}>
    {positions.map(position => <button key={position.id} type="button"
      data-state={position.displayStatus} onClick={() => onSelectPosition(position.id)}>{`pin ${position.id}`}</button>)}
    {children}
  </div>;
} }));
vi.mock('../../../services/occPositionsService', () => ({ loadOccPositions: vi.fn() }));
// Inside the OCC frame (PR M6) the map reads the station of the session and the map service: both synthetic here, the
// station of the traffic fixtures and the simulated adapter over their scenario, without the network. The map also
// reads the aerodrome weather of its station (PR M8), from the simulated weather service.
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ session: { stationScopes: [{ stationId: '5a000000-0000-4000-8000-000000000001', stationCode: 'PUJ' }] } }),
}));
vi.mock('../../../services/occMapService', async () => {
  const actual = await vi.importActual('../../../services/occMapService');
  const { createTrafficScenario } = await import('../../maps/testing/trafficFixtures');
  return { ...actual, occMapService: actual.createSimulatedOccMapAdapter({ scenario: createTrafficScenario() }) };
});
vi.mock('../../../services/weatherService', async () => {
  const actual = await vi.importActual('../../../services/weatherService');
  const { createWeatherScenario } = await import('../../maps/testing/weatherFixtures');
  return { ...actual, weatherService: actual.createSimulatedWeatherAdapter({ scenario: createWeatherScenario() }) };
});

const stationId = '20000000-0000-7000-8000-000000000003';
const PAGE = '/admin-occ/planning?stationId=s-1';
const parked = { turnaroundId: 't1', operationCode: 'OP-1', airlineName: 'Arajet', aircraftRegistration: null,
  arrivalFlightNumber: 'DM161', departureFlightNumber: 'DM162', arrivalScheduledAt: '2026-11-03T14:00:00Z', arrivedAt: null,
  departureScheduledAt: '2026-11-03T15:00:00Z', assignedFrom: '2026-11-03T13:30:00Z', status: 'Planned' };
const waiting = { ...parked, turnaroundId: 't2', operationCode: 'OP-2', arrivalFlightNumber: 'DM300' };
const board = { stationId, stationCode: 'PUJ', operationDate: '2026-11-03', asOf: '2026-11-03T12:00:00Z', canAssign: true,
  positions: [{ standId: 's1', code: 'A01', terminalCode: 'A', standType: 'Contact', status: 'planned', turnarounds: [parked],
    latitude: standPoint('A1')[1], longitude: standPoint('A1')[0], coveredBy: ['Ana Ruiz'] }],
  unassigned: [waiting] };
const query = () => new URLSearchParams(window.location.search);

beforeEach(() => { window.history.replaceState({}, '', PAGE); });
afterEach(() => { cleanup(); vi.clearAllMocks(); window.history.replaceState({}, '', '/'); });

it('shows the stands with flights and opens a flight in planning', async () => {
  loadOccPositions.mockResolvedValue(board);
  const onSelectFlight = vi.fn();
  render(<PlanningMap stationId={stationId} date="2026-11-03" flights={[{ id: 't1' }, { id: 't2' }]} onSelectFlight={onSelectFlight} />);
  expect(await screen.findByText(/1 de \d+ posiciones ubicadas por OCC/)).toBeInTheDocument();
  expect(loadOccPositions).toHaveBeenCalledWith(stationId, '2026-11-03', expect.anything());
  expect(screen.getByText('Posiciones con vuelos (1)')).toBeInTheDocument();
  expect(screen.getByText('Vuelos sin posición (1)')).toBeInTheDocument();

  // The map draws each stand as it reads now: A1's flight is past its arrival time and has not arrived.
  expect(screen.getByRole('button', { name: 'pin A1' })).toHaveAttribute('data-state', 'arriving');
  expect(screen.getByRole('button', { name: 'pin A2' })).toHaveAttribute('data-state', 'unverified');
  fireEvent.click(screen.getByRole('button', { name: 'pin A1' }));
  expect(screen.getByText('Posición A1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /DM161/ }));
  expect(onSelectFlight).toHaveBeenCalledWith('t1');
  fireEvent.click(screen.getByRole('button', { name: /DM300/ }));
  expect(onSelectFlight).toHaveBeenLastCalledWith('t2');
});

it('writes the flights’ times on 24 hours in the station zone (N28)', async () => {
  // Punta Cana is UTC−4: 14:00Z is 10:00 there and 23:53Z, 19:53 (never «7:53 p. m.»).
  loadOccPositions.mockResolvedValue({ ...board, unassigned: [{ ...waiting, arrivalScheduledAt: '2026-11-03T23:53:00Z' }] });
  render(<PlanningMap stationId={stationId} date="2026-11-03" flights={[{ id: 't1' }, { id: 't2' }]} />);
  expect(await screen.findByRole('button', { name: 'DM300 · Arajet · 19:53' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'pin A1' }));
  expect(screen.getByRole('button', { name: 'DM161 · Arajet · 10:00' })).toBeInTheDocument();
});

it('a stand click writes stand= and shows its flights', async () => {
  loadOccPositions.mockResolvedValue(board);
  render(<PlanningMap stationId={stationId} date="2026-11-03" flights={[{ id: 't1' }, { id: 't2' }]} />);
  fireEvent.click(await screen.findByRole('button', { name: 'pin A1' }));
  // The selection is the URL's, as on the positions map; the other keys stay.
  expect(query().get('stand')).toBe('A1');
  expect(query().get('stationId')).toBe('s-1');
  expect(screen.getByTestId('map')).toHaveAttribute('data-selected', 'A1');
  // The panel says what the stand says on the map, then its flights.
  const facts = screen.getByRole('list', { name: 'Estado en el mapa' });
  const items = within(facts).getAllByRole('listitem').map(item => item.textContent);
  expect(items[0]).toBe('Llegando');
  expect(items[1]).toMatch(/^Llegando: /);
  expect(items.at(-1)).toBe('Cubre Ana Ruiz');
  const characteristics = screen.getByRole('region', { name: 'Características' });
  expect(characteristics.querySelector('[data-fact="kind"] dd')).toHaveTextContent('Terminal A · De contacto');
  expect(characteristics.querySelector('[data-fact="location"] dd')).toHaveTextContent('Ubicada por OCC');
  expect(screen.getByRole('button', { name: /DM161/ })).toBeInTheDocument();
  // «Ver todas» clears the selection.
  fireEvent.click(screen.getByRole('button', { name: 'Ver todas' }));
  expect(query().has('stand')).toBe(false);
  expect(screen.getByText('Posiciones con vuelos (1)')).toBeInTheDocument();
  cleanup();

  // A link with stand= opens on that stand.
  window.history.replaceState({}, '', `${PAGE}&stand=A01`);
  render(<PlanningMap stationId={stationId} date="2026-11-03" flights={[{ id: 't1' }]} />);
  expect(await screen.findByText('Posición A1')).toBeInTheDocument();
});

it('reads the aerodrome weather of its station and gives it to the map (PR M8)', async () => {
  loadOccPositions.mockResolvedValue(board);
  render(<PlanningMap stationId={stationId} date="2026-11-03" flights={[{ id: 't1' }]} />);
  // The synthetic live METAR of the station reaches the map, which draws its wind at the airfield.
  await waitFor(() => expect(screen.getByTestId('map')).toHaveAttribute('data-weather', 'Live'));
  expect(weatherService.calls.at(-1)).toMatchObject({ read: 'aerodromeWeather', stationId });
  cleanup();
  // Without a station nothing is read.
  const reads = weatherService.calls.length;
  render(<PlanningMap stationId="" date="2026-11-03" />);
  await act(async () => {});
  expect(weatherService.calls).toHaveLength(reads);
});

it('reports a board error', async () => {
  loadOccPositions.mockRejectedValue(new Error('Tu acceso no permite registrar llegadas ni asignar posiciones.'));
  render(<PlanningMap stationId={stationId} date="2026-11-03" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Tu acceso no permite');
});

// Inside the OCC frame (PR M6): the stands read the map flights and the aircraft of the station and the map draws the
// traffic. Synthetic board of the traffic fixtures' noon: ZZ161 on A5, which the board says arrived (the feed's runway
// time) while its aircraft is still on final, and ZZ300 on A2, due 30 minutes ago and with its BLOCK_ON recorded.
describe('PlanningMap inside the OCC frame (PR M6)', () => {
  const ACCESS = administratorAccess('operations', DepartmentPermissionCodes.operations);
  const NOON = Date.parse(TRAFFIC_NOON);
  const rowOf = key => createMapFlights().flights.find(row => row.flightKey === key);
  const liveBoard = {
    ...board,
    operationDate: '2026-11-13',
    asOf: TRAFFIC_NOON,
    positions: [
      boardStand('A05', { coveredBy: ['Ana Ruiz'], turnarounds: [boardVisit({ nowMs: NOON, flight: 'ZZ161', arrivalInMin: 10,
        turnaroundId: rowOf(TRAFFIC_FLIGHT_KEY.arrival).turnaroundId, arrivedAt: new Date(NOON - 60_000).toISOString() })] }),
      boardStand('A02', { coveredBy: ['Ana Ruiz'], turnarounds: [boardVisit({ nowMs: NOON, flight: 'ZZ300', arrivalInMin: -30,
        departureInMin: 40, turnaroundId: rowOf(TRAFFIC_FLIGHT_KEY.parkedArrival).turnaroundId })] }),
    ],
    unassigned: [],
  };
  const flush = () => act(async () => {
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(0);
  });
  const pin = code => screen.getByRole('button', { name: `pin ${code}` });
  const framed = () => (
    <DepartmentAccessProvider initialAccess={ACCESS} load={vi.fn().mockResolvedValue(ACCESS)} observe={false}>
      <OccShellTestProvider>
        <PlanningMap stationId={stationId} date="2026-11-13" flights={[{ id: 't1' }]} />
      </OccShellTestProvider>
    </DepartmentAccessProvider>
  );

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOON);
    loadOccPositions.mockResolvedValue(liveBoard);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('without the frame the map gets no traffic and the stands read the board alone, as before', async () => {
    render(<PlanningMap stationId={stationId} date="2026-11-13" flights={[{ id: 't1' }]} />);
    await flush();
    expect(screen.getByTestId('map')).toHaveAttribute('data-traffic', '');
    expect(pin('A5')).toHaveAttribute('data-state', 'occupied');
    expect(pin('A2')).toHaveAttribute('data-state', 'arriving');
  });

  it('with the frame draws the traffic, and the stands and the panel read «Llegando» and «Ocupada» from the flights', async () => {
    render(framed());
    // The map view's own loading state while the live chunk loads.
    expect(screen.getByRole('status')).toHaveTextContent('Cargando');
    await flush();
    await flush();
    expect(screen.getByTestId('map').dataset.traffic.split(' ')).toEqual(expect.arrayContaining([
      `f:${TRAFFIC_FLIGHT_KEY.arrival}`, `h:${TRAFFIC_HEX.overflight}`,
    ]));
    expect(pin('A5')).toHaveAttribute('data-state', 'arriving');
    expect(pin('A2')).toHaveAttribute('data-state', 'occupied');
    fireEvent.click(pin('A2'));
    expect(within(screen.getByRole('list', { name: 'Estado en el mapa' })).getAllByRole('listitem')[0]).toHaveTextContent('Ocupada');
  });

  it('a flight or an aircraft of the URL is the map\'s selection, with its data block on the map', async () => {
    window.history.replaceState({}, '', `${PAGE}&hex=${TRAFFIC_HEX.overflight}`);
    render(framed());
    await flush();
    await flush();
    expect(screen.getByTestId('map')).toHaveAttribute('data-traffic-selection', `aircraft:${TRAFFIC_HEX.overflight}`);
    const block = within(screen.getByTestId('map')).getByRole('dialog', { name: 'Vuelo ZZZ804' });
    expect(block).toHaveStyle({ top: '12px', left: '12px' });
    expect(within(block).getByText('Otro tráfico')).toBeInTheDocument();
    // A stand chosen on the map replaces it: one selection at a time.
    fireEvent.click(pin('A2'));
    expect(query().get('stand')).toBe('A2');
    expect(query().has('hex')).toBe(false);
    expect(screen.getByTestId('map')).toHaveAttribute('data-traffic-selection', '');
  });
});
