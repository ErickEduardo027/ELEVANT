import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMetar } from '../../weather/metar';
import { MDPC_LAYOUT } from './airportLayout';
import { runwayInUse } from './runwayInUse';
import { metarWindForRunway, runwayLabel, runwayWinds, windComponents } from './runwayWind';

describe('the wind on the runways (PR M8)', () => {
  it('head and cross wind along, across and behind the runway', () => {
    expect(windComponents(80, 10, 80)).toEqual({ headwindKt: 10, crosswindKt: 0, side: null });
    expect(windComponents(170, 10, 80)).toEqual({ headwindKt: 0, crosswindKt: 10, side: 'right' });
    // Behind the runway the head wind is negative: a tail wind.
    expect(windComponents(260, 10, 80)).toEqual({ headwindKt: -10, crosswindKt: 0, side: null });
    // Whole knots and never −0, also across a north that wraps.
    expect(Object.is(windComponents(170, 10, 80).headwindKt, 0)).toBe(true);
    expect(windComponents(10, 20, 350)).toEqual({ headwindKt: 19, crosswindKt: 7, side: 'right' });
    expect(windComponents(360, 12, 0)).toEqual({ headwindKt: 12, crosswindKt: 0, side: null });
    // The METAR of the fixtures (100° 13 kt) on runway 08 of Punta Cana (73.8° true).
    expect(windComponents(100, 13, 73.8)).toEqual({ headwindKt: 12, crosswindKt: 6, side: 'right' });
    expect(Object.isFrozen(windComponents(100, 13, 73.8))).toBe(true);
    // Not finite numbers, or a negative speed, give nothing.
    for (const args of [[null, 10, 80], [100, Number.NaN, 80], ['100', 10, 80], [100, 10, undefined], [100, -1, 80]]) {
      expect(windComponents(...args), JSON.stringify(args)).toBeNull();
    }
  });

  it('side right and left; calm and VRB give no components', () => {
    expect(windComponents(110, 10, 80).side).toBe('right');
    expect(windComponents(50, 10, 80).side).toBe('left');
    expect(windComponents(350, 10, 80)).toEqual({ headwindKt: 0, crosswindKt: 10, side: 'left' });
    // A calm wind has no side; a calm, variable or missing METAR wind lists no runway.
    expect(windComponents(0, 0, 80)).toEqual({ headwindKt: 0, crosswindKt: 0, side: null });
    expect(runwayWinds(MDPC_LAYOUT, parseMetar('MDPC 131450Z 00000KT 9999 SCT020 29/22 Q1015').wind)).toEqual([]);
    expect(runwayWinds(MDPC_LAYOUT, parseMetar('MDPC 131450Z VRB03KT 9999 SCT020 29/22 Q1015').wind)).toEqual([]);
    expect(runwayWinds(MDPC_LAYOUT, parseMetar('MDPC 131450Z 9999 SCT020 29/22 Q1015').wind)).toEqual([]);
    expect(runwayWinds(MDPC_LAYOUT, null)).toEqual([]);
  });

  it('runwayLabel writes R08 from 08, 8 and RWY 08', () => {
    expect(['08', '8', 'RWY 08', 'rwy08', ' R08 '].map(runwayLabel)).toEqual(['R08', 'R08', 'R08', 'R08', 'R08']);
    expect(['26', '9', '27', '09L', '36R'].map(runwayLabel)).toEqual(['R26', 'R09', 'R27', 'R09L', 'R36R']);
    for (const ident of ['', '  ', null, undefined, 'RWY', '00', '37', 'H1', '08/26']) {
      expect(runwayLabel(ident), String(ident)).toBeNull();
    }
  });

  it('runwayWinds lists the four ends of MDPC', () => {
    const winds = runwayWinds(MDPC_LAYOUT, parseMetar('MDPC 131450Z 10013KT 9999 SCT020 29/22 Q1015').wind);
    expect(winds).toEqual([
      { ident: '08', label: 'R08', headwindKt: 12, crosswindKt: 6, side: 'right' },
      { ident: '26', label: 'R26', headwindKt: -12, crosswindKt: 6, side: 'left' },
      { ident: '09', label: 'R09', headwindKt: 13, crosswindKt: 3, side: 'right' },
      { ident: '27', label: 'R27', headwindKt: -13, crosswindKt: 3, side: 'left' },
    ]);
    expect(Object.isFrozen(winds) && winds.every(Object.isFrozen)).toBe(true);
    // A layout without runways has nothing to list.
    expect(runwayWinds({ runways: [] }, { directionDeg: 100, speedKt: 13, variable: false })).toEqual([]);
  });

  it('metarWindForRunway converts knots to m/s and gives null for calm or VRB', () => {
    const wind = metarWindForRunway(parseMetar('MDPC 131450Z 10013KT 9999 SCT020 29/22 Q1015').wind);
    expect(wind.directionDeg).toBe(100);
    expect(wind.speedMs).toBeCloseTo((13 * 1852) / 3600, 9);
    expect(Object.isFrozen(wind)).toBe(true);
    for (const raw of ['MDPC 131450Z 00000KT 9999', 'MDPC 131450Z VRB03KT 9999', 'MDPC 131450Z 9999']) {
      expect(metarWindForRunway(parseMetar(raw).wind), raw).toBeNull();
    }
    expect(metarWindForRunway(null)).toBeNull();
    expect(metarWindForRunway({ directionDeg: null, variable: false, speedKt: 12 })).toBeNull();

    // runwayInUse takes it as it is (contracts 2.3): an easterly keeps the flow on 08, a westerly turns it to 26.
    expect(runwayInUse({ wind, layout: MDPC_LAYOUT })).toEqual({ arrival: '08', departure: '08', source: 'wind' });
    const westerly = metarWindForRunway(parseMetar('MDPC 131450Z 27012KT 9999').wind);
    expect(runwayInUse({ wind: westerly, layout: MDPC_LAYOUT })).toEqual({ arrival: '26', departure: '26', source: 'wind' });
    // Calm or variable says nothing: the usual runway, 08 (owner decision 19).
    expect(runwayInUse({ wind: metarWindForRunway(parseMetar('MDPC 131450Z VRB03KT').wind), layout: MDPC_LAYOUT }))
      .toEqual({ arrival: '08', departure: '08', source: 'default' });
  });

  it('is pure and Node-safe like runwayInUse.js: no clock, no JSON, explicit .js imports', () => {
    const code = readFileSync('src/features/maps/airport/runwayWind.js', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:'"`])\/\/.*$/gmu, '$1');
    expect(code).not.toMatch(/\bDate\.now\s*\(|\bperformance\.now\s*\(|\bnew\s+Date\s*\(\s*\)|\bMath\.random\s*\(/u);
    const specifiers = [...code.matchAll(/from\s*['"]([^'"]+)['"]/gu)].map(([, specifier]) => specifier);
    expect(specifiers).toEqual(['../kinematics/units.js', './runwayInUse.js']);
  });
});
