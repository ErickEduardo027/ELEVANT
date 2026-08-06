import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppShell from './AppShell';
import * as dashboardService from '../../services/dashboardService';
import * as planningService from '../../services/planningService';

const SNAPSHOT = {
  station: { code: 'PUJ', localAbbr: 'AST', localTime: '2026-08-01T14:32:00-04:00', utcTime: '2026-08-01T18:32:00Z' },
  kpis: { flightsToday: 42, servicesPending: 18, servicesExecuted: 96, agentsActive: 27, approvalsPending: 4 },
  flyAware: { status: 'online', lastSyncMinutesAgo: 2 },
  flightStatusDistribution: [{ status: 'scheduled', count: 14 }],
  pendingApprovals: [],
  alerts: [],
};

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.classList.remove('dark');
  window.localStorage.clear();
});

describe('AppShell', () => {
  it('renders the sidebar with every module and the Dashboard active by default', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(SNAPSHOT);
    render(<AppShell />);

    await waitFor(() => expect(screen.getByText('Vuelos programados hoy')).toBeInTheDocument());

    const nav = screen.getByRole('navigation');
    expect(within(nav).getByText('Dashboard').closest('button')).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByText('Aprobaciones')).toBeInTheDocument();
    expect(within(nav).getByText('Chat interno')).toBeInTheDocument();
  });

  it('switches the main content to a module placeholder when a different item is selected', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(SNAPSHOT);
    render(<AppShell />);
    await waitFor(() => expect(screen.getByText('Vuelos programados hoy')).toBeInTheDocument());

    await userEvent.click(screen.getByText('Aprobaciones'));

    expect(screen.queryByText('Vuelos programados hoy')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Aprobaciones' })).toBeInTheDocument();
    expect(screen.getByText(/en construcción/i)).toBeInTheDocument();

    const nav = screen.getByRole('navigation');
    expect(within(nav).getByText('Aprobaciones').closest('button')).toHaveAttribute('aria-current', 'page');
  });

  it('shows the pending-approvals count as a badge on the Aprobaciones nav item', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(SNAPSHOT);
    render(<AppShell />);
    await waitFor(() => expect(screen.getByText('Vuelos programados hoy')).toBeInTheDocument());

    const nav = screen.getByRole('navigation');
    const approvalsItem = within(nav).getByText('Aprobaciones').closest('button');
    expect(within(approvalsItem).getByText('4')).toBeInTheDocument();
  });

  it('keeps a single shared theme between the topbar and the dev preview panel', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(SNAPSHOT);
    render(<AppShell />);
    await waitFor(() => expect(screen.getByText('Vuelos programados hoy')).toBeInTheDocument());

    expect(screen.getByText(/tema: claro/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /cambiar a modo oscuro/i }));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(screen.getByText(/tema: oscuro/i)).toBeInTheDocument();
  });

  it('forces the loading skeleton on the Dashboard module via the dev preview panel', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(SNAPSHOT);
    render(<AppShell />);
    await waitFor(() => expect(screen.getByText('Vuelos programados hoy')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /carga/i }));
    expect(screen.getAllByTestId('kpi-skeleton').length).toBeGreaterThan(0);
  });

  it('switches to the Planning module and renders the real planning screen', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(SNAPSHOT);
    vi.spyOn(planningService, 'getPlanningSnapshot').mockResolvedValue({
      station: { code: 'PUJ' },
      date: '2026-08-05',
      flights: [],
    });
    render(<AppShell />);
    await waitFor(() => expect(screen.getByText('Vuelos programados hoy')).toBeInTheDocument());

    const nav = screen.getByRole('navigation');
    await userEvent.click(within(nav).getByText('Planificación operativa'));

    expect(await screen.findByRole('heading', { name: 'Planificación Operativa' })).toBeInTheDocument();
    expect(within(nav).getByText('Planificación operativa').closest('button')).toHaveAttribute(
      'aria-current',
      'page'
    );
  });
});
