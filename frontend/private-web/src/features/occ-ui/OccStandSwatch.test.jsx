import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OccStandSwatch from './OccStandSwatch';
import { STAND_STATE_KEYS, STAND_STATES, TAGS } from './statusVocabulary';

afterEach(cleanup);

const standOf = svg => svg.querySelector('[data-part="stand"]');

describe('OccStandSwatch', () => {
  it('draws every stand state with the fill, outline and dash of the vocabulary', () => {
    const { container } = render(<>{STAND_STATE_KEYS.map(key => <OccStandSwatch key={key} state={key} />)}</>);
    const swatches = [...container.querySelectorAll('svg[data-stand-state]')];
    expect(swatches.map(svg => svg.dataset.standState)).toEqual(STAND_STATE_KEYS);

    for (const svg of swatches) {
      const key = svg.dataset.standState;
      const { fill, outline, dash } = STAND_STATES[key];
      const stand = standOf(svg);
      expect(stand.style.stroke, key).toBe(`var(${outline.token})`);
      expect(Number(stand.style.strokeWidth), key).toBe(outline.width);
      expect(stand.style.strokeDasharray, key).toBe(dash ? dash.join(' ') : '');
      if (fill.kind === 'none') {
        expect(stand.style.fill, key).toBe('none');
      } else if (fill.kind === 'hatch') {
        // The hatch of a disabled stand is a pattern of lines in its token.
        const pattern = svg.querySelector('defs > pattern');
        expect(stand.style.fill, key).toBe(`url("#${pattern.id}")`);
        expect(pattern.querySelector('line').style.stroke, key).toBe(`var(${fill.token})`);
      } else {
        expect(stand.style.fill, key).toBe(`var(${fill.token})`);
      }
      // Every swatch stands on the canvas, so a slab fill shows on any surface.
      expect(svg.querySelector('[data-part="ground"]').style.fill).toBe('var(--occ-canvas)');
    }
  });

  it('tells Ocupada from Por liberar by the clock', () => {
    const { container } = render(<><OccStandSwatch state="occupied" /><OccStandSwatch state="releasing" /></>);
    const [occupied, releasing] = container.querySelectorAll('svg');
    expect(occupied.querySelector('[data-part="clock"]')).toBeNull();
    expect(releasing.querySelector('[data-part="clock"]')).not.toBeNull();
    expect(standOf(occupied).getAttribute('style')).toBe(standOf(releasing).getAttribute('style'));
  });

  it('draws the Demo texture as an SVG pattern of 45° stripes, never with CSS', () => {
    const { container } = render(<OccStandSwatch tag="demo" />);
    const svg = container.querySelector('svg[data-tag="demo"]');
    expect(TAGS.demo.texture).toBe('stripes-45');
    const pattern = svg.querySelector('defs > pattern');
    expect(pattern).toHaveAttribute('patternTransform', 'rotate(45)');
    expect(pattern).toHaveAttribute('patternUnits', 'userSpaceOnUse');
    expect(standOf(svg).style.fill).toBe(`url("#${pattern.id}")`);
    // No CSS texture anywhere: no background image and no background class.
    for (const node of [svg, ...svg.querySelectorAll('*')]) {
      expect(node.style.backgroundImage ?? '').toBe('');
      expect(node.getAttribute('class') ?? '').not.toMatch(/(?:^|\s)bg-/);
    }
  });

  it('draws the other tags by their texture: est. dashed, No oficial outlined, Sin actualizar dimmed', () => {
    const { container } = render(<>
      <OccStandSwatch tag="estimated" />
      <OccStandSwatch tag="unofficial" />
      <OccStandSwatch tag="stale" />
    </>);
    const [estimated, unofficial, stale] = [...container.querySelectorAll('svg')].map(standOf);
    expect(estimated.style.strokeDasharray).not.toBe('');
    expect(unofficial.style.strokeDasharray).toBe('');
    expect(unofficial.style.stroke).toBe('var(--occ-line-strong)');
    expect(stale.style.stroke).toBe('var(--occ-faint)');
    expect(container.querySelector('svg[data-tag="stale"] [data-part="clock"]')).not.toBeNull();
    // None of them is filled with a texture.
    for (const stand of [estimated, unofficial, stale]) expect(stand.style.fill).toBe('none');
  });

  it('gives each swatch a pattern of its own', () => {
    const { container } = render(<><OccStandSwatch tag="demo" /><OccStandSwatch tag="demo" /><OccStandSwatch state="disabled" /></>);
    const ids = [...container.querySelectorAll('pattern')].map(pattern => pattern.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it('hides itself next to its word and is an image named by its title when alone', () => {
    render(<p><OccStandSwatch state="available" /> Libre <OccStandSwatch state="occupied" title="Ocupada" /></p>);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'Ocupada' })).toHaveAttribute('data-stand-state', 'occupied');
    expect(document.querySelector('[data-stand-state="available"]')).toHaveAttribute('aria-hidden', 'true');
    for (const svg of document.querySelectorAll('svg')) expect(svg).toHaveAttribute('focusable', 'false');
  });

  it('rejects a state or a tag the vocabulary does not have', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<OccStandSwatch state="closed" />)).toThrow(RangeError);
      expect(() => render(<OccStandSwatch tag="official" />)).toThrow(RangeError);
    } finally {
      consoleError.mockRestore();
    }
  });
});
