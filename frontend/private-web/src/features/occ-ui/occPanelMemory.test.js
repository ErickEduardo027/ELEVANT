import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OCC_PANEL_FOLDS_KEY, readPanelFolded, resetPanelFoldsForTests, subscribePanelFolds, writePanelFolded,
} from './occPanelMemory';

afterEach(() => {
  vi.restoreAllMocks();
  resetPanelFoldsForTests();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

const stored = () => JSON.parse(window.sessionStorage.getItem(OCC_PANEL_FOLDS_KEY));

describe('occPanelMemory', () => {
  it('remembers the folded state of each panel in the tab session and never throws without storage', () => {
    expect(OCC_PANEL_FOLDS_KEY).toBe('elevant-occ-panel-folds');
    // Nothing remembered yet: the panel uses its default.
    expect(readPanelFolded('board')).toBeNull();
    writePanelFolded('board', true);
    writePanelFolded('stands', false);
    expect(readPanelFolded('board')).toBe(true);
    expect(readPanelFolded('stands')).toBe(false);
    expect(readPanelFolded('alerts')).toBeNull();
    // One JSON object in this tab's sessionStorage; nothing in localStorage.
    expect(stored()).toEqual({ board: true, stands: false });
    expect(window.localStorage.getItem(OCC_PANEL_FOLDS_KEY)).toBeNull();
    writePanelFolded('board', false);
    expect(stored()).toEqual({ board: false, stands: false });
    // A storage given by the caller is used instead.
    const store = new Map();
    const injected = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
    writePanelFolded('inspector', true, injected);
    expect(JSON.parse(store.get(OCC_PANEL_FOLDS_KEY))).toEqual({ inspector: true });
    expect(readPanelFolded('inspector', injected)).toBe(true);

    resetPanelFoldsForTests();
    // No storage at all: the fold still holds for this page, and starts from the default on the next load.
    expect(() => writePanelFolded('board', true, null)).not.toThrow();
    expect(readPanelFolded('board', null)).toBe(true);
    resetPanelFoldsForTests();
    expect(readPanelFolded('board', null)).toBeNull();

    // A storage that refuses every call (quota, private mode).
    const refusing = {
      getItem: vi.fn(() => { throw new DOMException('Denied', 'SecurityError'); }),
      setItem: vi.fn(() => { throw new DOMException('Full', 'QuotaExceededError'); }),
      removeItem: vi.fn(() => { throw new DOMException('Denied', 'SecurityError'); }),
    };
    expect(() => writePanelFolded('alerts', true, refusing)).not.toThrow();
    expect(readPanelFolded('alerts', refusing)).toBe(true);
    // A storage that takes reads but no writes.
    const full = { getItem: () => null, setItem: vi.fn(() => { throw new DOMException('Full', 'QuotaExceededError'); }) };
    expect(() => writePanelFolded('stands', true, full)).not.toThrow();
    expect(full.setItem).toHaveBeenCalledWith(OCC_PANEL_FOLDS_KEY, JSON.stringify({ stands: true }));

    // A browser that throws on the sessionStorage property itself (storage blocked).
    const blocked = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    expect(() => writePanelFolded('board', false)).not.toThrow();
    expect(readPanelFolded('board')).toBe(false);
    expect(() => resetPanelFoldsForTests()).not.toThrow();
    expect(blocked).toHaveBeenCalled();
  });

  it('tells the panels of the page about every fold, reads a damaged value as nothing, and ignores a panel without id', () => {
    const listener = vi.fn();
    const stop = subscribePanelFolds(listener);
    writePanelFolded('board', true);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    writePanelFolded('board', false);
    expect(listener).toHaveBeenCalledTimes(1);

    // A damaged value reads as nothing remembered, and the next fold replaces it.
    resetPanelFoldsForTests();
    for (const damaged of ['{nope', '[true]', 'null', '7', JSON.stringify({ board: 'yes', stands: true })]) {
      window.sessionStorage.setItem(OCC_PANEL_FOLDS_KEY, damaged);
      expect(readPanelFolded('board'), damaged).toBeNull();
    }
    expect(readPanelFolded('stands')).toBe(true);
    window.sessionStorage.setItem(OCC_PANEL_FOLDS_KEY, '{nope');
    writePanelFolded('board', true);
    expect(stored()).toEqual({ board: true });

    // A panel needs an id to remember anything.
    for (const panelId of [undefined, null, '', 42]) {
      expect(() => writePanelFolded(panelId, true)).not.toThrow();
      expect(readPanelFolded(panelId)).toBeNull();
    }
    expect(stored()).toEqual({ board: true });
  });
});
