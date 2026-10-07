import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightMonitoringPage from './FlightMonitoringPage';

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', ''));
afterEach(() => vi.unstubAllEnvs());

vi.mock('./components/FlightMap', () => ({
  default: function FlightMapStub(props) {
    return <div data-testid="flight-map-stub" data-selected={String(props.selectedFlightId)} />;
  },
}));

vi.mock('./components/GoogleFlightMap', () => ({
  default: () => <div data-testid="google-flight-map-stub" />,
}));

function flight(overrides) {
  return {
    id: 1,
    flightNumber: 'DM161',
    airline: 'Arajet',
    origin: 'MIA',
    destination: 'PUJ',
    registration: 'HI1024',
    aircraft: 'B737 MAX 8',
    status: 'approaching',
    eta: '2026-08-06T14:20:00-04:00',
    etd: '2026-08-06T15:05:00-04:00',
    stand: 'A5',
    supervisor: 'Juan Pérez',
    agents: 5,
    heading: 310,
    speed: 250,
    altitude: 8000,
    latitude: 18.7,
    longitude: -68.5,
    services: ['GPU'],
    ...overrides,
  };
}

const DATA = {
  station: { code: 'PUJ' },
  flights: [flight({ id: 1 }), flight({ id: 2, flightNumber: 'AA904', status: 'delayed' })],
};

describe('FlightMonitoringPage', () => {
  it('shows the skeleton while loading', () => {
    render(
      <FlightMonitoringPage status="loading" data={null} error={null} connection="syncing" lastUpdatedAt={null} onRetry={() => {}} />
    );
    expect(screen.getByTestId('flight-monitoring-skeleton')).toBeInTheDocument();
  });

  it('shows the error panel and retries on click', async () => {
    const onRetry = vi.fn();
    render(
      <FlightMonitoringPage
        status="error"
        data={null}
        error={new Error('boom')}
        connection="disconnected"
        lastUpdatedAt={null}
        onRetry={onRetry}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar el monitoreo de vuelos de la estación.');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the toolbar, list, and map once data loads', () => {
    render(
      <FlightMonitoringPage status="success" data={DATA} error={null} connection="connected" lastUpdatedAt="2026-08-06T14:00:00-04:00" onRetry={() => {}} />
    );
    expect(screen.getByText('FlyAware conectado')).toBeInTheDocument();
    expect(screen.getByText('DM161')).toBeInTheDocument();
    expect(screen.getByText('AA904')).toBeInTheDocument();
    expect(screen.getByTestId('flight-map-stub')).toBeInTheDocument();
  });

  it('shows the empty state and explains the absence of telemetry when there are no flights', () => {
    render(
      <FlightMonitoringPage
        status="success"
        data={{ station: { code: 'PUJ' }, flights: [] }}
        error={null}
        connection="connected"
        lastUpdatedAt={null}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText('Sin vuelos para mostrar')).toBeInTheDocument();
    expect(screen.getByTestId('flight-map-stub')).toBeInTheDocument();
    expect(screen.getByText(/Sin posición de aeronaves en vivo/)).toBeInTheDocument();
  });

  it('keeps MapLibre when a local Google key is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'synthetic-test-key');
    render(<FlightMonitoringPage status="success" data={{ station: { code: 'PUJ' }, flights: [] }}
      error={null} connection="connected" lastUpdatedAt={null} onRetry={() => {}} />);
    expect(screen.getByTestId('flight-map-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('google-flight-map-stub')).not.toBeInTheDocument();
  });

  it('does not center another station on PUJ when a local Google key exists', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'synthetic-test-key');
    render(<FlightMonitoringPage status="success" data={{ station: { code: 'SDQ' },
      source: 'planning', flights: [] }} error={null} connection="connected"
      lastUpdatedAt={null} onRetry={() => {}} />);
    expect(screen.getByText(/La posición en vivo no está disponible/)).toBeInTheDocument();
    expect(screen.queryByText(/el mapa muestra PUJ/)).not.toBeInTheDocument();
  });

  it('selects a flight when its list item is clicked, opening the detail popover and passing the id to the map', async () => {
    render(
      <FlightMonitoringPage status="success" data={DATA} error={null} connection="connected" lastUpdatedAt={null} onRetry={() => {}} />
    );
    await userEvent.click(screen.getByText('DM161'));
    expect(screen.getByRole('dialog', { name: /DM161/ })).toBeInTheDocument();
    expect(screen.getByTestId('flight-map-stub')).toHaveAttribute('data-selected', '1');
  });

  it('honors the monitoringEmpty forceState override from the dev preview panel', () => {
    render(
      <FlightMonitoringPage
        status="success"
        data={DATA}
        error={null}
        connection="connected"
        lastUpdatedAt={null}
        onRetry={() => {}}
        forceState="monitoringEmpty"
      />
    );
    expect(screen.getByText('Sin vuelos para mostrar')).toBeInTheDocument();
  });

  it('shows disconnected when forceState is monitoringDisconnected, overriding the real connection prop', () => {
    render(
      <FlightMonitoringPage
        status="success"
        data={DATA}
        error={null}
        connection="connected"
        lastUpdatedAt={null}
        onRetry={() => {}}
        forceState="monitoringDisconnected"
      />
    );
    expect(screen.getByText('FlyAware desconectado')).toBeInTheDocument();
  });
});

function mockMatchMedia(matchingQueries) {
  window.matchMedia = vi.fn().mockImplementation(query => ({
    matches: matchingQueries.includes(query),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('FlightMonitoringPage — tablet layout', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('renders the full inline split with no toggle on desktop', () => {
    mockMatchMedia([]);
    render(
      <FlightMonitoringPage status="success" data={DATA} error={null} connection="connected" lastUpdatedAt={null} onRetry={() => {}} />
    );
    expect(screen.getByTestId('flight-list-panel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver vuelos' })).not.toBeInTheDocument();
  });

  it('hides the inline list panel and shows a "Ver vuelos" toggle on tablet', () => {
    mockMatchMedia(['(max-width: 1023.98px)']);
    render(
      <FlightMonitoringPage status="success" data={DATA} error={null} connection="connected" lastUpdatedAt={null} onRetry={() => {}} />
    );
    expect(screen.queryByTestId('flight-list-panel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver vuelos' })).toBeInTheDocument();
  });

  it('opens the list drawer when the toggle is clicked, and closes it via the backdrop', async () => {
    mockMatchMedia(['(max-width: 1023.98px)']);
    render(
      <FlightMonitoringPage status="success" data={DATA} error={null} connection="connected" lastUpdatedAt={null} onRetry={() => {}} />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Ver vuelos' }));
    expect(screen.getByTestId('flight-list-drawer')).toBeInTheDocument();
    expect(screen.getByText('DM161')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('flight-list-drawer-backdrop'));
    expect(screen.queryByTestId('flight-list-drawer')).not.toBeInTheDocument();
  });
});
