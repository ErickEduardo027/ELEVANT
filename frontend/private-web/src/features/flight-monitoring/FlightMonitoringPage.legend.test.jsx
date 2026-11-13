import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sharedFakeMapLibre } from '../../../tests/fakeMapLibre';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import FlightMonitoringPage from './FlightMonitoringPage';

// Monitoreo de vuelos with its real map (FlightMap over OccMap, on the shared fake MapLibre): the page has one legend,
// the map's, and it explains what the map draws. The other page tests stub the map.
vi.mock('maplibre-gl', async () => (await import('../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

const fake = sharedFakeMapLibre();
const PAGE = '/admin-occ/flight-monitoring?stationId=s-1';

// Synthetic flights (invented numbers, airline and registrations): the first about 10 NM from PUJ, the second without
// a position.
function flight(overrides) {
  return {
    id: 1,
    flightNumber: 'ZZ101',
    airline: 'Aerolínea de prueba',
    origin: 'MIA',
    destination: 'PUJ',
    registration: 'ZZ-TST1',
    aircraft: 'A320',
    status: 'approaching',
    eta: '2026-08-06T14:20:00-04:00',
    etd: '2026-08-06T15:05:00-04:00',
    stand: 'A5',
    supervisor: null,
    agents: 0,
    heading: 310,
    speed: 250,
    altitude: 8000,
    latitude: 18.7,
    longitude: -68.5,
    services: [],
    ...overrides,
  };
}

const DATA = {
  station: { code: 'PUJ' },
  flights: [flight({ id: 1 }), flight({ id: 2, flightNumber: 'ZZ202', latitude: null, longitude: null })],
};

function renderPage(data, { english = false } = {}) {
  const page = <FlightMonitoringPage status="success" data={data} error={null} connection="connected" lastUpdatedAt={null} onRetry={() => {}} />;
  const view = render(english ? <LanguageScope>{page}</LanguageScope> : page);
  const map = fake.state.liveMaps().at(-1);
  act(() => fake.state.emit(map, 'style.load'));
  return { ...view, map };
}

beforeEach(() => {
  fake.state.reset();
  window.history.replaceState({}, '', PAGE);
});

afterEach(() => {
  cleanup();
  act(() => resetLanguageForTests('es'));
  window.history.replaceState({}, '', '/');
});

describe('FlightMonitoringPage with its map', () => {
  it('shows one legend, the map\'s, which explains the flights on screen', () => {
    renderPage(DATA);
    expect(fake.state.liveMaps()).toHaveLength(1);
    // One «Leyenda», inside the map: the page no longer adds a legend of colour dots per flight state.
    const [button, ...others] = screen.getAllByRole('button', { name: 'Leyenda' });
    expect(others).toEqual([]);
    expect(screen.getByTestId('occ-map')).toContainElement(button);
    expect(within(screen.getByTestId('map-legend')).getAllByRole('listitem').map(item => item.textContent))
      .toEqual(['VueloApunta según su rumbo; al norte si no se conoce']);
  });

  it('has no legend while no flight has a position, and the page says why', () => {
    renderPage({ station: { code: 'PUJ' }, flights: [flight({ latitude: null, longitude: null })] });
    expect(screen.queryByRole('button', { name: 'Leyenda' })).not.toBeInTheDocument();
    expect(screen.getByText(/Sin posición de aeronaves en vivo/)).toBeInTheDocument();
  });

  it('shows the map\'s legend in English', () => {
    act(() => resetLanguageForTests('en'));
    renderPage(DATA, { english: true });
    expect(screen.getAllByRole('button', { name: 'Legend' })).toHaveLength(1);
    expect(within(screen.getByTestId('map-legend')).getAllByRole('listitem').map(item => item.textContent))
      .toEqual(['FlightPoints along its heading; north when unknown']);
    expect(screen.queryByText('Leyenda')).not.toBeInTheDocument();
  });
});
