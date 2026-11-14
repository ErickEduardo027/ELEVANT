import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { withStandDisplay } from '../../maps/stands/standModel';
import { STAND_REFERENCE } from '../../maps/stands/standReference';
import { createRampScenario } from '../../maps/testing/mapFixtures';
import { mapOccupancyToRampPositions } from '../positionsMapMappers';
import PositionDetailDrawer from './PositionDetailDrawer';

// A synthetic free stand of the positions board, without a flight.
const POSITION = {
  id: 'A5', terminal: 'A', status: 'available', standId: null, flightId: null, flightNumber: null,
  combinedConfiguration: null, linkedPositionId: null, updatedAt: '2026-11-12T15:00:00Z',
};

// The synthetic ramp of the map fixtures at 14:07 in Punta Cana, as Mapa de posiciones reads it (useStandDisplay).
const NOW = Date.parse('2026-11-13T18:07:00Z');
const REFERENCES = STAND_REFERENCE.map(stand => ({ id: stand.code, terminal: stand.terminal, lat: stand.latitude, lon: stand.longitude }));
function rampStands() {
  const { board, flightsByTurnaround } = createRampScenario(NOW);
  return withStandDisplay(mapOccupancyToRampPositions(REFERENCES, board, board.asOf), { nowMs: NOW, flightsByTurnaround });
}

const press = key => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  return event;
};

afterEach(() => {
  cleanup();
  act(() => resetLanguageForTests('es'));
});

it('calls preventDefault when Escape closes the drawer', () => {
  const onClose = vi.fn();
  const { rerender } = render(<PositionDetailDrawer position={POSITION} onClose={onClose} onViewFlightInMonitoring={() => {}} />);
  expect(screen.getByTestId('position-detail-drawer')).toBeInTheDocument();

  expect(press('Enter').defaultPrevented).toBe(false);
  expect(onClose).not.toHaveBeenCalled();

  const escape = press('Escape');
  expect(onClose).toHaveBeenCalledOnce();
  expect(escape.defaultPrevented).toBe(true);

  // Closed, the drawer listens to nothing: the next Escape is free for the map.
  rerender(<PositionDetailDrawer position={null} onClose={onClose} onViewFlightInMonitoring={() => {}} />);
  expect(screen.queryByTestId('position-detail-drawer')).not.toBeInTheDocument();
  expect(press('Escape').defaultPrevented).toBe(false);
  expect(onClose).toHaveBeenCalledOnce();
});

it('shows the stand facts and keeps its test id and «Ubicar en el mapa»', async () => {
  // A free stand with a row, cancelled by its combined neighbour, limited to narrow-body aircraft and covered by an
  // invented agent, as the positions map reads it now.
  const [stand] = withStandDisplay([{
    ...POSITION, standId: 'stand-A10', id: 'A10', status: 'disabled', turnarounds: [], cancelledBy: 'A09',
    linkedPositionId: 'A9', combinedConfiguration: '9-Alfa', narrowbodyOnly: true, coveredBy: ['Ana Ruiz'],
    locationSource: 'reference', latitude: 18.56, longitude: -68.36,
  }]);
  const onStartPlacing = vi.fn();
  render(<PositionDetailDrawer position={stand} onClose={() => {}} onViewFlightInMonitoring={() => {}} canAssign
    onStartPlacing={onStartPlacing} operationDate="2026-11-13" />);
  const drawer = screen.getByTestId('position-detail-drawer');
  const facts = within(drawer).getByRole('list', { name: 'Estado en el mapa' });
  expect(within(facts).getAllByRole('listitem').map(item => item.textContent)).toEqual([
    'Inhabilitada', 'Cubre Ana Ruiz', 'Anulada por A9', 'Solo fuselaje estrecho', 'No oficialReferencia interna sin verificar',
  ]);
  // The existing explanation of the combined configuration stays, and so does the action that places the stand.
  expect(within(drawer).getByTestId('combined-position-banner')).toBeInTheDocument();
  await userEvent.click(within(drawer).getByRole('button', { name: 'Ubicar en el mapa' }));
  expect(onStartPlacing).toHaveBeenCalledExactlyOnceWith(stand);
});

it('says the state once, in the words of the map: «Llegando» for a flight due within 15 minutes, never the board\'s «Planificada»', () => {
  const stands = rampStands();
  // The stands of the ramp whose board word is not the map's: A3, whose flight is due in 10 minutes; A5, whose
  // aircraft leaves in 10; A6, whose demo aircraft landed but is not on the stand yet; and A7, which has no database row.
  const cases = [
    { code: 'A3', board: 'planned', word: 'Llegando', boardWord: 'Planificada' },
    { code: 'A5', board: 'occupied', word: 'Por liberar', boardWord: 'Ocupada' },
    { code: 'A6', board: 'occupied', word: 'Llegando', boardWord: 'Ocupada' },
    { code: 'A7', board: 'unverified', word: 'Sin verificar', boardWord: 'Sin ocupación verificada' },
  ];
  for (const { code, board, word, boardWord } of cases) {
    const stand = stands.find(item => item.id === code);
    expect(stand.status, code).toBe(board);
    const { unmount } = render(<PositionDetailDrawer position={stand} onClose={() => {}} onViewFlightInMonitoring={() => {}} />);
    const drawer = screen.getByTestId('position-detail-drawer');
    expect(within(drawer).getAllByText(word), code).toHaveLength(1);
    expect(within(drawer).getByRole('list', { name: 'Estado en el mapa' }), code).toHaveTextContent(word);
    expect(drawer, code).not.toHaveTextContent(boardWord);
    unmount();
  }
});

it('says the state in the English words of the map on the English screens', () => {
  act(() => resetLanguageForTests('en'));
  const stand = rampStands().find(item => item.id === 'A3');
  render(<LanguageScope><PositionDetailDrawer position={stand} onClose={() => {}} onViewFlightInMonitoring={() => {}} /></LanguageScope>);
  const drawer = screen.getByTestId('position-detail-drawer');
  expect(within(drawer).getAllByText('Arriving')).toHaveLength(1);
  expect(drawer).not.toHaveTextContent('Planned');
});
