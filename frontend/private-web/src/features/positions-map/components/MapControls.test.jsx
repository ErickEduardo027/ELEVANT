import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import MapControls from './MapControls';

afterEach(() => {
  cleanup();
  act(() => resetLanguageForTests('es'));
});

const classesOf = element => element.className.split(/\s+/).filter(Boolean);

function renderControls(props = {}) {
  const handlers = { onToggleViewMode: vi.fn(), onCenterPuj: vi.fn(), onToggleFullscreen: vi.fn() };
  render(<MapControls viewMode="2d" fullscreen={false} {...handlers} {...props} />);
  return handlers;
}

it('is one opaque block with its joint around the three tools, so nothing of the map shows between them (N29)', () => {
  renderControls();
  const buttons = ['Cambiar a vista 3D', 'Centrar PUJ', 'Pantalla completa'].map(name => screen.getByRole('button', { name }));
  // One block holds the three tools, at the top left of the map.
  const [block] = new Set(buttons.map(button => button.parentElement));
  for (const button of buttons) expect(button.parentElement).toBe(block);
  expect(block.children).toHaveLength(3);
  expect(block).toHaveClass('absolute', 'left-3', 'top-3');
  // The opaque panel slab with a 1 px joint around it and between the tools, as the map's own control groups: never
  // the see-through floating panel, and no gap between separate buttons where a label or a «Demo» plate would show.
  expect(block).toHaveClass('bg-occ-panel', 'border', 'border-occ-line', 'divide-y', 'divide-occ-line');
  expect(classesOf(block).filter(name => /panel-float|^gap-|opacity|backdrop/.test(name))).toEqual([]);
  // It clips nothing, so the focus ring the OCC draws 2 px outside a tool stays whole.
  expect(classesOf(block).filter(name => /^overflow-/.test(name))).toEqual([]);
  // The tools are no slabs of their own: no background, joint or radius but the block's, only the hover's tint.
  for (const button of buttons) {
    expect(classesOf(button).filter(name => /^(?:bg-|border|rounded|opacity|shadow)/.test(name)), button.title).toEqual([]);
    expect(button).toHaveClass('hover:bg-occ-panel-raised');
  }
});

it('each tool keeps its name, its title and its action, and 2D/3D says which view is on', async () => {
  const user = userEvent.setup();
  const handlers = renderControls();
  const view = screen.getByRole('button', { name: 'Cambiar a vista 3D' });
  expect(view).toHaveAttribute('aria-pressed', 'false');
  expect(view).toHaveAttribute('title', 'Vista 3D');
  await user.click(view);
  await user.click(screen.getByRole('button', { name: 'Centrar PUJ' }));
  await user.click(screen.getByRole('button', { name: 'Pantalla completa' }));
  expect(handlers.onToggleViewMode).toHaveBeenCalledOnce();
  expect(handlers.onCenterPuj).toHaveBeenCalledOnce();
  expect(handlers.onToggleFullscreen).toHaveBeenCalledOnce();
  cleanup();

  renderControls({ viewMode: '3d', fullscreen: true });
  const threeD = screen.getByRole('button', { name: 'Cambiar a vista 2D' });
  expect(threeD).toHaveAttribute('aria-pressed', 'true');
  expect(threeD).toHaveAttribute('title', 'Vista 2D');
  expect(screen.getByRole('button', { name: 'Salir de pantalla completa' })).toBeInTheDocument();
});
