import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import tailwindConfig from '../../../tailwind.config.js';
import OccGlyph, { signalInkToken } from './OccGlyph';
import { OCC_PALETTE } from './occPalette';
import { SIGNALS } from './statusVocabulary';

afterEach(cleanup);

const classOf = svg => svg.getAttribute('class') ?? '';

describe('OccGlyph', () => {
  it('draws each signal with its own shape and paints only attention and urgent', () => {
    const { container } = render(<>
      <OccGlyph name="attention" />
      <OccGlyph name="urgent" />
      <OccGlyph name="notice" />
    </>);
    const glyphs = [...container.querySelectorAll('svg')];
    expect(glyphs.map(glyph => [glyph.dataset.occGlyph, glyph.dataset.shape])).toEqual([
      ['attention', 'triangle'], ['urgent', 'octagon'], ['notice', 'diamond'],
    ]);

    for (const glyph of glyphs) {
      const { colorToken } = SIGNALS[glyph.dataset.occGlyph];
      const body = glyph.querySelector('[data-part="body"]');
      const mark = glyph.querySelector('[data-part="mark"]');
      if (colorToken) {
        // The fill is the signal's token and the «!» is drawn in the ink made for that fill.
        expect(body.style.fill).toBe(`var(${colorToken})`);
        expect(mark.style.fill).toBe(`var(${signalInkToken(colorToken)})`);
        expect(OCC_PALETTE).toHaveProperty([signalInkToken(colorToken)]);
      } else {
        // The plain notice has no colour of its own: an outline in the text colour, without «!».
        expect(body.getAttribute('fill')).toBe('none');
        expect(body.getAttribute('stroke')).toBe('currentColor');
        expect(body.style.fill).toBe('');
        expect(mark).toBeNull();
      }
    }
    expect(signalInkToken('--occ-warn')).toBe('--occ-on-warn');
    expect(signalInkToken('--occ-danger')).toBe('--occ-on-danger');
  });

  it('hides itself next to its word and is an image named by its title when alone', () => {
    render(<p><OccGlyph name="attention" /> Atención <OccGlyph name="urgent" title="Urgente" /></p>);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    const urgent = screen.getByRole('img', { name: 'Urgente' });
    expect(urgent).toHaveAttribute('data-shape', 'octagon');
    expect(urgent.querySelector('title')).toHaveTextContent('Urgente');
    expect(document.querySelector('[data-occ-glyph="attention"]')).toHaveAttribute('aria-hidden', 'true');
    // A glyph is never a stop of the keyboard.
    for (const glyph of document.querySelectorAll('svg')) {
      expect(glyph).toHaveAttribute('focusable', 'false');
      expect(glyph).not.toHaveAttribute('tabindex');
    }
  });

  it('blinks only an urgent glyph, and only without reduced motion', () => {
    const { container } = render(<>
      <OccGlyph name="urgent" blink />
      <OccGlyph name="attention" blink />
      <OccGlyph name="urgent" />
    </>);
    const [blinking, attention, steady] = container.querySelectorAll('svg');
    expect(classOf(blinking)).toContain('motion-safe:animate-occ-alarm-blink');
    // With reduced motion it stays still and keeps a second outline instead.
    expect(classOf(blinking)).toContain('motion-reduce:outline-occ-danger');
    expect(classOf(blinking)).not.toMatch(/(?:^|\s)animate-/);
    for (const glyph of [attention, steady]) expect(classOf(glyph)).not.toContain('animate-');

    expect(tailwindConfig.theme.extend.animation['occ-alarm-blink']).toBe('occ-alarm-blink 1s steps(1, end) infinite');
    expect(Object.keys(tailwindConfig.theme.extend.keyframes['occ-alarm-blink'])).toEqual(['0%, 100%', '50%']);
  });

  it('rejects a signal the vocabulary does not have', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<OccGlyph name="info" />)).toThrow(RangeError);
    } finally {
      consoleError.mockRestore();
    }
  });
});
