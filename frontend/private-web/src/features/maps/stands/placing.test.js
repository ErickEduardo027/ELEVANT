import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { destinationPoint, haversineM, initialBearing, polygonAreaM2 } from '../airport/geo';
import { STAND_BOX, resolveStandGeometry } from '../airport/standGeometry';
import { createQaLayout, qaPoint } from '../testing/mapFixtures';
import { PLACING_SNAP_M, ghostFeatures, placedLocation, placingGhost } from './placing';

// The invented airport of the fixtures, in metres around its origin: its stand A2 sits at (−160, 40), nose south.
const QA = createQaLayout();
const qaStand = code => QA.stands.find(stand => stand.code === code);
const sides = ring => ring.slice(0, -1).map((point, at) => haversineM(point, ring[at + 1]));

describe('placing a stand', () => {
  it('the ghost is the dataset outline at true size, moved rigidly to the pointer', () => {
    const stand = qaStand('A2');
    const pointer = qaPoint(-120, 52);
    const ghost = placingGhost({ code: 'a-02', pointer, layout: QA });
    expect(ghost).toMatchObject({
      code: 'A2', center: pointer, headingTrue: stand.headingTrue, sizeLetter: 'D', snapped: false, source: 'layout',
    });
    // The same shape: every side, the area and the heading of each side, and every corner moved by the same shift.
    const shiftM = haversineM(stand.center, pointer);
    expect(shiftM).toBeGreaterThan(PLACING_SNAP_M);
    sides(ghost.polygon).forEach((length, at) => expect(length).toBeCloseTo(sides(stand.polygon)[at], 2));
    expect(polygonAreaM2(ghost.polygon)).toBeCloseTo(polygonAreaM2(stand.polygon), 0);
    expect(initialBearing(ghost.polygon[0], ghost.polygon[1])).toBeCloseTo(initialBearing(stand.polygon[0], stand.polygon[1]), 3);
    for (const [at, corner] of ghost.polygon.entries()) {
      expect(haversineM(stand.polygon[at], corner)).toBeCloseTo(shiftM, 1);
      expect(initialBearing(stand.polygon[at], corner)).toBeCloseTo(initialBearing(stand.center, pointer), 1);
    }
    expect(ghost.polygon.at(-1)).toEqual(ghost.polygon[0]);

    // A stand of the real layout too, read from the dataset: true size wherever the pointer is.
    const a5 = MDPC_LAYOUT.stands.find(item => item.code === 'A5');
    const moved = placingGhost({ code: 'A5', pointer: destinationPoint(a5.center, 0, 40), layout: MDPC_LAYOUT });
    expect(moved).toMatchObject({ snapped: false, source: 'layout', sizeLetter: a5.sizeLetter });
    sides(moved.polygon).forEach((length, at) => expect(length).toBeCloseTo(sides(a5.polygon)[at], 1));
  });

  it('within 15 m it snaps to the dataset outline of that stand', () => {
    const stand = qaStand('A2');
    const inside = destinationPoint(stand.center, 30, PLACING_SNAP_M - 0.1);
    const snapped = placingGhost({ code: 'A2', pointer: inside, layout: QA });
    // Exactly the outline and the centre of the layout, not the pointer.
    expect(snapped).toMatchObject({ code: 'A2', snapped: true, source: 'layout', center: stand.center, polygon: stand.polygon });
    // The click there gives the layout's centre, marked as snapped.
    expect(placedLocation(snapped)).toEqual({ latitude: stand.center[1], longitude: stand.center[0], snapped: true });
    // Just past 15 m it follows the pointer again, and the click gives the pointer.
    const outside = destinationPoint(stand.center, 30, PLACING_SNAP_M + 0.1);
    const free = placingGhost({ code: 'A2', pointer: outside, layout: QA });
    expect(free).toMatchObject({ snapped: false, center: outside });
    expect(placedLocation(free)).toEqual({ latitude: outside[1], longitude: outside[0], snapped: false });
    // Only its own outline: near another stand's centre it does not snap to that stand.
    expect(placingGhost({ code: 'A2', pointer: qaStand('B31').center, layout: QA })).toMatchObject({ snapped: false });
    // The real layout: A5's centre, the point of the owner's coordinate document, from 10 m away.
    const a5 = MDPC_LAYOUT.stands.find(item => item.code === 'A5');
    expect(placingGhost({ code: 'A5', pointer: destinationPoint(a5.center, 200, 10), layout: MDPC_LAYOUT }))
      .toMatchObject({ snapped: true, center: a5.center, polygon: a5.polygon });
  });

  it('a stand unknown to the dataset shows a derived box sized by its aircraft class', () => {
    // 60 m north of A10 on the invented airport: a stand the layout does not list.
    const pointer = qaPoint(-260, 100);
    for (const [sizeHint, letter] of [['Narrowbody', 'C'], ['Widebody', 'E'], [null, 'D']]) {
      const ghost = placingGhost({ code: 'C07', pointer, layout: QA, sizeHint });
      const derived = resolveStandGeometry({ dbLocation: pointer, sizeHint, layout: QA });
      expect(ghost, letter).toEqual({
        code: 'C7', center: derived.center, polygon: derived.polygon, headingTrue: derived.headingTrue, sizeLetter: letter,
        snapped: false, source: 'derived',
      });
      // At true size: the nose side is the width of its code letter.
      expect(haversineM(ghost.polygon[0], ghost.polygon[1]), letter).toBeCloseTo(STAND_BOX[letter].widthM, 0);
    }
    // The heading of the nearest active stand within 150 m (A10, nose south), never snapped, wherever it is.
    expect(placingGhost({ code: 'C7', pointer, layout: QA }).headingTrue).toBe(qaStand('A10').headingTrue);
    // A retired stand of the layout is never matched: it gets a box of its own too, and never snaps to the old outline.
    expect(placingGhost({ code: 'B33', pointer: qaStand('B33').center, layout: QA })).toMatchObject({ source: 'derived', snapped: false });
    // Without a layout: a box facing north.
    expect(placingGhost({ code: 'C7', pointer, layout: null })).toMatchObject({ headingTrue: 0, sizeLetter: 'D', source: 'derived' });
    // Nothing to draw without a pointer or a code.
    expect(placingGhost({ code: 'A2', pointer: null, layout: QA })).toBeNull();
    expect(placingGhost({ code: '', pointer, layout: QA })).toBeNull();
    expect(placedLocation(null)).toBeNull();
  });

  it('ghostFeatures: the pending box and its centre, then the box at the pointer', () => {
    const pending = placingGhost({ code: 'A2', pointer: qaStand('A2').center, layout: QA });
    const ghost = placingGhost({ code: 'A2', pointer: qaPoint(-100, 60), layout: QA });
    const { type, features } = ghostFeatures({ ghost, pending });
    expect(type).toBe('FeatureCollection');
    expect(features.map(item => [item.id, item.properties.kind, item.geometry.type])).toEqual([
      ['pending', 'pending', 'Polygon'], ['pending-centre', 'centre', 'Point'], ['ghost', 'ghost', 'Polygon'],
    ]);
    expect(features[0].properties).toEqual({ id: 'pending', kind: 'pending', code: 'A2', snapped: true });
    expect(features[0].geometry.coordinates).toEqual([pending.polygon]);
    expect(features[1].geometry.coordinates).toEqual(pending.center);
    expect(features[2].properties).toEqual({ id: 'ghost', kind: 'ghost', code: 'A2', snapped: false });
    expect(ghostFeatures({ ghost: null, pending: null }).features).toEqual([]);
    expect(ghostFeatures().features).toEqual([]);
  });

  it('never imports the dataset (source text guard)', () => {
    expect(readFileSync('src/features/maps/stands/placing.js', 'utf8')).not.toMatch(/airportLayout|\.json['"]/);
  });
});
