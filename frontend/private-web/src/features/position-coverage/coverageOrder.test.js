import { describe, expect, it } from 'vitest';
import { orderCoverageBoard } from './coverageOrder';

describe('orderCoverageBoard', () => {
  it('puts the stands and the stands of each coverage in natural order', () => {
    const board = {
      stands: ['A10', 'A01', 'A3', 'A02', 'A11', 'AN1'].map(code => ({ standId: code, code })),
      coverages: [{ id: 'c-1', stands: [{ standId: 'A10', code: 'A10' }, { standId: 'A9', code: 'A9' }] }],
      canAssign: true,
    };
    const ordered = orderCoverageBoard(board);
    expect(ordered.stands.map(stand => stand.code)).toEqual(['A01', 'A02', 'A3', 'A10', 'A11', 'AN1']);
    expect(ordered.coverages[0].stands.map(stand => stand.code)).toEqual(['A9', 'A10']);
    expect(ordered.canAssign).toBe(true);
    // The API's answer is not changed in place.
    expect(board.stands[0].code).toBe('A10');
  });

  it('leaves a missing board as it is', () => {
    expect(orderCoverageBoard(undefined)).toBeUndefined();
  });
});
