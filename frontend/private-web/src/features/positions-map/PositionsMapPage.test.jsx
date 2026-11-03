import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PositionsMapPage from './PositionsMapPage';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';

beforeEach(() => resetLanguageForTests('es'));
afterEach(() => { resetLanguageForTests('es'); vi.unstubAllEnvs(); });

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

const props = { status: 'success', data: SNAPSHOT, connection: 'connected', onRetry: vi.fn() };
describe('map-free position operations', () => {
  it('keeps unauthorized data and write actions out of the view', () => {
    render(<PositionsMapPage {...props} error={{ status: 403 }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Tu acceso no permite consultar');
    expect(screen.queryByTestId('position-list-item')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeDisabled();
  });
  it('shows loading and a recoverable error without internal exception text', async () => {
    const view = render(<PositionsMapPage {...props} status="loading" data={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando datos operativos');
    const retry = vi.fn();
    view.rerender(<PositionsMapPage {...props} status="error" error={new Error('private exception')} onRetry={retry} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('private exception')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it.each(['', 'synthetic-key'])('shows all positions without a map (%s)', key => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', key);
    const view = render(<PositionsMapPage {...props} />);
    expect(screen.getByRole('heading', { name: 'Posiciones operativas' })).toBeInTheDocument();
    expect(screen.getAllByTestId('position-list-item')).toHaveLength(3);
    expect(view.container.querySelector('canvas')).toBeNull();
  });

  it('searches positions and preserves the not-found message', async () => {
    render(<PositionsMapPage {...props} />);
    const search = screen.getByPlaceholderText('Buscar posición, vuelo o matrícula...');
    await userEvent.type(search, 'ZZZ99{enter}');
    expect(screen.getByText('No se encontró la posición.')).toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, 'A5{enter}');
    expect(await screen.findByTestId('position-detail-drawer')).toHaveTextContent('AC1876');
  });

  it('preserves disabled stand configuration details', async () => {
    render(<PositionsMapPage {...props} />);
    screen.getAllByTestId('position-list-item')[2].focus();
    await userEvent.keyboard('{Enter}');
    const drawer = screen.getByTestId('position-detail-drawer');
    expect(within(drawer).getByTestId('combined-position-banner')).toHaveTextContent('9-Alfa');
    expect(drawer).toHaveTextContent('A9');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('position-detail-drawer')).not.toBeInTheDocument();
  });

  it('retains contextual flight navigation and independent write capability', async () => {
    const navigate = vi.fn();
    render(<PositionsMapPage {...props} onNavigateToResource={navigate} />);
    await userEvent.click(screen.getByText('A5'));
    const drawer = screen.getByTestId('position-detail-drawer');
    expect(drawer).toHaveTextContent('Air Canada');
    expect(within(drawer).queryByRole('button', { name: 'Registrar llegada' })).not.toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: /ver vuelo en monitoreo/i }));
    expect(navigate).toHaveBeenCalledWith('flight-monitoring', 6);
  });

  it('keeps planned assignments without inventing geometry or availability', () => {
    render(<PositionsMapPage {...props} data={{ station: { code: 'SDQ' }, source: 'planning-no-map',
      positions: [{ id: 'G1', terminal: 'T1', status: 'planned', latitude: null, longitude: null, plannedFlights: ['EV311'] }] }} />);
    expect(screen.getByText('SDQ')).toBeInTheDocument();
    expect(screen.getByText(/Vuelos planificados: EV311/)).toBeInTheDocument();
    expect(screen.getByText('G1')).toBeInTheDocument();
  });

  it('retains disconnected feedback and translated labels', () => {
    act(() => resetLanguageForTests('en'));
    render(<LanguageScope><PositionsMapPage {...props} forceState="positionsMapDisconnected" /></LanguageScope>);
    expect(screen.getByRole('heading', { name: 'Operational positions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.getByText('Operational maps are available in Overview.')).toBeInTheDocument();
  });
});
