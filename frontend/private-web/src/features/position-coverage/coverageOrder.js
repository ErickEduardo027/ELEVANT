import { sortByStandCode } from '../../services/standCodes';

/**
 * The coverage board with its stands in natural order (services/standCodes.js: A1, A2… A10, A11, AN1…, B20, BN6…
 * BN13): the board's list, the form's buttons, the combined-stand choices and the stands inside each coverage row, so
 * no screen of «Cobertura de posiciones» reads «A10, A3» or «A10 A9». The board itself is left as the API answered it.
 */
export function orderCoverageBoard(board) {
  if (!board || typeof board !== 'object') return board;
  return {
    ...board,
    stands: sortByStandCode(board.stands),
    coverages: (board.coverages ?? []).map(coverage => ({ ...coverage, stands: sortByStandCode(coverage.stands) })),
  };
}
