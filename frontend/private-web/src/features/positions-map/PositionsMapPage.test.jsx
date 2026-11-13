import { forwardRef, useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PositionsMapPage from './PositionsMapPage';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';

vi.mock('./components/PositionMap', () => ({
  default: forwardRef(function PositionMapStub(props, ref) {
    useImperativeHandle(ref, () => ({
      flyToPosition: vi.fn(),
      flyToBounds: vi.fn(),
      flyToAll: vi.fn(),
      flyToPuj: vi.fn(),
      resetNorth: vi.fn(),
    }));
    return <div data-testid="position-map-stub" />;
  }),
}));

function position(overrides) {
  return {
    id: 'A1',
    terminal: 'A',
    latitude: 18.56,
    longitude: -68.36,
    status: 'available',
    flightId: null,
    flightNumber: null,
    airline: null,
    aircraftRegistration: null,
    aircraftType: null,
    assignedAgent: null,
    estimatedReleaseTime: null,
    updatedAt: '2026-08-06T10:00:00-04:00',
    combinedConfiguration: null,
    linkedPositionId: null,
    ...overrides,
  };
}

const POSITIONS = [
  position({ id: 'A1', terminal: 'A' }),
  position({
    id: 'A5',
    terminal: 'A',
    status: 'occupied',
    flightId: 6,
    flightNumber: 'AC1876',
    airline: 'Air Canada',
    aircraftRegistration: 'C-1876AC',
    aircraftType: 'A320',
    assignedAgent: 'J. Ramírez',
  }),
  position({ id: 'A10', terminal: 'A', status: 'disabled', combinedConfiguration: '9-Alfa', linkedPositionId: 'A9' }),
];

const SNAPSHOT = { station: { code: 'PUJ' }, positions: POSITIONS };

describe('PositionsMapPage', () => {
  it('shows the skeleton while loading', () => {
    render(<PositionsMapPage status="loading" data={null} error={null} connection="syncing" onRetry={() => {}} />);
    expect(screen.getByTestId('positions-map-skeleton')).toBeInTheDocument();
  });

  it('shows a recoverable error state with a retry action', async () => {
    const onRetry = vi.fn();
    render(<PositionsMapPage status="error" data={null} error={new Error('network down')} connection="disconnected" onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('network down')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the toolbar title/subtitle and the map', () => {
    render(<PositionsMapPage status="success" data={SNAPSHOT} error={null} connection="connected" onRetry={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Mapa de posiciones' })).toBeInTheDocument();
    expect(screen.getByText('PUJ · Aeropuerto Internacional de Punta Cana')).toBeInTheDocument();
    expect(screen.getByTestId('position-map-stub')).toBeInTheDocument();
  });

  it('shows a real planned-stand list for another station without drawing PUJ', () => {
    render(<PositionsMapPage status="success" data={{
      station: { code: 'SDQ', name: 'Santo Domingo' }, source: 'planning-no-map',
      positions: [{ id: 'G1', terminal: 'T1', status: 'planned',
        latitude: null, longitude: null, plannedFlights: ['EV311'] }],
    }} error={null} connection="connected" onRetry={() => {}} />);
    expect(screen.getByText(/SDQ/)).toBeInTheDocument();
    expect(screen.getByText('G1')).toBeInTheDocument();
    expect(screen.getByText(/Vuelos planificados: EV311/)).toBeInTheDocument();
    expect(screen.queryByTestId('position-map-stub')).not.toBeInTheDocument();
    expect(screen.queryByText(/Aeropuerto Internacional de Punta Cana/)).not.toBeInTheDocument();
  });

  it('shows "No se encontró la posición." when a search does not match any position', async () => {
    render(<PositionsMapPage status="success" data={SNAPSHOT} error={null} connection="connected" onRetry={() => {}} />);
    const input = screen.getByPlaceholderText('Buscar posición, vuelo o matrícula...');
    await userEvent.type(input, 'ZZZ99{enter}');
    expect(screen.getByText('No se encontró la posición.')).toBeInTheDocument();
  });

  it('opens the side panel via the toolbar button and shows every position', async () => {
    render(<PositionsMapPage status="success" data={SNAPSHOT} error={null} connection="connected" onRetry={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /lista de posiciones/i }));

    const panel = screen.getByTestId('positions-side-panel');
    expect(within(panel).getAllByTestId('position-list-item')).toHaveLength(3);
  });

  it('selecting a position from the side panel opens its detail drawer with the combined-configuration banner when disabled', async () => {
    render(<PositionsMapPage status="success" data={SNAPSHOT} error={null} connection="connected" onRetry={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /lista de posiciones/i }));
    await userEvent.click(within(screen.getByTestId('positions-side-panel')).getByText('A10'));

    const drawer = screen.getByTestId('position-detail-drawer');
    expect(within(drawer).getByTestId('combined-position-banner')).toBeInTheDocument();
    expect(within(drawer).getByText('Configuración 9-Alfa activa.')).toBeInTheDocument();
    expect(within(drawer).getByText('Esta configuración utiliza A9 y bloquea temporalmente A10.')).toBeInTheDocument();
  });

  it('shows flight fields and navigates to Flight Monitoring for an occupied position', async () => {
    const onNavigateToResource = vi.fn();
    render(
      <PositionsMapPage
        status="success"
        data={SNAPSHOT}
        error={null}
        connection="connected"
        onRetry={() => {}}
        onNavigateToResource={onNavigateToResource}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /lista de posiciones/i }));
    await userEvent.click(within(screen.getByTestId('positions-side-panel')).getByText('A5'));

    const drawer = screen.getByTestId('position-detail-drawer');
    expect(within(drawer).getByText('AC1876')).toBeInTheDocument();
    expect(within(drawer).getByText('Air Canada')).toBeInTheDocument();

    await userEvent.click(within(drawer).getByRole('button', { name: /ver vuelo en monitoreo/i }));
    expect(onNavigateToResource).toHaveBeenCalledWith('flight-monitoring', 6);
  });

  it('shows the "sin vuelo asignado" message for a position with no flight', async () => {
    render(<PositionsMapPage status="success" data={SNAPSHOT} error={null} connection="connected" onRetry={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /lista de posiciones/i }));
    await userEvent.click(within(screen.getByTestId('positions-side-panel')).getByText('A1'));

    expect(within(screen.getByTestId('position-detail-drawer')).getByText('Sin vuelo asignado')).toBeInTheDocument();
  });

  it('shows a disconnected banner when forced disconnected', () => {
    render(
      <PositionsMapPage
        status="success"
        data={SNAPSHOT}
        error={null}
        connection="connected"
        onRetry={() => {}}
        forceState="positionsMapDisconnected"
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent(/datos desactualizados/i);
  });

  it('shows the empty state when forced empty', () => {
    render(
      <PositionsMapPage
        status="success"
        data={SNAPSHOT}
        error={null}
        connection="connected"
        onRetry={() => {}}
        forceState="positionsMapEmpty"
      />
    );
    // Summary panel still renders with all-zero totals; the side panel empty state only shows once opened.
    expect(screen.getByTestId('position-map-stub')).toBeInTheDocument();
  });
});

describe('PositionsMapPage in English', () => {
  beforeEach(() => act(() => resetLanguageForTests('en')));
  afterEach(() => act(() => resetLanguageForTests('es')));

  function renderEnglish(props = {}) {
    return render(
      <LanguageScope>
        <PositionsMapPage status="success" data={SNAPSHOT} error={null} connection="connected" onRetry={() => {}} {...props} />
      </LanguageScope>
    );
  }

  it('renders the toolbar, controls, legend and summary in English', () => {
    renderEnglish();
    expect(screen.getByRole('heading', { name: 'Positions map' })).toBeInTheDocument();
    expect(screen.getByText('PUJ · Punta Cana International Airport')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Filter by terminal' })).toHaveTextContent('All');
    expect(screen.getByPlaceholderText('Search stand, flight or registration...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch to 3D view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Center on PUJ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Full screen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Legend' })).toBeInTheDocument();
    expect(screen.getByText('Combined configuration')).toBeInTheDocument();
    expect(screen.getByText('Stands')).toBeInTheDocument();
    expect(screen.getAllByText('Available').length).toBeGreaterThan(0);
    expect(screen.queryByText('Leyenda')).not.toBeInTheDocument();
  });

  it('shows the side panel and the combined-configuration drawer in English', async () => {
    renderEnglish();
    await userEvent.click(screen.getByRole('button', { name: 'Stand list' }));
    const panel = screen.getByTestId('positions-side-panel');
    expect(within(panel).getAllByText('Terminal A')).toHaveLength(3);
    expect(within(panel).getAllByText('No flight assigned').length).toBeGreaterThan(0);

    await userEvent.click(within(panel).getByText('A10'));
    const drawer = screen.getByTestId('position-detail-drawer');
    expect(within(drawer).getByText('Stand disabled')).toBeInTheDocument();
    expect(within(drawer).getByText('Configuration 9-Alfa active.')).toBeInTheDocument();
    expect(within(drawer).getByText('This configuration uses A9 and temporarily blocks A10.')).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Close details' })).toBeInTheDocument();
  });

  it('shows the not-found search message and the disconnected banner in English', async () => {
    renderEnglish({ forceState: 'positionsMapDisconnected' });
    expect(screen.getByText('Stale data — no connection with the positions provider.')).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('Search stand, flight or registration...'), 'ZZZ99{enter}');
    expect(screen.getByText('Stand not found.')).toBeInTheDocument();
  });
});
