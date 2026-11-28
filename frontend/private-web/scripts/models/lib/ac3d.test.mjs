import { describe, expect, it } from 'vitest';
import { parseAc3d } from './ac3d.mjs';

// A world with a group moved by `loc`, holding a quad (two triangles), a line surface and a hidden child.
const SAMPLE = `AC3Db
MATERIAL "fuselage" rgb 1 1 1  amb 0.8 0.8 0.8  emis 0 0 0  spec 0.5 0.5 0.5  shi 64 trans 0
MATERIAL "glass" rgb 0.1 0.1 0.1  amb 0.8 0.8 0.8  emis 0 0 0  spec 0.5 0.5 0.5  shi 64 trans 0.4
OBJECT world
kids 1
OBJECT group
name "body group"
loc 10 0 0
kids 2
OBJECT poly
name "skin"
data 9
skin.data
crease 40.0
texture "paint.png"
numvert 4
0 0 0
1 0 0
1 1 0
0 1 0
numsurf 2
SURF 0x10
mat 0
refs 4
0 0 0
1 1 0
2 1 1
3 0 1
SURF 0x02
mat 1
refs 2
0 0 0
2 1 1
kids 0
OBJECT poly
name "windshield"
hidden
numvert 3
0 0 1
1 0 1
0 1 1
numsurf 1
SURF 0x20
mat 1
refs 3
0 0 0
1 1 0
2 0 1
kids 0
`;

describe('AC3D reader (M5)', () => {
  it('reads materials, objects, polygons and their world positions, and skips lines', () => {
    const { materials, parts } = parseAc3d(SAMPLE);
    expect(materials).toEqual([
      { name: 'fuselage', rgb: [1, 1, 1], trans: 0 },
      { name: 'glass', rgb: [0.1, 0.1, 0.1], trans: 0.4 },
    ]);
    expect(parts.map(p => [p.name, p.path, p.material, p.crease, p.hidden, p.texture])).toEqual([
      ['skin', 'body group/skin', 'fuselage', 40, false, 'paint.png'],
      ['windshield', 'body group/windshield', 'glass', 30, true, null],
    ]);
    // The quad is fan-triangulated; the line surface adds nothing; the group's loc moves every vertex.
    expect(Array.from(parts[0].tri)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(Array.from(parts[0].pos)).toEqual([10, 0, 0, 11, 0, 0, 11, 1, 0, 10, 1, 0]);
    expect(Array.from(parts[1].pos.subarray(0, 3))).toEqual([10, 0, 1]);
  });

  it('refuses a text that is not AC3D', () => {
    expect(() => parseAc3d('glTF')).toThrow(/AC3D/);
  });
});
