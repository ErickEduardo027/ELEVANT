import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import DashboardPage from './DashboardPage';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import { parseMetar } from '../weather/metar';
import { loadSatelliteImageInfo } from '../../services/satelliteService';

vi.mock('next/dynamic', () => ({
  default: () => function MapStub({ positions }) {
    return <div data-testid="map-stub">{positions?.length ?? ''}</div>;
  },
}));
vi.mock('../../services/weatherService', () => ({ loadRecentMetars: vi.fn(() => new Promise(() => {})) }));
vi.mock('../../services/satelliteService', () => ({
  loadSatelliteImageInfo: vi.fn(() => new Promise(() => {})),
  imageAgeMinutes: vi.fn(() => 25),
  SATELLITE_OPACITY: { goes: 0.7, imerg: 0.82 },
}));

const stationId = '20000000-0000-7000-8000-000000000003';
const snapshot = { stationId, stationCode: 'PUJ', date: '2026-09-28',
  station: { name: 'Punta Cana', ianaTimeZone: 'America/Santo_Domingo' },
  turnarounds: [{
    id: 'turnaround-one', operationCode: 'DEV-TAT-0001', status: 'Scheduled',
    airline: { name: 'Synthetic Air' },
    arrival: { flightNumber: 'EV 101', scheduledAt: '2026-09-28T14:00:00Z' },
    departure: { flightNumber: 'EV 102' },
    stand: { code: 'A1' },
    agents: [{ agentId: 'agent-one', displayName: 'Agente Uno' }], services: [],
  }, {
    id: 'turnaround-two', operationCode: 'DEV-TAT-0002', status: 'Confirmed',
    airline: { name: 'Synthetic Air' },
    arrival: { flightNumber: 'EV 201', scheduledAt: '2026-09-28T16:00:00Z' },
    agents: [], services: [],
  }],
  reviews: [
    { operationId: 'operation-one', operationCode: 'DEV-TAT-0001', status: 'PendingReview',
      airlineName: 'Synthetic Air', agentName: 'Agente Uno', submittedAt: '2026-09-28T12:00:00Z', incidentCount: 1 },
    { operationId: 'operation-three', operationCode: 'DEV-TAT-0003', status: 'Approved',
      airlineName: 'Synthetic Air', agentName: 'Agente Tres', submittedAt: '2026-09-28T11:00:00Z' },
  ],
  reviewHasMore: false,
  notifications: [{ id: 'notice-one', operationId: 'operation-one', operationCode: 'DEV-TAT-0001',
    kind: 'operation_submitted', occurredAt: '2026-09-28T12:00:00Z', readAt: null }],
  notificationsHasMore: false,
};
const observation = {
  station: 'MDPC', observedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
  metar: parseMetar('MDPC 111900Z 10013G25KT 9999 FEW022 30/23 Q1015'),
  derived: { relativeHumidity: 66, feelsLikeC: 34, precipitationLastHourIn: 0 },
  source: { name: 'Iowa Environmental Mesonet', url: 'https://mesonet.agron.iastate.edu', official: false },
};
const weather = { status: 'success', data: observation, refreshFailed: false, refresh: vi.fn() };
const props = { status: 'success', data: snapshot, weather, traffic: { status: 'error', data: null },
  onRetry: vi.fn(), onRefresh: vi.fn() };

afterEach(() => {
  act(() => resetLanguageForTests('es'));
  vi.mocked(loadSatelliteImageInfo).mockImplementation(() => new Promise(() => {}));
});

it('shows scoped OCC facts for PUJ without a station selector or synthetic claims', () => {
  render(<DashboardPage {...props} />);
  expect(screen.getAllByText('DEV-TAT-0001').length).toBeGreaterThan(0);
  expect(screen.getAllByText(/EV 101/).length).toBeGreaterThan(0);
  expect(screen.getByText('Operación entregada para revisión')).toBeInTheDocument();
  expect(screen.queryByText('operation_submitted')).not.toBeInTheDocument();
  expect(screen.getByText(/Plataforma, meteorología y contexto regional/)).toBeInTheDocument();
  expect(screen.getByText(/2026/)).toHaveAttribute('dateTime', '2026-09-28');
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.queryByText(/sintéticos|FlyAware|42 vuelos/i)).not.toBeInTheDocument();
});

it('lists only submissions awaiting a decision as needing attention', () => {
  render(<DashboardPage {...props} />);
  const attention = screen.getByRole('region', { name: 'Requiere atención' });
  expect(within(attention).getByText('DEV-TAT-0001')).toBeInTheDocument();
  expect(within(attention).getByText('Pendiente')).toBeInTheDocument();
  expect(within(attention).queryByText('DEV-TAT-0003')).not.toBeInTheDocument();
  expect(within(attention).getByText('DEV-TAT-0002')).toBeInTheDocument();
  expect(within(attention).getByText(/sin posición, sin agente/)).toBeInTheDocument();
  expect(within(attention).getByRole('link', { name: /DEV-TAT-0001/ }))
    .toHaveAttribute('href', '/admin-occ/review?operationId=operation-one');
});

it('filters the turnaround board by derived resource state', () => {
  render(<DashboardPage {...props} />);
  const board = screen.getByRole('region', { name: 'Escalas del día' });
  expect(within(board).getAllByRole('row')).toHaveLength(3);
  fireEvent.click(within(board).getByRole('button', { name: /Sin recursos/ }));
  expect(within(board).getAllByRole('row')).toHaveLength(2);
  expect(within(board).getByText('DEV-TAT-0002')).toBeInTheDocument();
});

it('expands the apron map into a dialog that closes with Escape and restores focus', () => {
  render(<DashboardPage {...props} />);
  const expand = screen.getByRole('button', { name: 'Expandir mapa' });
  expand.focus();
  fireEvent.click(expand);
  const dialog = screen.getByRole('dialog', { name: /Plataforma PUJ/ });
  expect(within(dialog).getByText('A1')).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(document.activeElement).toBe(expand);
});

it('starts the dark apron view inclined and lets the operator choose 2D', () => {
  const { rerender } = render(<DashboardPage {...props} theme="light" />);
  const ramp = screen.getByRole('region', { name: 'Plataforma PUJ' });
  expect(within(ramp).getByRole('button', { name: 'Vista 3D' })).toHaveAttribute('aria-pressed', 'false');
  rerender(<DashboardPage {...props} theme="dark" />);
  const toggle = within(ramp).getByRole('button', { name: 'Vista 2D' });
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(toggle);
  expect(within(ramp).getByRole('button', { name: 'Vista 3D' })).toHaveAttribute('aria-pressed', 'false');
});

it('renders in English inside the OCC language scope', () => {
  act(() => resetLanguageForTests('en'));
  render(<LanguageScope><DashboardPage {...props} /></LanguageScope>);
  expect(screen.getByRole('heading', { level: 1, name: 'Operations overview' })).toBeInTheDocument();
  expect(screen.getByText('Operation submitted for review')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Needs attention' })).toBeInTheDocument();
});

it('stays in Spanish outside the OCC language scope', () => {
  act(() => resetLanguageForTests('en'));
  render(<DashboardPage {...props} />);
  expect(screen.getByRole('heading', { level: 1, name: 'Panorama operativo' })).toBeInTheDocument();
});

it('shows an honest empty station view with no invented operations', () => {
  render(<DashboardPage {...props} data={{
    ...snapshot, turnarounds: [], reviews: [], notifications: [],
  }} />);
  expect(screen.getByText(/No hay escalas registradas/)).toBeInTheDocument();
  expect(screen.getByText(/estación y fecha local/)).toBeInTheDocument();
  expect(screen.getByText(/No hay entregas pendientes/)).toBeInTheDocument();
  expect(screen.getByText(/No hay avisos/)).toBeInTheDocument();
});

it('fails closed for a revoked or missing PUJ station and hides stale results on errors', () => {
  const { rerender } = render(<DashboardPage {...props} status="forbidden" data={null} />);
  expect(screen.getByRole('alert')).toHaveTextContent('estación OCC autorizada');
  expect(screen.queryByText('DEV-TAT-0001')).not.toBeInTheDocument();
  rerender(<DashboardPage {...props} status="unavailable" data={null} />);
  expect(screen.getByRole('alert')).toHaveTextContent('estación PUJ');
  rerender(<DashboardPage {...props} status="error" data={null}
    error={new Error('SQL password=secret')} />);
  expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar');
  expect(screen.queryByText(/password=secret/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(props.onRetry).toHaveBeenCalled();
});

it('keeps the last data visible and says so when a background refresh fails', () => {
  render(<DashboardPage {...props} refreshFailed fetchedAt="2026-09-28T13:00:00Z" />);
  expect(screen.getAllByText('DEV-TAT-0001').length).toBeGreaterThan(0);
  expect(screen.getAllByRole('status').some(item => item.textContent.includes('La última actualización falló'))).toBe(true);
});

it('shows loading state without asserting zero as a business fact', () => {
  render(<DashboardPage {...props} status="loading" data={null} />);
  expect(screen.getByRole('status')).toHaveTextContent('Cargando panorama');
  expect(screen.queryByText('DEV-TAT-0001')).not.toBeInTheDocument();
});

it('shows the MDPC observation with its time, age and unofficial source', () => {
  render(<DashboardPage {...props} />);
  const panel = screen.getByRole('region', { name: 'Meteorología MDPC' });
  expect(within(panel).getByText('No oficial')).toBeInTheDocument();
  expect(within(panel).getByText('100° · 13 kt · ráfagas 25 kt')).toBeInTheDocument();
  expect(within(panel).getByText('1015 hPa')).toBeInTheDocument();
  expect(within(panel).getByText('Escasas 2,200 ft')).toBeInTheDocument();
  expect(within(panel).getByText(/Observado .* UTC/)).toBeInTheDocument();
  expect(within(panel).getByText('hace 20 min')).toBeInTheDocument();
  expect(within(panel).queryByText(/LIVE|En vivo/i)).not.toBeInTheDocument();
  expect(within(panel).queryByText('Desactualizado')).not.toBeInTheDocument();
});

it('marks an old observation as outdated and a failed source as unavailable', () => {
  const stale = { ...weather, data: { ...observation, observedAt: new Date(Date.now() - 3 * 3_600_000).toISOString() } };
  const { rerender } = render(<DashboardPage {...props} weather={stale} />);
  expect(screen.getByText('Desactualizado')).toBeInTheDocument();
  const refresh = vi.fn();
  rerender(<DashboardPage {...props} weather={{ status: 'error', data: null, refreshFailed: false, refresh }} />);
  const panel = screen.getByRole('region', { name: 'Meteorología MDPC' });
  expect(within(panel).getByRole('alert')).toHaveTextContent('no está disponible');
  fireEvent.click(within(panel).getByRole('button', { name: 'Reintentar' }));
  expect(refresh).toHaveBeenCalled();
});

it('opens the expanded weather view with raw METAR and unavailable image state', () => {
  render(<DashboardPage {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Ver meteorología' }));
  const dialog = screen.getByRole('dialog', { name: /Meteorología · Punta Cana/ });
  expect(within(dialog).getByText('MDPC 111900Z 10013G25KT 9999 FEW022 30/23 Q1015')).toBeInTheDocument();
  expect(within(dialog).getByText('34 °C')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'GOES-East' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('displays the GOES-East image time alongside its source when available', async () => {
  vi.mocked(loadSatelliteImageInfo).mockImplementation(layer => layer === 'goes'
    ? Promise.resolve({ time: '2026-09-28T13:00:00Z', precision: 'instant' }) : new Promise(() => {}));
  render(<DashboardPage {...props} />);
  const panel = screen.getByRole('region', { name: 'Meteorología MDPC' });
  await waitFor(() => expect(within(panel).getByText(/Imagen 13:00 UTC/)).toBeInTheDocument());
  expect(within(panel).getByText(/NASA GIBS/)).toBeInTheDocument();
  fireEvent.click(within(panel).getByRole('button', { name: 'Ver meteorología' }));
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'GOES-East' })).toHaveAttribute('aria-pressed', 'true');
});

it('switches to delayed IMERG estimates and shows image age and source', async () => {
  vi.mocked(loadSatelliteImageInfo).mockImplementation(layer => layer === 'imerg'
    ? Promise.resolve({ time: '2026-09-28T09:30:00Z', precision: 'instant' }) : new Promise(() => {}));
  render(<DashboardPage {...props} />);
  const panel = screen.getByRole('region', { name: 'Meteorología MDPC' });
  fireEvent.click(within(panel).getByRole('button', { name: 'IMERG' }));
  await waitFor(() => expect(within(panel).getByText(/Imagen 09:30 UTC/)).toBeInTheDocument());
  expect(within(panel).getByText(/antigüedad 25 min/)).toBeInTheDocument();
  expect(within(panel).getByText(/estimada IMERG/)).toBeInTheDocument();
  expect(within(panel).getByText(/no radar/)).toBeInTheDocument();
});

it('does not claim an exact image hour for a date-only IMERG product', async () => {
  vi.mocked(loadSatelliteImageInfo).mockImplementation(layer => layer === 'imerg'
    ? Promise.resolve({ time: '2026-09-28', precision: 'day' }) : new Promise(() => {}));
  render(<DashboardPage {...props} />);
  const panel = screen.getByRole('region', { name: 'Meteorología MDPC' });
  fireEvent.click(within(panel).getByRole('button', { name: 'IMERG' }));
  await waitFor(() => expect(within(panel).getByText(/Producto del día 2026-09-28 UTC/)).toBeInTheDocument());
  expect(within(panel).queryByText(/Imagen \d\d:\d\d UTC/)).not.toBeInTheDocument();
  expect(within(panel).queryByText(/antigüedad \d+ min/)).not.toBeInTheDocument();
});

it('keeps a quiet empty map when IMERG is unavailable', async () => {
  vi.mocked(loadSatelliteImageInfo).mockImplementation(layer => layer === 'imerg'
    ? Promise.reject(new Error('unavailable')) : new Promise(() => {}));
  render(<DashboardPage {...props} />);
  const panel = screen.getByRole('region', { name: 'Meteorología MDPC' });
  fireEvent.click(within(panel).getByRole('button', { name: 'IMERG' }));
  await waitFor(() => expect(within(panel).getByText('La imagen satelital no está disponible.')).toBeInTheDocument());
  expect(within(panel).getByText(/estimada IMERG/)).toBeInTheDocument();
});

it('uses a quiet empty state when the GOES-East image cannot be checked', async () => {
  vi.mocked(loadSatelliteImageInfo).mockImplementation(layer => layer === 'goes'
    ? Promise.reject(new Error('unavailable')) : new Promise(() => {}));
  render(<DashboardPage {...props} />);
  const panel = screen.getByRole('region', { name: 'Meteorología MDPC' });
  await waitFor(() => expect(within(panel).getByText('La imagen satelital no está disponible.')).toBeInTheDocument());
  expect(within(panel).getByText(/NASA GIBS/)).toBeInTheDocument();
});

it('expands the regional map without asserting aircraft coordinates', () => {
  render(<DashboardPage {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Ampliar región' }));
  const dialog = screen.getByRole('dialog', { name: /Región de República Dominicana/ });
  expect(within(dialog).getByText(/La telemetría regional no está disponible/)).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('keeps provenance beside each map and makes unsupported assignments unlocated', () => {
  render(<DashboardPage {...props} />);
  const ramp = screen.getByRole('region', { name: 'Plataforma PUJ' });
  const weatherPanel = screen.getByRole('region', { name: 'Meteorología MDPC' });
  const regional = screen.getByRole('region', { name: 'Tráfico regional' });
  expect(within(ramp).getByText(/Ubicaciones internas sin verificar/)).toBeInTheDocument();
  expect(within(weatherPanel).getByText(/NASA GIBS/)).toBeInTheDocument();
  expect(within(regional).getByText(/Mapa: OpenStreetMap\/OpenFreeMap/)).toBeInTheDocument();
});
