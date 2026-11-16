import { describe, expect, it } from 'vitest';
import { MDPC_LAYOUT } from '../../maps/airport/airportLayout';
import { attachStandGeometry } from '../../maps/stands/standModel';
import {
  REVEAL_MARGIN_PX, aimKeyOf, aimVerdict, freeAreaOf, inFreeArea, revealOf, selectionKeyOf, standGeometryOf,
} from './consoleCamera';

// The console's camera around its panels: the aims that wait for the URL and the panels, the area the panels leave in
// sight, and what of a selection has to stay in it. Pixels as the map's `project` answers them, from its top-left
// corner.

const SIZE = Object.freeze({ width: 1440, height: 900 });
// «Alertas» folded and the «Inspector» open beside it: 404 px from the right; the pills take 60 px at the top and the
// bottom.
const INSETS = Object.freeze({ top: 60, right: 404, bottom: 60, left: 0 });
const OUTLINE = Object.freeze([[-68.36, 18.56], [-68.359, 18.56], [-68.359, 18.561], [-68.36, 18.561]]);
const GEOMETRY = Object.freeze({ center: [-68.3595, 18.5605], polygon: OUTLINE });
const geometryOf = codes => code => (codes.includes(code) ? GEOMETRY : null);
// A drawn aircraft as useMapSituation's target has it: an ELEVANT flight's, and one of other traffic.
const AVIAM = Object.freeze({ id: 'f:p:1', kind: 'aviam', flightKey: 'p:1', hex: 'f1c161', lon: -68.5, lat: 18.53,
  hiddenInStand: false });
const OTHER = Object.freeze({ id: 'h:f1c804', kind: 'other', flightKey: null, hex: 'f1c804', lon: -67.9, lat: 19.0,
  hiddenInStand: false });

describe('aims', () => {
  it('key a selection as the URL then selects it', () => {
    expect(aimKeyOf('stand', 'a-01')).toBe('stand:A1');
    expect(aimKeyOf('stand', ' B21 ')).toBe('stand:B21');
    expect(aimKeyOf('aircraft', 'F1C804')).toBe('aircraft:f1c804');
    expect(aimKeyOf('flight', ' p:6a900000-0000-4000-8000-000000001611 '))
      .toBe('flight:p:6a900000-0000-4000-8000-000000001611');
    // What the URL does not select has no key.
    expect(aimKeyOf('terminal', 'A')).toBe('');
    expect(aimKeyOf('stand', '   ')).toBe('');
    expect(selectionKeyOf({ kind: 'flight', id: ' p:1 ' })).toBe('flight:p:1');
    expect(selectionKeyOf(null)).toBe('');
    expect(selectionKeyOf({ kind: 'stand', id: null })).toBe('');
  });

  it('go once the URL selects what they name, wait while it does not, and drop when it moved on', () => {
    const aim = { key: 'stand:B24', from: '' };
    expect(aimVerdict(null, null)).toBe('none');
    expect(aimVerdict(aim, null)).toBe('wait');
    expect(aimVerdict(aim, { kind: 'stand', id: 'B24' })).toBe('go');
    expect(aimVerdict(aim, { kind: 'stand', id: 'A5' })).toBe('drop');
    // Chosen already when the aim was made: nothing will change in the URL, and the aim goes at once.
    expect(aimVerdict({ key: 'flight:p:1', from: 'flight:p:1' }, { kind: 'flight', id: 'p:1' })).toBe('go');
    // Moved on from another selection to nothing: the aim is gone.
    expect(aimVerdict({ key: 'flight:p:1', from: 'stand:A5' }, null)).toBe('drop');
  });
});

describe('freeAreaOf', () => {
  it('is the map less its insets, in the pixels of the map', () => {
    expect(freeAreaOf(SIZE, INSETS)).toEqual({ left: 0, top: 60, right: 1036, bottom: 840 });
    expect(freeAreaOf(SIZE, {})).toEqual({ left: 0, top: 0, right: 1440, bottom: 900 });
    // An inset that is not a positive number takes nothing.
    expect(freeAreaOf(SIZE, { top: -4, right: Number.NaN, bottom: '12', left: 10 }))
      .toEqual({ left: 10, top: 0, right: 1440, bottom: 900 });
  });

  it('is null without a size or when the insets leave nothing', () => {
    expect(freeAreaOf({ width: 0, height: 900 }, INSETS)).toBeNull();
    expect(freeAreaOf(null, INSETS)).toBeNull();
    expect(freeAreaOf(SIZE, { left: 720, right: 720 })).toBeNull();
  });
});

describe('inFreeArea', () => {
  const area = freeAreaOf(SIZE, INSETS);

  it('asks every point to be the margin inside the area', () => {
    expect(REVEAL_MARGIN_PX).toBe(20);
    expect(inFreeArea([{ x: 500, y: 450 }, { x: 1016, y: 80 }], area)).toBe(true);
    // Under the inspector, or closer to its edge than the selection ring of an aircraft.
    expect(inFreeArea([{ x: 1300, y: 450 }], area)).toBe(false);
    expect(inFreeArea([{ x: 1020, y: 450 }], area)).toBe(false);
    expect(inFreeArea([{ x: 500, y: 450 }, { x: 1020, y: 450 }], area)).toBe(false);
    // Under the pills at the top and the bottom, and past the left edge.
    expect(inFreeArea([{ x: 500, y: 70 }], area)).toBe(false);
    expect(inFreeArea([{ x: 500, y: 830 }], area)).toBe(false);
    expect(inFreeArea([{ x: -5, y: 450 }], area)).toBe(false);
    // Without a margin, the area itself.
    expect(inFreeArea([{ x: 1036, y: 60 }], area, 0)).toBe(true);
  });

  it('keeps the middle of an area narrower than its margins', () => {
    const narrow = { left: 100, top: 100, right: 130, bottom: 400 };
    expect(inFreeArea([{ x: 115, y: 250 }], narrow)).toBe(true);
    expect(inFreeArea([{ x: 116, y: 250 }], narrow)).toBe(false);
  });

  it('answers false without an area, without points or with a point the map could not place', () => {
    expect(inFreeArea([{ x: 500, y: 450 }], null)).toBe(false);
    expect(inFreeArea([], area)).toBe(false);
    expect(inFreeArea([{ x: Number.NaN, y: 450 }], area)).toBe(false);
    expect(inFreeArea([null], area)).toBe(false);
  });
});

describe('standGeometryOf', () => {
  const stands = [{ id: 'A5', code: 'A5' }, { id: 'B24', code: 'B24' }];

  it('is where the map draws the stand, by its normalized code', () => {
    const expected = attachStandGeometry([stands[1]], MDPC_LAYOUT)[0].geometry;
    expect(expected.polygon.length).toBeGreaterThanOrEqual(3);
    expect(standGeometryOf(stands, 'B24')).toEqual(expected);
    expect(standGeometryOf(stands, 'b-24')).toEqual(expected);
  });

  it('is null for a stand the screen does not have or without a code', () => {
    expect(standGeometryOf(stands, 'B37')).toBeNull();
    expect(standGeometryOf(stands, '')).toBeNull();
    expect(standGeometryOf(null, 'A5')).toBeNull();
  });
});

describe('revealOf', () => {
  it('keeps a stand’s outline in sight, brought back by its code', () => {
    expect(revealOf({ selection: { kind: 'stand', id: 'B24' }, standGeometry: geometryOf(['B24']) }))
      .toEqual({ points: OUTLINE, move: { kind: 'stand', code: 'B24' } });
    // A stand drawn only by its centre.
    expect(revealOf({ selection: { kind: 'stand', id: 'B24' }, standGeometry: () => ({ center: [-68.36, 18.56] }) }))
      .toEqual({ points: [[-68.36, 18.56]], move: { kind: 'stand', code: 'B24' } });
    expect(revealOf({ selection: { kind: 'stand', id: 'B37' }, standGeometry: geometryOf(['B24']) })).toBeNull();
  });

  it('keeps a flight’s aircraft in sight, and its stand while the map draws no aircraft for it', () => {
    const selection = { kind: 'flight', id: 'p:1' };
    expect(revealOf({ selection, aircraft: AVIAM, standCode: 'A5', standGeometry: geometryOf(['A5']) }))
      .toEqual({ points: [[-68.5, 18.53]], move: { kind: 'flight', id: 'p:1' } });
    expect(revealOf({ selection, aircraft: null, standCode: 'A5', standGeometry: geometryOf(['A5']) }))
      .toEqual({ points: OUTLINE, move: { kind: 'stand', code: 'A5' } });
    // Hidden in a stand, an aircraft is not drawn.
    expect(revealOf({ selection, aircraft: { ...AVIAM, hiddenInStand: true }, standCode: 'A5',
      standGeometry: geometryOf(['A5']) })).toEqual({ points: OUTLINE, move: { kind: 'stand', code: 'A5' } });
    expect(revealOf({ selection, aircraft: null, standCode: null })).toBeNull();
  });

  it('keeps an aircraft in sight: by the flight it flies, else by its position', () => {
    expect(revealOf({ selection: { kind: 'aircraft', id: 'f1c161' }, aircraft: AVIAM, flightKey: 'p:1' }))
      .toEqual({ points: [[-68.5, 18.53]], move: { kind: 'flight', id: 'p:1' } });
    expect(revealOf({ selection: { kind: 'aircraft', id: 'f1c804' }, aircraft: OTHER }))
      .toEqual({ points: [[-67.9, 19.0]], move: { kind: 'point', center: [-67.9, 19.0] } });
    expect(revealOf({ selection: { kind: 'aircraft', id: 'f1c804' }, aircraft: null })).toBeNull();
  });

  it('has nothing to keep without a selection', () => {
    expect(revealOf({ selection: null })).toBeNull();
    expect(revealOf()).toBeNull();
    expect(revealOf({ selection: { kind: 'stand', id: null }, standGeometry: geometryOf(['B24']) })).toBeNull();
  });
});
