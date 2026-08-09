import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlanningPage from './PlanningPage';

const FLIGHTS = [
  {
    id: 'flt-1',
    flightNumber: 'DM161',
    airlineIata: 'DM',
    airlineName: 'ARAJET',
    status: 'scheduled',
    scheduledTime: '2026-08-05T08:05:00-04:00',
    estimatedTime: '2026-08-05T08:05:00-04:00',
    origin: 'PUJ',
    destination: 'JFK',
    aircraftType: 'A320',
    position: 'A5',
    station: 'PUJ',
    supervisor: 'J. Ramírez',
    agents: ['M. Castillo'],
    teams: ['Rampa 2'],
    services: ['Combustible'],
    conflict: null,
    observations: '',
    history: [],
  },
  {
    id: 'flt-2',
    flightNumber: 'AA904',
    airlineIata: 'AA',
    airlineName: 'AMERICAN',
    status: 'delayed',
    scheduledTime: '2026-08-05T09:20:00-04:00',
    estimatedTime: '2026-08-05T09:50:00-04:00',
    origin: 'MIA',
    destination: 'PUJ',
    aircraftType: 'B737-800',
    position: 'B21',
    station: 'PUJ',
    supervisor: 'K. Objío',
    agents: [],
    teams: [],
    services: [],
    conflict: { reason: 'Posición B21 con doble asignación' },
    observations: '',
    history: [],
  },
];

const SNAPSHOT = { station: { code: 'PUJ' }, date: '2026-08-05', flights: FLIGHTS };

describe('PlanningPage', () => {
  it('renders the header, KPIs, and timeline once data is provided', () => {
    render(<PlanningPage status="success" data={SNAPSHOT} error={null} onRetry={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Planificación Operativa' })).toBeInTheDocument();
    expect(screen.getByText('Vuelos del día')).toBeInTheDocument();
    expect(screen.getByText('DM161 · ARAJET')).toBeInTheDocument();
  });

  it('renders the skeleton when status is loading', () => {
    render(<PlanningPage status="loading" data={null} error={null} onRetry={() => {}} />);
    expect(screen.getByTestId('planning-skeleton')).toBeInTheDocument();
  });

  it('renders the skeleton when forceState is loading even if data already succeeded', () => {
    render(<PlanningPage status="success" data={SNAPSHOT} error={null} onRetry={() => {}} forceState="loading" />);
    expect(screen.getByTestId('planning-skeleton')).toBeInTheDocument();
  });

  it('shows a recoverable error state with a retry action when status is error', async () => {
    const onRetry = vi.fn();
    render(<PlanningPage status="error" data={null} error={new Error('network down')} onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the no-flights empty state when forceState is planningEmpty, ignoring a real error', () => {
    render(
      <PlanningPage
        status="error"
        data={null}
        error={new Error('network down')}
        onRetry={() => {}}
        forceState="planningEmpty"
      />
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Sin vuelos programados')).toBeInTheDocument();
  });

  it('shows the no-results empty state when forceState is planningNoResults even though flights exist', () => {
    render(
      <PlanningPage status="success" data={SNAPSHOT} error={null} onRetry={() => {}} forceState="planningNoResults" />
    );
    expect(screen.getByText('Sin resultados')).toBeInTheDocument();
  });

  it('opens the drawer with flight detail when a flight card is clicked, and closes it', async () => {
    render(<PlanningPage status="success" data={SNAPSHOT} error={null} onRetry={() => {}} />);
    await userEvent.click(screen.getByText('DM161 · ARAJET'));
    expect(screen.getByTestId('planning-drawer')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar detalle' }));
    expect(screen.queryByTestId('planning-drawer')).not.toBeInTheDocument();
  });

  it('switches to the table placeholder view when selected in the ViewSwitcher', async () => {
    render(<PlanningPage status="success" data={SNAPSHOT} error={null} onRetry={() => {}} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Tabla' }));
    expect(screen.getByText('Vista de tabla')).toBeInTheDocument();
    expect(screen.queryByTestId('flight-timeline')).not.toBeInTheDocument();
  });

  it('shows the error panel when forceState is planningError even though status is success', () => {
    render(
      <PlanningPage status="success" data={SNAPSHOT} error={null} onRetry={() => {}} forceState="planningError" />
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
