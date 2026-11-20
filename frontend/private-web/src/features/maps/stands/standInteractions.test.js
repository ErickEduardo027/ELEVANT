import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n/languageStore';
import { STAND_STATES } from '../../occ-ui/statusVocabulary';
import { mapOccupancyToRampPositions } from '../../positions-map/positionsMapMappers';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { layoutStandReferences } from '../airport/layoutIndex';
import { mapMessages } from '../mapMessages';
import { SCENARIO_AGENTS, boardStand, createRampScenario } from '../testing/mapFixtures';
import {
  SAFE_AREA_MARGIN, STAND_FLAG_KEYS, featureStatePlan, findStandByCode, isOutsideSafeArea, sameAgentMark, standFlags,
  standTooltip,
} from './standInteractions';
import { attachStandGeometry, withStandDisplay } from './standModel';

// 14:07 in Punta Cana (UTC−4): the synthetic ramp of the fixtures, read as the positions map reads it.
const NOW = Date.parse('2026-11-13T18:07:00Z');
const REFERENCES = layoutStandReferences(MDPC_LAYOUT);
const { marta, luis, ana } = SCENARIO_AGENTS;
const spanish = createTranslator(mapMessages, 'es');
const english = createTranslator(mapMessages, 'en');

function scenarioStands() {
  const { board, flightsByTurnaround } = createRampScenario(NOW);
  return withStandDisplay(attachStandGeometry(mapOccupancyToRampPositions(REFERENCES, board, board.asOf), MDPC_LAYOUT),
    { nowMs: NOW, flightsByTurnaround });
}

const sorted = codes => [...codes].sort();

describe('stand interactions', () => {
  it('hovering a stand marks the others covered by the same agent; leaving clears them', () => {
    const stands = scenarioStands();
    expect(STAND_FLAG_KEYS).toEqual(['hover', 'selected', 'related']);
    const idle = standFlags({ stands });
    expect(idle).toEqual({ hover: null, selected: null, related: null, sameAgent: new Set() });

    // Marta covers A1, A2 and A6: the pointer over A1 marks the other two.
    const over = standFlags({ hover: 'A01', stands });
    expect(over.hover).toBe('A1');
    expect(sorted(over.sameAgent)).toEqual(['A2', 'A6']);
    expect(featureStatePlan(idle, over)).toEqual([
      { op: 'set', id: 'A1', state: { hover: true } },
      { op: 'set', id: 'A2', state: { sameAgent: true } },
      { op: 'set', id: 'A6', state: { sameAgent: true } },
    ]);
    // Leaving the stand takes the marks away.
    expect(featureStatePlan(over, standFlags({ hover: null, stands }))).toEqual([
      { op: 'remove', id: 'A1', key: 'hover' },
      { op: 'remove', id: 'A2', key: 'sameAgent' },
      { op: 'remove', id: 'A6', key: 'sameAgent' },
    ]);

    // With A4 selected (Luis covers A4, A5 and B22) the pointer over A1 shows Marta's stands, and leaving gives the
    // marks back to the selection.
    const selected = standFlags({ selected: 'A4', stands });
    expect(sorted(selected.sameAgent)).toEqual(['A5', 'B22']);
    const pointing = standFlags({ hover: 'A1', selected: 'A4', stands });
    expect(featureStatePlan(selected, pointing)).toEqual([
      { op: 'remove', id: 'A5', key: 'sameAgent' },
      { op: 'remove', id: 'B22', key: 'sameAgent' },
      { op: 'set', id: 'A1', state: { hover: true } },
      { op: 'set', id: 'A2', state: { sameAgent: true } },
      { op: 'set', id: 'A6', state: { sameAgent: true } },
    ]);
    expect(featureStatePlan(pointing, standFlags({ selected: 'A4', stands }))).toEqual([
      { op: 'remove', id: 'A1', key: 'hover' },
      { op: 'remove', id: 'A2', key: 'sameAgent' },
      { op: 'remove', id: 'A6', key: 'sameAgent' },
      { op: 'set', id: 'A5', state: { sameAgent: true } },
      { op: 'set', id: 'B22', state: { sameAgent: true } },
    ]);
    // A stand nobody covers marks nothing; nor does a stand the screen does not know.
    expect(standFlags({ hover: 'A3', stands }).sameAgent.size).toBe(0);
    expect(standFlags({ hover: 'Z9', stands }).sameAgent.size).toBe(0);
    // Ana covers A9, A10, B21 and C7, the stand OCC placed away from the layout.
    expect(sorted(standFlags({ selected: 'A10', stands }).sameAgent)).toEqual(['A9', 'B21', 'C7']);
  });

  it('sameAgentMark names the ring after the stand whose agent it follows, and gives nothing when it rings no stand', () => {
    const stands = scenarioStands();
    // Nothing under the pointer and nothing selected: no ring.
    expect(sameAgentMark(standFlags({ stands }))).toBeNull();
    // Marta's stands around A1 under the pointer; Luis's around the selected A4.
    expect(sameAgentMark(standFlags({ hover: 'A1', stands }))).toBe('sameAgentHover');
    expect(sameAgentMark(standFlags({ selected: 'A4', stands }))).toBe('sameAgent');
    // The pointer wins while it is over another stand: the ring is that stand's, not the selection's.
    expect(sameAgentMark(standFlags({ hover: 'A1', selected: 'A4', stands }))).toBe('sameAgentHover');
    // Over the selected stand itself, whatever the spelling of its code, the ring is the selection's.
    expect(sameAgentMark(standFlags({ hover: 'a-04', selected: 'A4', stands }))).toBe('sameAgent');
    // Over A3, which nobody covers, no stand is ringed, so there is nothing to name, not even the selection's ring.
    const uncovered = standFlags({ hover: 'A3', selected: 'A4', stands });
    expect(uncovered.sameAgent.size).toBe(0);
    expect(sameAgentMark(uncovered)).toBeNull();
    // Flags given as lists, empty, or not at all.
    expect(sameAgentMark({ hover: null, selected: 'A4', sameAgent: ['A5'] })).toBe('sameAgent');
    expect(sameAgentMark({ hover: 'A1', selected: null, sameAgent: [] })).toBeNull();
    expect(sameAgentMark(null)).toBeNull();
    expect(sameAgentMark(undefined)).toBeNull();
  });

  it('the feature-state plan touches only the stands whose flags changed', () => {
    const before = { hover: 'A1', selected: 'B21', related: null, sameAgent: new Set(['A2', 'A6']) };
    const after = { hover: 'A1', selected: 'B22', related: 'A9', sameAgent: ['A6', 'C7'] };
    // Every removal first, then every write; A1 and A6 keep their flags and are not touched.
    expect(featureStatePlan(before, after)).toEqual([
      { op: 'remove', id: 'B21', key: 'selected' },
      { op: 'remove', id: 'A2', key: 'sameAgent' },
      { op: 'set', id: 'B22', state: { selected: true } },
      { op: 'set', id: 'A9', state: { related: true } },
      { op: 'set', id: 'C7', state: { sameAgent: true } },
    ]);
    // The same flags in another order, list or set, and codes written as the database writes them: nothing to do.
    expect(featureStatePlan(after, { hover: 'a-1', selected: 'B022', related: 'A09', sameAgent: new Set(['C07', 'A6']) })).toEqual([]);
    expect(featureStatePlan(undefined, undefined)).toEqual([]);
    expect(featureStatePlan({ selected: '', sameAgent: null }, {})).toEqual([]);
    // A selection that moves to the stand under the pointer keeps the hover and moves the selection only.
    expect(featureStatePlan({ hover: 'A5', selected: 'A1' }, { hover: 'A5', selected: 'A5' })).toEqual([
      { op: 'remove', id: 'A1', key: 'selected' },
      { op: 'set', id: 'A5', state: { selected: true } },
    ]);
  });

  it('the stand tooltip gives the code, the state word, the flight and «Cubre …»', () => {
    const stands = scenarioStands();
    // A5: the aircraft leaves within 15 minutes; its departure flight and its agent.
    expect(standTooltip('A05', stands, spanish)).toEqual({
      kind: 'stand', id: 'A5', code: 'A5', title: `A5 · ${STAND_STATES.releasing.es}`, detail: 'DM210 · Cubre Luis Peña',
      reasons: [],
    });
    // A3: arriving and covered by nobody, so its attention signal and its reason.
    expect(standTooltip('A3', stands, spanish)).toMatchObject({
      title: 'A3 · Llegando', detail: 'DM203', reasons: [{ signal: 'attention', text: 'Sin agente que la cubra' }],
    });
    // A4: another aircraft arrives while one is parked, urgent.
    expect(standTooltip('A4', stands, spanish)).toMatchObject({
      title: 'A4 · Ocupada', detail: 'DM206 · Cubre Luis Peña',
      reasons: [{ signal: 'urgent', text: 'Otra aeronave llega a esta posición' }],
    });
    // A6: the demo flight, labelled «Demo», still arriving until the server parks it.
    expect(standTooltip('A6', stands, spanish)).toMatchObject({ title: 'A6 · Llegando', detail: 'ZZ9001 · Demo · Cubre Marta Castillo' });
    // A10, cancelled by the combined A9, and B22, limited to narrow-body aircraft: their notes, without a signal.
    expect(standTooltip('A10', stands, spanish)).toMatchObject({
      title: 'A10 · Inhabilitada', detail: 'Cubre Ana Ruiz', reasons: [{ signal: null, text: 'Anulada por A9' }],
    });
    expect(standTooltip('B22', stands, spanish)).toMatchObject({
      title: 'B22 · Libre', detail: 'Cubre Luis Peña', reasons: [{ signal: null, text: 'Solo fuselaje estrecho' }],
    });
    // A stand of the catalogue without a row: its state and nothing else.
    expect(standTooltip('A7', stands, spanish)).toMatchObject({ title: 'A7 · Sin verificar', detail: null, reasons: [] });
    // Two agents, in the language's list form.
    const shared = stands.map(stand => (stand.id === 'A1' ? { ...stand, coveredBy: [marta, luis, ana] } : stand));
    expect(standTooltip('A1', shared, spanish).detail).toBe('Cubre Marta Castillo, Luis Peña y Ana Ruiz');
    expect(standTooltip('A1', shared, english, 'en').detail).toBe('Covered by Marta Castillo, Luis Peña, and Ana Ruiz');
    // In English, the vocabulary's word.
    expect(standTooltip('A5', stands, english, 'en')).toMatchObject({ title: 'A5 · Releasing', detail: 'DM210 · Covered by Luis Peña' });
    expect(standTooltip('A3', stands, english, 'en').reasons).toEqual([{ signal: 'attention', text: 'No agent covers it' }]);
    // A stand that reads only its board status, and one the map does not draw.
    expect(standTooltip('B21', [{ id: 'B21', status: 'occupied', flightNumber: 'DM777' }], spanish))
      .toMatchObject({ title: 'B21 · Ocupada', detail: 'DM777', reasons: [] });
    expect(standTooltip('Z9', stands, spanish)).toBeNull();
    // A stand with an aircraft standing in it and no arrival recorded (PR M6): the plain notice, after any stronger
    // reason, with its diamond.
    const notice = { kind: 'notice', reason: 'arrivalNotRecorded' };
    const waiting = stands.map(stand => (stand.id === 'A9' ? { ...stand, signals: [notice] } : stand));
    expect(standTooltip('A9', waiting, spanish).reasons)
      .toEqual([{ signal: 'notice', text: 'El avión ya está en la posición. Registra la llegada.' }]);
    const uncovered = stands.map(stand => (stand.id === 'A3' ? { ...stand, signals: [...stand.signals, notice] } : stand));
    expect(standTooltip('A3', uncovered, english, 'en').reasons).toEqual([
      { signal: 'attention', text: 'No agent covers it' },
      { signal: 'notice', text: 'The aircraft is already on the stand. Record its arrival.' },
    ]);
    expect(findStandByCode(stands, 'a-05')?.id).toBe('A5');
    expect(findStandByCode([{ id: 'B33', retired: true }], 'B33')).toBeNull();
  });

  it('«Cubre …» names who covers the stand now, from the coverage windows of its date (N26)', () => {
    // 19:50 on 16 November in Punta Cana: Elena Soto covered A5 until 17:00; Luis Peña covers it until 21:00.
    const T1950 = Date.parse('2026-11-16T23:50:00Z');
    const elena = { agentName: 'Elena Soto', startsAt: '2026-11-16T09:00:00Z', endsAt: '2026-11-16T21:00:00Z',
      isReinforcement: false };
    const luisNow = { agentName: 'Luis Peña', startsAt: '2026-11-16T21:00:00Z', endsAt: '2026-11-17T01:00:00Z',
      isReinforcement: false };
    const read = coverage => withStandDisplay(attachStandGeometry(mapOccupancyToRampPositions(REFERENCES, {
      operationDate: '2026-11-16', positions: [boardStand('A05', { coveredBy: coverage.map(item => item.agentName), coverage })],
    }, new Date(T1950).toISOString()), MDPC_LAYOUT), { nowMs: T1950 });
    expect(standTooltip('A5', read([elena]), spanish).detail).toBeNull();
    expect(standTooltip('A5', read([elena, luisNow]), spanish).detail).toBe('Cubre Luis Peña');
  });

  it('a stand is outside the safe area when it reaches into the band along the edges of the view, or beyond it', () => {
    const view = [[0, 0], [10, 10]];
    expect(SAFE_AREA_MARGIN).toBe(0.03);
    expect(isOutsideSafeArea([[4, 4], [6, 6]], view)).toBe(false);
    expect(isOutsideSafeArea([[0.4, 0.4], [9.6, 9.6]], view)).toBe(false);
    // In the band along the west edge, half out of sight, and beyond the view.
    expect(isOutsideSafeArea([[0.2, 4], [1.2, 5]], view)).toBe(true);
    expect(isOutsideSafeArea([[11, 4], [12, 5]], view)).toBe(true);
    expect(isOutsideSafeArea([[9, 9], [12, 12]], view)).toBe(true);
    expect(isOutsideSafeArea([[4, 9.8], [5, 9.9]], view)).toBe(true);
    // Without the band only what leaves the view counts.
    expect(isOutsideSafeArea([[0.2, 4], [1.2, 5]], view, { margin: 0 })).toBe(false);
    // Nothing to compare with: a map with no size or a stand the map does not draw moves no camera.
    expect(isOutsideSafeArea(null, view)).toBe(false);
    expect(isOutsideSafeArea([[4, 4], [6, 6]], null)).toBe(false);
  });

  it('never imports the dataset (source text guard)', () => {
    expect(readFileSync('src/features/maps/stands/standInteractions.js', 'utf8')).not.toMatch(/airportLayout|\.json['"]/);
  });
});
