import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DashboardPage from './DashboardPage';

const SNAPSHOT = {
  station: { code: 'PUJ', localAbbr: 'AST', localTime: '2026-08-01T14:32:00-04:00', utcTime: '2026-08-01T18:32:00Z' },
  kpis: { flightsToday: 42, servicesPending: 18, servicesExecuted: 96, agentsActive: 27, approvalsPending: 4 },
  flyAware: { status: 'online', lastSyncMinutesAgo: 2 },
  flightStatusDistribution: [
    { status: 'scheduled', count: 14 },
    { status: 'enRoute', count: 9 },
  ],
  pendingApprovals: [
    {
      id: 'a1',
      flightNumber: 'DM161',
      airlineIata: 'DM',
      station: 'PUJ',
      agent: 'J. Ramírez',
      requestedAt: '2026-08-01T13:50:00-04:00',
      status: 'pendingReview',
    },
  ],
  alerts: [
    {
      id: 'al1',
      severity: 'warning',
      message: 'Vuelo DM161 no llegó a la posición asignada según hora estimada',
      occurredAt: '2026-08-01T14:20:00-04:00',
    },
  ],
};

describe('DashboardPage', () => {
  it('renders KPI labels and content once data is provided', () => {
    render(<DashboardPage status="success" data={SNAPSHOT} error={null} onRetry={() => {}} />);
    expect(screen.getByText('Vuelos programados hoy')).toBeInTheDocument();
    expect(screen.getByText('Agentes en operaciones activas')).toBeInTheDocument();
    expect(screen.getByText('DM161 · DM')).toBeInTheDocument();
    expect(screen.getByText('Vuelo DM161 no llegó a la posición asignada según hora estimada')).toBeInTheDocument();
  });

  it('renders KPI skeletons when status is loading', () => {
    render(<DashboardPage status="loading" data={null} error={null} onRetry={() => {}} />);
    expect(screen.getAllByTestId('kpi-skeleton').length).toBeGreaterThan(0);
  });

  it('renders KPI skeletons when forceState is loading even if data already succeeded', () => {
    render(<DashboardPage status="success" data={SNAPSHOT} error={null} onRetry={() => {}} forceState="loading" />);
    expect(screen.getAllByTestId('kpi-skeleton').length).toBeGreaterThan(0);
  });

  it('shows the FlyAware disconnected panel when forceState is flyAwareError', () => {
    render(
      <DashboardPage status="success" data={SNAPSHOT} error={null} onRetry={() => {}} forceState="flyAwareError" />
    );
    expect(screen.getByText(/sin conexión/i)).toBeInTheDocument();
  });

  it('shows the empty approvals state when forceState is emptyApprovals', () => {
    render(
      <DashboardPage status="success" data={SNAPSHOT} error={null} onRetry={() => {}} forceState="emptyApprovals" />
    );
    expect(screen.getByText(/no hay operaciones pendientes de revisión/i)).toBeInTheDocument();
  });

  it('shows a recoverable error state with a retry action when status is error', async () => {
    const onRetry = vi.fn();
    render(
      <DashboardPage status="error" data={null} error={new Error('network down')} onRetry={onRetry} />
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/no se pudo cargar el panorama operativo/i)).toBeInTheDocument();
    expect(screen.getByText('network down')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('ignores a real fetch error while a forced preview state is active', () => {
    render(
      <DashboardPage
        status="error"
        data={null}
        error={new Error('network down')}
        onRetry={() => {}}
        forceState="emptyApprovals"
      />
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/no hay operaciones pendientes de revisión/i)).toBeInTheDocument();
  });
});
