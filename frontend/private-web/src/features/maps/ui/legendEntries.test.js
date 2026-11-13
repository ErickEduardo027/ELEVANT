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
const TERMINAL_A = [[-68.362, 18.563], [-68.36, 18.565]];
const FBO = [[-68.38, 18.562], [-68.377, 18.564]];

describe('legend entries', () => {
  it('lists only the states of the stands inside the view, in vocabulary order, and the «No oficial» tag for unofficial stands', () => {
    // Terminal A: three located by OCC, so no tag; the order is the vocabulary's, not the list's.
    expect(legendEntries({ stands: STANDS, bounds: TERMINAL_A })).toEqual({ states: ['available', 'planned', 'occupied'], tags: [] });
    // The FBO: a stand at its reference location and one without a row bring the tag.
    expect(legendEntries({ stands: STANDS, bounds: FBO })).toEqual({ states: ['disabled', 'unverified'], tags: ['unofficial'] });
    // The retired B33 is never drawn and the stand without a location is never on screen.
    expect(legendEntries({ stands: STANDS, bounds: TERMINAL_A }).states).not.toContain('releasing');
    expect(legendEntries({ stands: STANDS, bounds: TERMINAL_A }).states).not.toContain('arriving');
    // An empty view lists nothing; without bounds every drawn stand counts, and one without a location is never drawn.
    expect(legendEntries({ stands: STANDS, bounds: [[-69, 19], [-68.9, 19.1]] })).toEqual({ states: [], tags: [] });
    expect(legendEntries({ stands: STANDS }).states)
      .toEqual(STAND_STATE_KEYS.filter(state => ['available', 'planned', 'occupied', 'disabled', 'unverified'].includes(state)));
    expect(legendEntries({ stands: STANDS.filter(stand => stand.id === 'X1') })).toEqual({ states: [], tags: [] });
    expect(legendEntries()).toEqual({ states: [], tags: [] });
    // A status outside the vocabulary is not a legend entry.
    expect(legendEntries({ stands: [{ id: 'A9', latitude: 18.564, longitude: -68.361, status: 'mystery', locationSource: 'occ' }] }))
      .toEqual({ states: [], tags: [] });
  });

  it('standsInView keeps the drawn stands inside the bounds', () => {
    expect(standsInView(STANDS, TERMINAL_A).map(stand => stand.id)).toEqual(['A1', 'A2', 'A3']);
    expect(standsInView(STANDS).map(stand => stand.id)).toEqual(['A1', 'A2', 'A3', 'BN6', 'BN7', 'X1']);
    expect(standsInView(null)).toEqual([]);
  });
});
