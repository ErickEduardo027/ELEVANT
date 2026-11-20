import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import OccStatTile, { OCC_STAT_TONES, OccStatList } from './OccStatTile';

afterEach(() => {
  cleanup();
  resetLanguageForTests();
});

const classesOf = element => element.className.split(/\s+/).filter(Boolean);
const tileOf = label => screen.getByText(label).closest('[data-occ-stat]');
const figureOf = label => tileOf(label).querySelector('dd');

function figures(tiles) {
  return <OccStatList label="Cifras de la jornada" className="flex flex-wrap gap-x-6">{tiles}</OccStatList>;
}

describe('OccStatTile', () => {
  it('draws a dt and dd inside a dl, with the hint as screen-reader text', () => {
    render(figures(
      <OccStatTile label="Escalas" value={18} hint="Escalas planificadas para la fecha operacional." className="min-w-24" />,
    ));
    const list = screen.getByText('Escalas').closest('dl');
    expect(list).toHaveAttribute('aria-label', 'Cifras de la jornada');
    expect(list).toHaveAttribute('data-occ-stats');
    expect(classesOf(list)).toEqual(['flex', 'flex-wrap', 'gap-x-6']);
    const tile = tileOf('Escalas');
    expect(tile.parentElement).toBe(list);
    expect(within(tile).getByRole('term')).toHaveTextContent('Escalas');
    const [figure, hint] = within(tile).getAllByRole('definition');
    expect(figure).toHaveTextContent('18');
    // The hint explains the figure to assistive technology, out of sight.
    expect(hint).toHaveTextContent('Escalas planificadas para la fecha operacional.');
    expect(hint).toHaveClass('sr-only');
    expect(classesOf(tile).at(-1)).toBe('min-w-24');
    // Manrope, not mono: a figure is not an identifier.
    expect(classesOf(figure)).not.toContain('font-mono');
    expect(classesOf(figure)).toEqual(expect.arrayContaining(['font-semibold', 'text-occ-text']));
  });

  it('lights its tone with a glyph and word only above zero and never tints the figure', () => {
    expect(OCC_STAT_TONES).toEqual(['neutral', 'attention', 'urgent']);
    render(figures(
      <>
        <OccStatTile label="Sin recursos" value={1} tone="attention" />
        <OccStatTile label="Incidencias" value={2} tone="urgent" />
        <OccStatTile label="Por revisar" value={0} tone="attention" />
        <OccStatTile label="En operación" value={3} />
      </>,
    ));
    const attention = tileOf('Sin recursos');
    expect(attention).toHaveAttribute('data-tone', 'attention');
    expect(attention.querySelector('dt [data-occ-glyph]')).toHaveAttribute('data-shape', 'triangle');
    expect(attention.querySelector('[data-occ-glyph]')).toHaveAttribute('aria-hidden', 'true');
    // The word goes with the glyph, for whoever cannot see the shape.
    expect(within(attention).getByRole('term')).toHaveTextContent('Sin recursos, Atención');
    const urgent = tileOf('Incidencias');
    expect(urgent).toHaveAttribute('data-tone', 'urgent');
    expect(urgent.querySelector('[data-occ-glyph]')).toHaveAttribute('data-shape', 'octagon');
    expect(within(urgent).getByRole('term')).toHaveTextContent('Incidencias, Urgente');
    // Zero asks for nothing: no glyph, no word. A neutral figure never lights.
    for (const label of ['Por revisar', 'En operación']) {
      expect(tileOf(label)).toHaveAttribute('data-tone', 'neutral');
      expect(tileOf(label).querySelector('[data-occ-glyph]')).toBeNull();
      expect(within(tileOf(label)).getByRole('term')).toHaveTextContent(new RegExp(`^${label}$`));
    }
    // The figure itself never takes a hue.
    for (const label of ['Sin recursos', 'Incidencias', 'Por revisar', 'En operación']) {
      expect(classesOf(figureOf(label)).filter(name => /occ-(?:warn|danger|accent)/.test(name)), label).toEqual([]);
      expect(classesOf(figureOf(label))).toContain('text-occ-text');
    }

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<OccStatTile label="Escalas" value={1} tone="critical" />)).toThrow(RangeError);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('says more of its figure on a line under it, with the glyph and word of a signal when it carries one', () => {
    render(figures(
      <>
        <OccStatTile label="En operación" value={3} hint="Escalas en curso." detail="1 abierta tras la salida"
          detailTone="attention" />
        <OccStatTile label="Escalas" value={18} detail="2 demo" />
        <OccStatTile label="Completadas" value={null} detail="1 abierta tras la salida" detailTone="attention" />
        <OccStatTile label="Por revisar" value={2} detail="" detailTone="attention" />
      </>,
    ));
    const working = tileOf('En operación');
    // The figure, then the line on screen, then the hint for assistive technology.
    const [figure, detail, hint] = within(working).getAllByRole('definition');
    expect(figure).toHaveTextContent(/^3$/);
    expect(detail).toHaveAttribute('data-occ-stat-detail');
    expect(detail).not.toHaveClass('sr-only');
    expect(detail).toHaveTextContent(/^Atención: 1 abierta tras la salida$/);
    expect(detail.querySelector('[data-occ-glyph]')).toHaveAttribute('data-shape', 'triangle');
    expect(within(detail).getByText('Atención:', { exact: false })).toHaveClass('sr-only');
    expect(hint).toHaveClass('sr-only');
    // The line asks for attention; the figure and its label do not, so the tile keeps its own tone.
    expect(working).toHaveAttribute('data-tone', 'neutral');
    expect(working.querySelector('dt [data-occ-glyph]')).toBeNull();
    expect(classesOf(figure).filter(name => /occ-(?:warn|danger|accent)/.test(name))).toEqual([]);

    // A plain line has no glyph and no word.
    const plain = tileOf('Escalas').querySelector('[data-occ-stat-detail]');
    expect(plain).toHaveTextContent(/^2 demo$/);
    expect(plain.querySelector('[data-occ-glyph]')).toBeNull();
    // Nothing to say while the figure loads, nor without words.
    expect(tileOf('Completadas').querySelector('[data-occ-stat-detail]')).toBeNull();
    expect(tileOf('Por revisar').querySelector('[data-occ-stat-detail]')).toBeNull();

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<OccStatTile label="Escalas" value={1} detail="x" detailTone="critical" />)).toThrow(RangeError);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('shows a dash while loading and never asserts zero; writes a lower bound as «≥3»; links its figure when given href', () => {
    const { rerender } = render(figures(
      <>
        <OccStatTile label="Escalas" value={0} loading tone="attention" />
        <OccStatTile label="Completadas" value={null} />
        <OccStatTile label="Por revisar" value={3} isLowerBound tone="attention" href="/admin-occ/review" />
      </>,
    ));
    for (const label of ['Escalas', 'Completadas']) {
      const figure = figureOf(label);
      expect(figure).toHaveTextContent('—');
      expect(figure.textContent).not.toMatch(/\d/);
      expect(within(figure).getByText('—')).toHaveAttribute('aria-hidden', 'true');
      expect(within(figure).getByText('Cargando')).toHaveClass('sr-only');
      // While loading nothing lights, whatever the tone.
      expect(tileOf(label)).toHaveAttribute('data-tone', 'neutral');
    }
    // A lower bound: «≥3» on screen, «al menos 3» for assistive technology, and still lit above zero.
    const bound = figureOf('Por revisar');
    expect(within(bound).getByText('≥3')).toHaveAttribute('aria-hidden', 'true');
    expect(within(bound).getByText('al menos 3')).toHaveClass('sr-only');
    expect(tileOf('Por revisar')).toHaveAttribute('data-tone', 'attention');
    const link = within(bound).getByRole('link', { name: 'al menos 3' });
    expect(link).toHaveAttribute('href', '/admin-occ/review');
    // A link stays plain text with an underline: the figures never light up.
    expect(classesOf(link)).toEqual(expect.arrayContaining(['underline', 'decoration-occ-line-strong']));
    expect(classesOf(link).filter(name => /^text-occ-(?:accent|warn|danger)$/.test(name))).toEqual([]);

    // A figure still loading has nowhere to go; English inside the scope.
    act(() => resetLanguageForTests('en'));
    rerender(
      <LanguageScope>
        {figures(<OccStatTile label="To review" value={null} href="/admin-occ/review" />)}
        {figures(<OccStatTile label="Stands" value={4} isLowerBound />)}
      </LanguageScope>,
    );
    expect(within(figureOf('To review')).queryByRole('link')).not.toBeInTheDocument();
    expect(within(figureOf('To review')).getByText('Loading')).toHaveClass('sr-only');
    expect(within(figureOf('Stands')).getByText('at least 4')).toBeInTheDocument();
  });
});
