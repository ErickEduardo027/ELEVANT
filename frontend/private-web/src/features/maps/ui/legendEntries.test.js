import { describe, expect, it } from 'vitest';
import { STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { boxOfPoints } from '../stands/standFeatures';
import { attachStandGeometry, withStandDisplay } from '../stands/standModel';
import { createMapStands, standPoint } from '../testing/mapFixtures';
import { STAND_MARKS, STAND_SIGNAL_KEYS, legendEntries } from './legendEntries';

// Synthetic stands drawn as polygons: A1 occupied, A2 free and A3 planned (placed by OCC), B21 disabled and BN6
// unverified, every other stand free at its reference location.
const STANDS = withStandDisplay(attachStandGeometry(createMapStands(), MDPC_LAYOUT), { nowMs: Date.parse('2026-11-13T15:00:00Z') });
const byId = id => STANDS.find(stand => stand.id === id);
// The box around the polygons of some stands, as a view that shows them, and a view of a stand's centre alone.
const viewOf = (...codes) => boxOfPoints(codes.flatMap(code => byId(code).geometry.polygon));
const around = code => {
  const [lng, lat] = byId(code).geometry.center;
  return [[lng - 1e-5, lat - 1e-5], [lng + 1e-5, lat + 1e-5]];
};
// Synthetic flights (invented keys): one over A1, one without a position and one without an id over BN6.
const [A1_LNG, A1_LAT] = standPoint('A1');
const [BN6_LNG, BN6_LAT] = standPoint('BN6');
const FLIGHTS = [
  { id: 'l:leg-1', heading: 90, latitude: A1_LAT, longitude: A1_LNG },
  { id: 'p:prop-2', heading: null, latitude: null, longitude: null },
  { id: null, heading: 0, latitude: BN6_LAT, longitude: BN6_LNG },
];
const NOTHING = { flights: false, states: [], chips: false, signals: [], tags: [], marks: [], airfield: [] };

describe('legend entries', () => {
  it('lists only the states of the polygons on screen, in vocabulary order', () => {
    // A1 to A3, placed by OCC: their states in the vocabulary's order, and no «No oficial».
    const placed = STANDS.filter(stand => ['A1', 'A2', 'A3'].includes(stand.id));
    expect(legendEntries({ stands: placed })).toEqual({ ...NOTHING, states: ['available', 'planned', 'occupied'] });
    // A view of A3 alone lists «Planificada» only: a polygon counts when it reaches into the view.
    expect(legendEntries({ stands: STANDS, bounds: around('A3') }).states).toEqual(['planned']);
    // The FBO's B21 and BN6 at their reference location bring the tag.
    expect(legendEntries({ stands: STANDS.filter(stand => ['B21', 'BN6'].includes(stand.id)) }))
      .toEqual({ ...NOTHING, states: ['disabled', 'unverified'], tags: ['unofficial'] });
    // Every drawn stand without bounds; the drawn state is the display status, else the board status.
    expect(legendEntries({ stands: STANDS }).states)
      .toEqual(STAND_STATE_KEYS.filter(state => ['available', 'planned', 'occupied', 'disabled', 'unverified'].includes(state)));
    const arriving = { ...byId('A2'), displayStatus: 'arriving' };
    expect(legendEntries({ stands: [arriving] }).states).toEqual(['arriving']);
    expect(legendEntries({ stands: [{ ...byId('A2'), displayStatus: undefined, status: 'releasing' }] }).states).toEqual(['releasing']);
    // A state outside the vocabulary is drawn free, and so listed.
    expect(legendEntries({ stands: [{ ...byId('A2'), displayStatus: undefined, status: 'mystery' }] }).states).toEqual(['available']);
    // A retired stand, a stand without a polygon or a location, and an empty view list nothing.
    expect(legendEntries({ stands: [{ ...byId('A1'), retired: true }] })).toEqual(NOTHING);
    expect(legendEntries({ stands: [{ id: 'X1', geometry: null, latitude: null, longitude: null, status: 'arriving' }] })).toEqual(NOTHING);
    expect(legendEntries({ stands: STANDS, bounds: [[-70.6, 19.4], [-70.5, 19.5]] })).toEqual(NOTHING);
    expect(legendEntries()).toEqual(NOTHING);
    // A legend given stands without polygons (outside a map) reads their location.
    const points = [{ id: 'A5', latitude: A1_LAT, longitude: A1_LNG, status: 'occupied', locationSource: 'occ' }];
    expect(legendEntries({ stands: points, bounds: viewOf('A1') }).states).toEqual(['occupied']);
    expect(legendEntries({ stands: points, bounds: viewOf('BN6') }).states).toEqual([]);
  });

  it('lists the signals the map draws on the stands on screen, attention before urgent', () => {
    expect(STAND_SIGNAL_KEYS).toEqual(['attention', 'urgent']);
    const signalled = [
      { ...byId('A3'), signals: [{ kind: 'urgent', reason: 'conflict' }] },
      { ...byId('A1'), signals: [{ kind: 'attention', reason: 'uncovered' }, { kind: 'attention', reason: 'overdue' }] },
      { ...byId('A2'), signals: [] },
    ];
    expect(legendEntries({ stands: signalled }).signals).toEqual(['attention', 'urgent']);
    expect(legendEntries({ stands: signalled, bounds: around('A3') }).signals).toEqual(['urgent']);
    expect(legendEntries({ stands: STANDS }).signals).toEqual([]);
    expect(legendEntries({ stands: [{ ...byId('A1'), signals: [{ kind: 'notice' }] }] }).signals).toEqual([]);
  });

  it('lists one signal per stand, the strongest, as the map draws only that one', () => {
    // A1 has an aircraft on it while another flight arrives, and nobody covers it: urgent and attention, in either
    // order. The map draws only the red octagon on it, so «Atención» is not on screen; A2 carries no signal.
    const urgent = { kind: 'urgent', reason: 'conflict' };
    const attention = { kind: 'attention', reason: 'uncovered' };
    for (const signals of [[urgent, attention], [attention, urgent]]) {
      const stands = [{ ...byId('A1'), signals }, { ...byId('A2'), signals: [] }];
      expect(legendEntries({ stands }), JSON.stringify(signals)).toEqual({
        ...NOTHING, states: ['available', 'occupied'], signals: ['urgent'],
      });
    }
    // Another stand on screen with attention alone brings the triangle back.
    const both = [{ ...byId('A1'), signals: [urgent, attention] }, { ...byId('A3'), signals: [{ kind: 'attention', reason: 'overdue' }] }];
    expect(legendEntries({ stands: both }).signals).toEqual(['attention', 'urgent']);
    expect(legendEntries({ stands: both, bounds: around('A1') }).signals).toEqual(['urgent']);
    // The signals are read as the map reads them: those the screen derived, else those of the stand's display.
    const fromDisplay = { ...byId('A1'), signals: undefined, display: { ...byId('A1').display, signals: [attention] } };
    expect(legendEntries({ stands: [fromDisplay] }).signals).toEqual(['attention']);
    expect(legendEntries({ stands: [{ ...fromDisplay, signals: [] }] }).signals).toEqual([]);
  });

  it('lists the terminal chip and the stand marks only when the map draws them on screen', () => {
    expect(legendEntries({ chips: ['A', 'B'] })).toEqual({ ...NOTHING, chips: true });
    expect(legendEntries({ chips: [] }).chips).toBe(false);
    expect(legendEntries({ chips: 'A' }).chips).toBe(false);
    expect(STAND_MARKS).toEqual(['chipArriving', 'combined', 'narrowbody', 'sameAgent', 'ghost', 'pending']);
    // The arrow over a chip whose terminal has a flight arriving comes first: with the chips no state or signal is
    // listed, so it follows the chip's entry, before the boxes of a stand being placed.
    expect(legendEntries({ chips: ['A', 'B'], marks: ['chipArriving'] })).toEqual({ ...NOTHING, chips: true, marks: ['chipArriving'] });
    expect(legendEntries({ chips: ['A'], marks: ['pending', 'ghost', 'chipArriving'] }).marks).toEqual(['chipArriving', 'ghost', 'pending']);
    expect(legendEntries({ marks: ['narrowbody', 'combined', 'narrowbody'] }).marks).toEqual(['combined', 'narrowbody']);
    // The same-agent ring of a selection and the boxes of a stand being placed, in the order of the legend.
    expect(legendEntries({ marks: ['pending', 'sameAgent', 'ghost'] }).marks).toEqual(['sameAgent', 'ghost', 'pending']);
    expect(legendEntries({ marks: ['clusters', 'hatch'] }).marks).toEqual([]);
    expect(legendEntries({ marks: null }).marks).toEqual([]);
  });

  it('says when flights are drawn inside the view: those with an id and a position', () => {
    expect(legendEntries({ flights: FLIGHTS, bounds: viewOf('A1') })).toEqual({ ...NOTHING, flights: true });
    expect(legendEntries({ stands: STANDS, flights: FLIGHTS, bounds: viewOf('A1') }).flights).toBe(true);
    // Over BN6 there is only the flight without an id, which the map never draws.
    expect(legendEntries({ flights: FLIGHTS, bounds: viewOf('BN6') }).flights).toBe(false);
    expect(legendEntries({ flights: FLIGHTS }).flights).toBe(true);
    expect(legendEntries({ flights: FLIGHTS.slice(1, 2) })).toEqual(NOTHING);
    expect(legendEntries({ flights: null }).flights).toBe(false);
  });

  it('lists the airfield items only when they are drawn on screen', () => {
    expect(legendEntries({ stands: STANDS, bounds: viewOf('A1') }).airfield).toEqual([]);
    expect(legendEntries({ airfield: ['terminal', 'apron', 'runway', 'apron'] }))
      .toEqual({ ...NOTHING, airfield: ['runway', 'apron', 'terminal'] });
    expect(legendEntries({ airfield: ['holdBar', 'taxiway', 'runway', 'terminal', 'apron'] }).airfield)
      .toEqual(['runway', 'taxiway', 'holdBar', 'apron', 'terminal']);
    expect(legendEntries({ airfield: ['designator', 'stand', 'toString'] }).airfield).toEqual([]);
    expect(legendEntries({ airfield: 'runway' }).airfield).toEqual([]);
    expect(legendEntries({ airfield: null }).airfield).toEqual([]);
  });
});
