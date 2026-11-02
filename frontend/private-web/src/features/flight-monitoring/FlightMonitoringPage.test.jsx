import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightMonitoringPage from './FlightMonitoringPage';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';

beforeEach(() => resetLanguageForTests('es'));
afterEach(() => { resetLanguageForTests('es'); vi.unstubAllEnvs(); });

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

const props = { status: 'success', data: DATA, connection: 'connected', onRetry: vi.fn() };
describe('map-free flight consultation', () => {
  it('shows loading and sanitized recoverable errors', async () => {
    const view = render(<FlightMonitoringPage {...props} status="loading" data={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando datos operativos');
    const retry = vi.fn();
    view.rerender(<FlightMonitoringPage {...props} status="error" error={new Error('private exception')} onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar');
    expect(screen.queryByText('private exception')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it.each(['', 'synthetic-key'])('lists flights without a map with either provider configuration (%s)', key => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', key);
    const view = render(<FlightMonitoringPage {...props} />);
    expect(screen.getByText('DM161')).toBeInTheDocument();
    expect(screen.getByText('AA904')).toBeInTheDocument();
    expect(view.container.querySelector('canvas')).toBeNull();
    expect(screen.getByText('Los mapas operativos están disponibles en Panorama.')).toBeInTheDocument();
  });

  it('filters the consultation and opens details with keyboard dismissal', async () => {
    render(<FlightMonitoringPage {...props} />);
    await userEvent.type(screen.getByRole('textbox'), 'AA904');
    expect(screen.queryByText('DM161')).not.toBeInTheDocument();
    screen.getByTestId('flight-list-item').focus();
    await userEvent.keyboard('{Enter}');
    const detail = screen.getByRole('dialog', { name: /Detalle del vuelo/ });
    expect(within(detail).getByText(/AA904/)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('honors linked flight selection and hides stale details during a failed refresh', () => {
    const view = render(<FlightMonitoringPage {...props} focusFlightId={2} />);
    expect(within(screen.getByRole('dialog')).getByText(/AA904/)).toBeInTheDocument();
    view.rerender(<FlightMonitoringPage {...props} status="error" focusFlightId={2} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('preserves empty and disconnected states without recreating cartography', () => {
    const view = render(<FlightMonitoringPage {...props} forceState="monitoringEmpty" />);
    expect(screen.getByText('Sin vuelos para mostrar')).toBeInTheDocument();
    view.rerender(<FlightMonitoringPage {...props} forceState="monitoringDisconnected" />);
    expect(screen.getByText(/desconectado/i)).toBeInTheDocument();
    expect(view.container.querySelector('canvas')).toBeNull();
  });

  it('translates the consultation and its detail drawer', () => {
    act(() => resetLanguageForTests('en'));
    render(<LanguageScope><FlightMonitoringPage {...props} focusFlightId={1} /></LanguageScope>);
    expect(screen.getByRole('heading', { name: 'Flight monitoring' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Flight details' })).toBeInTheDocument();
    expect(screen.getByText('Operational maps are available in Overview.')).toBeInTheDocument();
  });
});
