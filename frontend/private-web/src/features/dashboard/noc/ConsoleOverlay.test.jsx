import { cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { readSource } from '../../../styles/occSourceScan';
import { OCC_FLOATING_PANEL_LAYOUT } from '../../occ-ui/OccFloatingPanel';
import ConsoleOverlay, { CONSOLE_OVERLAY_LAYOUT, CONSOLE_PANEL_EDGES } from './ConsoleOverlay';

afterEach(cleanup);

const panels = Object.freeze({
  board: <section data-testid="board" />, figures: <section data-testid="figures" />,
  alerts: <section data-testid="alerts" />, inspector: <section data-testid="inspector" />,
  positions: <section data-testid="positions" />,
});
const status = <p data-testid="status-line">Aviones: Red ADS-B de prueba, hace 3 s.</p>;
const parentOf = id => screen.getByTestId(id).parentElement;
const classesOf = className => className.split(/\s+/).filter(Boolean);
// The panels' own classes over the map, each placed by its slot.
const FLOAT_PANEL_CLASSES = Object.freeze(['boardPanel', 'figuresPanel', 'alertsPanel', 'alertsPanelWithInspector',
  'inspectorPanel', 'inspectorPanelWide', 'weatherPanel', 'positionsPanel']);

// What occ-map.css declares on the map, comments left out.
const MAP_CSS = readSource('src/styles/occ-map.css').replace(/\/\*[\s\S]*?\*\//g, '');
const ruleOf = selector => new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(MAP_CSS)?.[1] ?? '';
const zIndexOf = selector => Number(/z-index:\s*(\d+)/.exec(ruleOf(selector))?.[1]);
// The layer a class string gives, from its `z-N` or `z-[N]`.
const zOf = className => Number(/(?:^|\s)z-\[?(\d+)\]?(?:\s|$)/.exec(className)?.[1]);

describe('ConsoleOverlay (M1, «pantalla completa con paneles flotantes»)', () => {
  it('floats the lists at the left, the figures along the top and the band along the bottom, 12 px from the map and from each other', () => {
    render(<ConsoleOverlay layout="float" status={status} {...panels} />);
    const { float } = CONSOLE_OVERLAY_LAYOUT;
    // «Tablero» over «Alertas» in the left column, which runs the whole height of the panels.
    expect(parentOf('board')).toBe(parentOf('alerts'));
    expect(parentOf('board').className).toBe(float.lists);
    expect(float.lists).toContain('row-span-3');
    expect(parentOf('figures').className).toBe(float.figures);
    expect(parentOf('positions').className).toBe(float.positions);
    // 12 px (the map's --occ-map-gap) around the stage and between the panels, the column's two lists included.
    expect(declared('--occ-map-gap')).toBe('12px');
    expect(classesOf(float.root)).toEqual(expect.arrayContaining(['absolute', 'inset-0', 'p-3', 'gap-3']));
    expect(classesOf(float.panels)).toContain('gap-3');
    expect(classesOf(float.lists)).toContain('gap-3');
    // Each panel floats on its own slab (OccFloatingPanel's `float`): no joint and no corner of a docked pane.
    for (const key of FLOAT_PANEL_CLASSES) {
      expect(float[key], key).not.toMatch(/(?:^|[\s:])(?:border|rounded)(?:-|\s|$)/);
      expect(float[key], key).toContain('pointer-events-auto');
    }
    // Folded, a panel shrinks to its pill; «Alertas» keep to the foot of the column, so two pills never pile up at the
    // top of the map.
    expect(float.boardPanel).toContain('data-[folded=true]:self-start');
    expect(float.figuresPanel).toContain('data-[folded=true]:w-auto');
    expect(classesOf(float.alertsPanel)).toContain('mt-auto');
    expect(classesOf(float.alertsPanelWithInspector)).toContain('mt-auto');
  });

  it('keeps every panel out of the reserve of the control column at the right edge of the map', () => {
    const { float } = CONSOLE_OVERLAY_LAYOUT;
    // The stage ends where the reserve starts (occ-map.css: the rail, its gap from the edge and 12 px to a panel), so
    // the inspector floats 12 px left of the rail and the strips along the top and the bottom stop as short of it.
    expect(classesOf(float.root)).toContain('pr-[var(--occ-map-rail-reserve)]');
    expect(declared('--occ-map-rail-reserve')).toBe('calc(var(--occ-map-rail) + 2 * var(--occ-map-gap))');
    // The stage takes no pointer and makes no layer: the panels sit under the cards of the map (z-20, «Seguir en 3D»),
    // the status bar over them, and the control column with its menus over everything (z-30).
    expect(float.root).toContain('pointer-events-none');
    expect(float.root).not.toMatch(/(?:^|\s)z-/);
    expect(classesOf(float.panels)).toContain('relative');
    expect(classesOf(float.status)).toContain('relative');
    const follow = zIndexOf('.occ-map .occ-map-follow-panel');
    const dock = zIndexOf('.occ-map .occ-map-dock');
    expect([zOf(float.panels), follow, zOf(float.status), dock]).toEqual([10, 20, 25, 30]);
  });

  it('below 1536 px the inspector goes under the board, where «Alertas» fold away while it is open', () => {
    render(<ConsoleOverlay layout="float" {...panels} />);
    expect(parentOf('inspector')).toBe(parentOf('board'));
    expect(document.querySelector('[data-occ-console-side]')).toBeNull();
    expect(screen.getByTestId('board').closest('[data-occ-console-panels]')).toHaveAttribute('data-occ-console-wide', 'false');
    expect(CONSOLE_OVERLAY_LAYOUT.float.alertsPanelWithInspector).toContain('max-2xl:hidden');
    expect(CONSOLE_OVERLAY_LAYOUT.float.alertsPanel).not.toContain('hidden');
  });

  it('from 1536 px the inspector floats in a column of its own at the right, the slot of «Seguir en 3D»', () => {
    render(<ConsoleOverlay layout="float" wide {...panels} />);
    const side = parentOf('inspector');
    expect(side).toHaveAttribute('data-occ-console-side');
    expect(side.className).toBe(CONSOLE_OVERLAY_LAYOUT.float.side);
    // The right column is there at every width, and empty (no width) while nothing floats in it.
    expect(CONSOLE_OVERLAY_LAYOUT.float.panels).toContain('grid-cols-[24rem_minmax(0,1fr)_auto]');
    expect(CONSOLE_OVERLAY_LAYOUT.float.figures).toContain('col-span-2');
    expect(CONSOLE_OVERLAY_LAYOUT.float.positions).toContain('col-span-2');
    // Folded, its pill keeps to the right of its column, next to the control column.
    expect(CONSOLE_OVERLAY_LAYOUT.float.inspectorPanelWide).toContain('data-[folded=true]:self-end');
    // Without a selection the column is not there, and the map keeps its width.
    cleanup();
    render(<ConsoleOverlay layout="float" wide {...panels} inspector={null} />);
    expect(document.querySelector('[data-occ-console-side]')).toBeNull();
  });

  it('floats «Meteorología PUJ» at the foot of the right column, under the inspector, at every width (M1 with M7)', () => {
    const weather = <section data-testid="weather" />;
    const { float } = CONSOLE_OVERLAY_LAYOUT;
    // Wide, with the inspector: one column at the right, the inspector over the weather.
    render(<ConsoleOverlay layout="float" wide weather={weather} {...panels} />);
    const side = parentOf('weather');
    expect(side).toHaveAttribute('data-occ-console-side');
    expect(side.className).toBe(float.side);
    expect([...side.children].map(child => child.dataset.testid)).toEqual(['inspector', 'weather']);
    // Below 1536 px the inspector goes to the left column, and the weather keeps its place at the right.
    cleanup();
    render(<ConsoleOverlay layout="float" weather={weather} {...panels} />);
    expect(parentOf('inspector')).toBe(parentOf('board'));
    expect(parentOf('weather')).toHaveAttribute('data-occ-console-side');
    expect([...parentOf('weather').children].map(child => child.dataset.testid)).toEqual(['weather']);
    // At the foot of the column, open or folded (its pill at the right, next to the control column), and never taller
    // than half of it, so the inspector over it keeps its room.
    expect(classesOf(float.weatherPanel)).toEqual(expect.arrayContaining(['mt-auto', 'max-h-[50%]', 'min-h-0']));
    expect(float.weatherPanel).toContain('data-[folded=true]:self-end');
    // It takes room from the side it sits at, like the inspector.
    expect(CONSOLE_PANEL_EDGES.weather).toBe('side');
    // Hidden with the panels on the maximised map.
    cleanup();
    render(<ConsoleOverlay layout="float" showPanels={false} weather={weather} status={status} {...panels} />);
    expect(screen.queryByTestId('weather')).toBeNull();
  });

  it('floats the status bar at the foot of the map, and keeps it there while the panels hide (focus=map)', () => {
    const ref = createRef();
    render(<ConsoleOverlay layout="float" status={status} statusRef={ref} {...panels} />);
    const bar = document.querySelector('[data-occ-console-status]');
    const root = document.querySelector('[data-occ-console-panels="float"]');
    // Its own part of the stage, after the panels, pushed to the foot; the map measures it through `statusRef`.
    expect(bar.parentElement).toBe(root);
    expect(root.lastElementChild).toBe(bar);
    expect(bar).toContainElement(screen.getByTestId('status-line'));
    expect(ref.current).toBe(bar);
    expect(bar.className).toBe(CONSOLE_OVERLAY_LAYOUT.float.status);
    expect(classesOf(bar.className)).toEqual(expect.arrayContaining(['pointer-events-auto', 'mt-auto',
      ...classesOf(OCC_FLOATING_PANEL_LAYOUT.float)]));
    expect(bar.className).not.toMatch(/shadow|blur|backdrop|gradient/);
    // It takes its height from the bottom edge, as the band does.
    expect(CONSOLE_PANEL_EDGES.status).toBe('bottom');

    // `focus=map`: the panels go, the status bar stays.
    cleanup();
    render(<ConsoleOverlay layout="float" showPanels={false} status={status} {...panels} />);
    expect(screen.queryByTestId('board')).toBeNull();
    expect(screen.queryByTestId('positions')).toBeNull();
    expect(document.querySelector('[data-occ-console-grid]')).toBeNull();
    expect(document.querySelector('[data-occ-console-status]')).toContainElement(screen.getByTestId('status-line'));
    // Nothing to say, no bar.
    cleanup();
    render(<ConsoleOverlay layout="float" {...panels} />);
    expect(document.querySelector('[data-occ-console-status]')).toBeNull();
  });

  it('in the fallback grid keeps the alerts and the inspector together beside the board, and closes with the status bar', () => {
    render(<ConsoleOverlay layout="grid" wide status={status} {...panels} />);
    expect(parentOf('alerts')).toBe(parentOf('inspector'));
    expect(parentOf('board').className).toBe(CONSOLE_OVERLAY_LAYOUT.grid.lists);
    const bar = document.querySelector('[data-occ-console-status]');
    expect(bar.parentElement).toHaveAttribute('data-occ-console-panels', 'grid');
    expect(bar.className).toBe(CONSOLE_OVERLAY_LAYOUT.grid.status);
    expect(classesOf(bar.className)).toEqual(expect.arrayContaining(['order-5', 'lg:col-span-2',
      ...classesOf(OCC_FLOATING_PANEL_LAYOUT.grid)]));
  });

  it('names the edge of the map each of its panels takes room from (maps/ui/stageInsets.js)', () => {
    // The panels of the columns take room from the side they sit at (CN-32); the figures, the band and the status bar
    // from theirs, and «Mostrar paneles» over the maximised map from the top (M1).
    expect(CONSOLE_PANEL_EDGES).toEqual({ board: 'side', figures: 'top', alerts: 'side', inspector: 'side',
      weather: 'side', positions: 'bottom', status: 'bottom', showPanels: 'top' });
    expect(Object.isFrozen(CONSOLE_PANEL_EDGES)).toBe(true);
  });
});

function declared(name) {
  return new RegExp(`(?:^|[\\s;{])${name}:\\s*([^;]+);`).exec(MAP_CSS)?.[1].trim() ?? null;
}
