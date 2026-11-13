import { createElement } from 'react';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Drawer from '../../components/Drawer';
import {
  OCC_SHORTCUTS, createOccShortcutHandler, isEditableTarget, isOverlayOpen, matchOccShortcut,
} from './occShortcuts';

const mounted = [];

function mount(element) {
  document.body.append(element);
  mounted.push(element);
  return element;
}

function fromHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild;
}

// A map container with the handler on its `keydown`, as the maps attach it, and a button inside it to press keys on.
function setupMap(handlers, options) {
  const container = mount(document.createElement('div'));
  const button = container.appendChild(document.createElement('button'));
  const handle = createOccShortcutHandler(handlers, options);
  const results = [];
  container.addEventListener('keydown', event => { results.push(handle(event)); });

  function press(key, init = {}, target = button) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  return { container, button, press, results };
}

afterEach(() => {
  mounted.splice(0).forEach(element => element.remove());
});

describe('OCC shortcut table', () => {
  it('lists exactly the eight keys of the contracts page', () => {
    expect(OCC_SHORTCUTS.map(({ key, action, es, en }) => [key, action, es, en])).toEqual([
      ['1', 'view.region', 'Región', 'Region'],
      ['2', 'view.approach', 'Aproximación', 'Approach'],
      ['3', 'view.airfield', 'Aeródromo', 'Airfield'],
      ['4', 'view.ramp', 'Rampa', 'Ramp'],
      ['d', 'toggle3d', '2D/3D', '2D/3D'],
      ['s', 'toggleFollow', 'Seguir', 'Follow'],
      ['l', 'toggleLayers', 'Capas', 'Layers'],
      ['Escape', 'clearSelection', 'Limpiar', 'Clear'],
    ]);
    expect(new Set(OCC_SHORTCUTS.map(row => row.action)).size).toBe(8);
    expect(Object.isFrozen(OCC_SHORTCUTS) && OCC_SHORTCUTS.every(Object.isFrozen)).toBe(true);
  });

  it('matches event.key without regard to case', () => {
    expect(matchOccShortcut({ key: 'd' })).toBe('toggle3d');
    expect(matchOccShortcut({ key: 'D' })).toBe('toggle3d');
    expect(matchOccShortcut({ key: 'S' })).toBe('toggleFollow');
    expect(matchOccShortcut({ key: 'L' })).toBe('toggleLayers');
    expect(matchOccShortcut({ key: '4' })).toBe('view.ramp');
    expect(matchOccShortcut({ key: 'Escape' })).toBe('clearSelection');
    expect(matchOccShortcut({ key: 'escape' })).toBe('clearSelection');

    for (const key of ['x', '5', '0', 'Enter', ' ', 'Dead', 'dd']) expect(matchOccShortcut({ key }), key).toBeNull();
    // Only `event.key` counts: the physical key and the legacy code are not read.
    expect(matchOccShortcut({ code: 'KeyD', keyCode: 68 })).toBeNull();
    expect(matchOccShortcut(null)).toBeNull();
  });
});

describe('OCC shortcut handler', () => {
  it('runs the handler of the key and prevents the default', () => {
    const handlers = Object.fromEntries(OCC_SHORTCUTS.map(row => [row.action, vi.fn()]));
    const { press, results } = setupMap(handlers);

    for (const row of OCC_SHORTCUTS) {
      const event = press(row.key);
      expect(handlers[row.action], row.key).toHaveBeenCalledTimes(1);
      expect(handlers[row.action]).toHaveBeenCalledWith();
      expect(event.defaultPrevented, row.key).toBe(true);
    }
    expect(results).toEqual(OCC_SHORTCUTS.map(() => true));

    // Caps Lock or Shift change the letter, not the action.
    expect(press('D', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(handlers.toggle3d).toHaveBeenCalledTimes(2);
  });

  it('does nothing for a key outside the table or without a handler', () => {
    const toggle3d = vi.fn();
    const { press, results } = setupMap({ toggle3d });

    // Not in the table, and in the table but this map gave no handler for it: both keep their default.
    expect(press('x').defaultPrevented).toBe(false);
    expect(press('l').defaultPrevented).toBe(false);
    expect(press('Escape').defaultPrevented).toBe(false);
    expect(results).toEqual([false, false, false]);
    expect(toggle3d).not.toHaveBeenCalled();

    const bare = setupMap(undefined);
    expect(bare.press('d').defaultPrevented).toBe(false);
    expect(bare.results).toEqual([false]);
  });

  it('ignores keys typed in inputs, textareas, selects and contenteditable elements', () => {
    const toggle3d = vi.fn();
    const { container, button, press, results } = setupMap({ toggle3d });
    const fields = [
      '<input type="text">', '<input type="search">', '<textarea></textarea>', '<select><option>A</option></select>',
      '<div contenteditable="true"></div>', '<div contenteditable=""><span></span></div>',
    ].map(html => container.appendChild(fromHtml(html)));

    for (const field of fields) {
      const target = field.firstElementChild?.tagName === 'SPAN' ? field.firstElementChild : field;
      expect(isEditableTarget(target), field.outerHTML).toBe(true);
      expect(press('d', {}, target).defaultPrevented, field.outerHTML).toBe(false);
    }
    expect(toggle3d).not.toHaveBeenCalled();
    expect(results).toEqual(fields.map(() => false));

    // A browser reports the editable state itself (it also covers `designMode`).
    const reported = Object.defineProperty(document.createElement('div'), 'isContentEditable', { value: true });
    expect(isEditableTarget(reported)).toBe(true);

    // Anything else takes the key, an island that opts out of an editable region included.
    const region = '<div contenteditable="true"><span contenteditable="false"><b></b></span></div>';
    expect(isEditableTarget(container.appendChild(fromHtml(region)).querySelector('b'))).toBe(false);
    expect(isEditableTarget(button)).toBe(false);
    expect(isEditableTarget(container)).toBe(false);
    expect(isEditableTarget(document)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    press('d');
    expect(toggle3d).toHaveBeenCalledTimes(1);
  });

  it('ignores Ctrl and Meta combinations', () => {
    const handlers = { toggle3d: vi.fn(), toggleFollow: vi.fn(), 'view.region': vi.fn() };
    const { press, results } = setupMap(handlers);

    expect(press('d', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press('s', { metaKey: true }).defaultPrevented).toBe(false);
    expect(press('1', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press('S', { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);

    expect(results).toEqual([false, false, false, false]);
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
  });

  it('ignores Alt combinations, which belong to the browser, and a key that repeats while held', () => {
    const toggle3d = vi.fn();
    const { press, results } = setupMap({ toggle3d });

    expect(press('d', { altKey: true }).defaultPrevented).toBe(false);
    expect(toggle3d).not.toHaveBeenCalled();

    expect(press('d').defaultPrevented).toBe(true);
    expect(press('d', { repeat: true }).defaultPrevented).toBe(false);
    expect(press('d', { repeat: true }).defaultPrevented).toBe(false);
    expect(toggle3d).toHaveBeenCalledTimes(1);
    expect(results).toEqual([false, true, false, false]);
  });

  it('ignores events that another handler already prevented', () => {
    const clearSelection = vi.fn();
    const { button, press, results } = setupMap({ clearSelection });
    // For example a menu inside the map that closes itself on Escape.
    button.addEventListener('keydown', event => event.preventDefault());

    press('Escape');

    expect(clearSelection).not.toHaveBeenCalled();
    expect(results).toEqual([false]);
  });

  it('does nothing while a modal dialog is open', () => {
    const clearSelection = vi.fn();
    const { press, results } = setupMap({ clearSelection });

    for (const role of ['dialog', 'alertdialog']) {
      const dialog = mount(fromHtml(`<div role="${role}" aria-modal="true"></div>`));
      expect(isOverlayOpen(), role).toBe(true);
      expect(press('Escape').defaultPrevented, role).toBe(false);
      dialog.remove();
    }
    expect(clearSelection).not.toHaveBeenCalled();
    expect(results).toEqual([false, false]);

    // A popover that is not modal does not hold the keys back.
    mount(fromHtml('<div role="dialog"></div>'));
    expect(isOverlayOpen()).toBe(false);
    expect(press('Escape').defaultPrevented).toBe(true);
    expect(clearSelection).toHaveBeenCalledTimes(1);
  });

  it('looks for dialogs in the document it is given', () => {
    const toggle3d = vi.fn();
    const other = document.implementation.createHTMLDocument('');
    other.body.innerHTML = '<div role="dialog" aria-modal="true"></div>';
    const { press } = setupMap({ toggle3d }, { document: other });

    press('d');

    expect(isOverlayOpen(other)).toBe(true);
    expect(isOverlayOpen()).toBe(false);
    expect(toggle3d).not.toHaveBeenCalled();
  });

  it('ignores a closed drawer that stays mounted inert', () => {
    const clearSelection = vi.fn();
    const { press } = setupMap({ clearSelection });
    const drawer = open => createElement(Drawer, { open, onClose: () => {}, title: 'Detalle de la posición' });

    // The shared drawer keeps its dialog in the page while closed, to animate its exit.
    const { rerender } = render(drawer(false));
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
    expect(isOverlayOpen()).toBe(false);
    expect(press('Escape').defaultPrevented).toBe(true);
    expect(clearSelection).toHaveBeenCalledTimes(1);

    rerender(drawer(true));
    expect(isOverlayOpen()).toBe(true);
    // The open drawer uses the key to close itself (contracts 2.2: one Esc closes the drawer, the next one clears the
    // selection), so the key arrives used; the map stands still and keeps its selection.
    expect(press('Escape').defaultPrevented).toBe(true);
    expect(clearSelection).toHaveBeenCalledTimes(1);

    // The two marks of a closed drawer, each on its own.
    rerender(drawer(false));
    mount(fromHtml('<aside inert role="dialog" aria-modal="true"></aside>'));
    mount(fromHtml('<div aria-hidden="true"><aside role="dialog" aria-modal="true"></aside></div>'));
    expect(isOverlayOpen()).toBe(false);
  });

  it('does nothing while the caller reports an open drawer', () => {
    const toggleFollow = vi.fn();
    let drawerOpen = true;
    const { press, results } = setupMap({ toggleFollow }, { isBlocked: () => drawerOpen });

    expect(press('s').defaultPrevented).toBe(false);
    expect(toggleFollow).not.toHaveBeenCalled();

    drawerOpen = false;
    expect(press('s').defaultPrevented).toBe(true);
    expect(toggleFollow).toHaveBeenCalledTimes(1);
    expect(results).toEqual([false, true]);
  });
});
