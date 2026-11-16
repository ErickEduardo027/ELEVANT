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
    'Inhabilitada', 'Inhabilitada: anulada por A9 ocupada', 'Cubre Ana Ruiz',
  ]);
  // Its characteristics, with what limits it and where its location comes from.
  const characteristics = within(drawer).getByRole('region', { name: 'Características' });
  const row = name => characteristics.querySelector(`[data-fact="${name}"] dd`);
  expect(row('kind')).toHaveTextContent(/^Terminal A/);
  expect(row('constraints')).toHaveTextContent('Anulada por A9Solo fuselaje estrecho');
  expect(row('location')).toHaveTextContent('No oficialReferencia interna sin verificar');
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

it('says the turnaround on the stand: flight, airline, aircraft, times, countdown, agent and operation (owner request)', () => {
  const stand = rampStands().find(item => item.id === 'A5');
  render(<PositionDetailDrawer position={stand} onClose={() => {}} onViewFlightInMonitoring={() => {}} />);
  const drawer = screen.getByTestId('position-detail-drawer');
  const section = within(drawer).getByTestId('stand-turnaround');
  expect(section).toHaveTextContent('Escala en la posición');
  const fact = name => section.querySelector(`[data-fact="${name}"]`);
  for (const name of ['flight', 'airline', 'aircraft', 'route', 'arrival', 'departure', 'agent', 'operation']) {
    expect(fact(name), name).not.toBeNull();
  }
  expect(fact('flight')).toHaveTextContent(stand.display.visit.arrivalFlightNumber);
  expect(fact('departure')).toHaveTextContent(/Prog\. \d\d:\d\d/);
  // «Por liberar»: its aircraft leaves in about 10 minutes.
  expect(fact('countdown')).toHaveTextContent(/^Sale en \d+ min$/);
  // The existing facts, the close button and the drawer's test id stay.
  expect(within(drawer).getByRole('button', { name: 'Cerrar detalle' })).toBeInTheDocument();
});

it('«Tipo de aeronave» falls back to the type of the visit when the board does not carry it', () => {
  const stand = rampStands().find(item => item.id === 'A6');
  expect(stand.aircraftType).toBeNull();
  render(<PositionDetailDrawer position={stand} onClose={() => {}} onViewFlightInMonitoring={() => {}} />);
  const drawer = screen.getByTestId('position-detail-drawer');
  const field = within(drawer).getByText('Tipo de aeronave').closest('div');
  expect(field).toHaveTextContent(stand.display.aircraftType);
  expect(stand.display.aircraftType).toBe('B38M');
});

it('says why a stand reads its state, what comes next and what the stand is, from what the map read (owner request of 2026-11-15)', () => {
  const stands = rampStands();
  // A6: a demo aircraft landed and is not on the stand yet; its arrival on the stand comes next, with its countdown.
  const a6 = stands.find(item => item.id === 'A6');
  const slot = vi.fn(aircraft => <p data-testid="aircraft-slot">{aircraft.registration}</p>);
  const { unmount } = render(<PositionDetailDrawer position={a6} onClose={() => {}} onViewFlightInMonitoring={() => {}}
    aircraftFacts={slot} />);
  const drawer = screen.getByTestId('position-detail-drawer');
  const facts = within(drawer).getByRole('list', { name: 'Estado en el mapa' });
  expect(facts.querySelector('[data-fact="reason"]')).toHaveTextContent(/^Llegando: ZZ9001 aterrizó \d\d:\d\d, llega en \d+ min$/);
  expect(facts.querySelector('[data-fact="next-change"]'))
    .toHaveTextContent(/^Próximo cambio El avión entra en la posición a las \d\d:\d\d · en \d+ min$/);
  // The slot gets the aircraft coming onto the stand, marked demo so the screen never looks its registration up.
  expect(slot).toHaveBeenCalledWith(expect.objectContaining({ registration: 'HI9001', isDemo: true, state: 'arriving' }));
  expect(within(drawer).getByTestId('aircraft-slot')).toHaveTextContent('HI9001');
  const characteristics = within(drawer).getByRole('region', { name: 'Características' });
  const row = name => characteristics.querySelector(`[data-fact="${name}"] dd`);
  expect(row('size')).toHaveTextContent('Letra OACI D · hasta 52 m de envergadura');
  expect(row('heading')).toHaveTextContent(/^Nariz al [NSEO]{1,2} \(\d+°\)$/);
  expect(row('dimensions')).toHaveTextContent(/^≈ \d+ × \d+ m$/);
  expect(row('center')).toHaveTextContent(/^18\.\d{5}° N, 68\.\d{5}° O$/);
  expect(row('taxiway')).toHaveTextContent(/^Calle de rodaje \w+$/);
  unmount();

  // A free stand nobody covers: its reason, no next change, no aircraft slot, and «Sin cobertura registrada».
  const free = withStandDisplay([{ ...POSITION, standId: 'stand-A1', id: 'A1', status: 'available', turnarounds: [],
    coveredBy: [], locationSource: 'reference', latitude: 18.56, longitude: -68.36 }])[0];
  render(<PositionDetailDrawer position={free} onClose={() => {}} onViewFlightInMonitoring={() => {}} aircraftFacts={slot} />);
  const freeDrawer = screen.getByTestId('position-detail-drawer');
  expect(freeDrawer.querySelector('[data-fact="reason"]')).toHaveTextContent('Libre: sin escalas asignadas');
  expect(freeDrawer.querySelector('[data-fact="next-change"]')).toBeNull();
  expect(within(freeDrawer).queryByTestId('aircraft-slot')).toBeNull();
  expect(freeDrawer.querySelector('[data-fact="coverage-agents"] dd')).toHaveTextContent('Sin cobertura registrada');
});

it('says why and what comes next in English too', () => {
  act(() => resetLanguageForTests('en'));
  const a5 = rampStands().find(item => item.id === 'A5');
  render(<LanguageScope><PositionDetailDrawer position={a5} onClose={() => {}} onViewFlightInMonitoring={() => {}} /></LanguageScope>);
  const drawer = screen.getByTestId('position-detail-drawer');
  expect(drawer.querySelector('[data-fact="reason"]')).toHaveTextContent(/^Releasing: (scheduled|estimated) departure \d\d:\d\d$/);
  expect(within(drawer).getByRole('region', { name: 'Characteristics' })).toHaveTextContent(/ICAO code D/);
});
