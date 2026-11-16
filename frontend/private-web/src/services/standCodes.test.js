import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeStandCode } from './standCodes';
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
