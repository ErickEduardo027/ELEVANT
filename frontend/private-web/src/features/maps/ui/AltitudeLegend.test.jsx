import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { OccMapContext } from '../core/OccMapContext';
import { MAP_COLORS } from '../style/mapColors';
import AltitudeLegend, { altitudeTicks } from './AltitudeLegend';

afterEach(cleanup);

const withTraffic = { trafficOnScreen: { kinds: ['other'], tags: [], trails: [], route: [] }, engineStatus: 'ready' };
function renderLegend(context = withTraffic, props = {}) {
  return render(<OccMapContext.Provider value={context}><AltitudeLegend {...props} /></OccMapContext.Provider>);
}

describe('AltitudeLegend', () => {
  it('the ticks of the owner: 0 to 40 000+, evenly spaced', () => {
    const ticks = altitudeTicks();
    expect(ticks.map(tick => tick.text.replace(/\u202f/g, ' '))).toEqual(['0', '500', '1 000', '2 000', '4 000', '6 000',
      '8 000', '10 000', '20 000', '30 000', '40 000+']);
    expect(ticks[0].at).toBe(0);
    expect(ticks.at(-1).at).toBe(100);
    expect(ticks[5].at).toBe(50);
  });

  it('draws «Altitud (ft)», the gradient of the aircraft and the grey of the ground, and folds', async () => {
    renderLegend();
    const legend = screen.getByTestId('altitude-legend');
    expect(legend).toHaveTextContent('Altitud (ft)');
    expect(legend).toHaveTextContent('En tierra');
    const bar = legend.querySelector('[data-altitude-bar]');
    expect(bar.style.backgroundImage).toContain('linear-gradient');
    expect(legend.querySelectorAll('[data-altitude-tick]')).toHaveLength(11);
    expect(screen.getByRole('img', { name: 'Escala de colores por altitud, en pies' })).toBeInTheDocument();
    expect(legend.querySelector('[data-altitude-ground]').style.backgroundColor).not.toBe('');
    expect(MAP_COLORS.dark.altitude.ground).toMatch(/^#/);
    const button = screen.getByRole('button', { name: /Altitud/ });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(legend).toHaveAttribute('data-open', 'false');
    expect(legend.querySelector('[data-altitude-bar]')).toBeNull();
    await userEvent.click(button);
    expect(legend.querySelectorAll('[data-altitude-tick]')).toHaveLength(11);
  });

  it('shows nothing without traffic on screen or on a map that cannot draw', () => {
    renderLegend({ ...withTraffic, trafficOnScreen: { kinds: [], tags: [], trails: [], route: [] } });
    expect(screen.queryByTestId('altitude-legend')).toBeNull();
    cleanup();
    renderLegend({ ...withTraffic, engineStatus: 'unavailable' });
    expect(screen.queryByTestId('altitude-legend')).toBeNull();
  });
});
