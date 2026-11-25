import { forwardRef, useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ElevantApiError } from '@elevant/api-client';
import PositionsMapPage from './PositionsMapPage';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import { destinationPoint } from '../maps/airport/geo';
import { WEATHER_STATION_ID } from '../maps/testing/weatherFixtures';
import { boardStand, boardVisit, standPoint } from '../maps/testing/mapFixtures';
import { administratorAccess, DepartmentAccessProvider } from '../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../access/testAccess';
import { OccShellTestProvider } from '../admin-occ/shell/testing/occShellFixtures';
import { STAND_REFERENCE } from '../maps/stands/standReference';
import { createMapFlights, TRAFFIC_FLIGHT_KEY, TRAFFIC_HEX, TRAFFIC_NOON } from '../maps/testing/trafficFixtures';
import { mapOccupancyToRampPositions } from './positionsMapMappers';

// The map is a stub that shows what the page gives it and clicks where a test says (`map.next`); the API client is a
// stub too, so the real positions service translates its errors.
const map = vi.hoisted(() => ({ next: null }));
const api = vi.hoisted(() => ({ locateOccStand: null }));
vi.mock('../../config/elevantApiClient', async importOriginal => ({
  ...(await importOriginal()), createPrivateWebApiClient: () => api,
}));
// Inside the OCC frame (PR M6) the page reads the station of the session and the map service: both synthetic here, the
// station of the traffic fixtures and the simulated adapter over their scenario, without the network. The page also
// reads the aerodrome weather of that station (PR M8), from the synthetic weather service; a test may take the PUJ
// scope away (`auth.session`), and then nothing is read.
const PUJ_SESSION = Object.freeze({ stationScopes: [{ stationId: '5a000000-0000-4000-8000-000000000001', stationCode: 'PUJ' }] });
const auth = vi.hoisted(() => ({ session: null }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ session: auth.session }) }));
vi.mock('../../services/occMapService', async () => {
  const actual = await vi.importActual('../../services/occMapService');
  const { createTrafficScenario } = await import('../maps/testing/trafficFixtures');
  return { ...actual, occMapService: actual.createSimulatedOccMapAdapter({ scenario: createTrafficScenario() }) };
});

vi.mock('../../services/weatherService', async () => {
  const actual = await vi.importActual('../../services/weatherService');
  const { createWeatherScenario } = await import('../maps/testing/weatherFixtures');
  return { ...actual, weatherService: actual.createSimulatedWeatherAdapter({ scenario: createWeatherScenario() }) };
});

beforeEach(() => {
  auth.session = PUJ_SESSION;
});

vi.mock('./components/PositionMap', () => ({
  default: forwardRef(function PositionMapStub(props, ref) {
    useImperativeHandle(ref, () => ({
      flyToPosition: vi.fn(),
      flyToBounds: vi.fn(),
      flyToAll: vi.fn(),
      flyToPuj: vi.fn(),
      resetNorth: vi.fn(),
    }));
    const pending = props.pendingLocation;
    // What the page gives its map: the stands as they read now (`data-state`) and, inside the OCC frame, the traffic it
    // draws, the chosen flight or aircraft and the overlays it holds.
    return (
      <div data-testid="position-map-stub" data-placing={props.placingCode ?? ''} data-selected={props.selectedPositionId ?? ''}
        data-pending={pending ? `${pending.latitude},${pending.longitude}` : ''} data-weather={props.weather?.apiStatus ?? ''}
        data-weather-status={props.weather?.status ?? ''}
        data-traffic={props.traffic ? props.traffic.aircraft.map(item => item.id).join(' ') : ''}
        data-traffic-selection={props.trafficSelection ? `${props.trafficSelection.kind}:${props.trafficSelection.id}` : ''}>
        {props.onMapClick && <button type="button" onClick={() => props.onMapClick(map.next)}>Clic en el mapa</button>}
        {props.positions.map(item => <span key={item.id} data-stand={item.id} data-state={item.displayStatus} />)}
        {/* The page's own map tools go in the map's control rail (CN-32). */}
        <div data-testid="position-map-rail">{props.railTools}</div>
        {props.children}
      </div>
    );
  }),
}));

function position(overrides) {
  return {
    id: 'A1',
    terminal: 'A',
    latitude: 18.56,
    longitude: -68.36,
    status: 'available',
    flightId: null,
    flightNumber: null,
    airline: null,
    aircraftRegistration: null,
    aircraftType: null,
    assignedAgent: null,
    estimatedReleaseTime: null,
    updatedAt: '2026-08-06T10:00:00-04:00',
    combinedConfiguration: null,
    linkedPositionId: null,
    ...overrides,
  };
}

const POSITIONS = [
  position({ id: 'A1', terminal: 'A' }),
  position({
    id: 'A5',
    terminal: 'A',
    status: 'occupied',
    flightId: 6,
    flightNumber: 'AC1876',
    airline: 'Air Canada',
    aircraftRegistration: 'C-1876AC',
    aircraftType: 'A320',
    assignedAgent: 'J. Ramírez',
  }),
  position({ id: 'A10', terminal: 'A', status: 'disabled', combinedConfiguration: '9-Alfa', linkedPositionId: 'A9' }),
];

const SNAPSHOT = { station: { code: 'PUJ' }, positions: POSITIONS };
const PAGE = '/admin-occ/positions-map?stationId=s-1';

// A positions board the page can act on: OCC may assign, A1 and A5 have a stand row, and C7 is a stand of the board no
// map position shows. Synthetic: invented ids and an operation date.
const OPERATION_DATE = '2026-11-13';
const BOARD_SNAPSHOT = {
  station: { code: 'PUJ' },
  source: 'occupancy',
  operationDate: OPERATION_DATE,
  canAssign: true,
  unassigned: [],
  asOf: '2026-11-13T15:00:00Z',
  stands: [boardStand('A01'), boardStand('A05'), boardStand('C07', { terminalCode: 'B', maxAircraftSize: 'Narrowbody' })],
  positions: [
    position({ id: 'A1', standId: 'stand-A1', locationSource: 'reference', coveredBy: [] }),
    position({ id: 'A5', standId: 'stand-A5', locationSource: 'reference', coveredBy: [] }),
  ],
};
// Where a test clicks on the map: 20 m east of A1's reference point, with more decimals than the API keeps.
const CLICK = destinationPoint(standPoint('A1'), 90, 20);
const sixDecimals = value => Number(value.toFixed(6));
const query = () => new URLSearchParams(window.location.search);

beforeEach(() => {
  window.history.replaceState({}, '', PAGE);
  map.next = { latitude: CLICK[1], longitude: CLICK[0], snapped: false };
  api.locateOccStand = vi.fn();
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
  auth.session = null;
});

// Opens the list (unless it is open), the drawer of `code` and «Ubicar en el mapa».
async function startPlacing(user, code) {
  if (!screen.queryByTestId('positions-side-panel')) await user.click(screen.getByRole('button', { name: /lista de posiciones/i }));
  await user.click(within(screen.getByTestId('positions-side-panel')).getByText(code));
  await user.click(within(screen.getByTestId('position-detail-drawer')).getByRole('button', { name: 'Ubicar en el mapa' }));
}

const placingNotice = code => screen.getByRole('group', { name: `Ubicar ${code} en el mapa` });

describe('PositionsMapPage', () => {
  it('shows the skeleton while loading', () => {
    render(<PositionsMapPage status="loading" data={null} error={null} connection="syncing" onRetry={() => {}} />);
    expect(screen.getByTestId('positions-map-skeleton')).toBeInTheDocument();
  });

  it('shows a recoverable error state with a retry action', async () => {
    const onRetry = vi.fn();
    render(<PositionsMapPage status="error" data={null} error={new Error('network down')} connection="disconnected" onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('network down')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('reads the aerodrome weather of the OCC station and gives it to its map (PR M8)', async () => {
    // Without the PUJ scope there is no station: nothing read, the map gets a weather still loading.
    auth.session = null;
    const first = render(<PositionsMapPage status="success" data={SNAPSHOT} error={null} connection="connected" onRetry={() => {}} />);
    expect(screen.getByTestId('position-map-stub')).toHaveAttribute('data-weather-status', 'loading');
    expect(screen.getByTestId('position-map-stub')).toHaveAttribute('data-weather', '');
    first.unmount();
    // With it, the synthetic live METAR reaches the map, which draws its wind at the airfield.
    auth.session = { stationScopes: [{ stationId: WEATHER_STATION_ID, stationCode: 'PUJ' }] };
    render(<PositionsMapPage status="success" data={SNAPSHOT} error={null} connection="connected" onRetry={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('position-map-stub')).toHaveAttribute('data-weather', 'Live'));
    expect(screen.getByTestId('position-map-stub')).toHaveAttribute('data-weather-status', 'success');
  });

  it('renders the toolbar title/subtitle and the map', () => {
    render(<PositionsMapPage status="success" data={SNAPSHOT} error={null} connection="connected" onRetry={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Mapa de posiciones' })).toBeInTheDocument();
    expect(screen.getByText('PUJ · Aeropuerto Internacional de Punta Cana')).toBeInTheDocument();
    expect(screen.getByTestId('position-map-stub')).toBeInTheDocument();
  });

  it('shows a real planned-stand list for another station without drawing PUJ', () => {
    render(<PositionsMapPage status="success" data={{
      station: { code: 'SDQ', name: 'Santo Domingo' }, source: 'planning-no-map',
      positions: [{ id: 'G1', terminal: 'T1', status: 'planned',
        latitude: null, longitude: null, plannedFlights: ['EV311'] }],
    }} error={null} connection="connected" onRetry={() => {}} />);
    expect(screen.getByText(/SDQ/)).toBeInTheDocument();
    expect(screen.getByText('G1')).toBeInTheDocument();
    expect(screen.getByText(/Vuelos planificados: EV311/)).toBeInTheDocument();
    expect(screen.queryByTestId('position-map-stub')).not.toBeInTheDocument();
    expect(screen.queryByText(/Aeropuerto Internacional de Punta Cana/)).not.toBeInTheDocument();
  });

  it('shows "No se encontró la posición." when a search does not match any position', async () => {
    render(<PositionsMapPage status="success" data={SNAPSHOT} error={null} connection="connected" onRetry={() => {}} />);
    const input = screen.getByPlaceholderText('Buscar posición, vuelo o matrícula...');
    await userEvent.type(input, 'ZZZ99{enter}');
    expect(screen.getByText('No se encontró la posición.')).toBeInTheDocument();
  });

  it('opens the side panel via the toolbar button and shows every position', async () => {
    render(<PositionsMapPage status="success" data={SNAPSHOT} error={null} connection="connected" onRetry={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /lista de posiciones/i }));

    const panel = screen.getByTestId('positions-side-panel');
    expect(within(panel).getAllByTestId('position-list-item')).toHaveLength(3);
  });

  it('selecting a position from the side panel opens its detail drawer with the combined-configuration banner when disabled', async () => {
    render(<PositionsMapPage status="success" data={SNAPSHOT} error={null} connection="connected" onRetry={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /lista de posiciones/i }));
    await userEvent.click(within(screen.getByTestId('positions-side-panel')).getByText('A10'));

    const drawer = screen.getByTestId('position-detail-drawer');
    expect(within(drawer).getByTestId('combined-position-banner')).toBeInTheDocument();
    expect(within(drawer).getByText('Configuración 9-Alfa activa.')).toBeInTheDocument();
    expect(within(drawer).getByText('Esta configuración utiliza A9 y bloquea temporalmente A10.')).toBeInTheDocument();
  });

  it('shows flight fields and navigates to Flight Monitoring for an occupied position', async () => {
    const onNavigateToResource = vi.fn();
    render(
      <PositionsMapPage
        status="success"
        data={SNAPSHOT}
        error={null}
        connection="connected"
        onRetry={() => {}}
        onNavigateToResource={onNavigateToResource}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /lista de posiciones/i }));
    await userEvent.click(within(screen.getByTestId('positions-side-panel')).getByText('A5'));

    const drawer = screen.getByTestId('position-detail-drawer');
    expect(within(drawer).getByText('AC1876')).toBeInTheDocument();
    expect(within(drawer).getByText('Air Canada')).toBeInTheDocument();

    await userEvent.click(within(drawer).getByRole('button', { name: /ver vuelo en monitoreo/i }));
    expect(onNavigateToResource).toHaveBeenCalledWith('flight-monitoring', 6);
  });

  it('shows the "sin vuelo asignado" message for a position with no flight', async () => {
    render(<PositionsMapPage status="success" data={SNAPSHOT} error={null} connection="connected" onRetry={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /lista de posiciones/i }));
    await userEvent.click(within(screen.getByTestId('positions-side-panel')).getByText('A1'));

    expect(within(screen.getByTestId('position-detail-drawer')).getByText('Sin vuelo asignado')).toBeInTheDocument();
  });

  it('shows a disconnected banner when forced disconnected', () => {
    render(
      <PositionsMapPage
        status="success"
        data={SNAPSHOT}
        error={null}
        connection="connected"
        onRetry={() => {}}
        forceState="positionsMapDisconnected"
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent(/datos desactualizados/i);
  });

  it('shows the empty state when forced empty', () => {
    render(
      <PositionsMapPage
        status="success"
        data={SNAPSHOT}
        error={null}
        connection="connected"
        onRetry={() => {}}
        forceState="positionsMapEmpty"
      />
    );
    // Summary panel still renders with all-zero totals; the side panel empty state only shows once opened.
    expect(screen.getByTestId('position-map-stub')).toBeInTheDocument();
  });

  it('a list click writes stand= and opens the drawer; Esc closes only the drawer', async () => {
    const user = userEvent.setup();
    render(<PositionsMapPage status="success" data={SNAPSHOT} error={null} connection="connected" onRetry={() => {}} />);
    await user.click(screen.getByRole('button', { name: /lista de posiciones/i }));
    await user.click(within(screen.getByTestId('positions-side-panel')).getByText('A5'));
    // The selection is in the URL, next to every other key; the map and the list mark it.
    expect(query().get('stand')).toBe('A5');
    expect(query().get('stationId')).toBe('s-1');
    expect(screen.getByTestId('position-map-stub')).toHaveAttribute('data-selected', 'A5');
    const drawer = screen.getByTestId('position-detail-drawer');
    expect(within(drawer).getByRole('list', { name: 'Estado en el mapa' })).toHaveTextContent('Ocupada');

    // Esc closes the drawer and is used up; the stand stays selected for the map's own Esc.
    const escape = createEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent(document.body, escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(screen.queryByTestId('position-detail-drawer')).not.toBeInTheDocument();
    expect(query().get('stand')).toBe('A5');
    expect(screen.getByTestId('position-map-stub')).toHaveAttribute('data-selected', 'A5');
    // A click on the same stand opens its drawer again.
    await user.click(within(screen.getByTestId('positions-side-panel')).getByText('A5'));
    expect(screen.getByTestId('position-detail-drawer')).toBeInTheDocument();
  });

  it('a link with stand= opens that stand\'s drawer', () => {
    window.history.replaceState({}, '', `${PAGE}&stand=a-10`);
    render(<PositionsMapPage status="success" data={SNAPSHOT} error={null} connection="connected" onRetry={() => {}} />);
    expect(within(screen.getByTestId('position-detail-drawer')).getByText('A10')).toBeInTheDocument();
    expect(screen.getByTestId('position-map-stub')).toHaveAttribute('data-selected', 'A10');
  });

  it('a click sets a pending position and nothing is saved until «Guardar ubicación»; «Cancelar» and Esc cancel without a request', async () => {
    const user = userEvent.setup();
    render(<PositionsMapPage status="success" data={BOARD_SNAPSHOT} error={null} connection="connected" onRetry={() => {}} />);
    await startPlacing(user, 'A1');
    // The drawer gives way to the notice over the map, which takes the focus; the stand stays selected.
    expect(screen.queryByTestId('position-detail-drawer')).not.toBeInTheDocument();
    const notice = placingNotice('A1');
    expect(notice).toHaveFocus();
    expect(within(notice).getByRole('status')).toHaveTextContent('Haz clic en el centro de la posición A1.');
    expect(within(notice).getByRole('button', { name: 'Guardar ubicación' })).toBeDisabled();
    const stub = screen.getByTestId('position-map-stub');
    expect(stub).toHaveAttribute('data-placing', 'A1');
    expect(query().get('stand')).toBe('A1');

    // A click on the map sets the pending location; nothing is sent.
    await user.click(screen.getByRole('button', { name: 'Clic en el mapa' }));
    expect(stub).toHaveAttribute('data-pending', `${CLICK[1]},${CLICK[0]}`);
    expect(within(notice).getByRole('button', { name: 'Guardar ubicación' })).toBeEnabled();
    expect(api.locateOccStand).not.toHaveBeenCalled();
    // Another click moves it.
    map.next = { latitude: standPoint('A1')[1], longitude: standPoint('A1')[0], snapped: true };
    await user.click(screen.getByRole('button', { name: 'Clic en el mapa' }));
    expect(stub).toHaveAttribute('data-pending', `${standPoint('A1')[1]},${standPoint('A1')[0]}`);

    // «Cancelar» drops it without a request.
    await user.click(within(notice).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('group', { name: 'Ubicar A1 en el mapa' })).toBeNull();
    expect(stub).toHaveAttribute('data-placing', '');
    expect(stub).toHaveAttribute('data-pending', '');
    expect(screen.queryByRole('button', { name: 'Clic en el mapa' })).toBeNull();

    // So does Esc in the notice, which is used up there.
    await startPlacing(user, 'A1');
    await user.click(screen.getByRole('button', { name: 'Clic en el mapa' }));
    const escape = createEvent.keyDown(placingNotice('A1'), { key: 'Escape' });
    fireEvent(placingNotice('A1'), escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(screen.queryByRole('group', { name: 'Ubicar A1 en el mapa' })).toBeNull();
    expect(api.locateOccStand).not.toHaveBeenCalled();
    expect(query().get('stand')).toBe('A1');
  });

  it('saving shows «Guardando la ubicación de A1…», then «A1 quedó ubicada en el mapa.», and reads the board again', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    let answer;
    api.locateOccStand.mockReturnValueOnce(new Promise(resolve => { answer = resolve; }));
    render(<PositionsMapPage status="success" data={BOARD_SNAPSHOT} error={null} connection="connected" onRetry={onRetry} />);
    await startPlacing(user, 'A1');
    await user.click(screen.getByRole('button', { name: 'Clic en el mapa' }));
    await user.click(within(placingNotice('A1')).getByRole('button', { name: 'Guardar ubicación' }));

    // The same command as always (ADR-0027): the stand, the point to six decimals and the operation date.
    expect(api.locateOccStand).toHaveBeenCalledExactlyOnceWith('stand-A1', {
      latitude: sixDecimals(CLICK[1]), longitude: sixDecimals(CLICK[0]), operationDate: OPERATION_DATE,
    });
    const notice = placingNotice('A1');
    expect(within(notice).getByRole('status')).toHaveTextContent('Guardando la ubicación de A1…');
    expect(within(notice).getByRole('button', { name: 'Guardar ubicación' })).toBeDisabled();
    expect(within(notice).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    // Esc waits for the answer while it is sent.
    fireEvent.keyDown(notice, { key: 'Escape' });
    expect(placingNotice('A1')).toBeInTheDocument();
    expect(onRetry).not.toHaveBeenCalled();

    await act(async () => answer({ positions: [] }));
    expect(screen.queryByRole('group', { name: 'Ubicar A1 en el mapa' })).toBeNull();
    expect(screen.getByText('A1 quedó ubicada en el mapa.')).toHaveAttribute('role', 'status');
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByTestId('position-map-stub')).toHaveAttribute('data-placing', '');
  });

  it('an error shows the service\'s Spanish message, never the server title', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    api.locateOccStand.mockRejectedValueOnce(new ElevantApiError({
      kind: 'http', status: 409, title: 'The stand cannot take this location.', code: 'stand_unavailable', reasons: [],
    }));
    render(<PositionsMapPage status="success" data={BOARD_SNAPSHOT} error={null} connection="connected" onRetry={onRetry} />);
    await startPlacing(user, 'A1');
    await user.click(screen.getByRole('button', { name: 'Clic en el mapa' }));
    await user.click(within(placingNotice('A1')).getByRole('button', { name: 'Guardar ubicación' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('La posición está ocupada o reservada en ese horario. Elige otra o libérala primero.');
    expect(screen.queryByText(/The stand cannot take this location/)).toBeNull();
    // The pending location is kept for another try; nothing was read again.
    expect(within(placingNotice('A1')).getByRole('button', { name: 'Guardar ubicación' })).toBeEnabled();
    expect(screen.getByTestId('position-map-stub')).toHaveAttribute('data-pending', `${CLICK[1]},${CLICK[0]}`);
    expect(onRetry).not.toHaveBeenCalled();

    // An account that may not place stands is told so, in Spanish.
    api.locateOccStand.mockRejectedValueOnce(new ElevantApiError({ kind: 'http', status: 403, title: 'Forbidden', code: 'forbidden' }));
    await user.click(within(placingNotice('A1')).getByRole('button', { name: 'Guardar ubicación' }));
    expect(await screen.findByText('Tu acceso no permite ubicar posiciones en el mapa.')).toHaveAttribute('role', 'alert');
    expect(screen.queryByText('Forbidden')).toBeNull();
  });

  it('stands with no location are listed «Sin ubicar» and can be placed', async () => {
    const user = userEvent.setup();
    render(<PositionsMapPage status="success" data={BOARD_SNAPSHOT} error={null} connection="connected" onRetry={() => {}} />);
    await user.click(screen.getByRole('button', { name: /lista de posiciones/i }));
    const items = within(screen.getByTestId('positions-side-panel')).getAllByTestId('position-list-item');
    expect(items.map(item => item.querySelector('.font-mono').textContent)).toEqual(['A1', 'A5', 'C7']);
    // Only C7, which no map position shows, is «Sin ubicar».
    expect(items.filter(item => within(item).queryByText('Sin ubicar')).map(item => item.querySelector('.font-mono').textContent))
      .toEqual(['C7']);

    await user.click(within(items[2]).getByText('C7'));
    const drawer = screen.getByTestId('position-detail-drawer');
    expect(within(drawer).getByRole('region', { name: 'Características' })).toHaveTextContent('Sin ubicar');
    await user.click(within(drawer).getByRole('button', { name: 'Ubicar en el mapa' }));
    expect(within(placingNotice('C7')).getByRole('status')).toHaveTextContent('Haz clic en el centro de la posición C7.');
    expect(screen.getByTestId('position-map-stub')).toHaveAttribute('data-placing', 'C7');
    await user.click(screen.getByRole('button', { name: 'Clic en el mapa' }));
    await user.click(within(placingNotice('C7')).getByRole('button', { name: 'Guardar ubicación' }));
    expect(api.locateOccStand).toHaveBeenCalledExactlyOnceWith('stand-C7', expect.objectContaining({ operationDate: OPERATION_DATE }));
  });
});

describe('PositionsMapPage in English', () => {
  beforeEach(() => act(() => resetLanguageForTests('en')));
  afterEach(() => act(() => resetLanguageForTests('es')));

  function renderEnglish(props = {}) {
    return render(
      <LanguageScope>
        <PositionsMapPage status="success" data={SNAPSHOT} error={null} connection="connected" onRetry={() => {}} {...props} />
      </LanguageScope>
    );
  }

  it('renders the toolbar, controls and summary in English', () => {
    renderEnglish();
    expect(screen.getByRole('heading', { name: 'Positions map' })).toBeInTheDocument();
    expect(screen.getByText('PUJ · Punta Cana International Airport')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Filter by terminal' })).toHaveTextContent('All');
    expect(screen.getByPlaceholderText('Search stand, flight or registration...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch to 3D view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Center on PUJ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Full screen' })).toBeInTheDocument();
    // The count of the stands sits on the title's line, and the folded band counts them by the state the map draws.
    expect(screen.getByText('3 stands')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Stands by state' })).getByText(/Free/)).toBeInTheDocument();
    // The page has no legend of its own, nor its combined-stand drawing: the map's legend explains what the map
    // draws (PositionsMapPage.legend.test.jsx).
    expect(screen.queryByRole('button', { name: 'Legend' })).not.toBeInTheDocument();
    expect(screen.queryByText('Combined configuration')).not.toBeInTheDocument();
    expect(screen.queryByText('Leyenda')).not.toBeInTheDocument();
  });

  it('shows the side panel and the combined-configuration drawer in English', async () => {
    renderEnglish();
    await userEvent.click(screen.getByRole('button', { name: 'Stand list' }));
    const panel = screen.getByTestId('positions-side-panel');
    expect(within(panel).getByRole('columnheader', { name: 'Terminal' })).toBeInTheDocument();
    expect(within(panel).getAllByRole('cell', { name: 'A' })).toHaveLength(3);
    expect(within(panel).getAllByText('No flight assigned').length).toBeGreaterThan(0);

    await userEvent.click(within(panel).getByText('A10'));
    const drawer = screen.getByTestId('position-detail-drawer');
    expect(within(drawer).getByText('Stand disabled')).toBeInTheDocument();
    expect(within(drawer).getByText('Configuration 9-Alfa active.')).toBeInTheDocument();
    expect(within(drawer).getByText('This configuration uses A9 and temporarily blocks A10.')).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Close details' })).toBeInTheDocument();
  });

  it('shows the not-found search message and the disconnected banner in English', async () => {
    renderEnglish({ forceState: 'positionsMapDisconnected' });
    expect(screen.getByText('Stale data — no connection with the positions provider.')).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('Search stand, flight or registration...'), 'ZZZ99{enter}');
    expect(screen.getByText('Stand not found.')).toBeInTheDocument();
  });
});

// Inside the OCC frame (PR M6): the stands read the map flights and the aircraft of the station, and the map draws the
// traffic. Synthetic board: ZZ161 on A5, which the board already says arrived (the feed's runway time) while its
// aircraft is still on final, and ZZ300 on A2, due 30 minutes ago and not arrived on the board, while the tablet
// recorded its BLOCK_ON.
describe('PositionsMapPage inside the OCC frame (PR M6)', () => {
  const ACCESS = administratorAccess('operations', DepartmentPermissionCodes.operations);
  const NOON = Date.parse(TRAFFIC_NOON);
  const REFERENCES = STAND_REFERENCE.map(stand => ({ id: stand.code, terminal: stand.terminal, lat: stand.latitude, lon: stand.longitude }));
  const rowOf = key => createMapFlights().flights.find(row => row.flightKey === key);
  function liveData() {
    const board = {
      positions: [
        boardStand('A05', { coveredBy: ['Ana Ruiz'], turnarounds: [boardVisit({ nowMs: NOON, flight: 'ZZ161', arrivalInMin: 10,
          turnaroundId: rowOf(TRAFFIC_FLIGHT_KEY.arrival).turnaroundId, arrivedAt: new Date(NOON - 60_000).toISOString() })] }),
        boardStand('A02', { coveredBy: ['Ana Ruiz'], turnarounds: [boardVisit({ nowMs: NOON, flight: 'ZZ300', arrivalInMin: -30,
          departureInMin: 40, turnaroundId: rowOf(TRAFFIC_FLIGHT_KEY.parkedArrival).turnaroundId })] }),
      ],
      asOf: TRAFFIC_NOON,
    };
    return { station: { code: 'PUJ' }, source: 'occupancy', operationDate: '2026-11-13', canAssign: true, unassigned: [],
      asOf: TRAFFIC_NOON, stands: board.positions, positions: mapOccupancyToRampPositions(REFERENCES, board, TRAFFIC_NOON) };
  }
  const page = data => (
    <PositionsMapPage status="success" data={data} error={null} connection="connected" onRetry={() => {}} />
  );
  const framed = data => (
    <DepartmentAccessProvider initialAccess={ACCESS} load={vi.fn().mockResolvedValue(ACCESS)} observe={false}>
      <OccShellTestProvider>{page(data)}</OccShellTestProvider>
    </DepartmentAccessProvider>
  );
  const stateOf = code => screen.getByTestId('position-map-stub').querySelector(`[data-stand="${code}"]`).dataset.state;
  const flush = () => act(async () => {
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(0);
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOON);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('without the frame reads the board alone, as before', () => {
    render(page(liveData()));
    expect(stateOf('A5')).toBe('occupied');
    expect(stateOf('A2')).toBe('arriving');
    expect(screen.getByTestId('position-map-stub')).toHaveAttribute('data-traffic', '');
  });

  it('with the frame draws the traffic and the stands read «Llegando» and «Ocupada» from the flights', async () => {
    render(framed(liveData()));
    // The page's skeleton while the live chunk loads, never a map without its traffic.
    expect(screen.getByTestId('positions-map-skeleton')).toBeInTheDocument();
    await flush();
    await flush();
    const stub = screen.getByTestId('position-map-stub');
    expect(stub.dataset.traffic.split(' ')).toEqual(expect.arrayContaining([`f:${TRAFFIC_FLIGHT_KEY.arrival}`,
      `h:${TRAFFIC_HEX.overflight}`]));
    // ZZ161 is still on final: A5 reads «Llegando» until its aircraft is on it. ZZ300's BLOCK_ON puts it on A2.
    expect(stateOf('A5')).toBe('arriving');
    expect(stateOf('A2')).toBe('occupied');
    // The drawer says the same.
    act(() => screen.getByRole('button', { name: /lista de posiciones/i }).click());
    act(() => within(screen.getByTestId('positions-side-panel')).getByText('A2').click());
    expect(within(screen.getByTestId('position-detail-drawer')).getByRole('list', { name: 'Estado en el mapa' }))
      .toHaveTextContent('Ocupada');
  });

  it('a flight of the URL is the map\'s selection, with its data block docked beside the map controls', async () => {
    window.history.replaceState({}, '', `${PAGE}&flightId=${TRAFFIC_FLIGHT_KEY.arrival}`);
    render(framed(liveData()));
    await flush();
    await flush();
    const stub = screen.getByTestId('position-map-stub');
    expect(stub).toHaveAttribute('data-traffic-selection', `flight:${TRAFFIC_FLIGHT_KEY.arrival}`);
    expect(stub).toHaveAttribute('data-selected', '');
    const block = within(stub).getByRole('dialog', { name: 'Vuelo ZZ161' });
    // At the top left corner of the map, 12 px from its edges: the page's map tools are in the map's rail (CN-32).
    expect(block).toHaveStyle({ top: '12px', left: '12px' });
    // «Cerrar» lets it go, keeping the other keys of the URL.
    act(() => within(block).getByRole('button', { name: 'Cerrar' }).click());
    expect(query().has('flightId')).toBe(false);
    expect(query().get('stationId')).toBe('s-1');
    expect(screen.queryByRole('dialog', { name: 'Vuelo ZZ161' })).not.toBeInTheDocument();
  });
});
