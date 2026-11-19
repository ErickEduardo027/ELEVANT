import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareStandCodes, normalizeStandCode, sortByStandCode, standDisplayCode } from './standCodes';
import { mapStandCode } from '../features/positions-map/positionsMapMappers';

// ADR-0041: the API and the web compare stand codes with one rule. The cases are the file the C# tests read too
// (backend/tests/Elevant.UnitTests/Application/StandCodesTests.cs), relative to this package like hrDemoMode.test.js.
const vectors = JSON.parse(readFileSync('../../backend/Elevant.Application/Operations/StandCodes.vectors.json', 'utf8'));

describe('normalizeStandCode (ADR-0041)', () => {
  it('normalizes every shared vector', () => {
    expect(vectors.normalize.length).toBeGreaterThan(10);
    for (const { input, expected } of vectors.normalize) {
      expect(normalizeStandCode(input), input).toBe(expected);
      // A stand has one normalized code: normalizing it again changes nothing.
      expect(normalizeStandCode(expected), expected).toBe(expected);
    }
    // The file still holds the cases the rule was written for: «A01», «a-1» and «A1» are one stand.
    expect(vectors.normalize).toEqual(expect.arrayContaining([
      { input: 'A01', expected: 'A1' }, { input: 'a-1', expected: 'A1' }, { input: 'A1', expected: 'A1' },
      { input: '09A', expected: '9A' }]));
    expect(normalizeStandCode(null)).toBe('');
    expect(normalizeStandCode(undefined)).toBe('');
  });

  it('never infers another stand', () => {
    expect(vectors.distinct.length).toBeGreaterThan(0);
    for (const pair of vectors.distinct) {
      expect(pair).toHaveLength(2);
      expect(normalizeStandCode(pair[0])).not.toBe(normalizeStandCode(pair[1]));
    }
    // The airport's own notation stays as typed: no letter is added, moved or dropped.
    expect(['1', '9A', '23A'].map(normalizeStandCode)).toEqual(['1', '9A', '23A']);
  });

  it('mapStandCode stays as an alias', () => {
    expect(mapStandCode).toBe(normalizeStandCode);
    expect(mapStandCode('b-032')).toBe('B32');
  });
});

describe('standDisplayCode (N27)', () => {
  it('shows a stand without the zero padding of its number, as the map draws it', () => {
    // The seed's A01 and A02 are the plan's A1 and A2 (ADR-0041): every screen shows them so.
    expect(['A01', 'A02', 'B01', 'AN01', 'BN06', 'A010', 'A001', 'A00', '09A', 'A01B'].map(standDisplayCode))
      .toEqual(['A1', 'A2', 'B1', 'AN1', 'BN6', 'A10', 'A1', 'A0', '9A', 'A1B']);
    // A code without padding is shown as it is.
    expect(['A1', 'A10', 'A0', 'AN1', 'B20', 'FBO', '1', '9A', '23A'].map(standDisplayCode))
      .toEqual(['A1', 'A10', 'A0', 'AN1', 'B20', 'FBO', '1', '9A', '23A']);
  });

  it('shows any other code as it is: never as normalizeStandCode, which joins «E2E-XXXX-1» into «E2EXXXX1»', () => {
    expect(standDisplayCode('E2E-XXXX-1')).toBe('E2E-XXXX-1');
    expect(normalizeStandCode('E2E-XXXX-1')).toBe('E2EXXXX1');
    // Separators, spaces and small letters are not the stored form of a code: nothing is inferred from them.
    for (const code of ['A-01', 'a-1', 'A 1', 'A.01', ' bn-06 ', 'b032', 'A01 ', 'A1B2']) {
      expect(standDisplayCode(code), code).toBe(code);
    }
    expect(standDisplayCode(null)).toBe('');
    expect(standDisplayCode(undefined)).toBe('');
  });

  it('names the stand the shared rule names, as typed or as the rule reads it, never a third code', () => {
    for (const { input, expected } of vectors.normalize) {
      const shown = standDisplayCode(input);
      expect([input, expected], input).toContain(shown);
      expect(normalizeStandCode(shown), input).toBe(expected);
    }
    // A code as «Datos maestros» stores it (capitals, a number, no separators) is shown as the rule reads it.
    const stored = vectors.normalize.filter(({ input }) => /^[A-Z]*[0-9]+[A-Z]*$/.test(input));
    expect(stored.length).toBeGreaterThan(5);
    for (const { input, expected } of stored) expect(standDisplayCode(input), input).toBe(expected);
  });
});

describe('compareStandCodes', () => {
  it('orders stand codes naturally by their normalized code', () => {
    const codes = ['BN10', 'A10', 'A3', 'BN6', 'A02', 'AN1', 'B20', 'A11', 'A01', 'BN13', 'A4', 'B3'];
    expect([...codes].sort(compareStandCodes))
      .toEqual(['A01', 'A02', 'A3', 'A4', 'A10', 'A11', 'AN1', 'B3', 'B20', 'BN6', 'BN10', 'BN13']);
  });

  it('reads «A01» and «a-1» as the same stand', () => {
    expect(compareStandCodes('A01', 'a-1')).toBe(0);
    expect(compareStandCodes('A9', 'A10')).toBeLessThan(0);
    expect(compareStandCodes('A10', 'A9')).toBeGreaterThan(0);
  });

  it('sorts a copy of the items by their code', () => {
    const items = [{ code: 'A10' }, { code: 'A9' }, { code: 'A1' }];
    const sorted = sortByStandCode(items);
    expect(sorted.map(item => item.code)).toEqual(['A1', 'A9', 'A10']);
    expect(items.map(item => item.code)).toEqual(['A10', 'A9', 'A1']);
    expect(sortByStandCode([{ id: 'B2' }, { id: 'A2' }], item => item.id).map(item => item.id)).toEqual(['A2', 'B2']);
    expect(sortByStandCode(null)).toEqual([]);
  });
});
