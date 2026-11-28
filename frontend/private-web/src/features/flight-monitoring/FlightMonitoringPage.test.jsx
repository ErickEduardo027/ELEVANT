import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import { resetPanelFoldsForTests } from '../occ-ui/occPanelMemory';
import FlightMonitoringPage, {
  FLIGHT_MONITORING_LAYOUT, FLIGHT_MONITORING_PANEL_EDGES, boardStateOf,
} from './FlightMonitoringPage';
import { flightMonitoringMessages } from './flightMonitoringMessages';

// The map is the maps lane's (components/FlightMap.jsx and its own tests): this stub keeps the props the page gives it,
// so each test can read them and answer as the map does (`onSelectFlight`), and draws the page's floating panels inside
// it, as the map does (M1).
const map = vi.hoisted(() => ({ props: null }));
vi.mock('./components/FlightMap', () => ({
  default: function FlightMapStub(props) {
    map.props = props;
    return <div data-testid="flight-map-stub" data-selected={String(props.selectedFlightId)}>{props.panels}</div>;
  },
}));

const PAGE = '/admin-occ/flight-monitoring';
const STATION_ID = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';
// 14:00 at Punta Cana (UTC−4); a clock of the server that stands still.
const NOW = Date.parse('2026-11-14T18:00:00Z');
const CLOCK = Object.freeze({ now: () => NOW });
const at = minutes => new Date(NOW + minutes * 60_000).toISOString();

// Synthetic legs of the planning snapshot, as flightMonitoringService.js maps them (invented numbers and registrations).
function leg(overrides = {}) {
  return {
    id: 'leg-161', turnaroundId: 'tat-161', direction: 'arrival', flightNumber: 'DM161', airline: 'Aerolínea de prueba',
    origin: 'MIA', destination: 'PUJ', registration: 'HI1161', aircraft: 'B737 MAX 8', status: 'scheduled',
    scheduledAt: at(20), estimatedAt: null, actualAt: null, isDemo: false, turnaroundStatus: 'Confirmed',
    operationStatus: 'Assigned', eta: at(20), etd: null, actualArrival: null, actualDeparture: null, stand: 'A5',
    supervisor: null, agents: 2, services: ['Equipaje'], heading: null, speed: null, altitude: null, latitude: null,
    longitude: null, ...overrides,
  };
}
const ARRIVAL = leg();
const DEPARTURE = leg({ id: 'leg-904', turnaroundId: 'tat-904', direction: 'departure', flightNumber: 'AA904', origin: 'PUJ',
  destination: 'MIA', scheduledAt: at(45), eta: null, etd: at(45), stand: 'B21' });
const DATA = Object.freeze({ station: { code: 'PUJ', ianaTimeZone: 'America/Santo_Domingo' }, flights: [ARRIVAL, DEPARTURE] });

function page(props = {}) {
  return (
    <FlightMonitoringPage status="success" data={DATA} error={null} connection="connected" lastUpdatedAt={null}
      onRetry={() => {}} stationId={STATION_ID} stationCode="PUJ" clock={CLOCK} {...props} />
  );
}

const query = () => new URLSearchParams(window.location.search);
const board = () => screen.getByRole('region', { name: 'Tablero de vuelos' });
const stripOf = number => screen.getAllByTestId('flight-list-item').find(strip => strip.textContent.includes(number));

function mockMatchMedia(matchingQueries) {
  window.matchMedia = vi.fn().mockImplementation(mediaQuery => ({
    matches: matchingQueries.includes(mediaQuery),
    media: mediaQuery,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

const originalMatchMedia = window.matchMedia;
beforeEach(() => {
  map.props = null;
  resetPanelFoldsForTests();
  // A wide screen (1536 px or more) unless a test says otherwise: the board stays open beside the inspector.
  mockMatchMedia(['(min-width: 1536px)']);
  window.history.replaceState({}, '', `${PAGE}?stationId=${STATION_ID}`);
});
afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  act(() => resetLanguageForTests('es'));
  window.history.replaceState({}, '', '/');
});

describe('FlightMonitoringPage', () => {
  it('shows the skeleton while loading', () => {
    render(page({ status: 'loading', data: null }));
    expect(screen.getByTestId('flight-monitoring-skeleton')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Cargando los vuelos de la estación…');
    expect(screen.queryByTestId('flight-map-stub')).not.toBeInTheDocument();
  });

  it('shows a failed read on the board with Reintentar, never the server\'s words, and keeps the map', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(page({ status: 'error', data: null, error: new Error('boom'), connection: 'disconnected', onRetry }));
    expect(within(board()).getByRole('alert')).toHaveTextContent('No se pudo cargar el monitoreo de vuelos de la estación.');
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
    await user.click(within(board()).getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    // The map reads its own data: a failed planning read does not take it away.
    expect(screen.getByTestId('flight-map-stub')).toBeInTheDocument();
  });

  it('says the account may not see the flights after a refusal, with no retry', () => {
    render(page({ status: 'error', data: null, error: Object.assign(new Error('forbidden'), { status: 403 }) }));
    expect(within(board()).getByText('No tienes permiso para ver los vuelos de la estación.')).toBeInTheDocument();
    expect(within(board()).queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(boardStateOf({ isError: true, error: { status: 401 } })).toEqual({ status: 'unauthorized', staleSince: null });
  });

  it('renders the board of strips beside the map once data loads, with one h1 for the screen', () => {
    render(page());
    expect(screen.getByRole('heading', { level: 1, name: 'Monitoreo de vuelos' })).toHaveClass('sr-only');
    expect(screen.getAllByTestId('flight-list-item').map(strip => strip.dataset.occFlightStrip)).toEqual(['leg-161', 'leg-904']);
    expect(stripOf('DM161')).toHaveAccessibleName(/^Llegada, 14:20 programada, DM161, desde MIA, posición A5, Programado/);
    expect(screen.getByTestId('flight-map-stub')).toBeInTheDocument();
    // From 1024 px the board is beside the map and nothing opens it.
    expect(screen.queryByRole('button', { name: /^Ver vuelos/ })).not.toBeInTheDocument();
    // No inspector until a flight is chosen.
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('the map gets flights, selectedFlightId and onSelectFlight as before', async () => {
    const user = userEvent.setup();
    render(page({ theme: 'dark' }));
    // Every flight of the page, so a click on the map finds any of them, whatever the board shows; the inspector
    // replaces the page's card.
    expect(map.props.flights).toEqual([ARRIVAL, DEPARTURE]);
    expect(map.props).toMatchObject({ selectedFlightId: null, theme: 'dark', detail: null });
    expect(typeof map.props.onSelectFlight).toBe('function');
    await user.click(screen.getByRole('button', { name: 'Salidas 1' }));
    expect(map.props.flights).toHaveLength(2);

    await user.click(stripOf('AA904'));
    expect(map.props.selectedFlightId).toBe('leg-904');
    // A flight chosen on the map is the screen's: its strip and its inspector follow, and «Todos» comes back when the
    // direction on screen hid it.
    act(() => map.props.onSelectFlight('leg-161'));
    expect(query().get('flightId')).toBe('leg-161');
    expect(screen.getByRole('button', { name: 'Todos 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(stripOf('DM161')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('complementary', { name: 'Detalle del vuelo DM161' })).toBeInTheDocument();
    act(() => map.props.onSelectFlight(null));
    expect(query().get('flightId')).toBeNull();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('a strip writes flightId= and keeps stationId', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', `${PAGE}?stationId=${STATION_ID}&view=region&hex=f0c202`);
    render(page());
    await user.click(stripOf('AA904'));
    // The one selection of the URL (contratos 2.1): the leg's id, the other keys kept, the aircraft dropped.
    expect(Object.fromEntries(query())).toEqual({ stationId: STATION_ID, view: 'region', flightId: 'leg-904' });
    expect(stripOf('AA904')).toHaveAttribute('aria-pressed', 'true');
    expect(stripOf('DM161')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('complementary', { name: 'Detalle del vuelo AA904' })).toBeInTheDocument();
  });

  it('draws the milestone strip of the chosen flight from the map flights the map hands over, with no read of its own', () => {
    window.history.replaceState({}, '', `${PAGE}?stationId=${STATION_ID}&flightId=leg-161`);
    render(page());
    const inspector = screen.getByRole('complementary', { name: 'Detalle del vuelo DM161' });
    // Until the map tells which map flight it is, there is no strip.
    expect(within(inspector).queryByRole('list', { name: 'Hitos de la escala' })).not.toBeInTheDocument();
    expect(typeof map.props.onSelectionFlights).toBe('function');
    // A synthetic map flight of the visit with an operation and one recorded milestone (contratos 1.3).
    const mapFlight = { flightKey: 'l:leg-161', visitKey: 't:tat-161', legId: 'leg-161', direction: 'Arrival',
      turnaround: { operationId: 'op-161' }, milestones: [{ code: 'ON_BLOCK', at: at(-5) }] };
    act(() => map.props.onSelectionFlights({ flight: mapFlight, flights: [mapFlight] }));
    expect(within(inspector).getByRole('list', { name: 'Hitos de la escala' })).toBeInTheDocument();
    // A flight the map flights do not know has none.
    act(() => map.props.onSelectionFlights({ flight: null, flights: [mapFlight] }));
    expect(within(inspector).queryByRole('list', { name: 'Hitos de la escala' })).not.toBeInTheDocument();
  });

  it('M8: the board filter reaches the map, and En vuelo reads the phases of the map flights the map hands over', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', `${PAGE}?stationId=${STATION_ID}`);
    render(page());
    // Todos with no search keeps every flight: nothing is dimmed on the map.
    expect(map.props.emphasisedFlightIds).toBeNull();
    const group = within(board()).getByRole('group', { name: 'Filtro del tablero' });
    await user.click(within(group).getByRole('button', { name: 'Salidas 1' }));
    expect(map.props.emphasisedFlightIds).toEqual(['leg-904']);
    const kept = map.props.emphasisedFlightIds;
    // The page's clock re-renders hand the map the same list.
    act(() => map.props.onSelectionFlights({ flight: null, flights: [] }));
    expect(map.props.emphasisedFlightIds).toBe(kept);
    // A filter that keeps nothing dims every AVIAM flight.
    await user.click(within(group).getByRole('button', { name: 'En vuelo 0' }));
    expect(map.props.emphasisedFlightIds).toEqual([]);
    // The map flights the map has read (contratos 2.7: no read of the page's own) say the arrival flies.
    const mapFlight = { flightKey: 'l:leg-161', legId: 'leg-161', direction: 'Arrival', phase: 'enroute' };
    act(() => map.props.onSelectionFlights({ flight: null, flights: [mapFlight] }));
    expect(within(group).getByRole('button', { name: 'En vuelo 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(map.props.emphasisedFlightIds).toEqual(['leg-161']);
    await user.click(within(group).getByRole('button', { name: 'Todos 2' }));
    expect(map.props.emphasisedFlightIds).toBeNull();
    // The search alone is a filter too.
    await user.type(within(board()).getByLabelText('Buscar vuelo'), 'aa9');
    expect(map.props.emphasisedFlightIds).toEqual(['leg-904']);
  });

  it('a flightId link selects that flight', () => {
    for (const [link, number] of [['leg-161', 'DM161'], ['l:leg-904', 'AA904'], ['tat-161', 'DM161']]) {
      window.history.replaceState({}, '', `${PAGE}?stationId=${STATION_ID}&flightId=${link}`);
      const view = render(page());
      expect(screen.getByRole('complementary', { name: `Detalle del vuelo ${number}` }), link).toBeInTheDocument();
      expect(stripOf(number), link).toHaveAttribute('aria-pressed', 'true');
      expect(map.props.selectedFlightId, link).toBe(number === 'DM161' ? 'leg-161' : 'leg-904');
      view.unmount();
    }
  });

  it('keeps a flight only the map knows, and leaves an aircraft the map has just chosen alone', () => {
    window.history.replaceState({}, '', `${PAGE}?stationId=${STATION_ID}&flightId=p:proposal-1`);
    const view = render(page());
    // A proposal still to import: the map shows its own data block; the page has no strip or inspector for it.
    expect(map.props.selectedFlightId).toBe('p:proposal-1');
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    view.unmount();

    // The map writes `hex=` for other traffic and tells the page to leave its flight: the aircraft stays chosen.
    window.history.replaceState({}, '', `${PAGE}?stationId=${STATION_ID}&hex=f0c202`);
    render(page());
    act(() => map.props.onSelectFlight(null));
    expect(Object.fromEntries(query())).toEqual({ stationId: STATION_ID, hex: 'f0c202' });
  });

  it('Cerrar detalle clears the selection and gives the focus back to the flight\'s strip', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', `${PAGE}?stationId=${STATION_ID}&flightId=leg-904&follow=1`);
    render(page());
    const inspector = screen.getByRole('complementary', { name: 'Detalle del vuelo AA904' });
    await user.click(within(inspector).getByRole('button', { name: 'Cerrar detalle' }));
    expect(Object.fromEntries(query())).toEqual({ stationId: STATION_ID });
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(stripOf('AA904')).toHaveFocus();
  });

  it('no text says FlyAware', () => {
    render(page({ connection: 'disconnected', lastUpdatedAt: '2026-11-14T17:58:00Z' }));
    expect(screen.queryByText(/FlyAware/i)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/FlyAware/i);
    expect(JSON.stringify(flightMonitoringMessages)).not.toMatch(/FlyAware/i);
    // Where the screen names the source of its flights, it is the flight source.
    expect(within(board()).getByRole('status')).toHaveTextContent(/^Sin conexión con la fuente de vuelos/);
  });

  it('a lost connection keeps the flights on the board under the stale notice', () => {
    render(page({ connection: 'disconnected', lastUpdatedAt: '2026-11-14T17:58:00Z' }));
    expect(within(board()).getByRole('status')).toHaveTextContent(
      'Sin conexión con la fuente de vuelos: se muestran los datos de las 13:58.');
    expect(screen.getAllByTestId('flight-list-item')).toHaveLength(2);
    expect(within(board()).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('honours the preview\'s monitoringDisconnected and monitoringEmpty states', () => {
    const view = render(page({ forceState: 'monitoringDisconnected', lastUpdatedAt: '2026-11-14T17:58:00Z' }));
    expect(within(board()).getByRole('status')).toHaveTextContent('se muestran los datos de las 13:58');
    view.unmount();
    render(page({ forceState: 'monitoringEmpty' }));
    expect(within(board()).getByText('Sin vuelos para mostrar')).toBeInTheDocument();
    expect(screen.getByTestId('flight-map-stub')).toBeInTheDocument();
    // The map explains its traffic itself (maps/ui/MapSourceStatus.jsx): the page adds no notice of its own.
    expect(screen.queryByText(/Sin posición de aeronaves en vivo/)).not.toBeInTheDocument();
  });

  it('the board lists only the station\'s arrivals and departures', () => {
    const overflight = leg({ id: 'leg-100', flightNumber: 'AA100', direction: undefined, origin: 'MIA', destination: 'JFK' });
    render(page({ data: { ...DATA, flights: [ARRIVAL, DEPARTURE, overflight] } }));
    expect(screen.getAllByTestId('flight-list-item')).toHaveLength(2);
    expect(stripOf('AA100')).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Todos 2' })).toBeInTheDocument();
  });

  it('does not center another station on PUJ', () => {
    render(page({ stationCode: 'SDQ', data: { station: { code: 'SDQ' }, flights: [] } }));
    expect(screen.getByText(/La posición en vivo no está disponible/)).toBeInTheDocument();
    expect(screen.queryByTestId('flight-map-stub')).not.toBeInTheDocument();
  });

  it('toasts use OccToastStack in the work area', () => {
    const view = render(page());
    view.rerender(page({ data: { ...DATA, flights: [{ ...ARRIVAL, status: 'cancelled' }, DEPARTURE] } }));
    const stack = document.querySelector('[data-occ-toasts]');
    expect(stack).toHaveAttribute('data-placement', 'workArea');
    expect(stack.className).toContain('bottom-6');
    const toast = within(stack).getByRole('status');
    expect(toast).toHaveAttribute('data-priority', 'attention');
    expect(toast).toHaveTextContent('AtenciónVuelo DM161 cancelado');
    // The flight cancelled says so on its strip too, with the amber signal.
    expect(stripOf('DM161')).toHaveAccessibleName(/Atención: Cancelado/);
  });
});

describe('FlightMonitoringPage layout', () => {
  const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height,
    x: left, y: top, toJSON() { return this; } });
  const inspectorOf = number => screen.getByRole('complementary', { name: `Detalle del vuelo ${number}` });

  it('fills the screen with the map, with the board floating at its left and the inspector at its right (M1)', async () => {
    const user = userEvent.setup();
    mockMatchMedia(['(min-width: 1536px)']);
    render(page());
    // The map fills the stage, the whole work area: nothing sits beside it any more (CN-32's docked template B is gone).
    const stage = screen.getByTestId('flight-map-stub').parentElement;
    expect(stage.className).toBe(FLIGHT_MONITORING_LAYOUT.stage);
    expect(FLIGHT_MONITORING_LAYOUT.stage).toContain('h-full');
    expect(stage.closest('[data-occ-flight-monitoring]')).toHaveAttribute('data-occ-flight-monitoring', 'map');
    // The board floats inside the map at its left, on the floating slab, and folds to a pill at the top left.
    expect(screen.getByTestId('flight-map-stub')).toContainElement(board());
    expect(board()).toHaveAttribute('data-occ-floating-panel', 'fm-board');
    expect(board()).toHaveAttribute('data-layout', 'float');
    expect(board()).toHaveAttribute('data-folded', 'false');
    expect(board().className).toContain(FLIGHT_MONITORING_LAYOUT.board);
    expect(FLIGHT_MONITORING_LAYOUT.board).toMatch(/absolute bottom-3 left-3 top-3 z-10 w-\[24rem\]/);
    expect(FLIGHT_MONITORING_LAYOUT.board).toContain('data-[folded=true]:bottom-auto');

    // The inspector floats at the right, left of the map's control column (its reserve), and never under it.
    await user.click(stripOf('DM161'));
    const inspector = inspectorOf('DM161');
    expect(screen.getByTestId('flight-map-stub')).toContainElement(inspector);
    expect(inspector).toHaveAttribute('data-map-side-panel', 'floating');
    expect(inspector.className).toContain(FLIGHT_MONITORING_LAYOUT.inspector);
    expect(FLIGHT_MONITORING_LAYOUT.inspector).toContain('right-[var(--occ-map-rail-reserve)]');
    expect(FLIGHT_MONITORING_LAYOUT.inspector).toContain('w-[22.5rem]');
    // From 1536 px the board stays open beside it.
    expect(board()).toHaveAttribute('data-folded', 'false');
    // The map renders the flight's live data block inside the inspector (its slot): the flight has one card.
    const slot = inspector.querySelector('[data-occ-live-slot]');
    expect(slot).not.toBeNull();
    expect(map.props.dataBlockSlot).toBe(slot);
  });

  it('measures the board and the inspector into the map\'s insets, each from its own edge (M1)', async () => {
    const user = userEvent.setup();
    mockMatchMedia(['(min-width: 1536px)']);
    expect(FLIGHT_MONITORING_PANEL_EDGES).toEqual({ 'fm-board': 'left', 'fm-inspector': 'right', 'fm-view-flights': 'top' });
    const view = render(page());
    expect(map.props.insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    // A map of 1400 × 800 with the board 12 px in from its left edge (24rem).
    const stage = screen.getByTestId('flight-map-stub').parentElement;
    stage.getBoundingClientRect = () => rect(0, 0, 1400, 800);
    board().getBoundingClientRect = () => rect(12, 12, 384, 776);
    view.rerender(page());
    expect(map.props.insets).toEqual({ top: 0, right: 0, bottom: 0, left: 404 });
    // The inspector (22.5rem) 112 px from the right edge, the control column's reserve: its width, the reserve and the
    // gap.
    await user.click(stripOf('AA904'));
    inspectorOf('AA904').getBoundingClientRect = () => rect(928, 12, 360, 776);
    view.rerender(page());
    expect(map.props.insets).toEqual({ top: 0, right: 480, bottom: 0, left: 404 });
    // Folded, the board is a pill at the top: the left edge is the map's again.
    await user.click(within(board()).getByRole('button', { name: 'Tablero de vuelos' }));
    board().getBoundingClientRect = () => rect(12, 12, 180, 40);
    view.rerender(page());
    expect(map.props.insets).toEqual({ top: 60, right: 480, bottom: 0, left: 0 });
  });

  it('below 1536 px the open inspector folds the board to its pill until the person unfolds it (M1)', async () => {
    const user = userEvent.setup();
    mockMatchMedia([]);
    render(page());
    expect(board()).toHaveAttribute('data-folded', 'false');
    await user.click(stripOf('DM161'));
    // On a 1366 px laptop what matters stays open: the inspector, with the board as a pill.
    expect(inspectorOf('DM161')).toBeInTheDocument();
    expect(board()).toHaveAttribute('data-folded', 'true');
    // The person may open it beside the flight.
    await user.click(within(board()).getByRole('button', { name: 'Tablero de vuelos' }));
    expect(board()).toHaveAttribute('data-folded', 'false');
    await user.click(stripOf('AA904'));
    expect(board()).toHaveAttribute('data-folded', 'true');
    // «Cerrar detalle» brings the board back, with the focus on the flight's strip.
    await user.click(within(inspectorOf('AA904')).getByRole('button', { name: 'Cerrar detalle' }));
    expect(board()).toHaveAttribute('data-folded', 'false');
    expect(stripOf('AA904')).toHaveFocus();
  });

  it('without a map (another station) the board, the card and the inspector scroll in a plain grid', async () => {
    const user = userEvent.setup();
    mockMatchMedia(['(min-width: 1536px)']);
    render(page({ stationCode: 'SDQ', data: { station: { code: 'SDQ' }, flights: [ARRIVAL] } }));
    const card = screen.getByText(/La posición en vivo no está disponible/);
    expect(card.className).toBe(FLIGHT_MONITORING_LAYOUT.gridCard);
    expect(card.parentElement.className).toBe(FLIGHT_MONITORING_LAYOUT.grid);
    expect(card.parentElement.parentElement.className).toBe(FLIGHT_MONITORING_LAYOUT.scroll);
    expect(FLIGHT_MONITORING_LAYOUT.scroll).toContain('overflow-y-auto');
    // A plain panel, nothing floating.
    expect(board()).not.toHaveAttribute('data-occ-floating-panel');
    await user.click(stripOf('DM161'));
    expect(card.parentElement.className).toBe(FLIGHT_MONITORING_LAYOUT.gridWithInspector);
    expect(inspectorOf('DM161')).toHaveAttribute('data-map-side-panel', 'framed');
  });

  it('below 1024 px Ver vuelos opens the board in a drawer that its veil closes', async () => {
    const user = userEvent.setup();
    mockMatchMedia(['(max-width: 1023.98px)']);
    render(page());
    expect(screen.queryByRole('region', { name: 'Tablero de vuelos' })).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Ver vuelos (2)' });
    // «Ver vuelos» floats at the top left of the map, measured as its top edge.
    const place = toggle.closest('[data-occ-view-flights]');
    expect(screen.getByTestId('flight-map-stub')).toContainElement(place);
    expect(place.className).toBe(FLIGHT_MONITORING_LAYOUT.viewFlights);
    await user.click(toggle);
    const drawer = screen.getByRole('dialog', { name: 'Lista de vuelos' });
    expect(within(drawer).getByRole('region', { name: 'Tablero de vuelos' })).toBeInTheDocument();
    await user.click(document.querySelector('[data-occ-drawer-scrim]'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // A strip chosen in the drawer selects its flight and closes it.
    await user.click(toggle);
    await user.click(within(screen.getByRole('dialog')).getAllByTestId('flight-list-item')[1]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(query().get('flightId')).toBe('leg-904');
    expect(screen.getByRole('complementary', { name: 'Detalle del vuelo AA904' })).toBeInTheDocument();
  });
});

describe('FlightMonitoringPage in English', () => {
  beforeEach(() => act(() => resetLanguageForTests('en')));

  it('renders the board, the statuses and the inspector in English', async () => {
    const user = userEvent.setup();
    render(<LanguageScope>{page()}</LanguageScope>);
    expect(screen.getByRole('heading', { level: 1, name: 'Flight monitoring' })).toBeInTheDocument();
    const flights = screen.getByRole('region', { name: 'Flight board' });
    expect(within(flights).getByRole('group', { name: 'Board filter' })).toBeInTheDocument();
    expect(within(flights).getByRole('button', { name: 'Departures 1' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search flight')).toHaveAttribute('placeholder', 'Number, airline, registration or supervisor');
    expect(within(flights).getAllByText('Scheduled')).toHaveLength(2);
    await user.click(stripOf('DM161'));
    expect(screen.getByRole('complementary', { name: 'Flight DM161 details' })).toBeInTheDocument();
    // The page has no legend button of its own: the map's explains what the map draws (FlightMonitoringPage.legend.test.jsx).
    expect(screen.queryByRole('button', { name: 'Legend' })).not.toBeInTheDocument();
    expect(screen.queryByText('Leyenda')).not.toBeInTheDocument();
  });

  it('renders the error state in English', () => {
    render(<LanguageScope>{page({ status: 'error', data: null, error: null, connection: 'disconnected' })}</LanguageScope>);
    expect(screen.getByRole('alert')).toHaveTextContent('Station flight monitoring could not be loaded.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
