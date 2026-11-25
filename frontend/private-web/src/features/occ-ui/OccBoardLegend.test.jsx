import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import OccBoardLegend from './OccBoardLegend';

afterEach(() => {
  cleanup();
  resetLanguageForTests();
});

const items = () => [...screen.getByRole('list', { name: 'Leyenda del tablero' }).querySelectorAll('li')];

describe('OccBoardLegend', () => {
  it('names each mark of the board as the strips draw it, in the words of the status bar\'s legend', () => {
    render(<OccBoardLegend keys={['attention', 'urgent', 'demo', 'estimated', 'delay']} label="Leyenda del tablero" />);
    expect(items().map(item => item.dataset.occLegendItem)).toEqual(['attention', 'urgent', 'demo', 'estimated', 'delay']);
    expect(items().map(item => item.textContent)).toEqual(['Atención', 'Urgente', 'DemoSimulado para la demostración',
      'est.Calculado, no medido', '+NMinutos de demora']);
    // Each signal with its glyph, each tag as the strip draws it, and the delay chip with what it counts (CN-32).
    expect(items()[0].querySelector('[data-occ-glyph="attention"]')).not.toBeNull();
    expect(within(items()[2]).getByText('Demo')).toHaveAttribute('data-occ-tag', 'demo');
    expect(within(items()[4]).getByText('+N')).toHaveAttribute('aria-hidden', 'true');
  });

  it('lists only the keys given, in English too, and throws on an unknown one', () => {
    resetLanguageForTests('en');
    render(<LanguageScope><OccBoardLegend keys={['delay']} label="Leyenda del tablero" /></LanguageScope>);
    expect(items().map(item => item.textContent)).toEqual(['+NMinutes late']);
    cleanup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<OccBoardLegend keys={['late']} label="Leyenda del tablero" />)).toThrow(RangeError);
    } finally {
      consoleError.mockRestore();
    }
  });
});
