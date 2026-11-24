import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { createTranslator, resetLanguageForTests } from '../../../i18n/languageStore';
import { buildFlightBoard } from '../flightBoardModel';
import { flightMonitoringMessages } from '../flightMonitoringMessages';
import FlightInspector, { inspectorLinks } from './FlightInspector';

afterEach(() => {
  cleanup();
  act(() => resetLanguageForTests('es'));
});

const ZONE = 'America/Santo_Domingo';
const STATION_ID = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';
// 14:00 at Punta Cana (UTC−4).
const NOW = Date.parse('2026-11-14T18:00:00Z');
const at = minutes => new Date(NOW + minutes * 60_000).toISOString();

// A synthetic leg of the planning snapshot, as flightMonitoringService.js maps it.
const ARRIVAL = Object.freeze({
  id: 'leg-101', turnaroundId: 'tat-101', direction: 'arrival', flightNumber: 'ZZ101', airline: 'Aerolínea de prueba',
  origin: 'MIA', destination: 'PUJ', registration: 'HI1001', aircraft: 'A320-200', status: 'delayed',
  scheduledAt: at(10), estimatedAt: at(25), actualAt: null, isDemo: true, turnaroundStatus: 'Confirmed',
  operationStatus: 'Assigned', stand: 'A05', supervisor: null, agents: 2, services: ['Equipaje', 'Limpieza'],
});

function stripOf(flight, language = 'es') {
  const t = createTranslator(flightMonitoringMessages, language);
  return buildFlightBoard([flight], { nowMs: NOW, t, stationCode: 'PUJ' }).all[0];
}

function inspector(props = {}) {
  const flight = props.flight ?? ARRIVAL;
  return (
    <FlightInspector flight={flight} strip={stripOf(flight)} stationId={STATION_ID} timeZone={ZONE} onClose={vi.fn()}
      {...props} />
  );
}

const facts = region => Object.fromEntries(within(region).getAllByRole('term').map(term => [term.textContent,
  term.nextElementSibling.textContent]));

describe('FlightInspector', () => {
  it('docked complementary region, no dialog, closes with Cerrar detalle', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(inspector({ onClose }));
    const region = screen.getByRole('complementary', { name: 'Detalle del vuelo ZZ101' });
    // Docked beside the map: no dialog, no veil and nothing that keeps the focus inside it.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(region).not.toHaveAttribute('aria-modal');
    expect(within(region).getByRole('heading', { level: 2 })).toHaveTextContent('ZZ101Demo');
    expect(within(region).getByText('Llegada desde MIA')).toBeInTheDocument();
    expect(within(region).getByText('Aerolínea de prueba')).toBeInTheDocument();
    await user.click(within(region).getByRole('button', { name: 'Cerrar detalle' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows its three times, its stand as a plate, its aircraft, its agents and its services', () => {
    render(inspector());
    const region = screen.getByRole('complementary', { name: 'Detalle del vuelo ZZ101' });
    expect(facts(region)).toEqual({
      Programada: '14:10', Estimada: '14:25', Real: 'Pendiente', Posición: 'A5', Avión: 'A320-200', Matrícula: 'HI1001',
      Agentes: '2 asignados', Servicios: 'Equipaje, Limpieza',
    });
    expect(within(region).getByText('A5')).toHaveAttribute('data-occ-plate', 'stand');
    expect(within(region).getByText('HI1001')).toHaveAttribute('data-occ-plate', 'registration');
    expect(within(region).getByText('14:25').tagName).toBe('TIME');
    expect(within(region).getByText('14:25')).toHaveAttribute('dateTime', '2026-11-14T18:25:00.000Z');
    // Its delay (CN-32): 15 minutes past its scheduled time, at the right of «Horarios», with the amber triangle.
    const times = within(region).getByRole('region', { name: 'Horarios' });
    const delay = times.querySelector('[data-occ-delay]');
    expect(delay).toHaveAttribute('data-occ-delay', '15');
    expect(delay).toHaveAttribute('data-signal', 'attention');
    expect(delay).toHaveTextContent('Atención: 15 min de demora');
  });

  it('says what a flight lacks: no stand, no aircraft, nobody and no services', () => {
    const bare = { ...ARRIVAL, id: 'leg-102', flightNumber: 'ZZ102', stand: null, registration: null, aircraft: null,
      estimatedAt: null, actualAt: at(-5), agents: 0, services: [], isDemo: false };
    render(inspector({ flight: bare }));
    const region = screen.getByRole('complementary', { name: 'Detalle del vuelo ZZ102' });
    expect(facts(region)).toMatchObject({ Estimada: 'Sin estimación', Real: '13:55', Posición: 'Sin posición',
      Avión: 'Sin registrar', Matrícula: 'Sin registrar', Agentes: 'Sin asignar', Servicios: 'Sin servicios registrados' });
    expect(within(region).queryByText('Demo')).not.toBeInTheDocument();
    // The status of its strip, with its signal said in words.
    expect(region).toHaveTextContent('Atención: Llegada sin posición asignada');
  });

  it('links to Planificación and Mapa de posiciones keep stationId', () => {
    render(inspector());
    const links = within(screen.getByRole('navigation', { name: 'Abrir en otro módulo' }));
    const planning = new URL(links.getByRole('link', { name: 'Ver planificación' }).getAttribute('href'), 'http://occ.test');
    expect(planning.pathname).toBe('/admin-occ/planning');
    expect(Object.fromEntries(planning.searchParams)).toEqual({ stationId: STATION_ID, flightId: 'leg-101' });
    const positions = new URL(links.getByRole('link', { name: 'Ver mapa de posiciones' }).getAttribute('href'), 'http://occ.test');
    expect(positions.pathname).toBe('/admin-occ/positions-map');
    expect(Object.fromEntries(positions.searchParams)).toEqual({ stationId: STATION_ID, stand: 'A5' });

    // Without a stand the positions map opens on the flight; without a station the links carry none.
    expect(inspectorLinks({ id: 'leg-9' }, { standCode: null })).toEqual({
      planning: '/admin-occ/planning?flightId=leg-9', positions: '/admin-occ/positions-map?flightId=leg-9',
    });
  });

  it('renders nothing without a flight and speaks English inside a translated scope', () => {
    const view = render(<FlightInspector flight={null} strip={null} timeZone={ZONE} onClose={vi.fn()} />);
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    view.unmount();

    act(() => resetLanguageForTests('en'));
    render(<LanguageScope><FlightInspector flight={ARRIVAL} strip={stripOf(ARRIVAL, 'en')} stationId={STATION_ID}
      timeZone={ZONE} onClose={vi.fn()} /></LanguageScope>);
    const region = screen.getByRole('complementary', { name: 'Flight ZZ101 details' });
    expect(within(region).getByRole('button', { name: 'Close details' })).toBeInTheDocument();
    expect(within(region).getByText('Arrival from MIA')).toBeInTheDocument();
    expect(facts(region)).toMatchObject({ Scheduled: '14:10', Estimated: '14:25', Actual: 'Pending', Agents: '2 assigned' });
    expect(within(region).getByRole('link', { name: 'View planning' })).toBeInTheDocument();
  });
});
