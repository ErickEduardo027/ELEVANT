import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { STAND_STATES, TAGS } from '../../occ-ui/statusVocabulary';
import { mapOccupancyToRampPositions } from '../../positions-map/positionsMapMappers';
import { withStandDisplay } from '../stands/standModel';
import { STAND_REFERENCE } from '../stands/standReference';
import { SCENARIO_AGENTS, createRampScenario } from '../testing/mapFixtures';
import StandDetailFacts, { locationOrigin } from './StandDetailFacts';

// The synthetic ramp of the fixtures at 14:07 in Punta Cana, as the positions map reads it (useStandDisplay).
const NOW = Date.parse('2026-11-13T18:07:00Z');
const REFERENCES = STAND_REFERENCE.map(stand => ({ id: stand.code, terminal: stand.terminal, lat: stand.latitude, lon: stand.longitude }));
const { board, flightsByTurnaround } = createRampScenario(NOW);
const STANDS = withStandDisplay(mapOccupancyToRampPositions(REFERENCES, board, board.asOf), { nowMs: NOW, flightsByTurnaround });
const stand = code => STANDS.find(item => item.id === code);
const facts = () => screen.getByRole('list', { name: /Estado en el mapa|State on the map/ });
const factsOf = kind => within(facts()).getAllByRole('listitem').filter(item => item.dataset.fact === kind);

afterEach(() => {
  cleanup();
  act(() => resetLanguageForTests('es'));
});

describe('StandDetailFacts', () => {
  it('shows the state word, «Cubre …», the signal reasons, «Anulada por» and where the location comes from', () => {
    // A3: «Llegando» on the map (the board still says planned), covered by nobody, with its attention signal.
    const { rerender } = render(<StandDetailFacts position={stand('A3')} />);
    expect(stand('A3').status).toBe('planned');
    expect(factsOf('state')[0]).toHaveTextContent(STAND_STATES.arriving.es);
    expect(factsOf('state')[0].querySelector('svg')).toHaveAttribute('data-stand-state', 'arriving');
    expect(factsOf('coverage')).toEqual([]);
    const [signal] = factsOf('signal');
    expect(signal).toHaveTextContent('Sin agente que la cubra');
    expect(within(signal).getByRole('img', { name: 'Atención' })).toHaveAttribute('data-shape', 'triangle');
    // At its point of the internal reference catalogue: «No oficial» and what it means.
    expect(factsOf('location')[0]).toHaveTextContent(`${TAGS.unofficial.es}Referencia interna sin verificar`);

    // A4: occupied, Luis covers it, and another aircraft arrives: the urgent signal with its octagon.
    rerender(<StandDetailFacts position={stand('A4')} />);
    expect(factsOf('state')[0]).toHaveTextContent('Ocupada');
    expect(factsOf('coverage')[0]).toHaveTextContent(`Cubre ${SCENARIO_AGENTS.luis}`);
    expect(within(factsOf('signal')[0]).getByRole('img', { name: 'Urgente' })).toHaveAttribute('data-shape', 'octagon');
    expect(factsOf('signal')[0]).toHaveTextContent('Otra aeronave llega a esta posición');

    // A10: cancelled by the combined A9; B22 and BN6: only narrow-body aircraft.
    rerender(<StandDetailFacts position={stand('A10')} />);
    expect(factsOf('state')[0]).toHaveTextContent('Inhabilitada');
    expect(factsOf('cancelled')[0]).toHaveTextContent('Anulada por A9');
    rerender(<StandDetailFacts position={stand('B22')} />);
    expect(factsOf('narrowbody')[0]).toHaveTextContent('Solo fuselaje estrecho');
    expect(factsOf('cancelled')).toEqual([]);

    // C7, placed by OCC; and a stand of the board no map draws.
    rerender(<StandDetailFacts position={stand('C7')} />);
    expect(factsOf('location')[0]).toHaveTextContent(/^Ubicada por OCC$/);
    expect(factsOf('location')[0]).toHaveAttribute('data-origin', 'occ');
    rerender(<StandDetailFacts position={{ ...stand('A1'), latitude: null, longitude: null, locationSource: 'none' }} />);
    expect(factsOf('location')[0]).toHaveTextContent(/^Sin ubicar$/);

    // Two agents in the list form of the language; a stand that reads only its board status.
    rerender(<StandDetailFacts position={{ ...stand('A1'), coveredBy: [SCENARIO_AGENTS.marta, SCENARIO_AGENTS.ana] }} />);
    expect(factsOf('coverage')[0]).toHaveTextContent(`Cubre ${SCENARIO_AGENTS.marta} y ${SCENARIO_AGENTS.ana}`);
    rerender(<StandDetailFacts position={{ id: 'A2', status: 'releasing', latitude: 18.5, longitude: -68.3 }} />);
    expect(factsOf('state')[0]).toHaveTextContent('Por liberar');
    expect(factsOf('signal')).toEqual([]);
    rerender(<StandDetailFacts position={null} />);
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('speaks English on the English screens', () => {
    act(() => resetLanguageForTests('en'));
    render(<LanguageScope><StandDetailFacts position={stand('A3')} /></LanguageScope>);
    expect(factsOf('state')[0]).toHaveTextContent('Arriving');
    expect(factsOf('signal')[0]).toHaveTextContent('No agent covers it');
    expect(within(factsOf('signal')[0]).getByRole('img', { name: 'Attention' })).toBeInTheDocument();
    expect(factsOf('location')[0]).toHaveTextContent(`${TAGS.unofficial.en}Internal reference, not verified`);
  });

  it('tells where a location comes from', () => {
    expect(locationOrigin({ locationSource: 'occ', latitude: 1, longitude: 2 })).toBe('occ');
    expect(locationOrigin({ locationSource: 'reference', latitude: 1, longitude: 2 })).toBe('reference');
    expect(locationOrigin({ latitude: 1, longitude: 2 })).toBe('reference');
    expect(locationOrigin({ locationSource: 'none' })).toBe('none');
    expect(locationOrigin({ latitude: null, longitude: null })).toBe('none');
  });
});
