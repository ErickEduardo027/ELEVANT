import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findLegacyColourClasses } from '../../styles/occLegacyBridge';
import OccStatusLegend from './OccStatusLegend';
import OccStatusPill from './OccStatusPill';
import { OCC_STATUS_TONE_KEYS, STATUS_TONES } from './statusVocabulary';

afterEach(cleanup);

const classesOf = element => element.getAttribute('class').split(/\s+/).filter(Boolean);
const entriesOf = legend => within(legend).getAllByRole('listitem')
  .map(item => [item.dataset.tone, item.textContent, item.querySelector('svg').dataset.shape]);

describe('OccStatusLegend', () => {
  it('lists each mark in order with the shape of its tone and its word, named for assistive technology', () => {
    render(<OccStatusLegend label="Atributos y estado" data-testid="legend" className="ml-2" items={[
      { key: 'attribute', tone: 'neutral', label: 'Atributo' },
      { key: 'inactive', tone: 'muted', label: 'Desactivada' },
      { key: 'busy', tone: 'attention', label: 'Operación en curso' },
    ]} />);
    const legend = screen.getByRole('list', { name: 'Atributos y estado' });
    expect(legend).toHaveAttribute('data-testid', 'legend');
    expect(entriesOf(legend)).toEqual([
      ['neutral', 'Atributo', 'hollow-circle'], ['muted', 'Desactivada', 'slashed-circle'],
      ['attention', 'Operación en curso', 'triangle'],
    ]);
    // The words say the marks: every glyph is hidden from assistive technology, and nothing is an image.
    for (const glyph of legend.querySelectorAll('svg')) expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).toBeNull();
    // Small and secondary, flat, on occ tokens only, and className last.
    const classes = classesOf(legend);
    expect(classes).toEqual(expect.arrayContaining(['text-xs', 'text-occ-muted']));
    expect(findLegacyColourClasses(classes.join(' '))).toEqual([]);
    expect(classes.filter(name => /shadow|uppercase|tracking|^bg-/.test(name))).toEqual([]);
    expect(classes.at(-1)).toBe('ml-2');
  });

  it('draws for every tone the very glyph of the pill, so a legend shows the board\'s own shapes', () => {
    for (const tone of OCC_STATUS_TONE_KEYS) {
      const { unmount } = render(<>
        <OccStatusLegend label="Leyenda" items={[{ key: tone, tone, label: 'Marca' }]} />
        <OccStatusPill tone={tone} label="Fila" />
      </>);
      const legendGlyph = screen.getByRole('list', { name: 'Leyenda' }).querySelector('svg');
      const pillGlyph = screen.getByText('Fila').closest('[data-occ-status]').querySelector('svg');
      expect(legendGlyph.outerHTML, tone).toBe(pillGlyph.outerHTML);
      expect(legendGlyph, tone).toHaveAttribute('data-shape', STATUS_TONES[tone].shape);
      unmount();
    }
  });

  it('throws on an unknown tone', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<OccStatusLegend label="Leyenda" items={[{ key: 'x', tone: 'critical', label: 'Urgente' }]} />))
        .toThrow(/Unknown OCC status tone: critical/);
    } finally {
      consoleError.mockRestore();
    }
  });
});
