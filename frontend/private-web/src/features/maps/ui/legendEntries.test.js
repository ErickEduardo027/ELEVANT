import { describe, expect, it } from 'vitest';
import { STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { standsInView } from '../core/cameraPresets';
import { legendEntries } from './legendEntries';

// Synthetic stands of a screen: terminal A in the east, the FBO far to the west.
const STANDS = [
  { id: 'A1', terminal: 'A', latitude: 18.5642, longitude: -68.3603, status: 'occupied', locationSource: 'occ' },
  { id: 'A2', terminal: 'A', latitude: 18.5642, longitude: -68.3609, status: 'available', locationSource: 'occ' },
  { id: 'A3', terminal: 'A', latitude: 18.5642, longitude: -68.3615, status: 'planned', locationSource: 'occ' },
  { id: 'BN6', terminal: 'FBO', latitude: 18.5630, longitude: -68.3788, status: 'disabled', locationSource: 'reference' },
  { id: 'BN7', terminal: 'FBO', latitude: 18.5631, longitude: -68.3780, status: 'unverified' },
  { id: 'B33', terminal: 'B', latitude: 18.5642, longitude: -68.3612, status: 'releasing', retired: true },
  { id: 'X1', terminal: 'A', latitude: null, longitude: null, status: 'arriving' },
];
// Synthetic flights (invented keys): one over terminal A, one without a position and one without an id near the FBO.
const FLIGHTS = [
  { id: 'l:leg-1', heading: 90, latitude: 18.5643, longitude: -68.3606 },
  { id: 'p:prop-2', heading: null, latitude: null, longitude: null },
  { id: null, heading: 0, latitude: 18.5631, longitude: -68.3785 },
];
const TERMINAL_A = [[-68.362, 18.563], [-68.36, 18.565]];
const FBO = [[-68.38, 18.562], [-68.377, 18.564]];
const NOTHING = { flights: false, states: [], tags: [], grouped: false };

describe('legend entries', () => {
  it('lists only the states of the stands inside the view, in vocabulary order, and the «No oficial» tag for unofficial stands', () => {
    // Terminal A: three located by OCC, so no tag; the order is the vocabulary's, not the list's.
    expect(legendEntries({ stands: STANDS, bounds: TERMINAL_A }))
      .toEqual({ ...NOTHING, states: ['available', 'planned', 'occupied'] });
    // The FBO: a stand at its reference location and one without a row bring the tag.
    expect(legendEntries({ stands: STANDS, bounds: FBO }))
      .toEqual({ ...NOTHING, states: ['disabled', 'unverified'], tags: ['unofficial'] });
    // The retired B33 is never drawn and the stand without a location is never on screen.
    expect(legendEntries({ stands: STANDS, bounds: TERMINAL_A }).states).not.toContain('releasing');
    expect(legendEntries({ stands: STANDS, bounds: TERMINAL_A }).states).not.toContain('arriving');
    // An empty view lists nothing; without bounds every drawn stand counts, and one without a location is never drawn.
    expect(legendEntries({ stands: STANDS, bounds: [[-69, 19], [-68.9, 19.1]] })).toEqual(NOTHING);
    expect(legendEntries({ stands: STANDS }).states)
      .toEqual(STAND_STATE_KEYS.filter(state => ['available', 'planned', 'occupied', 'disabled', 'unverified'].includes(state)));
    expect(legendEntries({ stands: STANDS.filter(stand => stand.id === 'X1') })).toEqual(NOTHING);
    expect(legendEntries()).toEqual(NOTHING);
    // A status outside the vocabulary is not a legend entry.
    expect(legendEntries({ stands: [{ id: 'A9', latitude: 18.564, longitude: -68.361, status: 'mystery', locationSource: 'occ' }] }))
      .toEqual(NOTHING);
  });

  it('says when stands on screen are drawn as clusters, which have no state of their own', () => {
    expect(legendEntries({ stands: [], grouped: true })).toEqual({ ...NOTHING, grouped: true });
    expect(legendEntries({ stands: STANDS, bounds: FBO, grouped: true }))
      .toEqual({ ...NOTHING, states: ['disabled', 'unverified'], tags: ['unofficial'], grouped: true });
    expect(legendEntries({ stands: [], grouped: 'yes' }).grouped).toBe(false);
  });

  it('says when flights are drawn inside the view: those with an id and a position', () => {
    // Over terminal A the flight is drawn next to the stands of the view.
    expect(legendEntries({ flights: FLIGHTS, bounds: TERMINAL_A })).toEqual({ ...NOTHING, flights: true });
    expect(legendEntries({ stands: STANDS, flights: FLIGHTS, bounds: TERMINAL_A }))
      .toEqual({ ...NOTHING, flights: true, states: ['available', 'planned', 'occupied'] });
    // Near the FBO there is only the flight without an id, which the map never draws.
    expect(legendEntries({ stands: STANDS, flights: FLIGHTS, bounds: FBO }).flights).toBe(false);
    // Without bounds any drawn flight counts; a flight without a position is never drawn.
    expect(legendEntries({ flights: FLIGHTS }).flights).toBe(true);
    expect(legendEntries({ flights: FLIGHTS.slice(1) })).toEqual(NOTHING);
    expect(legendEntries({ flights: null }).flights).toBe(false);
  });

  it('standsInView keeps the drawn stands inside the bounds', () => {
    expect(standsInView(STANDS, TERMINAL_A).map(stand => stand.id)).toEqual(['A1', 'A2', 'A3']);
    expect(standsInView(STANDS).map(stand => stand.id)).toEqual(['A1', 'A2', 'A3', 'BN6', 'BN7', 'X1']);
    expect(standsInView(null)).toEqual([]);
  });
});
