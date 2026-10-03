import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import DashboardPage from './DashboardPage';

const stationId = '20000000-0000-7000-8000-000000000003';
const otherStationId = '20000000-0000-7000-8000-000000000004';
const stationScopes = [
  { stationId, stationCode: 'PUJ' },
  { stationId: otherStationId, stationCode: 'SDQ' },
];
const snapshot = { stationId, stationCode: 'PUJ', date: '2026-09-28',
  turnarounds: [{
    id: 'turnaround-one', operationCode: 'DEV-TAT-0001', status: 'Scheduled',
    airline: { name: 'Synthetic Air' },
    arrival: { flightNumber: 'EV 101' },
    departure: { flightNumber: 'EV 102' },
    agents: [{ agentId: 'agent-one' }], services: [],
  }],
  reviews: [{ operationId: 'operation-one', operationCode: 'DEV-TAT-0001',
    airlineName: 'Synthetic Air', agentName: 'Agente Uno',
    submittedAt: '2026-09-28T12:00:00Z' }],
  reviewHasMore: false,
  notifications: [{ id: 'notice-one', operationCode: 'DEV-TAT-0001',
    kind: 'operation_submitted', occurredAt: '2026-09-28T12:00:00Z',
    readAt: null }],
  notificationsHasMore: false,
};
const props = { status: 'success', data: snapshot, stationScopes,
  selectedStationId: stationId, onStationChange: vi.fn(),
  onRetry: vi.fn(), onOpenPlanning: vi.fn(), onOpenReview: vi.fn(),
  onOpenNotifications: vi.fn() };

it('shows scoped, persisted OCC facts without synthetic counters or FlyAware claims', () => {
  render(<DashboardPage {...props} />);
  expect(screen.getAllByText('DEV-TAT-0001').length).toBeGreaterThan(0);
  expect(screen.getByText(/EV 101/)).toBeInTheDocument();
  expect(screen.getByText('Agente Uno')).toBeInTheDocument();
  expect(screen.getByText('operation_submitted')).toBeInTheDocument();
  expect(screen.getByText(/28 de septiembre|2026-09-28/i)).toBeInTheDocument();
  expect(screen.getByText(/Planificación del día local/)).toBeInTheDocument();
  expect(screen.getByText(/fecha local 2026-09-28/)).toBeInTheDocument();
  expect(screen.queryByText(/fecha UTC|día UTC/)).not.toBeInTheDocument();
  expect(screen.queryByText(/sintéticos|FlyAware|42 vuelos/i)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Estación OCC'),
    { target: { value: otherStationId } });
  expect(props.onStationChange).toHaveBeenCalledWith(otherStationId);
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

it('fails closed for a revoked station and hides stale results on errors', () => {
  const { rerender } = render(<DashboardPage {...props}
    status="forbidden" data={null} />);
  expect(screen.getByRole('alert')).toHaveTextContent('estación OCC autorizada');
  expect(screen.queryByText('DEV-TAT-0001')).not.toBeInTheDocument();
  rerender(<DashboardPage {...props} status="error" data={null}
    error={new Error('SQL password=secret')} />);
  expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar');
  expect(screen.queryByText(/password=secret/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(props.onRetry).toHaveBeenCalled();
});

it('shows loading state without asserting zero as a business fact', () => {
  render(<DashboardPage {...props} status="loading" data={null} />);
  expect(screen.getByRole('status')).toHaveTextContent('Cargando panorama');
  expect(screen.queryByText('DEV-TAT-0001')).not.toBeInTheDocument();
});
