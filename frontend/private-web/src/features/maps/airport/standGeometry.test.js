import { describe, expect, it } from 'vitest';
import { destinationPoint, haversineM, initialBearing, polygonCentroid } from './geo.js';
import { STAND_BOX, SIZE_LETTERS, headingFromAxis, leadIn, standBox } from './standGeometry.js';

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
});
