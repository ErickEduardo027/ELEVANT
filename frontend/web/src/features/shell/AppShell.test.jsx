import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppShell from './AppShell';
import * as dashboardService from '../../services/dashboardService';
import * as planningService from '../../services/planningService';
import * as flightMonitoringService from '../../services/flightMonitoringService';
import * as reviewService from '../../services/reviewService';
import * as notificationsService from '../../services/notificationsService';
import { __resetNotificationsStoreForTests } from '../../services/notificationsService';

vi.mock('../flight-monitoring/components/FlightMap', () => ({
  default: function FlightMapStub() {
    return <div data-testid="flight-map-stub" />;
  },
}));

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
  __resetNotificationsStoreForTests();
});

describe('AppShell', () => {
  it('renders the sidebar with every module and the Dashboard active by default', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(SNAPSHOT);
    render(<AppShell />);

    await waitFor(() => expect(screen.getByText('Vuelos programados hoy')).toBeInTheDocument());

    const nav = screen.getByRole('navigation');
    expect(within(nav).getByText('Dashboard').closest('button')).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByText('Revisión')).toBeInTheDocument();
    expect(within(nav).getByText('Chat interno')).toBeInTheDocument();
  });

  it('switches to the Review module and renders the real review screen', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(SNAPSHOT);
    vi.spyOn(reviewService, 'getReviewQueue').mockResolvedValue({
      station: { code: 'PUJ' },
      date: '2026-08-05',
      operations: [],
    });
    render(<AppShell />);
    await waitFor(() => expect(screen.getByText('Vuelos programados hoy')).toBeInTheDocument());

    await userEvent.click(screen.getByText('Revisión'));

    expect(screen.queryByText('Vuelos programados hoy')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Revisión' })).toBeInTheDocument();
    expect(screen.getByText('No hay operaciones pendientes de revisión.')).toBeInTheDocument();

    const nav = screen.getByRole('navigation');
    expect(within(nav).getByText('Revisión').closest('button')).toHaveAttribute('aria-current', 'page');
  });

  it('shows the pending-approvals count as a badge on the Revisión nav item', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(SNAPSHOT);
    render(<AppShell />);
    await waitFor(() => expect(screen.getByText('Vuelos programados hoy')).toBeInTheDocument());

    const nav = screen.getByRole('navigation');
    const reviewItem = within(nav).getByText('Revisión').closest('button');
    expect(within(reviewItem).getByText('4')).toBeInTheDocument();
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

  it('switches to the Flight Monitoring module and renders the real monitoring screen', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(SNAPSHOT);
    vi.spyOn(flightMonitoringService, 'getFlightMonitoringSnapshot').mockResolvedValue({
      station: { code: 'PUJ' },
      flights: [],
    });
    vi.spyOn(flightMonitoringService, 'subscribeToFlightUpdates').mockReturnValue(() => {});
    render(<AppShell />);
    await waitFor(() => expect(screen.getByText('Vuelos programados hoy')).toBeInTheDocument());

    const nav = screen.getByRole('navigation');
    await userEvent.click(within(nav).getByText('Monitoreo de vuelos'));

    expect(await screen.findByText('FlyAware conectado')).toBeInTheDocument();
    expect(within(nav).getByText('Monitoreo de vuelos').closest('button')).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('switches to the Notifications module and renders the real notifications screen', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(SNAPSHOT);
    render(<AppShell />);
    await waitFor(() => expect(screen.getByText('Vuelos programados hoy')).toBeInTheDocument());

    const nav = screen.getByRole('navigation');
    await userEvent.click(within(nav).getByText('Notificaciones'));

    expect(await screen.findByRole('heading', { name: 'Notificaciones' })).toBeInTheDocument();
    expect(await screen.findByText('FlyAware desconectado')).toBeInTheDocument();
    expect(within(nav).getByText('Notificaciones').closest('button')).toHaveAttribute('aria-current', 'page');
  });

  it('shows the unread notifications count as a badge on the Notificaciones nav item and the Topbar bell', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(SNAPSHOT);
    render(<AppShell />);
    await waitFor(() => expect(screen.getByText('Vuelos programados hoy')).toBeInTheDocument());

    const nav = screen.getByRole('navigation');
    const notificationsItem = within(nav).getByText('Notificaciones').closest('button');
    await waitFor(() => expect(within(notificationsItem).getByText('5')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('notifications-badge')).toHaveTextContent('5'));
  });

  it('clicking the Topbar bell navigates to the Notifications module', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(SNAPSHOT);
    render(<AppShell />);
    await waitFor(() => expect(screen.getByText('Vuelos programados hoy')).toBeInTheDocument());

    const nav = screen.getByRole('navigation');
    // Wait for the unread count to land so the sidebar item's accessible name becomes
    // "Notificaciones 5", disambiguating it from the Topbar bell's aria-label "Notificaciones".
    await waitFor(() => expect(within(nav).getByText('Notificaciones').closest('button')).toHaveTextContent('5'));

    await userEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    expect(await screen.findByRole('heading', { name: 'Notificaciones' })).toBeInTheDocument();
  });

  it('navigating from a notification to Flight Monitoring pre-selects the related flight', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(SNAPSHOT);
    vi.spyOn(flightMonitoringService, 'subscribeToFlightUpdates').mockReturnValue(() => {});
    render(<AppShell />);
    await waitFor(() => expect(screen.getByText('Vuelos programados hoy')).toBeInTheDocument());

    const nav = screen.getByRole('navigation');
    await userEvent.click(within(nav).getByText('Notificaciones'));
    await userEvent.click(await screen.findByText('Vuelo DM161 fuera de tiempo estimado'));
    await userEvent.click(screen.getByRole('button', { name: /ver vuelo/i }));

    expect(await screen.findByLabelText('Detalle del vuelo DM161')).toBeInTheDocument();
    expect(within(nav).getByText('Monitoreo de vuelos').closest('button')).toHaveAttribute('aria-current', 'page');
  });

  it('navigating from a notification to Revisión pre-selects the related operation', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(SNAPSHOT);
    render(<AppShell />);
    await waitFor(() => expect(screen.getByText('Vuelos programados hoy')).toBeInTheDocument());

    const nav = screen.getByRole('navigation');
    await userEvent.click(within(nav).getByText('Notificaciones'));
    await userEvent.click(await screen.findByText('Nueva operación pendiente de revisión'));
    await userEvent.click(screen.getByRole('button', { name: /ver operación/i }));

    expect(await screen.findByTestId('review-detail-drawer')).toBeInTheDocument();
    expect(within(nav).getByText('Revisión').closest('button')).toHaveAttribute('aria-current', 'page');
  });

  it('switches to the Reports module and renders the real reports screen', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(SNAPSHOT);
    render(<AppShell />);
    await waitFor(() => expect(screen.getByText('Vuelos programados hoy')).toBeInTheDocument());

    const nav = screen.getByRole('navigation');
    await userEvent.click(within(nav).getByText('Reportes'));

    expect(await screen.findByRole('heading', { name: 'Reportes' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Cierre operacional' })).toHaveAttribute('aria-selected', 'true');
    expect(within(nav).getByText('Reportes').closest('button')).toHaveAttribute('aria-current', 'page');
  });
});
