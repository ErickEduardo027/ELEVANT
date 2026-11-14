import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findLegacyColourClasses } from '../../styles/occLegacyBridge';
import OccStatusPill, { OCC_STATUS_PILL_SIZES } from './OccStatusPill';
import { OCC_STATUS_TONE_KEYS, STATUS_TONES } from './statusVocabulary';

afterEach(cleanup);

const classesOf = element => element.getAttribute('class').split(/\s+/).filter(Boolean);
const pillOf = label => screen.getByText(label).closest('[data-occ-status]');
// The Tailwind class of a token: `--occ-muted` is painted by `text-occ-muted`.
const classOf = (utility, token) => `${utility}-${token.replace(/^--/, '')}`;

const LABELS = Object.freeze({
  neutral: 'Planificada', active: 'En operación', done: 'Completada', muted: 'Cancelada', attention: 'Sin agente',
  urgent: 'Incidencia',
});

describe('OccStatusPill', () => {
  it('draws a glyph and the word for every tone, never colour alone', () => {
    for (const tone of OCC_STATUS_TONE_KEYS) {
      const { unmount } = render(<OccStatusPill tone={tone} label={LABELS[tone]} data-testid={`pill-${tone}`} />);
      const pill = pillOf(LABELS[tone]);
      expect(pill).toHaveAttribute('data-tone', tone);
      expect(pill).toHaveAttribute('data-testid', `pill-${tone}`);
      // The word is text, and the pill says nothing else.
      expect(pill).toHaveTextContent(LABELS[tone], { normalizeWhitespace: true });
      expect(pill.textContent).toBe(LABELS[tone]);
      // One glyph in the tone's shape, hidden from assistive technology: the word carries the state.
      const glyphs = pill.querySelectorAll('svg');
      expect(glyphs, tone).toHaveLength(1);
      expect(glyphs[0]).toHaveAttribute('data-shape', STATUS_TONES[tone].shape);
      expect(glyphs[0]).toHaveAttribute('aria-hidden', 'true');
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      // The word wears the tone's text token.
      expect(classesOf(pill)).toContain(classOf('text', STATUS_TONES[tone].textToken));
      unmount();
    }
    // The four normal shapes are drawn in currentColor, in their glyph token; the signals use OccGlyph.
    render(<>
      <OccStatusPill tone="neutral" label="Libre" />
      <OccStatusPill tone="urgent" label="Otra aeronave llega" />
    </>);
    const hollow = pillOf('Libre').querySelector('svg');
    expect(classesOf(hollow)).toContain(classOf('text', STATUS_TONES.neutral.glyphToken));
    expect(hollow.querySelector('circle')).toHaveAttribute('stroke', 'currentColor');
    expect(pillOf('Otra aeronave llega').querySelector('svg')).toHaveAttribute('data-occ-glyph', 'urgent');
  });

  it('puts a container only around attention and urgent', () => {
    for (const tone of OCC_STATUS_TONE_KEYS) {
      const { unmount } = render(<OccStatusPill tone={tone} label={LABELS[tone]} className="ml-2" />);
      const classes = classesOf(pillOf(LABELS[tone]));
      const { container } = STATUS_TONES[tone];
      const slabs = classes.filter(name => /^bg-/.test(name));
      if (container === null) {
        expect(slabs, tone).toEqual([]);
        expect(classes, tone).not.toContain('rounded');
      } else {
        expect(slabs, tone).toEqual([classOf('bg', container)]);
        expect(classes, tone).toContain('rounded');
      }
      // Flat, on occ tokens only, and className last.
      expect(findLegacyColourClasses(classes.join(' ')), tone).toEqual([]);
      expect(classes.filter(name => /shadow|uppercase|tracking/.test(name)), tone).toEqual([]);
      expect(classes.at(-1)).toBe('ml-2');
      unmount();
    }
  });

  it('adds the Demo and est. tags', () => {
    const { rerender } = render(<OccStatusPill tone="active" label="En operación" demo estimated />);
    const pill = pillOf('En operación');
    expect(pill.querySelector('[data-occ-tag="demo"]')).toHaveTextContent('Demo');
    expect(pill.querySelector('[data-occ-tag="estimated"]')).toHaveTextContent('est.');
    // The tags follow the word.
    expect(pill.textContent).toBe('En operaciónDemoest.');

    rerender(<OccStatusPill tone="active" label="En operación" />);
    expect(pillOf('En operación').querySelector('[data-occ-tag]')).toBeNull();
    // A smaller pill for dense tables, never under 12 px.
    rerender(<OccStatusPill tone="active" label="En operación" size="sm" />);
    expect(classesOf(pillOf('En operación'))).toContain('text-xs');
    expect(OCC_STATUS_PILL_SIZES).toEqual(['md', 'sm']);
  });

  it('throws on an unknown tone', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // `critical` is the design's word; the vocabulary says `urgent`.
      expect(() => render(<OccStatusPill tone="critical" label="Urgente" />)).toThrow(RangeError);
      expect(() => render(<OccStatusPill tone="ok" label="Libre" />)).toThrow(/Unknown OCC status tone: ok/);
      expect(() => render(<OccStatusPill tone="done" label="Cerrada" size="lg" />)).toThrow(RangeError);
    } finally {
      consoleError.mockRestore();
    }
  });
});
