import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { createTranslator, resetLanguageForTests } from '../../../i18n/languageStore';
import { createMapFlights, TRAFFIC_FLIGHT_KEY, TRAFFIC_NOON } from '../../maps/testing/trafficFixtures';
import BoardPanel from './BoardPanel';
import { buildBoard } from './boardModel';
import { consoleMessages } from './consoleMessages';

const NOW = Date.parse(TRAFFIC_NOON);
const FLIGHTS = createMapFlights().flights;
const flight = key => FLIGHTS.find(item => item.flightKey === TRAFFIC_FLIGHT_KEY[key]);
// A flight of the map as the feed proposes it before OCC imports it: a proposal without a leg or a turnaround.
const proposed = item => ({ ...item, imported: false, legId: null, turnaroundId: null, turnaround: null, stand: null });
// ZZ161 and the demo ZZ9001 wait to be imported, and the demo ZZ9002 is the only departure: nothing is imported.
const ONLY_TO_IMPORT = Object.freeze([proposed(flight('arrival')), flight('demoArrival'), flight('demoDeparture')]);

afterEach(() => {
  cleanup();
  resetLanguageForTests();
});

/** The board of `flights` at the lab's noon, over a read that answered, in `language`; returns its panel. */
function renderBoard(flights, language = 'es') {
  const board = buildBoard({ flights, nowMs: NOW, t: createTranslator(consoleMessages, language) });
  resetLanguageForTests(language);
  render(
    <LanguageScope>
      <BoardPanel board={board} state={{ status: 'success' }} nowMs={NOW} timeZone="America/Santo_Domingo" />
    </LanguageScope>
  );
  return within(screen.getByRole('region', { name: consoleMessages[language].panels.board }));
}

describe('BoardPanel', () => {
  it('a tab whose flights all wait to be imported counts them instead of saying it has none (N25)', async () => {
    const board = renderBoard(ONLY_TO_IMPORT);

    // The tab counts the flights to import, and its body now says where they are.
    expect(board.getByRole('tab', { name: 'Llegadas 2' })).toHaveAttribute('aria-selected', 'true');
    expect(board.getByText('Ninguna llegada importada: 2 por importar.')).toBeInTheDocument();
    expect(board.queryByText('No hay llegadas en la ventana del mapa.')).not.toBeInTheDocument();
    const toImport = board.getByRole('region', { name: 'Por importar' });
    expect(toImport).toHaveTextContent('ZZ161');
    expect(toImport).toHaveTextContent('ZZ9001');

    await userEvent.click(board.getByRole('tab', { name: 'Salidas 1' }));
    expect(board.getByText('Ninguna salida importada: 1 por importar.')).toBeInTheDocument();
    expect(board.queryByText('No hay salidas en la ventana del mapa.')).not.toBeInTheDocument();
    expect(board.getByRole('region', { name: 'Por importar' })).toHaveTextContent('ZZ9002');
  });

  it('a tab without any flight says the map window has none; one with strips says neither', async () => {
    // ZZ300 is on its stand, imported, and the demo ZZ9001 waits to be imported; there is no departure.
    const board = renderBoard([flight('parkedArrival'), flight('demoArrival')]);

    expect(board.getByRole('tab', { name: 'Llegadas 2' })).toHaveAttribute('aria-selected', 'true');
    expect(board.getByRole('button', { name: /ZZ300/ })).toBeInTheDocument();
    expect(board.queryByText(/Ninguna llegada importada|No hay llegadas/)).not.toBeInTheDocument();

    await userEvent.click(board.getByRole('tab', { name: 'Salidas 0' }));
    expect(board.getByText('No hay salidas en la ventana del mapa.')).toBeInTheDocument();
    expect(board.queryByText(/Ninguna salida importada/)).not.toBeInTheDocument();
    expect(board.queryByRole('region', { name: 'Por importar' })).not.toBeInTheDocument();
  });

  it('says the same in English (N25)', async () => {
    const board = renderBoard(ONLY_TO_IMPORT, 'en');

    expect(board.getByRole('tab', { name: 'Arrivals 2' })).toHaveAttribute('aria-selected', 'true');
    expect(board.getByText('No arrivals imported: 2 to import.')).toBeInTheDocument();
    await userEvent.click(board.getByRole('tab', { name: 'Departures 1' }));
    expect(board.getByText('No departures imported: 1 to import.')).toBeInTheDocument();
    expect(board.queryByText('There are no departures in the map window.')).not.toBeInTheDocument();
  });
});
