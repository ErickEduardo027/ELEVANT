import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlanningPage from './PlanningPage';
import { usePlanningOptions } from './usePlanningOptions';
import {
  createPlanningFlight,
  createPlanningSnapshot,
  OPTIONS_STATE_SUCCESS,
  STATION_ID,
  STATION_SCOPES,
} from './testing/planningFixtures';

vi.mock('./usePlanningOptions', () => ({ usePlanningOptions: vi.fn() }));

const BASE_ASSIGNED_FLIGHT = createPlanningFlight();
const ASSIGNED_FLIGHT = createPlanningFlight({
  arrival: { ...BASE_ASSIGNED_FLIGHT.arrival, estimatedAt: null },
});
const UNASSIGNED_DELAYED_FLIGHT = createPlanningFlight({
  id: '91000000-0000-0000-0000-000000000003',
  turnaroundId: '91000000-0000-0000-0000-000000000003',
  operationCode: 'DEV-TAT-0003',
  status: 'Delayed',
  stand: null,
  position: null,
  terminal: null,
  terminalCode: null,
  assignedAgents: [],
  assignedEquipment: [],
  assignedServices: [],
  agents: [],
  equipment: [],
  services: [],
  resourceState: {
    standAssigned: false,
    agentsAssigned: false,
    equipmentAssigned: false,
    servicesPlanned: false,
  },
  hasAssignmentGap: true,
});
const SNAPSHOT = createPlanningSnapshot([ASSIGNED_FLIGHT, UNASSIGNED_DELAYED_FLIGHT]);

const DEFAULT_PROPS = {
  status: 'success',
  data: SNAPSHOT,
  error: null,
  onRetry: () => {},
  stationScopes: STATION_SCOPES,
  selectedStationId: STATION_ID,
  onStationChange: () => {},
  selectedDate: SNAPSHOT.date,
  onDateChange: () => {},
};

function renderPage(overrides = {}) {
  return render(<PlanningPage {...DEFAULT_PROPS} {...overrides} />);
}

beforeEach(() => {
  vi.mocked(usePlanningOptions).mockReset();
  vi.mocked(usePlanningOptions).mockReturnValue(OPTIONS_STATE_SUCCESS);
});

describe('PlanningPage', () => {
  it('renders a successful, station-and-date-scoped planning snapshot', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Planificación Operativa' })).toBeInTheDocument();
    expect(screen.getByLabelText('Estación')).toHaveValue(STATION_ID);
    expect(screen.getByLabelText('Fecha operativa')).toHaveValue('2026-08-19');
    expect(screen.getByText('Escalas operativas')).toBeInTheDocument();
    expect(screen.getByText('Tramos de vuelo')).toBeInTheDocument();
    expect(screen.getByText('DEV-TAT-0002')).toBeInTheDocument();
    expect(screen.getByText('DEV-TAT-0003')).toBeInTheDocument();
  });

  it('renders an announced skeleton and keeps scope controls available while loading', () => {
    renderPage({ status: 'loading', data: null, selectedDate: '' });

    expect(screen.getByTestId('planning-skeleton')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Cargando planificación operativa' })).toBeInTheDocument();
    expect(screen.getAllByTestId('kpi-skeleton')).toHaveLength(4);
    expect(screen.getByLabelText('Estación')).toBeEnabled();
    expect(screen.getByLabelText('Fecha operativa')).toBeEnabled();
  });

  it('renders the server-backed empty state', () => {
    renderPage({ status: 'empty', data: createPlanningSnapshot([]) });

    expect(screen.getByText('Sin vuelos programados')).toBeInTheDocument();
    expect(screen.queryByTestId('flight-card')).not.toBeInTheDocument();
  });

  it('renders a recoverable error and retries without exposing its internal detail', async () => {
    const onRetry = vi.fn();
    renderPage({
      status: 'error',
      data: null,
      error: new Error('private upstream failure'),
      onRetry,
    });

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar la planificación operativa.');
    expect(screen.queryByText('private upstream failure')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders an unauthorized state without a retry action', () => {
    renderPage({ status: 'unauthorized', data: null });

    expect(screen.getByRole('status')).toHaveTextContent('La sesión ya no está disponible.');
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Estación')).not.toBeInTheDocument();
  });

  it('renders non-recoverable permission guidance for a forbidden snapshot', () => {
    renderPage({ status: 'forbidden', data: null });

    expect(screen.getByRole('alert')).toHaveTextContent('No tiene permiso para consultar esta planificación.');
    expect(screen.getByRole('alert')).toHaveTextContent('revise su rol y alcance de estación');
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Estación')).not.toBeInTheDocument();
  });

  it('renders no-station-scope guidance before issuing planning controls', () => {
    renderPage({
      status: 'idle',
      data: null,
      stationScopes: [],
      selectedStationId: '',
      selectedDate: '',
      hasStationScope: false,
    });

    expect(screen.getByRole('status')).toHaveTextContent('Sin estaciones habilitadas');
    expect(screen.queryByLabelText('Estación')).not.toBeInTheDocument();
    expect(vi.mocked(usePlanningOptions)).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('filters only delayed or pending-resource turnarounds with the supported quick filters', async () => {
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Con retraso' }));
    expect(screen.queryByText('DEV-TAT-0002')).not.toBeInTheDocument();
    expect(screen.getByText('DEV-TAT-0003')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Con retraso' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pendientes de recursos' }));
    expect(screen.queryByText('DEV-TAT-0002')).not.toBeInTheDocument();
    expect(screen.getByText('DEV-TAT-0003')).toBeInTheDocument();
  });

  it('opens canonical detail and loads authorized options for its turnaround', async () => {
    renderPage();

    await userEvent.click(screen.getByText('DEV-TAT-0002'));
    expect(screen.getByTestId('planning-drawer')).toBeInTheDocument();
    expect(vi.mocked(usePlanningOptions)).toHaveBeenLastCalledWith({
      turnaroundId: ASSIGNED_FLIGHT.turnaroundId,
      refreshToken: 0,
      enabled: true,
    });
    expect(screen.getByText(/DEV-CONTRACT · versión 1 · USD/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar panel' }));
    expect(screen.queryByTestId('planning-drawer')).not.toBeInTheDocument();
  });

  it('retries a recoverable 409 options state for the selected turnaround', async () => {
    vi.mocked(usePlanningOptions).mockReturnValue({
      status: 'error',
      data: null,
      error: new Error('safe conflict'),
      reason: 'contract-ambiguity',
      recoverable: true,
    });
    renderPage();

    await userEvent.click(screen.getByText('DEV-TAT-0002'));
    expect(screen.getByRole('alert')).toHaveTextContent('Hay más de un contrato aplicable');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => {
      expect(vi.mocked(usePlanningOptions)).toHaveBeenLastCalledWith({
        turnaroundId: ASSIGNED_FLIGHT.turnaroundId,
        refreshToken: 1,
        enabled: true,
      });
    });
  });

  it('keeps alternative views explicitly unavailable instead of inventing data', async () => {
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Tabla' }));
    expect(screen.getByText('Vista de tabla')).toBeInTheDocument();
    expect(screen.queryByTestId('flight-timeline')).not.toBeInTheDocument();
  });

  it('supports deterministic preview states without replacing real data contracts', () => {
    const { rerender } = render(<PlanningPage {...DEFAULT_PROPS} forceState="planningNoResults" />);
    expect(screen.getByText('Sin resultados')).toBeInTheDocument();

    rerender(<PlanningPage {...DEFAULT_PROPS} forceState="planningError" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(<PlanningPage {...DEFAULT_PROPS} forceState="loading" />);
    expect(screen.getByTestId('planning-skeleton')).toBeInTheDocument();
  });
});
