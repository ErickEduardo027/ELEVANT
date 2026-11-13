import { describe, expect, it } from 'vitest';
import { createQaLayout, qaPoint } from '../testing/mapFixtures';
import { MDPC_LAYOUT } from './airportLayout';
import { destinationPoint, haversineM, initialBearing, polygonCentroid } from './geo.js';
import { indexLayout } from './layoutIndex';
import {
  MAX_TRANSLATION_M, NEIGHBOUR_HEADING_RADIUS_M, SIZE_FROM_AIRCRAFT, STAND_BOX, SIZE_LETTERS, headingFromAxis, leadIn,
  lineUpDistanceM, locationPoint, resolveStandGeometry, standBox, translateRigid,
} from './standGeometry.js';
import { nearestEdge } from './taxiGraph.js';

const CENTER = [-68.3625, 18.5642];

describe('standGeometry', () => {
  it('a C box is 41 m wide and 50 m deep, centred on its point, with the nose along the heading', () => {
    const ring = standBox(CENTER, 175, 'C');
    expect(ring).toHaveLength(5);
    expect(ring[4]).toEqual(ring[0]);
    const [noseLeft, noseRight, tailRight, tailLeft] = ring;
    expect(haversineM(noseLeft, noseRight)).toBeCloseTo(41, 1);
    expect(haversineM(noseRight, tailRight)).toBeCloseTo(50, 1);
    expect(haversineM(tailRight, tailLeft)).toBeCloseTo(41, 1);
    expect(haversineM(polygonCentroid(ring), CENTER)).toBeLessThan(0.05);
    // The middle of the nose side lies 25 m from the centre along the heading.
    const noseMiddle = [(noseLeft[0] + noseRight[0]) / 2, (noseLeft[1] + noseRight[1]) / 2];
    expect(haversineM(CENTER, noseMiddle)).toBeCloseTo(25, 1);
    expect(initialBearing(CENTER, noseMiddle)).toBeCloseTo(175, 1);
    // Nose-right is clockwise of the heading.
    expect(initialBearing(CENTER, noseRight)).toBeGreaterThan(175);
    expect(SIZE_LETTERS).toEqual(['C', 'D', 'E', 'F']);
    expect(STAND_BOX.E).toEqual({ widthM: 73, depthM: 80 });
    expect(Object.isFrozen(STAND_BOX.C)).toBe(true);
    expect(() => standBox(CENTER, 0, 'X')).toThrow(/size letter/u);
  });

  it('maxWidthM narrows the box and headingFromAxis picks the side towards or away from the target', () => {
    const narrow = standBox(CENTER, 84, 'E', { maxWidthM: 55 });
    expect(haversineM(narrow[0], narrow[1])).toBeCloseTo(55, 1);
    expect(haversineM(narrow[1], narrow[2])).toBeCloseTo(80, 1);
    // A wider limit never widens the box.
    const wide = standBox(CENTER, 84, 'C', { maxWidthM: 90 });
    expect(haversineM(wide[0], wide[1])).toBeCloseTo(41, 1);

    const terminalSouth = destinationPoint(CENTER, 180, 120);
    expect(headingFromAxis(175, CENTER, terminalSouth, { towards: true })).toBeCloseTo(175, 6);
    expect(headingFromAxis(355, CENTER, terminalSouth, { towards: true })).toBeCloseTo(175, 6);
    const taxilaneNorth = destinationPoint(CENTER, 0, 80);
    expect(headingFromAxis(175, CENTER, taxilaneNorth, { towards: false })).toBeCloseTo(175, 6);
    expect(headingFromAxis(-5, CENTER, taxilaneNorth, { towards: true })).toBeCloseTo(355, 6);
  });

  it('draws the lead-in from the snap point to the centre, lining up on the axis when needed', () => {
    const behind = destinationPoint(CENTER, 355, 60);
    const straight = leadIn(CENTER, 175, behind);
    expect(straight).toEqual([behind, CENTER]);
    const offset = destinationPoint(behind, 90, 30);
    const bent = leadIn(CENTER, 175, offset);
    expect(bent).toHaveLength(3);
    expect(bent[0]).toEqual(offset);
    expect(bent[2]).toEqual(CENTER);
    expect(initialBearing(bent[1], CENTER)).toBeCloseTo(175, 0);
  });

  it('lines the aircraft up at least minAlignM behind the centre, clear of its row', () => {
    expect(lineUpDistanceM('D')).toBe(63);
    expect(lineUpDistanceM('C')).toBe(45.5);
    expect(() => lineUpDistanceM('X')).toThrow(/size letter/u);
    // A taxi edge beside the stand, 70 m off its wing: without a minimum the line runs sideways into the box.
    const beside = destinationPoint(CENTER, 85, 70);
    expect(leadIn(CENTER, 175, beside)).toEqual([beside, CENTER]);
    const lined = leadIn(CENTER, 175, beside, { minAlignM: 63 });
    expect(lined).toHaveLength(3);
    expect(lined[0]).toEqual(beside);
    expect(lined[2]).toEqual(CENTER);
    expect(haversineM(lined[1], CENTER)).toBeCloseTo(63, 1);
    expect(initialBearing(CENTER, lined[1])).toBeCloseTo(355, 0);
    // A snap point farther back than the minimum keeps the align point abreast of it.
    const farBehind = destinationPoint(destinationPoint(CENTER, 355, 120), 85, 40);
    expect(haversineM(leadIn(CENTER, 175, farBehind, { minAlignM: 63 })[1], CENTER)).toBeCloseTo(120, 0);
  });
});

// Where a stand is drawn (PR M4, design C5), on the invented airport of the fixtures: the apron lane runs along y = 100
// from x = -330 to 60, taxiway A goes north from (0, 100), runway 09/27 runs along y = 300 and taxiway X goes south
// from its end at (1000, 300). The stands A10 and A2 face south at y = 40, AN1 faces north at (-330, 160).
describe('resolveStandGeometry', () => {
  const layout = createQaLayout();
  const index = indexLayout(layout);
  const standOf = code => layout.stands.find(stand => stand.code === code);
  const sides = ring => ring.slice(0, -1).map((point, at) => haversineM(point, ring[at + 1]));
  const onGraph = point => nearestEdge(index.graph, point, { kinds: ['taxiway', 'taxilane'] }).distanceM;

  it('without a saved location the dataset geometry is used as it is (reference, surveyed)', () => {
    for (const stand of MDPC_LAYOUT.stands.filter(candidate => !candidate.retired)) {
      const geometry = resolveStandGeometry({ layoutStand: stand, layout: MDPC_LAYOUT });
      expect(geometry, stand.code).toEqual({
        center: stand.center, headingTrue: stand.headingTrue, sizeLetter: stand.sizeLetter, polygon: stand.polygon,
        leadIn: stand.leadIn, locationSource: 'reference', geometrySource: 'surveyed',
      });
      // The very geometry of the layout: the centre is the point of the owner's document (decision 20).
      expect(geometry.polygon, stand.code).toBe(stand.polygon);
    }
    // Nothing reads OpenStreetMap or the layout's QA tables (owner decision of 2026-11-13: his document wins over
    // OpenStreetMap, which is out of date at the airport), with or without a saved location.
    const stand = standOf('A2');
    const trap = what => ({ get() { throw new Error(`read ${what}`); } });
    const guarded = Object.defineProperties({ ...stand }, { qa: trap('qa'), provenance: trap('provenance') });
    const guardedLayout = Object.defineProperties({ ...layout }, { qa: trap('layout qa') });
    expect(resolveStandGeometry({ layoutStand: guarded, layout: guardedLayout }).center).toEqual(stand.center);
    expect(resolveStandGeometry({ layoutStand: guarded, dbLocation: qaPoint(-160, 70), layout: guardedLayout })
      .geometrySource).toBe('translated');
    expect(resolveStandGeometry({ layoutStand: guarded, dbLocation: qaPoint(-160, -60), layout: guardedLayout })
      .geometrySource).toBe('derived');
  });

  it('a saved location within 80 m translates the polygon and lead-in rigidly: same edge lengths, heading and size letter', () => {
    const stand = standOf('A2');
    const saved = destinationPoint(stand.center, 37, 60);
    const geometry = resolveStandGeometry({
      layoutStand: stand, dbLocation: { latitude: saved[1], longitude: saved[0] }, layout, index,
    });
    expect(geometry).toMatchObject({
      center: saved, headingTrue: stand.headingTrue, sizeLetter: stand.sizeLetter, locationSource: 'occ',
      geometrySource: 'translated',
    });
    expect(geometry.polygon).toHaveLength(stand.polygon.length);
    sides(geometry.polygon).forEach((side, at) => expect(side).toBeCloseTo(sides(stand.polygon)[at], 2));
    // Every corner moved 60 m on bearing 37, so the box is centred on the saved point and its nose still points south.
    for (const [at, corner] of geometry.polygon.entries()) {
      expect(haversineM(stand.polygon[at], corner)).toBeCloseTo(60, 2);
      expect(initialBearing(stand.polygon[at], corner)).toBeCloseTo(37, 1);
    }
    expect(haversineM(polygonCentroid(geometry.polygon), saved)).toBeLessThan(0.05);
    expect(initialBearing(geometry.polygon[3], geometry.polygon[0])).toBeCloseTo(initialBearing(stand.polygon[3], stand.polygon[0]), 2);
    // The lead-in moves with it: same length, still ending at the centre.
    expect(geometry.leadIn).toHaveLength(stand.leadIn.length);
    expect(haversineM(geometry.leadIn.at(-1), saved)).toBeLessThan(0.01);
    expect(haversineM(geometry.leadIn[0], geometry.leadIn.at(-1)))
      .toBeCloseTo(haversineM(stand.leadIn[0], stand.leadIn.at(-1)), 2);
    // The rule's limit, with the location written as [lng, lat] as well.
    expect(MAX_TRANSLATION_M).toBe(80);
    const near = destinationPoint(stand.center, 200, 79.9);
    expect(resolveStandGeometry({ layoutStand: stand, dbLocation: near, layout, index }).geometrySource).toBe('translated');
    const far = destinationPoint(stand.center, 200, 80.5);
    expect(resolveStandGeometry({ layoutStand: stand, dbLocation: far, layout, index }).geometrySource).toBe('derived');
    expect(translateRigid([stand.center], stand.center, saved)[0].map(value => Number(value.toFixed(9))))
      .toEqual(saved.map(value => Number(value.toFixed(9))));
    expect(locationPoint({ lon: 1, lat: 2 })).toEqual([1, 2]);
    expect(locationPoint({ latitude: 2 })).toBeNull();
  });

  it('a saved location more than 80 m away gets a derived box', () => {
    const stand = standOf('A2');
    // 100 m south of its layout box, facing south as the nearest stand within 150 m (its own box, then A10) does.
    const saved = qaPoint(-160, -60);
    const geometry = resolveStandGeometry({ layoutStand: stand, dbLocation: saved, sizeHint: 'Widebody', layout, index });
    expect(geometry).toMatchObject({
      center: saved, headingTrue: 180, sizeLetter: 'E', locationSource: 'occ', geometrySource: 'derived',
    });
    // A new box of its own size, not the layout's box moved there.
    expect(geometry.polygon).toEqual(standBox(saved, 180, 'E'));
    expect(sides(geometry.polygon)[0]).toBeCloseTo(STAND_BOX.E.widthM, 1);
    // Its lead-in lines up behind the box (no taxi edge within 150 m straight behind it) and starts on the graph.
    expect(onGraph(geometry.leadIn[0])).toBeLessThan(0.5);
    expect(geometry.leadIn.at(-1)).toEqual(saved);
    expect(Math.abs(((initialBearing(saved, geometry.leadIn[0]) - 180 + 540) % 360) - 180)).toBeGreaterThan(90);
    // Where the only taxi edge near the box lies in front of its nose, the aircraft comes straight in from it.
    const facing = qaPoint(-160, 140);
    const fromFront = resolveStandGeometry({ layoutStand: stand, dbLocation: facing, layout, index });
    expect(fromFront.headingTrue).toBe(180);
    expect(fromFront.leadIn).toHaveLength(2);
    expect(onGraph(fromFront.leadIn[0])).toBeLessThan(0.5);
    expect(haversineM(fromFront.leadIn[0], facing)).toBeCloseTo(40, 0);
  });

  it('a stand unknown to the dataset takes the heading of the nearest dataset stand within 150 m and the size of its aircraft class (Widebody E, Narrowbody C, unknown D)', () => {
    // 100 m north of AN1, which faces north; the stands of the row facing south are more than 150 m away.
    const saved = qaPoint(-330, 260);
    expect(NEIGHBOUR_HEADING_RADIUS_M).toBe(150);
    expect(SIZE_FROM_AIRCRAFT).toEqual({ Widebody: 'E', Narrowbody: 'C' });
    for (const [sizeHint, letter] of [['Widebody', 'E'], ['Narrowbody', 'C'], [null, 'D'], ['Turboprop', 'D'], ['toString', 'D']]) {
      const geometry = resolveStandGeometry({ layoutStand: null, dbLocation: saved, sizeHint, layout, index });
      expect(geometry, String(sizeHint)).toMatchObject({
        center: saved, headingTrue: standOf('AN1').headingTrue, sizeLetter: letter, locationSource: 'occ',
        geometrySource: 'derived',
      });
      const [noseLeft, noseRight, tailRight] = geometry.polygon;
      expect(haversineM(noseLeft, noseRight), String(sizeHint)).toBeCloseTo(STAND_BOX[letter].widthM, 1);
      expect(haversineM(noseRight, tailRight), String(sizeHint)).toBeCloseTo(STAND_BOX[letter].depthM, 1);
      expect(onGraph(geometry.leadIn[0]), String(sizeHint)).toBeLessThan(0.5);
    }
    // A retired stand of the layout gives no heading: next to B33 alone, the box faces away from the apron lane.
    const besideRetired = resolveStandGeometry({
      dbLocation: qaPoint(130, 40),
      layout: { ...layout, stands: layout.stands.filter(stand => stand.code === 'B33') },
    });
    expect(besideRetired.headingTrue).toBeCloseTo(180, 1);
  });

  it('with no dataset stand within 150 m the heading is perpendicular to the nearest taxi edge and the lead-in starts on the graph', () => {
    // 120 m west of taxiway X and 100 m south of runway 09/27: the runway is nearer, but it is no taxi edge.
    const saved = qaPoint(880, 200);
    const geometry = resolveStandGeometry({ layoutStand: null, dbLocation: saved, sizeHint: 'Narrowbody', layout, index });
    expect(geometry.geometrySource).toBe('derived');
    // The nose points west, away from taxiway X, and the tail to it, as a remote stand parks.
    expect(geometry.headingTrue).toBeCloseTo(270, 1);
    expect(geometry.leadIn).toHaveLength(2);
    expect(onGraph(geometry.leadIn[0])).toBeLessThan(0.5);
    expect(haversineM(saved, geometry.leadIn[0])).toBeCloseTo(120, 0);
    expect(initialBearing(saved, geometry.leadIn[0])).toBeCloseTo(90, 0);
    expect(geometry.leadIn[1]).toEqual(saved);
    // The same without the index: the graph is built from the layout.
    expect(resolveStandGeometry({ dbLocation: saved, sizeHint: 'Narrowbody', layout })).toEqual(geometry);
    // Without a layout: a box facing north and no lead-in.
    expect(resolveStandGeometry({ dbLocation: saved, sizeHint: 'Narrowbody' })).toMatchObject({
      headingTrue: 0, sizeLetter: 'C', leadIn: null, geometrySource: 'derived',
    });
  });

  it('with neither a dataset stand nor a saved location there is no geometry', () => {
    expect(resolveStandGeometry({ layoutStand: null, dbLocation: null, layout, index })).toBeNull();
    expect(resolveStandGeometry({ layoutStand: { code: 'A2' }, dbLocation: { latitude: null, longitude: null }, layout }))
      .toBeNull();
    expect(resolveStandGeometry()).toBeNull();
    // A layout stand without a drawable box counts as unknown: with a saved location it gets a box of its own.
    const broken = { ...standOf('A2'), sizeLetter: 'X' };
    expect(resolveStandGeometry({ layoutStand: broken, layout, index })).toBeNull();
    expect(resolveStandGeometry({ layoutStand: broken, dbLocation: qaPoint(-160, 50), layout, index }).geometrySource)
      .toBe('derived');
  });
});
