import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetLanguageForTests } from '../../i18n/languageStore';
import { readSource } from '../../styles/occSourceScan';
import OccFloatingPanel, { OCC_FLOATING_PANEL_LAYOUT, OCC_FLOATING_PANEL_ORIENTATIONS } from './OccFloatingPanel';
import { OCC_PALETTE } from './occPalette';
import { OCC_PANEL_FOLDS_KEY, readPanelFolded, resetPanelFoldsForTests } from './occPanelMemory';
import { createOccShortcutHandler, isOverlayOpen } from './occShortcuts';

afterEach(() => {
  cleanup();
  resetLanguageForTests();
  resetPanelFoldsForTests();
  window.sessionStorage.clear();
});

const classesOf = element => element.className.split(/\s+/).filter(Boolean);
const bodyOf = toggle => document.getElementById(toggle.getAttribute('aria-controls'));
// The classes that set `display` and would override the `hidden` attribute.
const DISPLAY_CLASSES = new Set(['block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'inline-grid', 'table',
  'contents', 'flow-root', 'list-item']);

// A body with a state of its own, like the board's chosen tab.
function Counter() {
  const [count, setCount] = useState(0);
  return <button type="button" onClick={() => setCount(value => value + 1)}>{`Vistas ${count}`}</button>;
}

describe('OccFloatingPanel', () => {
  it('is a region named by its title with one button that says with aria-expanded whether it is open', () => {
    const { rerender } = render(
      <OccFloatingPanel panelId="board" title="Tablero" meta="4 llegadas"
        actions={<button type="button">Importar vuelos</button>}>
        <p>ZZ9001</p>
      </OccFloatingPanel>,
    );
    const region = screen.getByRole('region', { name: 'Tablero' });
    expect(region.tagName).toBe('SECTION');
    // The title is the fold button, inside the heading; the button's name is the title alone.
    const toggle = within(region).getByRole('button', { name: 'Tablero' });
    expect(screen.getByRole('heading', { level: 2, name: 'Tablero' })).toContainElement(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(bodyOf(toggle)).toHaveAttribute('data-occ-panel-body');
    expect(bodyOf(toggle)).toHaveTextContent('ZZ9001');
    expect(toggle.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    // Meta and actions sit next to the button, never inside it.
    expect(toggle).not.toContainElement(screen.getByText('4 llegadas'));
    expect(toggle).not.toContainElement(screen.getByRole('button', { name: 'Importar vuelos' }));
    expect(within(region).getAllByRole('button')).toHaveLength(2);

    rerender(<OccFloatingPanel panelId="board" title="Tablero" headingLevel={3}><p>ZZ9001</p></OccFloatingPanel>);
    expect(screen.getByRole('heading', { level: 3, name: 'Tablero' })).toBeInTheDocument();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<OccFloatingPanel panelId="board" title="Tablero" headingLevel={1} />)).toThrow(RangeError);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('folds to a pill and unfolds again with its own button, keeping focus on that button', async () => {
    const user = userEvent.setup();
    render(<OccFloatingPanel panelId="board" title="Tablero" meta="4 llegadas"><p>ZZ9001</p></OccFloatingPanel>);
    const toggle = screen.getByRole('button', { name: 'Tablero' });
    const region = screen.getByRole('region', { name: 'Tablero' });

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(region).toHaveAttribute('data-folded', 'true');
    expect(toggle).toHaveFocus();
    // The pill keeps its title and its meta; the body is out of sight.
    expect(within(region).getByText('4 llegadas')).toBeVisible();
    expect(screen.getByText('ZZ9001')).not.toBeVisible();

    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('ZZ9001')).toBeVisible();
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // The same button the whole time: focus never had to move.
    expect(screen.getByRole('button', { name: 'Tablero' })).toBe(toggle);
    expect(toggle).toHaveFocus();
  });

  it('keeps the body mounted and hidden while folded, and shows the folded summary only then', async () => {
    const user = userEvent.setup();
    render(
      <OccFloatingPanel panelId="stands" title="Posiciones" foldedSummary="12 escalas, 3 en posición" meta="Hoy"
        actions={<button type="button">Todas</button>} bodyClassName="flex flex-col gap-2">
        <Counter />
      </OccFloatingPanel>,
    );
    const toggle = screen.getByRole('button', { name: 'Posiciones' });
    const body = bodyOf(toggle);
    // Open: the summary is not there; the actions are.
    expect(screen.queryByText('12 escalas, 3 en posición')).not.toBeInTheDocument();
    expect(toggle).not.toHaveAttribute('aria-describedby');
    expect(screen.getByRole('button', { name: 'Todas' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Vistas 0' }));

    await user.click(toggle);
    // Folded: still mounted, with its state, but hidden; no display class can undo `hidden`.
    expect(body).toHaveAttribute('hidden');
    expect(body).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Vistas 1', hidden: true })).toBeInTheDocument();
    expect(classesOf(body).filter(name => DISPLAY_CLASSES.has(name))).toEqual([]);
    expect(classesOf(body.firstElementChild)).toEqual(['flex', 'flex-col', 'gap-2']);
    // The summary shows next to the button, which it describes; actions wait for the panel to open.
    const summary = screen.getByText('12 escalas, 3 en posición');
    expect(toggle.getAttribute('aria-describedby')).toBe(summary.id);
    expect(screen.getByRole('button', { name: 'Posiciones', description: '12 escalas, 3 en posición' })).toBe(toggle);
    expect(toggle).not.toContainElement(summary);
    expect(screen.getByText('Hoy')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Todas' })).not.toBeInTheDocument();

    await user.click(toggle);
    expect(body).not.toHaveAttribute('hidden');
    expect(screen.getByRole('button', { name: 'Vistas 1' })).toBeVisible();
    expect(screen.queryByText('12 escalas, 3 en posición')).not.toBeInTheDocument();
  });

  it('shows its legend on a line of its own at the foot of the header, only while open', async () => {
    const user = userEvent.setup();
    render(
      <OccFloatingPanel panelId="board" title="Tablero" meta="14 nov" actions={<button type="button">Importar vuelos</button>}
        legend={<ul aria-label="Leyenda del tablero"><li>Atención</li></ul>}>
        <p>ZZ9001</p>
      </OccFloatingPanel>,
    );
    const region = screen.getByRole('region', { name: 'Tablero' });
    const toggle = within(region).getByRole('button', { name: 'Tablero' });
    const legend = within(region).getByRole('list', { name: 'Leyenda del tablero' });
    // In the header, after the title, the meta and the actions, on a line of its own; never in the body or the button.
    expect(bodyOf(toggle)).not.toContainElement(legend);
    expect(toggle).not.toContainElement(legend);
    const line = legend.parentElement;
    expect(line).toHaveAttribute('data-occ-panel-legend');
    expect(line.parentElement).toContainElement(toggle);
    expect(line.previousElementSibling).toContainElement(screen.getByRole('button', { name: 'Importar vuelos' }));
    expect(classesOf(line)).toContain('w-full');
    // Folded: nothing of the body is on screen for it to explain.
    await user.click(toggle);
    expect(within(region).queryByRole('list', { name: 'Leyenda del tablero' })).not.toBeInTheDocument();
    await user.click(toggle);
    expect(within(region).getByRole('list', { name: 'Leyenda del tablero' })).toBeVisible();
  });

  it("remembers each panel's fold for the session across a remount, and starts from defaultFolded when nothing is remembered", async () => {
    const user = userEvent.setup();
    const panels = (
      <>
        <OccFloatingPanel panelId="board" title="Tablero"><p>ZZ9001</p></OccFloatingPanel>
        <OccFloatingPanel panelId="alerts" title="Alertas" defaultFolded><p>Sin alertas</p></OccFloatingPanel>
      </>
    );
    const { unmount } = render(panels);
    const board = () => screen.getByRole('button', { name: 'Tablero' });
    const alerts = () => screen.getByRole('button', { name: 'Alertas' });
    // Nothing remembered: each starts from its default.
    expect(board()).toHaveAttribute('aria-expanded', 'true');
    expect(alerts()).toHaveAttribute('aria-expanded', 'false');

    await user.click(board());
    // Folding one panel leaves the other as it was.
    expect(board()).toHaveAttribute('aria-expanded', 'false');
    expect(alerts()).toHaveAttribute('aria-expanded', 'false');
    await user.click(alerts());
    expect(alerts()).toHaveAttribute('aria-expanded', 'true');
    expect(JSON.parse(window.sessionStorage.getItem(OCC_PANEL_FOLDS_KEY))).toEqual({ board: true, alerts: false });

    // Another module and back: the console opens as it was left, whatever the defaults say.
    unmount();
    render(panels);
    expect(board()).toHaveAttribute('aria-expanded', 'false');
    expect(alerts()).toHaveAttribute('aria-expanded', 'true');
  });

  it('can be controlled by the console with folded and onFoldedChange', async () => {
    const user = userEvent.setup();
    const onFoldedChange = vi.fn();
    const { rerender } = render(
      <OccFloatingPanel panelId="inspector" title="Inspector" folded={false} onFoldedChange={onFoldedChange}>
        <p>AA904</p>
      </OccFloatingPanel>,
    );
    const toggle = screen.getByRole('button', { name: 'Inspector' });
    await user.click(toggle);
    // The console owns the fold: the press is reported and nothing changes until the console says so.
    expect(onFoldedChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(readPanelFolded('inspector')).toBeNull();
    expect(window.sessionStorage.getItem(OCC_PANEL_FOLDS_KEY)).toBeNull();
    rerender(
      <OccFloatingPanel panelId="inspector" title="Inspector" folded onFoldedChange={onFoldedChange}>
        <p>AA904</p>
      </OccFloatingPanel>,
    );
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    cleanup();

    function Console() {
      const [folded, setFolded] = useState(true);
      return (
        <>
          <OccFloatingPanel panelId="inspector" title="Inspector" folded={folded} onFoldedChange={setFolded}>
            <p>AA904</p>
          </OccFloatingPanel>
          <button type="button" onClick={() => setFolded(false)}>Ver y seguir</button>
        </>
      );
    }
    render(<Console />);
    expect(screen.getByRole('button', { name: 'Inspector' })).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'Ver y seguir' }));
    expect(screen.getByRole('button', { name: 'Inspector' })).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: 'Inspector' }));
    expect(screen.getByRole('button', { name: 'Inspector' })).toHaveAttribute('aria-expanded', 'false');
    cleanup();

    // Left to itself it still tells the console about every press.
    const heard = vi.fn();
    render(<OccFloatingPanel panelId="board" title="Tablero" onFoldedChange={heard}><p>ZZ9001</p></OccFloatingPanel>);
    await user.click(screen.getByRole('button', { name: 'Tablero' }));
    expect(heard).toHaveBeenCalledExactlyOnceWith(true);
    expect(readPanelFolded('board')).toBe(true);
  });

  it('answers no key and never counts as an open overlay (Esc, D, S, L reach the map untouched; isOverlayOpen stays false)', async () => {
    const user = userEvent.setup();
    const handlers = { clearSelection: vi.fn(), toggle3d: vi.fn(), toggleFollow: vi.fn(), toggleLayers: vi.fn() };
    const onMapKey = createOccShortcutHandler(handlers);
    const reached = [];
    // The map container listens on keydown in the bubble phase, as the console's map does (contratos 2.2).
    render(
      <div data-testid="map" onKeyDown={event => { reached.push([event.key, event.defaultPrevented]); onMapKey(event); }}>
        <OccFloatingPanel panelId="board" title="Tablero"><button type="button">ZZ9001</button></OccFloatingPanel>
      </div>,
    );
    const toggle = screen.getByRole('button', { name: 'Tablero' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(isOverlayOpen(document)).toBe(false);

    act(() => toggle.focus());
    await user.keyboard('{Escape}dsl');
    act(() => screen.getByRole('button', { name: 'ZZ9001' }).focus());
    await user.keyboard('{Escape}');
    // Every key arrived at the map, not yet handled by anyone, and the map ran its action.
    expect(reached).toEqual([['Escape', false], ['d', false], ['s', false], ['l', false], ['Escape', false]]);
    expect(handlers.clearSelection).toHaveBeenCalledTimes(2);
    expect(handlers.toggle3d).toHaveBeenCalledOnce();
    expect(handlers.toggleFollow).toHaveBeenCalledOnce();
    expect(handlers.toggleLayers).toHaveBeenCalledOnce();
    // Esc is the map's: it never folds the panel, and the panel is still no overlay.
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(isOverlayOpen(document)).toBe(false);
  });

  it('is flat on --occ-panel-float with the 8 px overlay radius and no shadow or blur; the grid layout uses the panel slab', () => {
    expect(Object.keys(OCC_FLOATING_PANEL_LAYOUT)).toEqual(['float', 'grid', 'dock']);
    // Docked flush against the map (CN-32): the opaque panel slab, the console draws the joint on the map's side.
    expect(OCC_FLOATING_PANEL_LAYOUT.dock.split(' ')).toEqual(['bg-occ-panel', 'text-occ-text']);
    const float = OCC_FLOATING_PANEL_LAYOUT.float.split(' ');
    expect(float).toEqual(expect.arrayContaining(['border', 'border-occ-line', 'bg-occ-panel-float',
      'rounded-[var(--occ-radius-overlay)]', 'text-occ-text']));
    expect(OCC_FLOATING_PANEL_LAYOUT.grid.split(' ')).toEqual(['border', 'border-occ-line', 'bg-occ-panel', 'rounded-md']);
    for (const layout of Object.values(OCC_FLOATING_PANEL_LAYOUT)) {
      expect(layout).not.toMatch(/shadow|blur|backdrop|gradient|opacity|\/\d/);
    }
    // Near-opaque, so it reads the same over any part of the map; the overlay radius token is 8 px.
    const [, alpha] = /\/\s*([\d.]+)\)$/.exec(OCC_PALETTE['--occ-panel-float']);
    expect(Number(alpha)).toBeGreaterThanOrEqual(0.9);
    expect(readSource('src/styles/occ.css')).toMatch(/--occ-radius-overlay:\s*8px;/);

    const { rerender } = render(<OccFloatingPanel panelId="board" title="Tablero"><p>ZZ9001</p></OccFloatingPanel>);
    const region = screen.getByRole('region', { name: 'Tablero' });
    expect(region).toHaveAttribute('data-layout', 'float');
    expect(classesOf(region)).toEqual(expect.arrayContaining(float));
    expect(region).not.toHaveAttribute('style');
    rerender(<OccFloatingPanel panelId="board" title="Tablero" layout="grid"><p>ZZ9001</p></OccFloatingPanel>);
    expect(region).toHaveAttribute('data-layout', 'grid');
    expect(classesOf(region)).toEqual(expect.arrayContaining(['bg-occ-panel', 'rounded-md']));
    expect(classesOf(region)).not.toContain('bg-occ-panel-float');

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<OccFloatingPanel panelId="board" title="Tablero" layout="glass" />)).toThrow(RangeError);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('forwards ref, className and data-testid and marks data-occ-floating-panel and data-folded for the console to measure', async () => {
    const user = userEvent.setup();
    const ref = createRef();
    render(
      <OccFloatingPanel ref={ref} panelId="stands" title="Posiciones" className="absolute inset-x-3 bottom-3"
        data-testid="stands-panel">
        <p>A5</p>
      </OccFloatingPanel>,
    );
    const region = screen.getByRole('region', { name: 'Posiciones' });
    expect(ref.current).toBe(region);
    expect(region).toHaveAttribute('data-testid', 'stands-panel');
    expect(region).toHaveAttribute('data-occ-floating-panel', 'stands');
    expect(region).toHaveAttribute('data-folded', 'false');
    expect(classesOf(region).slice(-3)).toEqual(['absolute', 'inset-x-3', 'bottom-3']);
    await user.click(screen.getByRole('button', { name: 'Posiciones' }));
    expect(region).toHaveAttribute('data-folded', 'true');
    // The console finds every panel by its id, folded or not.
    expect(document.querySelector('[data-occ-floating-panel="stands"]')).toBe(region);

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<OccFloatingPanel title="Sin id" />)).toThrow(TypeError);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('lays its header beside its body in a row, for a strip of figures along the map (CN-32)', () => {
    expect(Object.keys(OCC_FLOATING_PANEL_ORIENTATIONS)).toEqual(['column', 'row']);
    render(<OccFloatingPanel panelId="figures" title="Cifras de la jornada" layout="dock" orientation="row"><p>5</p></OccFloatingPanel>);
    const region = screen.getByRole('region', { name: 'Cifras de la jornada' });
    expect(region).toHaveAttribute('data-orientation', 'row');
    expect(region).toHaveAttribute('data-layout', 'dock');
    expect(classesOf(region)).toEqual(expect.arrayContaining(['flex-row', 'bg-occ-panel']));
    // The joint between the header and the body is vertical, at the header's right.
    const header = region.firstElementChild;
    expect(classesOf(header)).toEqual(expect.arrayContaining(['border-r', 'shrink-0']));
    expect(classesOf(header)).not.toContain('border-b');
    expect(classesOf(region.querySelector('[data-occ-panel-body]'))).toEqual(expect.arrayContaining(['min-w-0', 'flex-1']));
  });

  it('shows a shorter word on a narrow screen and keeps the title as the name of the button (CN-32)', () => {
    render(<OccFloatingPanel panelId="figures" title="Cifras de la jornada" shortTitle="Cifras"><p>5</p></OccFloatingPanel>);
    const toggle = screen.getByRole('button', { name: 'Cifras de la jornada' });
    expect(screen.getByRole('region', { name: 'Cifras de la jornada' })).toBeInTheDocument();
    const [full, short] = toggle.querySelectorAll('span');
    expect(full).toHaveTextContent('Cifras de la jornada');
    expect(classesOf(full)).toContain('max-[1399.98px]:sr-only');
    expect(short).toHaveTextContent(/^Cifras$/);
    expect(short).toHaveAttribute('aria-hidden', 'true');
    expect(classesOf(short)).toContain('min-[1400px]:hidden');
  });

  it('throws on an unknown orientation', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<OccFloatingPanel panelId="x" title="X" orientation="diagonal" />)).toThrow(RangeError);
    } finally {
      consoleError.mockRestore();
    }
  });
});
