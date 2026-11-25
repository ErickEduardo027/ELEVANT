import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { createTranslator, resetLanguageForTests } from '../../../i18n/languageStore';
import { buildFlightBoard } from '../flightBoardModel';
import { flightMonitoringMessages } from '../flightMonitoringMessages';
import FlightBoard from './FlightBoard';

afterEach(() => {
  cleanup();
  act(() => resetLanguageForTests('es'));
});

const ZONE = 'America/Santo_Domingo';
// 14:00 at Punta Cana (UTC−4).
const NOW = Date.parse('2026-11-14T18:00:00Z');
const at = minutes => new Date(NOW + minutes * 60_000).toISOString();
const es = createTranslator(flightMonitoringMessages, 'es');

// Synthetic legs of the planning snapshot, as flightMonitoringService.js maps them.
function leg(overrides = {}) {
  return {
    id: 'leg-1', turnaroundId: 'tat-1', direction: 'arrival', flightNumber: 'ZZ101', airline: 'Aerolínea de prueba',
    origin: 'MIA', destination: 'PUJ', registration: 'HI1001', aircraft: 'A320-200', status: 'scheduled',
    scheduledAt: at(30), estimatedAt: null, actualAt: null, isDemo: false, turnaroundStatus: 'Confirmed',
    operationStatus: 'Assigned', stand: 'A5', supervisor: null, agents: 1, services: [], ...overrides,
  };
}
const FLIGHTS = [
  leg({ id: 'a1', flightNumber: 'ZZ101', scheduledAt: at(20) }),
  leg({ id: 'a2', flightNumber: 'ZZ9001', isDemo: true, stand: null, scheduledAt: at(35) }),
  leg({ id: 'd1', direction: 'departure', flightNumber: 'ZZ201', origin: 'PUJ', destination: 'YYZ', scheduledAt: at(50) }),
];
const BOARD = buildFlightBoard(FLIGHTS, { nowMs: NOW, t: es, stationCode: 'PUJ' });
const SUCCESS = Object.freeze({ status: 'success', staleSince: null });

// The page holds the filter and the search; this harness does the same.
function Harness({ board = BOARD, state = SUCCESS, onSelect = vi.fn(), selectedId = null, ...props }) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  return (
    <FlightBoard board={board} state={state} filter={filter} onFilterChange={setFilter} search={search}
      onSearchChange={setSearch} selectedId={selectedId} onSelect={onSelect} nowMs={NOW} timeZone={ZONE} {...props} />
  );
}

const panel = () => screen.getByRole('region', { name: 'Tablero de vuelos' });
const strips = () => screen.queryAllByTestId('flight-list-item');

describe('FlightBoard', () => {
  it('shows Llegadas, Salidas and Todos with their counts as a group of toggle buttons', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const group = within(panel()).getByRole('group', { name: 'Dirección' });
    expect(within(group).getAllByRole('button').map(button => button.textContent)).toEqual(['Llegadas 2', 'Salidas 1',
      'Todos 3']);
    expect(within(group).getByRole('button', { name: 'Todos 3' })).toHaveAttribute('aria-pressed', 'true');
    expect(strips()).toHaveLength(3);

    await user.click(within(group).getByRole('button', { name: 'Salidas 1' }));
    expect(within(group).getByRole('button', { name: 'Salidas 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(strips().map(strip => strip.dataset.occFlightStrip)).toEqual(['d1']);
    await user.click(within(group).getByRole('button', { name: 'Llegadas 2' }));
    expect(strips().map(strip => strip.dataset.occFlightStrip)).toEqual(['a1', 'a2']);
  });

  it('each strip is a flight-list-item button with aria-pressed', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} selectedId="a2" />);
    const [first, demo] = strips();
    for (const strip of strips()) expect(strip.tagName).toBe('BUTTON');
    expect(first).toHaveAttribute('aria-pressed', 'false');
    expect(demo).toHaveAttribute('aria-pressed', 'true');
    // Named in full words, with its kind of time, its «Demo» tag, its stand or «Sin posición» and its countdown.
    expect(first).toHaveAccessibleName('Llegada, 14:20 programada, ZZ101, desde MIA, posición A5, Programado, en 20 min');
    expect(demo).toHaveAccessibleName(
      'Llegada, 14:35 programada, ZZ9001, Demo, desde MIA, Sin posición, Atención: Llegada sin posición asignada, en 35 min');
    expect(within(demo).getByText('Demo')).toHaveAttribute('data-occ-tag', 'demo');
    expect(within(demo).getByText('Sin posición')).toBeInTheDocument();

    await user.click(first);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1', legId: 'a1', flightNumber: 'ZZ101' }));
  });

  it('the legend in its header names the marks on screen, as a list and never as a «Leyenda» button', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const legend = within(panel()).getByRole('list', { name: 'Leyenda del tablero' });
    expect(within(legend).getAllByRole('listitem').map(item => item.dataset.occLegendItem)).toEqual(['attention', 'demo']);
    expect(legend).toHaveTextContent('Atención');
    expect(legend).toHaveTextContent('Simulado para la demostración');
    expect(screen.queryByRole('button', { name: 'Leyenda' })).not.toBeInTheDocument();
    // Only what the strips on screen carry: the departures have neither mark.
    await user.click(screen.getByRole('button', { name: 'Salidas 1' }));
    expect(within(panel()).queryByRole('list', { name: 'Leyenda del tablero' })).not.toBeInTheDocument();
  });

  it('its column header sorts the strips, and a second click turns the order (CN-32)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const header = within(panel()).getByRole('group', { name: 'Ordenar el tablero' });
    expect(within(header).getAllByRole('button').map(button => button.textContent))
      .toEqual(['Hora', 'Vuelo', 'Estado', 'Ruta', 'Pos.']);
    // By time at first, the column pressed with its arrow.
    const time = within(header).getByRole('button', { name: 'Ordenado por hora, de menor a mayor' });
    expect(time).toHaveAttribute('aria-pressed', 'true');
    expect(strips().map(strip => strip.dataset.occFlightStrip)).toEqual(['a1', 'a2', 'd1']);
    await user.click(within(header).getByRole('button', { name: 'Ordenar por ruta' }));
    expect(within(header).getByRole('button', { name: 'Ordenado por ruta, de menor a mayor' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(time).toHaveAttribute('aria-pressed', 'false');
    expect(strips().map(strip => strip.dataset.occFlightStrip)).toEqual(['a1', 'a2', 'd1']);
    await user.click(within(header).getByRole('button', { name: 'Ordenado por ruta, de menor a mayor' }));
    // YYZ, then the two MIA in the board's own order.
    expect(strips().map(strip => strip.dataset.occFlightStrip)).toEqual(['d1', 'a1', 'a2']);
  });

  it('a late flight carries its delay chip on its status line, and the legend says what it counts (CN-32)', () => {
    const late = buildFlightBoard([leg({ id: 'late', flightNumber: 'ZZ555', scheduledAt: at(20), estimatedAt: at(38) })],
      { nowMs: NOW, t: es, stationCode: 'PUJ' });
    render(<Harness board={late} />);
    const [strip] = strips();
    const chip = strip.querySelector('[data-part="status"] [data-occ-delay]');
    expect(chip).toHaveAttribute('data-occ-delay', '18');
    expect(strip).toHaveAccessibleName(expect.stringContaining('Programado, Atención: 18 min de demora'));
    const legend = within(panel()).getByRole('list', { name: 'Leyenda del tablero' });
    expect(within(legend).getAllByRole('listitem').map(item => item.dataset.occLegendItem)).toEqual(['attention', 'delay']);
  });

  it('searches by number, airline or registration and says Sin resultados when nothing matches', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const search = screen.getByLabelText('Buscar vuelo');
    expect(search).toHaveAttribute('placeholder', 'Número, aerolínea, matrícula o supervisor');
    await user.type(search, 'zz9');
    expect(strips().map(strip => strip.dataset.occFlightStrip)).toEqual(['a2']);
    await user.clear(search);
    await user.type(search, 'nada');
    expect(strips()).toEqual([]);
    expect(within(panel()).getByText('Sin resultados')).toBeInTheDocument();
    expect(within(panel()).getByText('Ningún vuelo coincide con la búsqueda.')).toBeInTheDocument();
  });

  it('shows the stale note with the time of the last data and Reintentar', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<Harness state={{ status: 'success', staleSince: '2026-11-14T17:32:00Z', onRetry }}
      labels={{ stale: es('status.stale'), retry: es('page.retry') }} />);
    // The flights stay on the board, dimmed, under the note; the note names the source, never a provider.
    expect(within(panel()).getByRole('status')).toHaveTextContent(
      'Sin conexión con la fuente de vuelos: se muestran los datos de las 13:32.');
    expect(strips()).toHaveLength(3);
    expect(strips()[0].closest('[data-stale]')).not.toBeNull();
    await user.click(within(panel()).getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('empty day says Sin vuelos para mostrar', () => {
    render(<Harness board={buildFlightBoard([], { nowMs: NOW, t: es })} state={{ status: 'empty', staleSince: null }} />);
    expect(within(panel()).getByText('Sin vuelos para mostrar')).toBeInTheDocument();
    expect(within(panel()).getByText('No hay vuelos relacionados con la estación en este momento.')).toBeInTheDocument();
    // No counts nobody counted: the controls are not drawn over an empty day.
    expect(screen.queryByRole('group', { name: 'Dirección' })).not.toBeInTheDocument();
    expect(strips()).toEqual([]);
  });

  it('a failed read says what failed with Reintentar, and a refusal says the account may not see the flights', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const labels = { error: es('page.errorTitle'), retry: es('page.retry'), forbidden: es('board.forbidden') };
    const view = render(<Harness state={{ status: 'error', onRetry }} labels={labels} />);
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar el monitoreo de vuelos de la estación.');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(strips()).toEqual([]);

    view.rerender(<Harness state={{ status: 'forbidden' }} labels={labels} />);
    expect(within(panel()).getByText('No tienes permiso para ver los vuelos de la estación.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('speaks English inside a translated scope', () => {
    act(() => resetLanguageForTests('en'));
    const en = createTranslator(flightMonitoringMessages, 'en');
    render(<LanguageScope><Harness board={buildFlightBoard(FLIGHTS, { nowMs: NOW, t: en, stationCode: 'PUJ' })} /></LanguageScope>);
    expect(screen.getByRole('region', { name: 'Flight board' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Direction' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Arrivals 2' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search flight')).toHaveAttribute('placeholder', 'Number, airline, registration or supervisor');
    expect(screen.getByRole('list', { name: 'Board legend' })).toBeInTheDocument();
    expect(screen.getAllByText('Arrival without an assigned stand')).toHaveLength(1);
    expect(screen.queryByText('Leyenda')).not.toBeInTheDocument();
  });
});
