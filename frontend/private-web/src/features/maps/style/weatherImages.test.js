import { describe, expect, it } from 'vitest';
import { MAP_IMAGE_IDS, MAP_IMAGE_SHAPES, isSdfImage } from './mapImages';
import {
  BARB_IMAGE_SIZE, BARB_SHAFT, BARB_SPEEDS, WEATHER_IMAGE_SHAPES, barbImageFor, barbImageId, barbParts,
} from './weatherImages';

// The corners of the marks of a barb (every path after the shaft), as [x, y] pairs.
const pointsOf = shape => shape.ops.slice(1).flatMap(op => [...(op.fill ?? op.stroke).matchAll(/-?\d+(?:\.\d+)?/g)]
  .map(match => Number(match[0])))
  .reduce((pairs, value, index, all) => (index % 2 === 0 ? [...pairs, [value, all[index + 1]]] : pairs), []);

describe('wind barb images (lane M7)', () => {
  it('one SDF image per 5 kt from 5 to 100 kt, registered with the map images', () => {
    expect(BARB_SPEEDS).toHaveLength(20);
    expect([BARB_SPEEDS[0], BARB_SPEEDS.at(-1)]).toEqual([5, 100]);
    expect(Object.keys(WEATHER_IMAGE_SHAPES)).toEqual(BARB_SPEEDS.map(barbImageId));
    expect([barbImageId(5), barbImageId(15), barbImageId(100)]).toEqual(['wind-barb-1', 'wind-barb-3', 'wind-barb-20']);
    for (const id of Object.keys(WEATHER_IMAGE_SHAPES)) {
      expect(MAP_IMAGE_IDS, id).toContain(id);
      expect(MAP_IMAGE_SHAPES[id], id).toEqual(WEATHER_IMAGE_SHAPES[id]);
      expect(isSdfImage(id), id).toBe(true);
    }
    // After the wind of PR M8 and before the traffic images, which stay last.
    expect(MAP_IMAGE_IDS.indexOf(barbImageId(5))).toBe(MAP_IMAGE_IDS.indexOf('wind-calm') + 1);
  });

  it('pennants of 50 kt, barbs of 10 kt and a half barb of 5 kt', () => {
    expect(barbParts(5)).toEqual({ pennants: 0, barbs: 0, half: true });
    expect(barbParts(15)).toEqual({ pennants: 0, barbs: 1, half: true });
    expect(barbParts(65)).toEqual({ pennants: 1, barbs: 1, half: true });
    expect(barbParts(100)).toEqual({ pennants: 2, barbs: 0, half: false });
    // The shaft and one operation per mark.
    expect(WEATHER_IMAGE_SHAPES[barbImageId(65)].ops).toHaveLength(4);
    expect(WEATHER_IMAGE_SHAPES[barbImageId(65)].ops.filter(op => op.fill !== undefined)).toHaveLength(1);
  });

  it('a square around the station, the shaft rising north from its dot, every mark 3 px clear of the border', () => {
    for (const id of Object.keys(WEATHER_IMAGE_SHAPES)) {
      const shape = WEATHER_IMAGE_SHAPES[id];
      expect([shape.width, shape.height], id).toEqual([BARB_IMAGE_SIZE, BARB_IMAGE_SIZE]);
      expect(shape.ops[0].stroke, id).toBe(`M28 ${BARB_SHAFT.bottom} V${BARB_SHAFT.top}`);
      for (const [x, y] of pointsOf(shape)) {
        expect(x >= 3 && x <= BARB_IMAGE_SIZE - 3 && y >= 3 && y <= BARB_SHAFT.bottom, `${id} ${x},${y}`).toBe(true);
        // The marks on the right of the shaft (the northern hemisphere's side for a shaft that points north).
        expect(x >= BARB_IMAGE_SIZE / 2, `${id} ${x}`).toBe(true);
      }
    }
    // A half barb alone sits a step in from the tip, so it never reads as a barb.
    const [, half] = WEATHER_IMAGE_SHAPES[barbImageId(5)].ops;
    expect(half.stroke.startsWith(`M28 ${BARB_SHAFT.top}`)).toBe(false);
  });

  it('the image of a wind: its speed to the nearest 5 kt, none for a calm or variable wind', () => {
    expect(barbImageFor({ speedKt: 13, directionDeg: 100 })).toBe(barbImageId(15));
    expect(barbImageFor({ speedKt: 3, directionDeg: 100 })).toBe(barbImageId(5));
    expect(barbImageFor({ speedKt: 140, directionDeg: 100 })).toBe(barbImageId(100));
    expect(barbImageFor({ speedKt: 2, directionDeg: 100 })).toBeNull();
    expect(barbImageFor({ speedKt: 12, directionDeg: null })).toBeNull();
    expect(barbImageFor({ speedKt: null, directionDeg: 90 })).toBeNull();
    expect(barbImageFor()).toBeNull();
  });
});
