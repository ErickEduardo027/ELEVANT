import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { resetPanelFoldsForTests } from '../../occ-ui/occPanelMemory';
import PositionsPanel from './PositionsPanel';

// «Posiciones» folded (its default): the pill the console shows along the bottom of the map. Synthetic stands and
// figures, as useStandDisplay and buildFigures give them.
const STANDS = Object.freeze([
  { id: 'A1', code: 'A1', displayStatus: 'available' },
  { id: 'A2', code: 'A2', displayStatus: 'available' },
  { id: 'B24', code: 'B24', displayStatus: 'occupied' },
]);
const FIGURES = Object.freeze({ turnarounds: 6, inOperation: 3, openAfterDeparture: 0, arriving60: 2, needsResources: 1,
  toReview: 1, toReviewIsLowerBound: false, completed: 1 });

afterEach(() => {
  cleanup();
  resetLanguageForTests();
  resetPanelFoldsForTests();
});

/** The folded band, `props` on top of a read that answered; returns what its pill says beside its button. */
function foldedSummary(props = {}) {
  render(
    <LanguageScope>
      <PositionsPanel stands={STANDS} figures={FIGURES} state={{ status: 'success' }} nowMs={Date.now()}
        timeZone="America/Santo_Domingo" {...props} />
    </LanguageScope>,
  );
  const panel = screen.getByRole('region', { name: 'Posiciones' });
  expect(panel).toHaveAttribute('data-folded', 'true');
  const button = within(panel).getByRole('button', { name: 'Posiciones', exact: true });
  return document.getElementById(button.getAttribute('aria-describedby'));
}

describe('PositionsPanel', () => {
  it('says the figures of the day in its pill unless the screen shows them elsewhere (`showFigures`), whatever its layout (M1)', () => {
    for (const layout of ['float', 'grid']) {
      // Where no strip of figures shows them (the fallback grid, a screen without one): «Escalas» and «En operación».
      let summary = foldedSummary({ layout });
      expect(summary, layout).toHaveTextContent(/Escalas\s*6/);
      expect(summary, layout).toHaveTextContent(/En operación\s*3/);
      cleanup();
      // Under the strip of figures over the map, it does not say them again, and keeps the stands by state.
      summary = foldedSummary({ layout, showFigures: false });
      expect(summary, layout).not.toHaveTextContent(/Escalas|En operación/);
      const counts = within(summary).getByRole('list', { name: 'Posiciones por estado' });
      expect(within(counts).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Libre 2', 'Ocupada 1']);
      cleanup();
    }
  });
});
