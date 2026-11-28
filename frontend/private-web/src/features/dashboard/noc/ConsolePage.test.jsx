import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GPUInitializationError, sharedFakeMapLibre } from '../../../../tests/fakeMapLibre';
import {
  ARRIVAL_ON_FINAL_KEY, CONSOLE_HEX, DEMO_FLIGHT_KEYS, aircraftTrack, airPicture, assignmentReadiness, mapFlights,
  notices, planningSnapshot, positionsBoard, reviewQueue, stationDay,
} from '../../../../tests/visual/occ/fixtures/consoleApi.mjs';
import { OCC_ACCESS, STATION } from '../../../../tests/visual/occ/fixtures/occApi.mjs';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { assignPlanningOperation, getPlanningOptions } from '../../../services/planningService';
import { loadSatelliteImageInfo } from '../../../services/satelliteService';
import { createSimulatedOccMapAdapter } from '../../../services/occMapService';
import { DepartmentAccessProvider } from '../../access/DepartmentAccessContext';
import { createOccShellValue, OccShellTestProvider } from '../../admin-occ/shell/testing/occShellFixtures';
import { MDPC_LAYOUT } from '../../maps/airport/airportLayout';
import { attachStandGeometry } from '../../maps/stands/standModel';
import { MIN_VISIBLE_MAP_PX } from '../../maps/ui/stageInsets';
import { resetPanelFoldsForTests, writePanelFolded } from '../../occ-ui/occPanelMemory';
import { parseMetar } from '../../weather/metar';
import { resetClosedArrivalsForTests } from './arrivalMemory';
import { BOARD_LEGEND_KEYS } from './boardModel';
import ConsolePage from './ConsolePage';
import ConsoleRoute from './ConsoleRoute';

views.ConsolePage = ConsolePage;

// The OCC console on the one map engine (contratos 2.5): the route with stand-ins of its reads (the synthetic day of
// the visual suite, tests/visual/occ/fixtures/consoleApi.mjs), the simulated map adapter over the same day, a shell
// stub and the recording MapLibre. No request leaves the test. The honesty checks are the old Panorama's
// (DashboardPage.test.jsx, gone with PR U3), on the new console.

vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);
const auth = vi.hoisted(() => ({ session: null }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ session: auth.session }) }));
const weatherView = vi.hoisted(() => ({ current: null }));
vi.mock('../../weather/useMdpcWeather', async () => ({
  ...(await vi.importActual('../../weather/useMdpcWeather')), useMdpcWeather: () => weatherView.current,
}));
vi.mock('../../../services/weatherService', () => ({
  loadRecentMetars: vi.fn(() => new Promise(() => {})), loadCurrentObservation: vi.fn(() => new Promise(() => {})),
}));
vi.mock('../../../services/satelliteService', () => ({
  loadSatelliteImageInfo: vi.fn(() => new Promise(() => {})),
  imageAgeMinutes: vi.fn(() => 25),
  SATELLITE_OPACITY: { goes: 0.7, imerg: 0.82 },
  SATELLITE_LAYERS: { goes: 'goes', imerg: 'imerg' },
  satelliteTileAt: () => null,
}));
// What the console loads with next/dynamic: its view (ConsolePage.jsx, its own chunk in the app), here at once, and the
// satellite map of the weather detail, a stand-in that says what it would draw.
const views = vi.hoisted(() => ({ ConsolePage: null }));
vi.mock('next/dynamic', () => ({
  default: () => function DynamicStub(props) {
    if (props.live !== undefined) {
      const View = views.ConsolePage;
      return <View {...props} />;
    }
    return <div data-testid="goes-cloud-map" data-imagery={props.imagery} />;
  },
}));
// The import dialog and the planning drawer are Planificación's (their own tests cover them): stand-ins that keep the
// props the console gives them.
const opened = vi.hoisted(() => ({ importProps: null, drawerProps: null }));
vi.mock('../../planning/components/ProviderFlightsDialog', () => ({
  default: props => {
    opened.importProps = props;
    return (
      <section role="dialog" aria-modal="true" aria-label="Importar vuelos del proveedor">
        <button type="button" onClick={props.onImported}>Escala importada</button>
        <button type="button" onClick={props.onClose}>Cerrar</button>
      </section>
    );
  },
}));
vi.mock('../../planning/components/PlanningDrawer', () => ({
  default: props => {
    opened.drawerProps = props;
    if (!props.flight) return null;
    return (
      <aside role="dialog" aria-modal="true" aria-label={`Asignación de ${props.flight.operationCode}`}>
        <p>{props.optionsState.status}</p>
        <button type="button" onClick={() => props.onAssign('agent-1')}>Asignar operación</button>
        <button type="button" onClick={() => props.onAgentReleased()}>Liberar agente</button>
        <button type="button" onClick={props.onClose}>Cerrar</button>
      </aside>
    );
  },
}));
vi.mock('../../../services/planningService', async () => ({
  ...(await vi.importActual('../../../services/planningService')),
  getPlanningOptions: vi.fn(),
  assignPlanningOperation: vi.fn(),
}));

const fake = sharedFakeMapLibre();
const PAGE = '/admin-occ/dashboard';
const SESSION = { accountId: '2b7c4e1a-9d3f-4c5b-8e6a-1f2d3c4b5a69',
  stationScopes: [{ stationId: STATION.stationId, stationCode: 'PUJ' }] };
const observation = (ageMinutes = 20) => ({
  station: 'MDPC', observedAt: new Date(Date.now() - ageMinutes * 60_000).toISOString(),
  metar: parseMetar('MDPC 111900Z 10013G25KT 9999 FEW022 30/23 Q1015'),
  derived: { relativeHumidity: 66, feelsLikeC: 34, precipitationLastHourIn: 0 },
  source: { name: 'Iowa Environmental Mesonet', url: 'https://mesonet.agron.iastate.edu', official: false },
});
const weatherOf = (status, data = null, extra = {}) => ({ status, data, fetchedAt: null, refreshFailed: false,
  refreshing: false, refresh: vi.fn(), ...extra });

/** Counted stand-ins of the console's four reads, answering the synthetic day at the moment of each read. */
function consoleServices(overrides = {}) {
  return {
    getPlanningSnapshot: vi.fn(async ({ stationId }) => planningSnapshot({ now: Date.now(), stationId })),
    getAssignmentReadiness: vi.fn(async ({ stationId, date }) => assignmentReadiness({ stationId, date })),
    loadOccPositions: vi.fn(async (stationId, date) => positionsBoard({ now: Date.now(), stationId, date })),
    loadOccReviewQueue: vi.fn(async stationId => reviewQueue({ now: Date.now(), stationId })),
    clock: { now: () => Date.now() },
    ...overrides,
  };
}

/** The simulated map reads of the same day; `demo.on` puts the demo pair in the flights from the next read. */
function simulatedMap(demo = { on: false }) {
  return createSimulatedOccMapAdapter({ scenario: {
    picture: ({ nowMs, stationId, trails }) => airPicture({ now: nowMs, stationId, trails }),
    flights: ({ nowMs, stationId }) => mapFlights({ now: nowMs, stationId, demo: demo.on }),
    tracks: { [CONSOLE_HEX.onFinal]: ({ nowMs }) => aircraftTrack({ now: nowMs, hex: CONSOLE_HEX.onFinal }) },
  } });
}

function shellWith(overrides = {}) {
  return createOccShellValue({ notices: { status: 'success', items: notices({ now: Date.now() }).notifications,
    fetchedAt: new Date().toISOString(), markRead: vi.fn(async id => ({ id })), ...overrides } });
}

function renderConsole({ url = PAGE, services = consoleServices(), mapService = simulatedMap(), shell = shellWith(),
  scope = false, access = OCC_ACCESS } = {}) {
  window.history.replaceState({}, '', url);
  const route = <ConsoleRoute services={services} mapService={mapService} />;
  const view = render(
    <DepartmentAccessProvider initialAccess={access} load={vi.fn().mockResolvedValue(access)} observe={false}>
      <OccShellTestProvider value={shell}>{scope ? <LanguageScope>{route}</LanguageScope> : route}</OccShellTestProvider>
    </DepartmentAccessProvider>,
  );
  return { ...view, services, mapService, shell, map: fake.state.liveMaps().at(-1) ?? null };
}

const region = name => screen.getByRole('region', { name, exact: true });
const board = () => region('Tablero');
const pendingRegion = () => within(region('Alertas')).getByRole('region', { name: 'Pendientes de la jornada' });
// The figure a tile of «Cifras de la jornada» shows, by its label.
const figureOf = label => [...region('Cifras de la jornada').querySelectorAll('[data-occ-stat]')]
  .find(tile => tile.querySelector('dt')?.textContent.trim() === label)?.querySelector('dd')?.textContent ?? null;
// The OCC access without some of its permissions.
const accessWithout = (...codes) => ({ ...OCC_ACCESS, permissions: OCC_ACCESS.permissions.filter(code => !codes.includes(code)) });
const NO_PERMISSION = 'No tienes permiso para ver esta información.';
const NO_STATION = 'No hay una estación OCC autorizada para consultar este panorama.';
const panelOf = id => document.querySelector(`[data-occ-floating-panel="${id}"]`);
const statusBar = () => document.querySelector('[data-occ-console-status]');
// What the folded band's pill says beside its button (OccFloatingPanel's `foldedSummary`, which describes the button).
const bandSummary = () => document.getElementById(within(region('Posiciones'))
  .getByRole('button', { name: 'Posiciones', exact: true }).getAttribute('aria-describedby'));
const search = () => new URLSearchParams(window.location.search);
// The board answers once the map flights did: its tabs show (also inside a folded board, whose body stays mounted).
const boardReady = () => within(board()).findByRole('tablist', { name: 'Vista del tablero', hidden: true });

class FakeResizeObserver {
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    this.targets = new Set();
    FakeResizeObserver.instances.push(this);
  }

  observe(target) { this.targets.add(target); }

  unobserve(target) { this.targets.delete(target); }

  disconnect() { this.targets.clear(); }
}

// A screen `width` px wide as matchMedia answers it: the console asks only `max-width` and `min-width` queries (below
// 1440 px only the board opens, below 768 px nothing does, from 1536 px the inspector takes a column of its own).
const screenOf = width => query => {
  const [, kind, px] = /\((max|min)-width:\s*([\d.]+)px\)/.exec(query) ?? [];
  let matches = false;
  if (kind === 'max') matches = width <= Number(px);
  else if (kind === 'min') matches = width >= Number(px);
  return { matches, media: query, addEventListener() {}, removeEventListener() {} };
};
const boxOf = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height,
  x: left, y: top, toJSON() { return this; } });
// Where the console's box, its floating panels and its status bar sit on a map of 1440 × 900, the fake map's own
// viewport, as `[left, top, width, height]` in window pixels: each panel as a pill when folded and open otherwise (M1).
// The stage is 12 px in from the edges of the map and stops 112 px from its right edge (the control column's reserve);
// the panels are 12 px apart. The status bar runs along the foot (60 px from the bottom with its gap); over it the
// left column (24rem) holds «Tablero», «Alertas» at its foot and, below 1536 px, the «Inspector»: any of them open takes
// 404 px from the left. From 1536 px the inspector floats in its own column left of the reserve: 472 px from the right.
// With the panels hidden (`focus=map`), «Mostrar paneles» sits alone at the top left.
const PANEL_PLACES = Object.freeze({
  map: [0, 0, 1440, 900],
  status: [12, 848, 1316, 40],
  showPanels: [12, 12, 140, 32],
  board: { folded: [12, 12, 132, 40], open: [12, 12, 384, 560] },
  figures: { folded: [408, 12, 100, 40], open: [408, 12, 920, 56] },
  alerts: { folded: [12, 796, 132, 40], open: [12, 584, 384, 252] },
  inspector: { folded: [12, 64, 132, 40], open: [12, 64, 384, 772] },
  inspectorWide: { folded: [1196, 80, 132, 40], open: [976, 80, 352, 704] },
  positions: { folded: [408, 796, 920, 40], open: [408, 588, 920, 248] },
});
// The same at 1366 × 768 with the navigation rail open (248 px) under the 48 px status bar: a map of 1118 × 720, where
// only the board opens and the others are pills. The board's box is drawn as it shares its column with an open
// inspector; alone it runs down to the pill of «Alertas»: 404 px from the left either way.
const PLACES_1366 = Object.freeze({
  map: [0, 0, 1118, 720],
  status: [12, 668, 994, 40],
  board: { folded: [12, 12, 132, 40], open: [12, 12, 384, 266] },
  figures: { folded: [408, 12, 100, 40], open: [408, 12, 598, 104] },
  alerts: { folded: [12, 616, 132, 40], open: [12, 432, 384, 224] },
  inspector: { folded: [12, 290, 132, 40], open: [12, 290, 384, 366] },
  positions: { folded: [408, 616, 598, 40], open: [408, 420, 598, 236] },
});
let laidOut = null;

/**
 * Lays out what jsdom does not: the console's map box, its panels by fold, its status bar and «Mostrar paneles», from
 * `places`; the inspector by where the overlay put it (its own column from 1536 px: `inspectorWide`).
 */
function layOutPanels(places = PANEL_PLACES) {
  const original = Element.prototype.getBoundingClientRect;
  laidOut = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function boundingClientRect() {
    const fold = this.getAttribute('data-folded') === 'true' ? 'folded' : 'open';
    const panelId = this.getAttribute('data-occ-floating-panel');
    const id = panelId === 'inspector' && this.closest('[data-occ-console-side]') ? 'inspectorWide' : panelId;
    let place = places[id]?.[fold];
    if (this.hasAttribute('data-occ-console-map')) place = places.map;
    else if (this.hasAttribute('data-occ-console-status')) place = places.status;
    else if (this.hasAttribute('data-occ-console-show')) place = places.showPanels;
    return place ? boxOf(...place) : original.call(this);
  });
}

// The panels measured again, as the browser's ResizeObserver does after a fold.
const remeasure = () => act(async () => {
  for (const observer of FakeResizeObserver.instances) observer.callback([], observer);
});
// Where the map draws a stand: the centre of its box in the airport layout (the synthetic day saves no location).
const standCentre = code => attachStandGeometry([{ id: code, code }], MDPC_LAYOUT)[0].geometry.center;
// Whether a camera centre (a LngLat or `[lng, lat]`) is at `[lng, lat]`, to a millionth of a degree.
// An aircraft is drawn where the motion's frame samples it (PR M6): a few hundred metres on from its fix at most.
const AIRCRAFT_TOLERANCE = 0.01;
function near(center, [lng, lat], tolerance = 1e-6) {
  const [x, y] = Array.isArray(center) ? center : [center?.lng, center?.lat];
  return Math.abs(x - lng) < tolerance && Math.abs(y - lat) < tolerance;
}
// The fake map's camera put, at its zoom, so that `lngLat` is drawn at the pixel `[x, y]` of its 1440 × 900 viewport.
function drawAt(map, lngLat, [x, y]) {
  map.jumpTo({ center: lngLat });
  const centre = map.unproject([720 - (x - 720), 450 - (y - 450)]);
  map.jumpTo({ center: [centre.lng, centre.lat] });
}
// A click on the map at the pixel `[x, y]`, where it draws the stand `code` at `[lng, lat]`, as MapLibre picks it.
async function clickStand(map, code, [x, y], [lng, lat]) {
  fake.state.setRenderedFeatures(map, () => [{ id: code, layer: { id: 'occ-stands-fill' }, properties: { code } }]);
  await act(async () => fake.state.emit(map, 'click', { point: { x, y }, lngLat: { lng, lat } }));
}
// The camera moves the console made after `from` (an index of the fake map's camera calls), padding left aside.
const movesSince = (map, from) => map.cameraCalls.slice(from).filter(call => call.method !== 'setPadding');
const paddedSince = (map, from, side, value) => map.cameraCalls.slice(from)
  .findIndex(call => call.method === 'setPadding' && call.options[side] === value);
const movedToSince = (map, from, point, tolerance) => map.cameraCalls.slice(from)
  .findIndex(call => call.method !== 'setPadding' && near(call.options.center, point, tolerance));

beforeEach(() => {
  fake.state.reset();
  auth.session = SESSION;
  weatherView.current = weatherOf('loading');
  Object.assign(opened, { importProps: null, drawerProps: null });
  vi.mocked(getPlanningOptions).mockReset().mockResolvedValue({
    options: { services: [], agents: [{ id: 'agent-1', displayName: 'Marta Castillo', employeeNumber: 'EMP-0101',
      eligible: true, eligibilityReasons: [] }] }, etag: '"planning-options-v1"' });
  vi.mocked(assignPlanningOperation).mockReset().mockResolvedValue({ assignmentId: 'assignment-new' });
});

afterEach(() => {
  cleanup();
  act(() => resetLanguageForTests('es'));
  resetPanelFoldsForTests();
  resetClosedArrivalsForTests();
  FakeResizeObserver.instances = [];
  laidOut?.mockRestore();
  laidOut = null;
  vi.unstubAllGlobals();
  vi.mocked(loadSatelliteImageInfo).mockImplementation(() => new Promise(() => {}));
  window.history.replaceState({}, '', '/');
});

describe('the OCC console', () => {
  it('shows the scoped OCC facts of PUJ without a station selector or synthetic claims', async () => {
    renderConsole();
    await boardReady();
    // The board: the map flights of the day, as strips.
    expect(within(board()).getByRole('button', { name: /ZZ161/ })).toBeInTheDocument();
    expect(within(board()).getByRole('button', { name: /ZZ500/ })).toBeInTheDocument();
    // The station's operational date, as the server decided it.
    expect(within(board()).getByText((_, element) => element?.tagName === 'TIME'
      && element.getAttribute('dateTime') === stationDay())).toBeInTheDocument();
    // The urgent alert in its words, never its raw kind.
    const alerts = region('Alertas');
    expect(await within(alerts).findByText('Incidencia reportada en rampa')).toBeInTheDocument();
    expect(screen.queryByText('incident_reported')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText(/sintéticos|FlyAware|42 vuelos/i)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Panorama operativo' })).toBeInTheDocument();
    // The provenance line says where the data comes from, in the status bar that floats at the foot of the map (M1).
    const provenance = await screen.findByTestId('occ-console-provenance');
    expect(provenance.closest('[data-occ-console-status]')).not.toBeNull();
    expect(screen.getByTestId('occ-map')).toContainElement(provenance);
    await waitFor(() => expect(provenance).toHaveTextContent(/Aviones: Red ADS-B de prueba, hace \d+ s\./));
    expect(provenance).toHaveTextContent('Posiciones: referencia interna sin verificar.');
    expect(provenance).not.toHaveTextContent('Incluye un vuelo demo.');
  });

  it('panels are regions named Tablero, Alertas, Cifras de la jornada, Posiciones and fold through their own button', async () => {
    renderConsole();
    await boardReady();
    for (const name of ['Tablero', 'Alertas', 'Cifras de la jornada', 'Posiciones']) {
      const panel = region(name);
      const button = within(panel).getByRole('button', { name, exact: true });
      const open = button.getAttribute('aria-expanded') === 'true';
      // No key of its own folds it.
      fireEvent.keyDown(button, { key: 'f' });
      expect(button).toHaveAttribute('aria-expanded', String(open));
      await userEvent.click(button);
      expect(button).toHaveAttribute('aria-expanded', String(!open));
      expect(panel).toHaveAttribute('data-folded', String(open));
    }
    // «Posiciones» opens folded: its pill says the stands by state (over the map, the strip of figures already says the
    // figures of the day).
    expect(region('Posiciones')).toHaveAttribute('data-folded', 'false');
    await userEvent.click(within(region('Posiciones')).getByRole('button', { name: 'Posiciones' }));
    expect(within(region('Posiciones')).getByRole('list', { name: 'Posiciones por estado' })).toHaveTextContent(/Libre/);
    // No inspector without a selection.
    expect(screen.queryByRole('region', { name: 'Inspector' })).not.toBeInTheDocument();
  });

  it('selecting a strip selects the flight on the map and opens the Inspector', async () => {
    renderConsole();
    await boardReady();
    const strip = within(board()).getByRole('button', { name: /ZZ161/ });
    await userEvent.click(strip);
    await waitFor(() => expect(search().get('flightId')).toBe(ARRIVAL_ON_FINAL_KEY));
    expect(strip).toHaveAttribute('aria-pressed', 'true');
    const inspector = await screen.findByRole('region', { name: 'Inspector' });
    // The maps lane's data block of the flight, its milestones and nothing to import or assign: it has its agent.
    expect(within(inspector).getByRole('dialog', { name: 'Vuelo ZZ161' })).toBeInTheDocument();
    expect(within(inspector).getByRole('list', { name: 'Hitos de la escala' })).toBeInTheDocument();
    expect(within(inspector).queryByRole('button', { name: 'Asignar agente' })).not.toBeInTheDocument();
    // «Cerrar» of the data block clears the selection.
    await userEvent.click(within(inspector).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(search().has('flightId')).toBe(false));
    expect(screen.queryByRole('region', { name: 'Inspector' })).not.toBeInTheDocument();
  });

  it('a map selection switches the board tab and marks the strip', async () => {
    const { map } = renderConsole();
    await boardReady();
    await act(async () => fake.state.emit(map, 'style.load'));
    await userEvent.click(within(board()).getByRole('tab', { name: /Salidas/ }));
    expect(within(board()).getByRole('tab', { name: /Salidas/ })).toHaveAttribute('aria-selected', 'true');
    // A click on the aircraft on final, the flight ZZ161, as the map picks it.
    fake.state.setRenderedFeatures(map, () => [{ layer: { id: 'occ-traffic-aviam' },
      properties: { flightKey: ARRIVAL_ON_FINAL_KEY, kind: 'aviam' } }]);
    await act(async () => fake.state.emit(map, 'click', { point: { x: 200, y: 200 }, lngLat: { lng: -68.5, lat: 18.53 } }));
    await waitFor(() => expect(search().get('flightId')).toBe(ARRIVAL_ON_FINAL_KEY));
    await waitFor(() => expect(within(board()).getByRole('tab', { name: /Llegadas/ })).toHaveAttribute('aria-selected', 'true'));
    expect(within(board()).getByRole('button', { name: /ZZ161/ })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('region', { name: 'Inspector' })).toBeInTheDocument();
  });

  it('a selected stand shows its facts and its flight in the Inspector, and marks its bar on the band', async () => {
    renderConsole({ url: `${PAGE}?stand=A5` });
    await boardReady();
    const inspector = await screen.findByRole('region', { name: 'Inspector' });
    expect(within(inspector).getByTestId('stand-detail-facts')).toBeInTheDocument();
    const flight = within(inspector).getByRole('region', { name: 'Vuelo de la posición' });
    await waitFor(() => expect(flight).toHaveTextContent('ZZ161'));
    // The band shows the stand's visit selected.
    await userEvent.click(within(region('Posiciones')).getByRole('button', { name: 'Posiciones' }));
    const band = within(region('Posiciones')).getByRole('group', { name: 'Posiciones en el tiempo' });
    expect(within(band).getAllByRole('button', { pressed: true }).map(bar => bar.textContent)).toEqual(['ZZ161 → ZZ162']);
    await userEvent.click(within(inspector).getByRole('button', { name: 'Quitar selección' }));
    await waitFor(() => expect(search().has('stand')).toBe(false));
  });

  it('Recibido acknowledges through the shell read receipt', async () => {
    const shell = shellWith();
    renderConsole({ shell });
    await boardReady();
    const alerts = region('Alertas');
    const urgent = notices({ now: Date.now() }).notifications.find(item => item.kind === 'incident_reported');
    await userEvent.click(within(alerts).getByRole('button', { name: 'Recibido' }));
    expect(shell.notices.markRead).toHaveBeenCalledExactlyOnceWith(urgent.id);
    // Only the unreceived urgent and attention alerts of the station are listed; the received one and the plain notice
    // stay in the shell's drawer.
    expect(within(alerts).queryByText('Operación entregada para revisión')).not.toBeInTheDocument();
    expect(within(alerts).getByText('1 sin recibir')).toBeInTheDocument();
  });

  it('lists the open conditions of the day in «Pendientes de la jornada» with the action that closes each', async () => {
    renderConsole();
    await boardReady();
    const pending = within(region('Alertas')).getByRole('region', { name: 'Pendientes de la jornada' });
    await waitFor(() => expect(within(pending).getByText(/ZZ500 sin agente, llega en/)).toBeInTheDocument());
    expect(within(pending).getByText(/ZZ610 sin posición/)).toBeInTheDocument();
    expect(within(pending).getByText(/ZZ610 sin agente/)).toBeInTheDocument();
    const day = stationDay().replaceAll('-', '');
    expect(within(pending).getByText(`PUJ-${day}-005 por revisar`)).toBeInTheDocument();
    expect(within(pending).getByRole('link', { name: 'Revisar' }))
      .toHaveAttribute('href', `/admin-occ/review?operationId=${reviewQueue().operations[0].operationId}`);
    expect(within(pending).getAllByRole('link', { name: 'Elegir posición' })[0]).toHaveAttribute('href', '/admin-occ/positions-map');
  });

  it('Importar vuelos opens the import dialog over the console', async () => {
    const services = consoleServices();
    renderConsole({ services });
    await boardReady();
    await userEvent.click(within(board()).getByRole('button', { name: 'Importar vuelos' }));
    const dialog = screen.getByRole('dialog', { name: 'Importar vuelos del proveedor' });
    expect(opened.importProps).toMatchObject({ stationId: STATION.stationId, date: stationDay(),
      timeZone: 'America/Santo_Domingo', revision: expect.any(Number) });
    // Over the console: the board and the map stay where they are.
    expect(board()).toBeInTheDocument();
    expect(screen.getByTestId('occ-map')).toBeInTheDocument();
    // An import re-reads the day's planning, without waiting for its poll, and what the assignment drawer reads.
    const reads = services.getPlanningSnapshot.mock.calls.length;
    expect(opened.drawerProps.dataRevision).toBe(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Escala importada' }));
    await waitFor(() => expect(services.getPlanningSnapshot.mock.calls.length).toBeGreaterThan(reads));
    expect(opened.drawerProps.dataRevision).toBe(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog', { name: 'Importar vuelos del proveedor' })).not.toBeInTheDocument();
  });

  it('Asignar agente opens the assignment drawer over the console', async () => {
    const services = consoleServices();
    renderConsole({ services });
    await boardReady();
    const pending = within(region('Alertas')).getByRole('region', { name: 'Pendientes de la jornada' });
    const item = (await within(pending).findByText(/ZZ500 sin agente/)).closest('li');
    await userEvent.click(within(item).getByRole('button', { name: 'Asignar agente' }));
    const day = stationDay().replaceAll('-', '');
    const drawer = await screen.findByRole('dialog', { name: `Asignación de PUJ-${day}-003` });
    await waitFor(() => expect(drawer).toHaveTextContent('success'));
    expect(getPlanningOptions).toHaveBeenCalledWith(planningSnapshot().turnarounds[2].id, expect.anything());
    const reads = services.getPlanningSnapshot.mock.calls.length;
    await userEvent.click(within(drawer).getByRole('button', { name: 'Asignar operación' }));
    expect(assignPlanningOperation).toHaveBeenCalledWith(planningSnapshot().turnarounds[2].id, 'agent-1',
      '"planning-options-v1"', expect.anything());
    expect(await screen.findByText('Operación asignada a Marta Castillo.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /^Asignación de/ })).not.toBeInTheDocument();
    await waitFor(() => expect(services.getPlanningSnapshot.mock.calls.length).toBeGreaterThan(reads));
  });

  it('the safety poll of the planning never reloads the options of an open assignment drawer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      const services = consoleServices();
      renderConsole({ services });
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      const item = within(pendingRegion()).getByText(/ZZ500 sin agente/).closest('li');
      act(() => { fireEvent.click(within(item).getByRole('button', { name: 'Asignar agente' })); });
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      const drawer = screen.getByRole('dialog', { name: /^Asignación de/ });
      expect(drawer).toHaveTextContent('success');
      expect(getPlanningOptions).toHaveBeenCalledOnce();
      const reads = services.getPlanningSnapshot.mock.calls.length;
      // A minute later the planning re-reads on its poll; the agents OCC is choosing from stay as they are.
      await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
      expect(services.getPlanningSnapshot.mock.calls.length).toBeGreaterThan(reads);
      expect(getPlanningOptions).toHaveBeenCalledOnce();
      expect(drawer).toHaveTextContent('success');
      expect(opened.drawerProps.dataRevision).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('releasing an agent from the drawer says so in the words of the console', async () => {
    renderConsole();
    await boardReady();
    const item = (await within(pendingRegion()).findByText(/ZZ500 sin agente/)).closest('li');
    await userEvent.click(within(item).getByRole('button', { name: 'Asignar agente' }));
    const drawer = await screen.findByRole('dialog', { name: /^Asignación de/ });
    await userEvent.click(within(drawer).getByRole('button', { name: 'Liberar agente' }));
    expect(await screen.findByText('Agente liberado. Ya puedes asignar a otro.')).toBeInTheDocument();
    // A release is a change of the console's own: the drawer reads again what it shows.
    expect(opened.drawerProps.dataRevision).toBe(1);
  });

  it('a new demo arrival shows Llegada nueva with Ver y seguir, which writes flightId and follow=1', async () => {
    const demo = { on: false };
    const shell = shellWith();
    renderConsole({ mapService: simulatedMap(demo), shell });
    await boardReady();
    // The first read only learns what is there: nothing is announced.
    expect(screen.queryByText(/Llegada nueva/)).not.toBeInTheDocument();
    // The superadministrator fires the demo flight: occ_planning re-reads the map flights.
    demo.on = true;
    act(() => shell.announce(['occ_planning']));
    const pill = await screen.findByText('Llegada nueva: ZZ9001', {}, { timeout: 6_000 });
    const status = pill.closest('[role="status"]');
    expect(within(status).getByText('Demo')).toBeInTheDocument();
    // The board lists it with «Demo» and «Llegada sin posición asignada», still to import.
    expect(board()).toHaveTextContent('ZZ9001');
    expect(board()).toHaveTextContent('Llegada sin posición asignada');
    await userEvent.click(within(status).getByRole('button', { name: 'Ver y seguir' }));
    await waitFor(() => expect(search().get('flightId')).toBe(DEMO_FLIGHT_KEYS.arrival));
    // follow=1 once the URL has the flight and its view: a view the page asks for ends follow mode (PR M6).
    await waitFor(() => expect(search().get('follow')).toBe('1'));
    // The map flies to the view that follows it: a demo flight in approach.
    expect(search().get('view')).toBe('approach');
    expect(screen.queryByText('Llegada nueva: ZZ9001')).not.toBeInTheDocument();
    expect(screen.getByTestId('occ-console-provenance')).toHaveTextContent('Incluye un vuelo demo.');
  }, 15_000);

  it('a demo flight already on its way when the console opens shows Llegada nueva, until it is closed', async () => {
    // The superadministrator fired the flight before OCC opened the console: it comes in the first read of the flights.
    renderConsole({ mapService: simulatedMap({ on: true }) });
    await boardReady();
    const announced = await screen.findByText('Llegada nueva: ZZ9001');
    // In the area the panels leave (under «Mostrar paneles» too, on the maximised map), and no wider than it: it wraps
    // rather than run over a panel or the control column.
    const place = announced.closest('[data-occ-arrival-place]');
    expect(place.style.top).toContain('--occ-map-inset-top');
    expect(place.style.left).toContain('--occ-map-inset-left');
    expect(place.style.maxWidth).toContain('--occ-map-inset-left');
    expect(place.style.maxWidth).toContain('--occ-map-clear-right');
    // Opened again (a reload, or back from another module) before anyone acted on it: it is still news.
    cleanup();
    renderConsole({ mapService: simulatedMap({ on: true }) });
    await boardReady();
    const pill = (await screen.findByText('Llegada nueva: ZZ9001')).closest('[role="status"]');
    await userEvent.click(within(pill).getByRole('button', { name: 'Ver y seguir' }));
    await waitFor(() => expect(search().get('flightId')).toBe(DEMO_FLIGHT_KEYS.arrival));
    // follow=1 once the URL has the flight and its view: a view the page asks for ends follow mode (PR M6).
    await waitFor(() => expect(search().get('follow')).toBe('1'));
    expect(search().get('view')).toBe('approach');
    expect(screen.queryByText(/Llegada nueva/)).not.toBeInTheDocument();
    // «Ver y seguir» closed it for the tab: opening the console again does not announce it, though the board lists it.
    cleanup();
    renderConsole({ mapService: simulatedMap({ on: true }) });
    await boardReady();
    await waitFor(() => expect(board()).toHaveTextContent('ZZ9001'));
    expect(screen.queryByText(/Llegada nueva/)).not.toBeInTheDocument();
  }, 15_000);

  it('«Cerrar» on Llegada nueva keeps that flight closed when the console opens again', async () => {
    renderConsole({ mapService: simulatedMap({ on: true }) });
    await boardReady();
    const pill = (await screen.findByText('Llegada nueva: ZZ9001')).closest('[role="status"]');
    await userEvent.click(within(pill).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByText(/Llegada nueva/)).not.toBeInTheDocument();
    // Nothing was selected: «Cerrar» only closes.
    expect(search().has('flightId')).toBe(false);
    cleanup();
    renderConsole({ mapService: simulatedMap({ on: true }) });
    await boardReady();
    await waitFor(() => expect(board()).toHaveTextContent('ZZ9001'));
    expect(screen.queryByText(/Llegada nueva/)).not.toBeInTheDocument();
  });

  it('an unavailable engine renders the same panels in a grid', async () => {
    fake.state.reset({ constructorError: new GPUInitializationError() });
    renderConsole();
    await waitFor(() => expect(document.querySelector('[data-occ-console]')).toHaveAttribute('data-occ-console', 'grid'));
    await boardReady();
    for (const id of ['board', 'alerts', 'figures', 'positions']) expect(panelOf(id)).toHaveAttribute('data-layout', 'grid');
    // The map stays in its place with its list, and its dock is gone.
    const fallback = screen.getByTestId('map-unavailable');
    expect(within(fallback).getByRole('heading', { name: 'El mapa no está disponible' })).toBeInTheDocument();
    expect(screen.queryByTestId('map-preset-switcher')).not.toBeInTheDocument();
    // A stand chosen from the list is the selection of the console, with its inspector.
    await userEvent.click(within(within(fallback).getByRole('group', { name: 'Posiciones del mapa' }))
      .getByRole('button', { name: 'A5' }));
    await waitFor(() => expect(search().get('stand')).toBe('A5'));
    expect(await screen.findByRole('region', { name: 'Inspector' })).toHaveAttribute('data-layout', 'grid');
    // The status bar closes the grid, under the map's list: there is no map for it to float over, nor panels to hide.
    const bar = statusBar();
    expect(bar.parentElement).toHaveAttribute('data-occ-console-panels', 'grid');
    expect(screen.getByTestId('occ-map')).not.toContainElement(bar);
    expect(within(bar).queryByRole('button', { name: 'Ocultar paneles' })).not.toBeInTheDocument();
    // Without a strip of figures over a map, the band's pill says the figures of the day.
    expect(bandSummary()).toHaveTextContent('Escalas');
    expect(bandSummary()).toHaveTextContent('En operación');
  });

  it('a phone opens every panel folded', async () => {
    vi.stubGlobal('matchMedia', screenOf(600));
    renderConsole();
    await boardReady();
    for (const id of ['board', 'alerts', 'figures', 'positions']) expect(panelOf(id)).toHaveAttribute('data-folded', 'true');
  });

  it('below 1440 px only the board opens: the figures, the alerts and the band open folded (M1)', async () => {
    vi.stubGlobal('matchMedia', screenOf(1366));
    renderConsole();
    await boardReady();
    expect(panelOf('board')).toHaveAttribute('data-folded', 'false');
    for (const id of ['alerts', 'figures', 'positions']) expect(panelOf(id)).toHaveAttribute('data-folded', 'true');
    // The strip of figures says «Cifras» on its pill there, and keeps its whole name.
    expect(within(region('Cifras de la jornada')).getByRole('button', { name: 'Cifras de la jornada' }))
      .toHaveTextContent('Cifras');
  });

  it('from 1440 px the board, the alerts and the figures open, and the band folds', async () => {
    vi.stubGlobal('matchMedia', screenOf(1440));
    renderConsole();
    await boardReady();
    for (const id of ['board', 'alerts', 'figures']) expect(panelOf(id)).toHaveAttribute('data-folded', 'false');
    expect(panelOf('positions')).toHaveAttribute('data-folded', 'true');
    // Under the strip of figures, the band's pill does not say them again.
    expect(bandSummary()).not.toHaveTextContent(/Escalas|En operación/);
  });

  it('open panels and the status bar become map insets', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    renderConsole();
    await boardReady();
    const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height,
      x: left, y: top, toJSON() { return this; } });
    // The map's box at 1400 × 800, and the panels where the overlay floats them: 12 px in from the edges of the map and
    // 12 px apart, short of the control column's reserve at the right (112 px), over the status bar.
    document.querySelector('[data-occ-console-map]').getBoundingClientRect = () => rect(0, 0, 1400, 800);
    panelOf('board').getBoundingClientRect = () => rect(12, 12, 384, 560);
    panelOf('alerts').getBoundingClientRect = () => rect(12, 584, 384, 152);
    panelOf('figures').getBoundingClientRect = () => rect(408, 12, 880, 56);
    panelOf('positions').getBoundingClientRect = () => rect(408, 696, 880, 40);
    statusBar().getBoundingClientRect = () => rect(12, 748, 1276, 40);
    await remeasure();
    const map = screen.getByTestId('occ-map');
    expect(map.style.getPropertyValue('--occ-map-inset-left')).toBe('404px');
    // Nothing floats at the right: the control column keeps its reserve without taking room from the camera.
    expect(map.style.getPropertyValue('--occ-map-inset-right')).toBe('0px');
    expect(map.style.getPropertyValue('--occ-map-inset-top')).toBe('76px');
    // The folded band is a pill over the status bar: only its height counts, from the higher of the two.
    expect(map.style.getPropertyValue('--occ-map-inset-bottom')).toBe('112px');

    // Folding the board leaves its pill at the top, and «Alertas» keep the column: the left edge is still theirs.
    await userEvent.click(within(board()).getByRole('button', { name: 'Tablero' }));
    panelOf('board').getBoundingClientRect = () => rect(12, 12, 132, 40);
    await remeasure();
    expect(map.style.getPropertyValue('--occ-map-inset-left')).toBe('404px');
    expect(map.style.getPropertyValue('--occ-map-inset-top')).toBe('76px');
    // Folded too, «Alertas» are a pill at the foot of the column: the left edge is the map's again.
    await userEvent.click(within(region('Alertas')).getByRole('button', { name: 'Alertas' }));
    panelOf('alerts').getBoundingClientRect = () => rect(12, 696, 132, 40);
    await remeasure();
    expect(map.style.getPropertyValue('--occ-map-inset-left')).toBe('0px');
    expect(map.style.getPropertyValue('--occ-map-inset-bottom')).toBe('112px');
  });

  it('at 1366 × 768 the panels that open leave the map far more than its least visible area (M1)', async () => {
    vi.stubGlobal('matchMedia', screenOf(1366));
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    layOutPanels(PLACES_1366);
    renderConsole();
    await boardReady();
    await remeasure();
    const inset = side => Number.parseFloat(screen.getByTestId('occ-map').style.getPropertyValue(`--occ-map-inset-${side}`));
    const insets = () => ({ top: inset('top'), right: inset('right'), bottom: inset('bottom'), left: inset('left') });
    const [, , width, height] = PLACES_1366.map;
    // The open board at the left, the pills of «Cifras» at the top and of the band and «Alertas» over the status bar.
    expect(insets()).toEqual({ top: 60, right: 0, bottom: 112, left: 404 });
    // More than the least the map keeps in sight, so none of that room was given back (maps/ui/stageInsets.js), and
    // more than half of the map across and down.
    const across = width - inset('left') - inset('right');
    const down = height - inset('top') - inset('bottom');
    expect(across).toBeGreaterThan(MIN_VISIBLE_MAP_PX.width);
    expect(down).toBeGreaterThan(MIN_VISIBLE_MAP_PX.height);
    expect(across / width).toBeGreaterThan(0.5);
    expect(down / height).toBeGreaterThan(0.5);

    // A stand chosen: its inspector opens under the board, in the same column, and the map keeps its width.
    cleanup();
    FakeResizeObserver.instances = [];
    renderConsole({ url: `${PAGE}?stand=B24` });
    await boardReady();
    await screen.findByRole('region', { name: 'Inspector' });
    await remeasure();
    expect(panelOf('inspector').closest('[data-occ-console-side]')).toBeNull();
    expect(insets()).toEqual({ top: 60, right: 0, bottom: 112, left: 404 });
  });

  it('Escalas filters by derived resource state and labels a demo turnaround «Demo», and no other', async () => {
    const services = consoleServices({
      getPlanningSnapshot: vi.fn(async ({ stationId }) => {
        const snapshot = planningSnapshot({ now: Date.now(), stationId });
        return { ...snapshot, turnarounds: snapshot.turnarounds.map(turnaround => (
          turnaround.arrival.flightNumber === 'ZZ610' ? { ...turnaround, isDemo: true } : turnaround)) };
      }),
    });
    renderConsole({ services });
    await boardReady();
    await userEvent.click(within(board()).getByRole('tab', { name: /Escalas/ }));
    const visits = () => [...board().querySelectorAll('[data-occ-visit]')];
    await waitFor(() => expect(visits()).toHaveLength(5));
    const filters = within(board()).getByRole('group', { name: 'Filtrar escalas' });
    await userEvent.click(within(filters).getByRole('button', { name: /Sin recursos/ }));
    expect(visits().map(visit => visit.textContent)).toEqual([expect.stringContaining('ZZ500'),
      expect.stringContaining('ZZ610')]);
    expect(visits()[0]).toHaveTextContent('sin agente');
    expect(visits()[1]).toHaveTextContent('sin posición, sin agente');
    // ADR-0041: the demo turnaround carries «Demo» next to its code, and no other row does.
    expect(within(visits()[1]).getByText('Demo')).toBeInTheDocument();
    expect(within(visits()[0]).queryByText('Demo')).not.toBeInTheDocument();
    await userEvent.click(within(filters).getByRole('button', { name: /Completadas/ }));
    expect(visits().map(visit => visit.textContent)).toEqual([expect.stringContaining('ZZ700')]);
  });

  it('the board names in its header the marks of the tab on screen, and only those', async () => {
    renderConsole({ mapService: simulatedMap({ on: true }) });
    await boardReady();
    const legend = () => within(board()).queryByRole('list', { name: 'Leyenda del tablero' });
    const legendKeys = () => [...(legend()?.querySelectorAll('[data-occ-legend-item]') ?? [])]
      .map(item => item.getAttribute('data-occ-legend-item'));
    // What the tab's body draws: the glyph of a signal, the «Demo» and «est.» tags and the delay chip (CN-32).
    const markSelector = key => {
      if (key === 'demo' || key === 'estimated') return `[data-occ-tag="${key}"]`;
      return key === 'delay' ? '[data-occ-delay]' : `[data-occ-glyph="${key}"]`;
    };
    const marksOf = body => BOARD_LEGEND_KEYS.filter(key => body.querySelector(markSelector(key)) !== null);
    const body = () => board().querySelector('[role="tabpanel"]');

    // «Llegadas»: the demo arrival still to import, without a stand and due within the hour; the map draws its aircraft
    // where its demo clock puts it (PR M6), an estimated position, so its strip also says «est.».
    await waitFor(() => expect(body()).toHaveTextContent('ZZ9001'));
    await waitFor(() => expect(legendKeys()).toEqual(marksOf(body())));
    expect(legendKeys()).toEqual(expect.arrayContaining(['attention', 'demo', 'estimated']));
    expect(legend()).toHaveTextContent('Atención');
    expect(legend()).toHaveTextContent('Simulado para la demostración');
    expect(within(legend()).getByText('Demo')).toHaveAttribute('data-occ-tag', 'demo');
    // In the header, never in the body it explains.
    expect(body()).not.toContainElement(legend());
    for (const tab of ['Salidas', 'Escalas', 'Llegadas']) {
      await userEvent.click(within(board()).getByRole('tab', { name: new RegExp(`^${tab}`) }));
      expect(legendKeys(), tab).toEqual(marksOf(body()));
    }
    // «Escalas» lists visits without a stand or an agent: its legend says what their amber triangle means.
    await userEvent.click(within(board()).getByRole('tab', { name: /^Escalas/ }));
    expect(legendKeys()).toContain('attention');
    // Folded, the board explains nothing.
    await userEvent.click(within(board()).getByRole('button', { name: 'Tablero' }));
    expect(legend()).toBeNull();
  });

  it('?focus=map hides the panels behind «Mostrar paneles», and keeps the status bar over the map', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    layOutPanels();
    renderConsole({ url: `${PAGE}?focus=map` });
    expect(await screen.findByRole('button', { name: 'Mostrar paneles' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Tablero' })).not.toBeInTheDocument();
    // The status bar stays, still measured: only its height is taken from the map, at the bottom; «Mostrar paneles»
    // takes its own at the top, so the pill of a new arrival opens under it, never over it.
    const map = screen.getByTestId('occ-map');
    expect(map).toContainElement(statusBar());
    expect(await within(statusBar()).findByTestId('occ-console-provenance')).toBeInTheDocument();
    expect(within(statusBar()).queryByRole('button', { name: 'Ocultar paneles' })).not.toBeInTheDocument();
    expect(statusBar()).not.toContainElement(screen.getByRole('button', { name: 'Mostrar paneles' }));
    await remeasure();
    expect(['top', 'right', 'bottom', 'left'].map(side => map.style.getPropertyValue(`--occ-map-inset-${side}`)))
      .toEqual(['52px', '0px', '60px', '0px']);

    await userEvent.click(screen.getByRole('button', { name: 'Mostrar paneles' }));
    await waitFor(() => expect(search().has('focus')).toBe(false));
    expect(await screen.findByRole('region', { name: 'Tablero' })).toBeInTheDocument();
    await userEvent.click(within(statusBar()).getByRole('button', { name: 'Ocultar paneles' }));
    await waitFor(() => expect(search().get('focus')).toBe('map'));
  });
});

// The panels never cover what is chosen (contratos 2.5): the room they take from the map changes the map's padding, so
// the console moves the camera only once the panels are measured for the selection, and brings what is chosen back
// when a change of the room covers it. The fake MapLibre answers `project` around the middle of its viewport and
// applies every move at once; `cameraCalls` keeps their order.
describe('the camera around the panels', () => {
  /**
   * The console on a laid-out screen `width` px wide (PANEL_PLACES), its engine ready, and `code` drawn at `pixel` after
   * the opening view. `folded`: the person folded «Tablero», «Alertas» and «Cifras» earlier in the tab (the band opens
   * folded anyway), so only their pills take room until something is chosen.
   */
  async function consoleWithStandAt(code, pixel, { folded = true, width = 1440, url = PAGE } = {}) {
    vi.stubGlobal('matchMedia', screenOf(width));
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    if (folded) for (const panelId of ['board', 'alerts', 'figures']) writePanelFolded(panelId, true);
    layOutPanels();
    const { map } = renderConsole({ url });
    await boardReady();
    await act(async () => fake.state.emit(map, 'style.load'));
    const point = standCentre(code);
    act(() => drawAt(map, point, pixel));
    return { map, point };
  }

  it('a stand chosen on the map where the inspector opens comes back into sight, at the same zoom', async () => {
    // Every panel a pill: the left edge is the map's until something is chosen.
    const { map, point } = await consoleWithStandAt('B24', [150, 450]);
    expect(screen.getByTestId('occ-map').style.getPropertyValue('--occ-map-inset-left')).toBe('0px');
    const zoom = map.getZoom();
    const from = map.cameraCalls.length;
    await clickStand(map, 'B24', [150, 450], point);
    await waitFor(() => expect(search().get('stand')).toBe('B24'));
    expect(await screen.findByRole('region', { name: 'Inspector' })).toBeInTheDocument();
    // Below 1536 px the inspector opens in the left column, 404 px from the left, where B24 was: once the map has that
    // room, B24 is in its middle.
    const padded = paddedSince(map, from, 'left', 404);
    expect(padded).toBeGreaterThanOrEqual(0);
    expect(movedToSince(map, from, point)).toBeGreaterThan(padded);
    expect(near(map.getCenter(), point)).toBe(true);
    expect(map.getZoom()).toBeCloseTo(zoom, 6);
  });

  it('a stand chosen on the map that the inspector leaves in sight keeps the camera where it is', async () => {
    const { map, point } = await consoleWithStandAt('B24', [600, 450]);
    const centre = map.getCenter();
    const from = map.cameraCalls.length;
    await clickStand(map, 'B24', [600, 450], point);
    await screen.findByRole('region', { name: 'Inspector' });
    expect(paddedSince(map, from, 'left', 404)).toBeGreaterThanOrEqual(0);
    expect(movesSince(map, from)).toEqual([]);
    expect(near(map.getCenter(), [centre.lng, centre.lat])).toBe(true);
  });

  it('a panel unfolded over what is chosen brings it back, but not what a person moved out of sight', async () => {
    const { map, point } = await consoleWithStandAt('B24', [700, 700], { url: `${PAGE}?stand=B24` });
    await screen.findByRole('region', { name: 'Inspector' });
    const zoom = map.getZoom();
    let from = map.cameraCalls.length;
    // «Posiciones» opens 320 px high over B24, which its pill over the status bar left in sight.
    await userEvent.click(within(region('Posiciones')).getByRole('button', { name: 'Posiciones', exact: true }));
    await remeasure();
    expect(paddedSince(map, from, 'bottom', 320)).toBeGreaterThanOrEqual(0);
    expect(near(map.getCenter(), point)).toBe(true);
    expect(map.getZoom()).toBeCloseTo(zoom, 6);

    // A person drags B24 far out of sight; folding the band leaves the camera where they put it.
    act(() => map.jumpTo({ center: [point[0] + 0.05, point[1]], originalEvent: { type: 'mousemove' } }));
    const dragged = map.getCenter();
    from = map.cameraCalls.length;
    await userEvent.click(within(region('Posiciones')).getByRole('button', { name: 'Posiciones', exact: true }));
    await remeasure();
    expect(paddedSince(map, from, 'bottom', 112)).toBeGreaterThanOrEqual(0);
    expect(movesSince(map, from)).toEqual([]);
    expect(near(map.getCenter(), [dragged.lng, dragged.lat])).toBe(true);
  });

  it('a strip chosen on a wide screen flies to its flight only once the inspector\'s column is measured', async () => {
    // From 1536 px (a map of 1440 px beside the open navigation rail) the inspector floats in a column of its own, left
    // of the control column: until something is chosen nothing floats at the right.
    const { map } = await consoleWithStandAt('B24', [600, 450], { folded: false, width: 1688 });
    expect(screen.getByTestId('occ-map').style.getPropertyValue('--occ-map-inset-right')).toBe('0px');
    const onFinal = airPicture({ now: Date.now() }).aircraft.find(item => item.hex === CONSOLE_HEX.onFinal);
    const aircraft = [onFinal.longitude, onFinal.latitude];
    const from = map.cameraCalls.length;
    await userEvent.click(within(board()).getByRole('button', { name: /ZZ161/ }));
    await waitFor(() => expect(search().get('flightId')).toBe(ARRIVAL_ON_FINAL_KEY));
    const inspector = await screen.findByRole('region', { name: 'Inspector' });
    expect(inspector.closest('[data-occ-console-side]')).not.toBeNull();
    // Its width, the column's reserve and the gap: 472 px. A move made before that room would stop half-way at the
    // jump of the new padding.
    const padded = paddedSince(map, from, 'right', 472);
    expect(padded).toBeGreaterThanOrEqual(0);
    expect(movedToSince(map, from, aircraft, AIRCRAFT_TOLERANCE)).toBeGreaterThan(padded);
    expect(near(map.getCenter(), aircraft, AIRCRAFT_TOLERANCE)).toBe(true);
  });

  /** The console with a demo flight on its way whose aircraft the map draws, and «Ver y seguir» pressed. */
  async function followDemoArrival() {
    const demoFix = nowMs => ({ ...airPicture({ now: nowMs, trails: 'none' }).aircraft[0], hex: 'f1c901',
      callsign: 'ZZZ9001', registration: 'ZZ-TST5', latitude: 18.48, longitude: -68.62,
      matchedFlightKey: DEMO_FLIGHT_KEYS.arrival, matchedBy: 'Callsign', trail: [] });
    const mapService = createSimulatedOccMapAdapter({ scenario: {
      picture: ({ nowMs, stationId, trails }) => {
        const picture = airPicture({ now: nowMs, stationId, trails });
        return { ...picture, aircraft: [...picture.aircraft, demoFix(nowMs)] };
      },
      flights: ({ nowMs, stationId }) => mapFlights({ now: nowMs, stationId, demo: true }),
    } });
    const { map } = renderConsole({ mapService });
    await boardReady();
    await act(async () => fake.state.emit(map, 'style.load'));
    const pill = (await screen.findByText('Llegada nueva: ZZ9001')).closest('[role="status"]');
    await userEvent.click(within(pill).getByRole('button', { name: 'Ver y seguir' }));
    await waitFor(() => expect(search().get('flightId')).toBe(DEMO_FLIGHT_KEYS.arrival));
    // First the view that follows it, Aproximación, not yet on the aircraft.
    await waitFor(() => expect(screen.getByTestId('occ-map')).toHaveAttribute('data-occ-view', 'approach'));
    return { map, aircraft: [-68.62, 18.48] };
  }

  it('«Ver y seguir» frames the view that follows the flight, then follows its aircraft on the frames', async () => {
    const { map, aircraft } = await followDemoArrival();
    const zoom = map.getZoom();
    expect(near(map.getCenter(), aircraft, AIRCRAFT_TOLERANCE)).toBe(false);
    await act(async () => fake.state.emit(map, 'idle'));
    // Follow mode (PR M6) frames the moving aircraft with its next objective, the airport: the camera runs with it,
    // between the aircraft and PUJ, at the zoom of the view.
    await waitFor(() => expect(search().get('follow')).toBe('1'));
    await waitFor(() => {
      const { lng, lat } = map.getCenter();
      expect(lng).toBeGreaterThan(aircraft[0]);
      expect(lng).toBeLessThan(-68.36);
      expect(lat).toBeGreaterThan(aircraft[1]);
    });
    expect(map.getZoom()).toBeCloseTo(zoom, 6);
    expect(screen.getByTestId('occ-map')).toHaveAttribute('data-occ-view', 'approach');
    // The console's dock moves its traffic like the other OCC maps and offers «Pausar movimiento»; paused, the button
    // says «Reanudar movimiento» without a status line, so the dock stays one row beside the panels.
    await userEvent.click(screen.getByRole('button', { name: 'Pausar movimiento' }));
    expect(screen.getByRole('button', { name: 'Reanudar movimiento' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByTestId('map-motion-control')).queryByRole('status')).toBeNull();
  });

  it('«Ver y seguir» leaves the camera to a person who moves it before the map settles', async () => {
    const { map, aircraft } = await followDemoArrival();
    // A drag: it ends follow mode too (PR M6), so the frames leave the camera where the person put it.
    act(() => fake.state.emit(map, 'dragstart', { originalEvent: new MouseEvent('mousedown') }));
    act(() => map.jumpTo({ center: [-68.3, 18.6], originalEvent: { type: 'mousemove' } }));
    const from = map.cameraCalls.length;
    // The map settles, and what waited for it has run by the next task.
    await act(async () => {
      fake.state.emit(map, 'idle');
      await new Promise(resolve => { setTimeout(resolve, 0); });
    });
    expect(movedToSince(map, from, aircraft, AIRCRAFT_TOLERANCE)).toBe(-1);
    expect(near(map.getCenter(), [-68.3, 18.6])).toBe(true);
  });
});

describe('honesty of the console states', () => {
  it('fails closed when the station day is refused, and never shows the error text of the server', async () => {
    const refused = Object.assign(new Error('forbidden'), { status: 403 });
    renderConsole({ services: consoleServices({ getPlanningSnapshot: vi.fn(async () => { throw refused; }) }) });
    await boardReady();
    await waitFor(() => expect(region('Cifras de la jornada'))
      .toHaveTextContent('No hay una estación OCC autorizada para consultar este panorama.'));
    cleanup();

    const services = consoleServices({ getPlanningSnapshot: vi.fn(async () => { throw new Error('SQL password=secret'); }) });
    renderConsole({ services });
    await boardReady();
    const figures = region('Cifras de la jornada');
    await waitFor(() => expect(within(figures).getByRole('alert'))
      .toHaveTextContent('No se pudo cargar el panorama operativo de la estación.'));
    expect(screen.queryByText(/password=secret/)).not.toBeInTheDocument();
    const reads = services.getPlanningSnapshot.mock.calls.length;
    await userEvent.click(within(figures).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(services.getPlanningSnapshot.mock.calls.length).toBeGreaterThan(reads));
  });

  it('a day without turnarounds still lists what is pending from the other reads, and counts its figures', async () => {
    const services = consoleServices({ getPlanningSnapshot: vi.fn(async ({ stationId }) => ({
      ...planningSnapshot({ now: Date.now(), stationId }), turnarounds: [] })) });
    renderConsole({ services, mapService: simulatedMap({ on: true }) });
    await boardReady();
    // The demo flight waits to be imported and the queue has a hand-off: the planning's empty day hides neither.
    await waitFor(() => expect(within(pendingRegion()).getByText(/ZZ9001 por importar/)).toBeInTheDocument());
    const day = stationDay().replaceAll('-', '');
    await waitFor(() => expect(within(pendingRegion()).getByText(`PUJ-${day}-005 por revisar`)).toBeInTheDocument());
    expect(within(pendingRegion()).queryByText('No hay pendientes.')).not.toBeInTheDocument();
    // The figures of an empty day are counted zeros, next to those the other reads answer.
    const figures = region('Cifras de la jornada');
    await waitFor(() => expect(figureOf('Escalas')).toBe('0'));
    expect(figureOf('En operación')).toBe('0');
    expect(figureOf('Completadas')).toBe('0');
    expect(Number.parseInt(figureOf('Por revisar').replace(/\D/g, ''), 10)).toBeGreaterThan(0);
    expect(figures).not.toHaveTextContent('No hay datos para mostrar.');
  });

  it('a refused or failing read blanks only its own pending items, and says so', async () => {
    const refused = Object.assign(new Error('forbidden'), { status: 403 });
    renderConsole({ services: consoleServices({ getPlanningSnapshot: vi.fn(async () => { throw refused; }) }),
      mapService: simulatedMap({ on: true }) });
    await boardReady();
    const day = stationDay().replaceAll('-', '');
    // The items of the map flights and of the review queue stay, under the line of the refused planning.
    await waitFor(() => expect(within(pendingRegion()).getByText(/ZZ9001 por importar/)).toBeInTheDocument());
    await waitFor(() => expect(within(pendingRegion()).getByText(`PUJ-${day}-005 por revisar`)).toBeInTheDocument());
    expect(within(pendingRegion()).getByText('No tienes permiso para ver la planificación del día.')).toBeInTheDocument();
    expect(within(pendingRegion()).queryByText('No hay pendientes.')).not.toBeInTheDocument();
    expect(pendingRegion()).not.toHaveTextContent(NO_STATION);
    // The figures keep the old Panorama's refusal of the station's day.
    await waitFor(() => expect(region('Cifras de la jornada')).toHaveTextContent(NO_STATION));
    cleanup();

    // A failing queue: its line with «Reintentar», which reads it again, and the planning's items stay.
    const queue = vi.fn(async () => { throw new Error('SQL password=secret'); });
    renderConsole({ services: consoleServices({ loadOccReviewQueue: queue }) });
    await boardReady();
    await waitFor(() => expect(within(pendingRegion()).getByText(/ZZ500 sin agente/)).toBeInTheDocument());
    const line = await within(pendingRegion()).findByText('La consulta de la cola de revisión falló.');
    expect(within(pendingRegion()).queryByText('No hay pendientes.')).not.toBeInTheDocument();
    expect(screen.queryByText(/password=secret/)).not.toBeInTheDocument();
    const reads = queue.mock.calls.length;
    await userEvent.click(within(line.closest('li')).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(queue.mock.calls.length).toBeGreaterThan(reads));
  });

  it('a panel the account may not read says so in plain words, never that the station is not authorized', async () => {
    const services = consoleServices();
    renderConsole({ services, access: accessWithout('operations.positions_map.read') });
    await boardReady();
    const positions = region('Posiciones');
    await waitFor(() => expect(positions).toHaveTextContent(NO_PERMISSION));
    expect(positions).not.toHaveTextContent(NO_STATION);
    // Nothing is asked for it, and the other panels read as usual.
    expect(services.loadOccPositions).not.toHaveBeenCalled();
    await waitFor(() => expect(figureOf('Escalas')).toMatch(/^\d+$/));
    cleanup();

    // Without any of the map's permissions the board is refused as well, in the same plain words.
    renderConsole({ access: accessWithout('operations.dashboard.read', 'operations.flight_monitoring.read',
      'operations.positions_map.read', 'operations.planning.read') });
    await waitFor(() => expect(board()).toHaveTextContent(NO_PERMISSION));
    expect(board()).not.toHaveTextContent(NO_STATION);
    expect(board()).not.toHaveTextContent('La sesión expiró');
    // The planning's own refusal keeps its words.
    await waitFor(() => expect(region('Cifras de la jornada')).toHaveTextContent(NO_STATION));
  });

  it('shows the loading state without asserting zero as a business fact', async () => {
    const never = () => new Promise(() => {});
    renderConsole({
      services: consoleServices({ getPlanningSnapshot: vi.fn(never), loadOccPositions: vi.fn(never),
        loadOccReviewQueue: vi.fn(never) }),
      mapService: { ...simulatedMap(), getMapFlights: vi.fn(never), getAirPicture: vi.fn(never) },
    });
    expect(await screen.findAllByRole('status')).not.toHaveLength(0);
    expect(screen.getAllByRole('status').some(item => item.textContent.includes('Cargando panorama'))).toBe(true);
    expect(screen.queryByText('ZZ161')).not.toBeInTheDocument();
    // No figure claims a count nobody made.
    expect(region('Cifras de la jornada').querySelectorAll('[data-occ-stat]')).toHaveLength(0);
  });

  it('keeps the last data visible and says so when a background refresh fails', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      let fail = false;
      const services = consoleServices({ getPlanningSnapshot: vi.fn(async ({ stationId }) => {
        if (fail) throw new Error('down');
        return planningSnapshot({ now: Date.now(), stationId });
      }) });
      renderConsole({ services });
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      const figures = region('Cifras de la jornada');
      expect(within(figures).getAllByRole('definition').length).toBeGreaterThan(0);
      fail = true;
      // The safety poll re-reads the planning after 60 s, and it fails.
      await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
      expect(within(figures).getByRole('status')).toHaveTextContent('La última actualización falló');
      expect(within(figures).getAllByRole('definition').length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the weather pill', () => {
  const pill = () => screen.getByRole('button', { name: /Viento|observación|meteorológica/ });

  it('shows the MDPC observation with its wind, QNH, age and unofficial source, and its detail', async () => {
    weatherView.current = weatherOf('success', observation(20));
    renderConsole();
    expect(pill()).toHaveTextContent('Viento 100° · 13 kt · ráfagas 25 kt');
    expect(pill()).toHaveTextContent('QNH 1015');
    expect(pill()).toHaveTextContent('hace 20 min');
    expect(pill()).toHaveTextContent('No oficial');
    expect(pill()).not.toHaveTextContent('Desactualizado');
    await userEvent.click(pill());
    const detail = screen.getByRole('dialog', { name: 'Meteorología · Punta Cana (MDPC)' });
    expect(within(detail).getByText('1015 hPa')).toBeInTheDocument();
    expect(within(detail).getByText('Escasas 2,200 ft')).toBeInTheDocument();
    expect(within(detail).getByText(/Observado .* UTC/)).toBeInTheDocument();
    expect(within(detail).getByText('34 °C')).toBeInTheDocument();
    expect(within(detail).getByText('MDPC 111900Z 10013G25KT 9999 FEW022 30/23 Q1015')).toBeInTheDocument();
    expect(within(detail).queryByText(/LIVE|En vivo/i)).not.toBeInTheDocument();
    // The imagery of NASA GIBS, on the maps lane's satellite map, only while the detail is open.
    expect(within(detail).getByRole('button', { name: 'GOES-East' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(detail).getByTestId('goes-cloud-map')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('goes-cloud-map')).not.toBeInTheDocument();
  });

  it('closes its detail on Esc and keeps the selection and the view of the map under it (M1)', async () => {
    weatherView.current = weatherOf('success', observation(20));
    renderConsole({ url: `${PAGE}?stand=A5` });
    await boardReady();
    await screen.findByRole('region', { name: 'Inspector' });
    // The status bar floats inside the map's root, which listens to the map keys; the bar keeps them out.
    const map = screen.getByTestId('occ-map');
    expect(map).toContainElement(pill());
    expect(pill().closest('[data-occ-console-status]')).toHaveAttribute('data-occ-map-keys', 'off');
    const view = map.getAttribute('data-occ-view');
    await userEvent.click(pill());
    const detail = screen.getByRole('dialog', { name: 'Meteorología · Punta Cana (MDPC)' });
    // «2» on a button of the detail is not the map's «Aproximación».
    within(detail).getByRole('button', { name: 'GOES-East' }).focus();
    await userEvent.keyboard('2');
    expect(map.getAttribute('data-occ-view')).toBe(view);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Meteorología · Punta Cana (MDPC)' })).not.toBeInTheDocument();
    expect(search().get('stand')).toBe('A5');
    expect(screen.getByRole('region', { name: 'Inspector' })).toBeInTheDocument();
  });

  it('marks an old observation as outdated and a failed source as unavailable', async () => {
    weatherView.current = weatherOf('success', observation(3 * 60));
    const view = renderConsole();
    expect(pill()).toHaveTextContent('Desactualizado');
    view.unmount();

    const refresh = vi.fn();
    weatherView.current = weatherOf('error', null, { refresh });
    renderConsole();
    expect(pill()).toHaveTextContent('La observación meteorológica no está disponible.');
    await userEvent.click(pill());
    const alert = within(screen.getByRole('dialog', { name: 'Meteorología · Punta Cana (MDPC)' })).getByRole('alert');
    expect(alert).toHaveTextContent('no está disponible');
    await userEvent.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    expect(refresh).toHaveBeenCalled();
  });

  it('shows the GOES-East and IMERG image times with their source, a date-only product and a missing image', async () => {
    vi.mocked(loadSatelliteImageInfo).mockImplementation(layer => Promise.resolve(layer === 'goes'
      ? { time: '2026-09-28T13:00:00Z', precision: 'instant' } : { time: '2026-09-28T09:30:00Z', precision: 'instant' }));
    weatherView.current = weatherOf('success', observation(20));
    renderConsole();
    await userEvent.click(pill());
    const detail = screen.getByRole('dialog', { name: 'Meteorología · Punta Cana (MDPC)' });
    expect(await within(detail).findByText(/Imagen 13:00 UTC/)).toBeInTheDocument();
    expect(within(detail).getByText(/NASA GIBS/)).toBeInTheDocument();
    await userEvent.click(within(detail).getByRole('button', { name: 'IMERG' }));
    expect(await within(detail).findByText(/Imagen 09:30 UTC/)).toBeInTheDocument();
    expect(within(detail).getByText(/antigüedad 25 min/)).toBeInTheDocument();
    expect(within(detail).getByText(/estimada IMERG/)).toBeInTheDocument();
    expect(within(detail).getByText(/no radar/)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    vi.mocked(loadSatelliteImageInfo).mockImplementation(layer => (layer === 'imerg'
      ? Promise.resolve({ time: '2026-09-28', precision: 'day' }) : Promise.reject(new Error('unavailable'))));
    await userEvent.click(pill());
    const again = screen.getByRole('dialog', { name: 'Meteorología · Punta Cana (MDPC)' });
    // The choice of layer is kept between two openings.
    expect(within(again).getByRole('button', { name: 'IMERG' })).toHaveAttribute('aria-pressed', 'true');
    expect(await within(again).findByText(/Producto del día 2026-09-28 UTC/)).toBeInTheDocument();
    expect(within(again).queryByText(/Imagen \d\d:\d\d UTC/)).not.toBeInTheDocument();
    await userEvent.click(within(again).getByRole('button', { name: 'GOES-East' }));
    expect(await within(again).findByText('La imagen satelital no está disponible.')).toBeInTheDocument();
  });
});

describe('the console in English', () => {
  it('renders in English inside the OCC language scope and in Spanish outside it', async () => {
    act(() => resetLanguageForTests('en'));
    renderConsole({ scope: true });
    expect(screen.getByRole('heading', { level: 1, name: 'Operations overview' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Board', exact: true })).toBeInTheDocument();
    expect(await within(region('Alerts')).findByText('Incident reported on the ramp')).toBeInTheDocument();
    cleanup();

    renderConsole();
    expect(screen.getByRole('heading', { level: 1, name: 'Panorama operativo' })).toBeInTheDocument();
  });

  it('says that an agent was released in English too', async () => {
    act(() => resetLanguageForTests('en'));
    renderConsole({ scope: true });
    await within(await screen.findByRole('region', { name: 'Board', exact: true }))
      .findByRole('tablist', { name: 'Board view', hidden: true });
    const pending = within(region('Alerts')).getByRole('region', { name: 'Open items of the day' });
    const item = (await within(pending).findByText(/ZZ500 without an agent/)).closest('li');
    await userEvent.click(within(item).getByRole('button', { name: 'Assign agent' }));
    const drawer = await screen.findByRole('dialog', { name: /^Asignación de/ });
    await userEvent.click(within(drawer).getByRole('button', { name: 'Liberar agente' }));
    expect(await screen.findByText('Agent released. You can assign another one.')).toBeInTheDocument();
    expect(screen.queryByText('Agente liberado. Ya puedes asignar a otro.')).not.toBeInTheDocument();
  });
});
