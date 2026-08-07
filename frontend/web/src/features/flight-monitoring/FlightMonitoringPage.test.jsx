import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightMonitoringPage from './FlightMonitoringPage';

vi.mock('./components/FlightMap', () => ({
  default: function FlightMapStub(props) {
    return <div data-testid="flight-map-stub" data-selected={String(props.selectedFlightId)} />;
  },
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

  it('shows the empty state instead of the list when the snapshot has no flights, while the map still renders', () => {
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
