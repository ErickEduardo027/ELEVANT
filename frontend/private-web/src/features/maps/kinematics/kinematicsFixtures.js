import { haversineM, initialBearing, roundCoord, toLocal } from '../airport/geo.js';
import { standBox } from '../airport/standGeometry.js';

// Synthetic data for the kinematics tests (PR M6): an invented aerodrome with the shape of mdpc.layout.json, laid out
// in metres east and north of an origin far from any real airport (as testing/mapFixtures.js does for the layout
// review). One runway 09/27 of 3 000 m along y = 0 with three exits (x1 300 m, x2 1 600 m and x3 2 700 m past the
// 09 threshold), the holding point of taxiway A 90 m south of x1, a parallel taxiway P along y = -300, an apron
// taxilane along y = -500 with two apron holds (terminal T1 and T2) and four stands nose south (S4 with a short
// 25 m lead-in), the bent connector C from x3 to the lane's east end, and one tempting edge of an inactive runway
// 05/23 that cuts from taxiway A straight to the lane's west end.

export const KINEMATICS_ORIGIN = Object.freeze([-59, 11]);
const plane = toLocal(KINEMATICS_ORIGIN);

/** A point of the invented aerodrome, `x` metres east and `y` metres north of its origin, as `[lng, lat]`. */
export const kinematicsPoint = (x, y) => roundCoord(plane.inverse([x, y]));

const round1 = value => Math.round(value * 10) / 10;
const lineLength = line => line.slice(1).reduce((sum, point, at) => sum + haversineM(line[at], point), 0);

const NODES = Object.freeze([
  ['rw-09', 'runway', -1500, 0], ['x1', 'exit', -1200, 0], ['x2', 'exit', 100, 0], ['x3', 'exit', 1200, 0],
  ['rw-27', 'runway', 1500, 0],
  ['hp-A-09-27', 'hold', -1200, -90],
  ['j1', 'junction', -1200, -300], ['j2', 'junction', 100, -300], ['j3', 'junction', 1200, -300],
  ['l0', 'junction', -700, -500], ['ls-S1', 'junction', -400, -500], ['ah-t1', 'apronHold', -250, -500],
  ['ls-S2', 'junction', -100, -500], ['l1', 'junction', 100, -500], ['ls-S3', 'junction', 250, -500],
  ['ah-t2', 'apronHold', 350, -500], ['ls-S4', 'junction', 450, -500], ['l2', 'junction', 700, -500],
]);

const STANDS = Object.freeze([
  { code: 'S1', terminal: 'T1', x: -400, y: -580 },
  { code: 'S2', terminal: 'T1', x: -100, y: -580 },
  { code: 'S3', terminal: 'T2', x: 250, y: -580 },
  { code: 'S4', terminal: 'T2', x: 450, y: -525 },
]);

/** The invented aerodrome in the shape of mdpc.layout.json: a new, unfrozen object on every call. */
export function createKinematicsLayout() {
  const nodes = NODES.map(([id, kind, x, y]) => ({ id, p: kinematicsPoint(x, y), kind }));
  const at = id => nodes.find(node => node.id === id).p;
  const edge = (a, b, kind, ref = null, via = null) => {
    const line = via === null ? [at(a), at(b)] : [at(a), ...via.map(([x, y]) => kinematicsPoint(x, y)), at(b)];
    const result = { a, b, m: round1(lineLength(line)), kind, ref };
    if (line.length > 2) result.line = line;
    return result;
  };

  const stands = STANDS.map(({ code, terminal, x, y }) => {
    const center = kinematicsPoint(x, y);
    const leadInStart = kinematicsPoint(x, -500);
    nodes.push({ id: `st-${code}`, p: center, kind: 'stand' });
    return {
      code,
      terminal,
      kind: 'contact',
      bridge: false,
      aliases: [],
      center,
      headingTrue: 180,
      sizeLetter: 'C',
      widthM: 41,
      polygon: standBox(center, 180, 'C'),
      leadIn: [leadInStart, center],
      node: `st-${code}`,
      retired: false,
      overlaps: [],
    };
  });

  const edges = [
    edge('rw-09', 'x1', 'runway', '09/27'), edge('x1', 'x2', 'runway', '09/27'), edge('x2', 'x3', 'runway', '09/27'),
    edge('x3', 'rw-27', 'runway', '09/27'),
    edge('x1', 'hp-A-09-27', 'taxiway', 'A'), edge('hp-A-09-27', 'j1', 'taxiway', 'A'),
    edge('x2', 'j2', 'taxiway', 'B'), edge('x3', 'j3', 'taxiway', 'C'),
    edge('j3', 'l2', 'taxiway', 'C', [[1200, -500]]),
    edge('j1', 'j2', 'taxiway', 'P'), edge('j2', 'j3', 'taxiway', 'P'),
    edge('j2', 'l1', 'taxiway', 'D'),
    edge('l0', 'ls-S1', 'taxilane'), edge('ls-S1', 'ah-t1', 'taxilane'), edge('ah-t1', 'ls-S2', 'taxilane'),
    edge('ls-S2', 'l1', 'taxilane'), edge('l1', 'ls-S3', 'taxilane'), edge('ls-S3', 'ah-t2', 'taxilane'),
    edge('ah-t2', 'ls-S4', 'taxilane'), edge('ls-S4', 'l2', 'taxilane'),
    ...stands.map(stand => edge(`ls-${stand.code}`, stand.node, 'leadin', stand.code)),
    // The tempting shortcut: 539 m of a runway nobody uses, against 2 300 m of taxiway and apron lane.
    edge('j1', 'l0', 'runway', '05/23'),
  ];

  const threshold09 = kinematicsPoint(-1500, 0);
  const threshold27 = kinematicsPoint(1500, 0);
  const centerline = [threshold09, at('x1'), at('x2'), at('x3'), threshold27];
  return {
    schema: 1,
    meta: {
      icao: 'ZZZK',
      iata: 'ZZK',
      name: 'Aeródromo sintético de pruebas',
      arp: [...KINEMATICS_ORIGIN],
      elevationFt: 20,
      bbox: [...kinematicsPoint(-1600, -700), ...kinematicsPoint(1600, 100)],
    },
    runways: [{
      id: '09/27',
      lengthM: round1(lineLength(centerline)),
      widthM: 45,
      surface: 'ASP',
      centerline,
      ends: [
        { ident: '09', threshold: threshold09, headingTrue: round1(initialBearing(threshold09, threshold27)), elevationFt: 20 },
        { ident: '27', threshold: threshold27, headingTrue: round1(initialBearing(threshold27, threshold09)), elevationFt: 18 },
      ],
    }],
    taxiGraph: { nodes, edges },
    holdingPoints: [
      { id: 'hp-A-09-27', runway: '09/27', taxiwayRef: 'A', p: at('hp-A-09-27'), node: 'hp-A-09-27', source: 'derived' },
    ],
    apronHolds: [
      { id: 'ah-t1', p: at('ah-t1'), node: 'ah-t1', terminals: ['T1'] },
      { id: 'ah-t2', p: at('ah-t2'), node: 'ah-t2', terminals: ['T2'] },
    ],
    stands,
    operations: { preferred: { arrival: '09', departure: '09' }, source: 'test' },
  };
}
