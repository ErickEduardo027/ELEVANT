import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FLIGHT_CATEGORY_COLORS, RADAR_SCALE_NWS, SIGMET_HAZARD_COLORS } from '../style/weatherColors';
import ReferenceSwatch from './ReferenceSwatch';

// The swatches of the regional weather (lane M7) in the aviation colours the owner approved on 2026-11-26.

afterEach(cleanup);

const swatchOf = kind => render(<ReferenceSwatch kind={kind} />).container.querySelector(`[data-reference-swatch="${kind}"]`);
const rgb = hex => `rgb(${[1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16)).join(', ')})`;

describe('regional weather swatches', () => {
  it('a dot in the colour of each flight category, and a hollow ring without one', () => {
    for (const [category, colour] of Object.entries(FLIGHT_CATEGORY_COLORS)) {
      const dot = swatchOf(`category${category}`).querySelector('circle');
      expect(dot.style.fill, category).toBe(rgb(colour));
      expect(dot.style.stroke, category).toBe('var(--occ-nav)');
    }
    const ring = swatchOf('categoryNone').querySelector('circle');
    expect([ring.style.fill, ring.style.stroke]).toEqual(['none', 'var(--occ-muted)']);
  });

  it('the radar as flat steps of its scale, a SIGMET area, a barb and the loops', () => {
    const steps = [...swatchOf('radar').querySelectorAll('rect[style]')].filter(rect => rect.getAttribute('width') === '3.6');
    expect(steps.map(step => step.style.fill)).toEqual([1, 4, 6, 9, 12].map(index => rgb(RADAR_SCALE_NWS[index][1])));
    const area = swatchOf('sigmet').querySelector('path');
    expect(area.style.stroke).toBe(rgb(SIGMET_HAZARD_COLORS.TS));
    expect(Number(area.style.fillOpacity)).toBeLessThanOrEqual(0.15);
    expect(swatchOf('barb').querySelector('[data-glyph="barb"]').querySelectorAll('path').length).toBeGreaterThan(1);
    for (const kind of ['loopIr', 'loopGeocolor']) {
      const svg = swatchOf(kind);
      expect(svg.getAttribute('aria-hidden'), kind).toBe('true');
      expect(svg.querySelectorAll('path').length, kind).toBeGreaterThan(1);
    }
  });
});
