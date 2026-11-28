import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { resetPanelFoldsForTests } from '../../occ-ui/occPanelMemory';
import { consoleMessages } from './consoleMessages';
import FiguresPanel from './FiguresPanel';

// The figures of a day the reads answered, as buildFigures counts them (consoleModel.js), synthetic.
const FIGURES = Object.freeze({ turnarounds: 6, inOperation: 3, openAfterDeparture: 0, arriving60: 2, needsResources: 1,
  toReview: 1, toReviewIsLowerBound: false, completed: 1 });

afterEach(() => {
  cleanup();
  resetLanguageForTests();
  resetPanelFoldsForTests();
});

/** «Cifras de la jornada» over a planning read that answered, in `language`; returns the tile labelled `label`. */
function renderFigures(figures, language = 'es') {
  resetLanguageForTests(language);
  render(
    <LanguageScope>
      <FiguresPanel figures={figures} state={{ status: 'success' }} timeZone="America/Santo_Domingo" />
    </LanguageScope>,
  );
  const panel = screen.getByRole('region', { name: consoleMessages[language].panels.figures });
  return label => within(panel).getByText(label, { selector: 'dt span' }).closest('[data-occ-stat]');
}

describe('FiguresPanel', () => {
  it('«En operación» keeps counting an operation open after its departure and says so (N30)', () => {
    const tileOf = renderFigures({ ...FIGURES, openAfterDeparture: 1 });
    const working = tileOf('En operación');
    const [figure, detail] = within(working).getAllByRole('definition');
    expect(figure).toHaveTextContent(/^3$/);
    expect(detail).toHaveTextContent(/^Atención: 1 abierta tras la salida$/);
    expect(detail.querySelector('[data-occ-glyph]')).toHaveAttribute('data-shape', 'triangle');
    // Only «En operación» says it: the other figures carry no line.
    for (const label of ['Escalas', 'Llegan en 60 min', 'Sin recursos', 'Por revisar', 'Completadas']) {
      expect(tileOf(label).querySelector('[data-occ-stat-detail]'), label).toBeNull();
    }
  });

  it('counts them in the plural, and says nothing while none is open or the board has not answered (N30)', () => {
    const tileOf = renderFigures({ ...FIGURES, openAfterDeparture: 2 });
    expect(tileOf('En operación').querySelector('[data-occ-stat-detail]')).toHaveTextContent('2 abiertas tras la salida');
    cleanup();
    for (const openAfterDeparture of [0, null]) {
      const tile = renderFigures({ ...FIGURES, openAfterDeparture })('En operación');
      expect(tile.querySelector('[data-occ-stat-detail]'), String(openAfterDeparture)).toBeNull();
      expect(within(tile).getAllByRole('definition')[0]).toHaveTextContent(/^3$/);
      cleanup();
    }
  });

  it('says it in English inside the scope (N30)', () => {
    const tileOf = renderFigures({ ...FIGURES, openAfterDeparture: 1 }, 'en');
    expect(tileOf('In operation').querySelector('[data-occ-stat-detail]'))
      .toHaveTextContent(/^Attention: 1 open after departure$/);
  });

  it('is the strip along the top of the map only when asked (`strip`), whatever its layout (M1)', () => {
    const figureClasses = () => [...document.querySelectorAll('[data-occ-stat] dt + dd')].map(dd => dd.className);
    const show = props => render(
      <LanguageScope>
        <FiguresPanel figures={FIGURES} state={{ status: 'success' }} timeZone="America/Santo_Domingo" {...props} />
      </LanguageScope>,
    );
    // Floating over the map: one line, the header at the left of the figures, «Cifras» on the button of a laptop
    // (below 1400 px) while its name stays the whole title, and each figure a size down.
    show({ layout: 'float', strip: true });
    let panel = screen.getByRole('region', { name: 'Cifras de la jornada' });
    expect(panel).toHaveAttribute('data-layout', 'float');
    expect(panel).toHaveAttribute('data-orientation', 'row');
    const button = within(panel).getByRole('button', { name: 'Cifras de la jornada' });
    expect(within(button).getByText('Cifras')).toHaveAttribute('aria-hidden', 'true');
    expect(figureClasses()).toHaveLength(6);
    for (const className of figureClasses()) expect(className).toContain('text-lg');
    cleanup();
    // Without `strip` the same floating layout is a panel of tiles: the header over them, the whole title on the
    // button, the figures at their size.
    for (const layout of ['float', 'grid']) {
      show({ layout });
      panel = screen.getByRole('region', { name: 'Cifras de la jornada' });
      expect(panel, layout).toHaveAttribute('data-layout', layout);
      expect(panel, layout).toHaveAttribute('data-orientation', 'column');
      expect(within(panel).queryByText('Cifras'), layout).toBeNull();
      for (const className of figureClasses()) expect(className, layout).toContain('text-2xl');
      cleanup();
    }
  });
});
