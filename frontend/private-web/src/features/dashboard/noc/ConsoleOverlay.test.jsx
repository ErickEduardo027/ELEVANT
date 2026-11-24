import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ConsoleOverlay, { CONSOLE_OVERLAY_LAYOUT } from './ConsoleOverlay';

afterEach(cleanup);

const panels = Object.freeze({
  board: <section data-testid="board" />, figures: <section data-testid="figures" />,
  alerts: <section data-testid="alerts" />, inspector: <section data-testid="inspector" />,
  positions: <section data-testid="positions" />,
});
const parentOf = id => screen.getByTestId(id).parentElement;

describe('ConsoleOverlay (CN-32)', () => {
  it('docks the lists at the left, the figures along the top and the band along the bottom', () => {
    render(<ConsoleOverlay layout="float" {...panels} />);
    const { float } = CONSOLE_OVERLAY_LAYOUT;
    // «Tablero» over «Alertas» in the left column, which runs the whole height of the map.
    expect(parentOf('board')).toBe(parentOf('alerts'));
    expect(parentOf('board').className).toBe(float.lists);
    expect(float.lists).toContain('row-span-3');
    expect(parentOf('figures').className).toBe(float.figures);
    expect(parentOf('positions').className).toBe(float.positions);
    // Flush against the map: no gap or padding around the panes, and each meets the map with a joint.
    expect(float.root).not.toMatch(/(?:^|\s)(?:gap|p)-\d/);
    expect(float.boardPanel).toContain('border-r');
    expect(float.figuresPanel).toContain('border-b');
    expect(float.positionsPanel).toContain('border-t');
  });

  it('below 1536 px the inspector docks under the board, where «Alertas» fold away while it is open', () => {
    render(<ConsoleOverlay layout="float" {...panels} />);
    expect(parentOf('inspector')).toBe(parentOf('board'));
    expect(document.querySelector('[data-occ-console-side]')).toBeNull();
    expect(screen.getByTestId('board').closest('[data-occ-console-panels]')).toHaveAttribute('data-occ-console-wide', 'false');
    expect(CONSOLE_OVERLAY_LAYOUT.float.alertsPanelWithInspector).toContain('max-2xl:hidden');
    expect(CONSOLE_OVERLAY_LAYOUT.float.alertsPanel).not.toContain('hidden');
  });

  it('from 1536 px the inspector takes a column of its own at the right, the place of follow mode\'s flight panel', () => {
    render(<ConsoleOverlay layout="float" wide {...panels} />);
    const side = parentOf('inspector');
    expect(side).toHaveAttribute('data-occ-console-side');
    expect(side.className).toBe(CONSOLE_OVERLAY_LAYOUT.float.side);
    expect(CONSOLE_OVERLAY_LAYOUT.float.root).toContain('2xl:grid-cols-[24rem_minmax(0,1fr)_auto]');
    expect(CONSOLE_OVERLAY_LAYOUT.float.inspectorPanelWide).toContain('border-l');
    // Without a selection the column is not there, and the map keeps its width.
    cleanup();
    render(<ConsoleOverlay layout="float" wide {...panels} inspector={null} />);
    expect(document.querySelector('[data-occ-console-side]')).toBeNull();
  });

  it('in the fallback grid keeps the alerts and the inspector together beside the board', () => {
    render(<ConsoleOverlay layout="grid" wide {...panels} />);
    expect(parentOf('alerts')).toBe(parentOf('inspector'));
    expect(parentOf('board').className).toBe(CONSOLE_OVERLAY_LAYOUT.grid.lists);
  });
});
