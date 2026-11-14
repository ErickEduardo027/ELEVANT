'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { CONSOLE_PANEL_EDGES, insetsFromPanels, sameInsets } from './consoleInsets';

const ZERO = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

// The browser's ResizeObserver, or null (jsdom has none: the tests pass one of their own).
const browserObserver = () => (typeof globalThis.ResizeObserver === 'function' ? globalThis.ResizeObserver : null);

/**
 * The map insets of the console (contratos 2.5): what its open floating panels and its folded pills cover of the map.
 * - `rootRef` goes on the box the map fills; `measure(panelId)` gives the ref of a floating panel (one stable callback
 *   per panel), whose edge comes from `edges` (CONSOLE_PANEL_EDGES by default) and whose fold from its `data-folded`.
 * - A ResizeObserver watches the box and every panel, so a fold, a panel that grows and a window that changes size
 *   are measured again; the insets are measured after every render too, so a panel that comes or goes counts at once.
 *   Without a ResizeObserver (`ResizeObserverImpl` null) only the renders measure.
 * - `enabled: false` (the grid of the fallback, the maximised map) measures nothing: the insets are 0.
 * Returns `{ insets, rootRef, measure }`; `insets` keeps its identity while it measures the same.
 */
export function useConsoleInsets({ edges = CONSOLE_PANEL_EDGES, enabled = true, ResizeObserverImpl = browserObserver() }
  = {}) {
  const [insets, setInsets] = useState(ZERO);
  const root = useRef(null);
  const panels = useRef(new Map());
  const refs = useRef(new Map());
  const observer = useRef(null);
  const latest = useRef({ edges, enabled });
  useLayoutEffect(() => { latest.current = { edges, enabled }; });

  const recompute = useCallback(() => {
    const { edges: sides, enabled: on } = latest.current;
    const box = root.current;
    const next = !on || !box ? ZERO : insetsFromPanels(box.getBoundingClientRect(), [...panels.current]
      .map(([panelId, element]) => ({
        side: sides[panelId], rect: element.getBoundingClientRect(), folded: element.dataset.folded === 'true',
      })));
    setInsets(current => (sameInsets(current, next) ? current : next));
  }, []);

  // One observer for the life of the console, created on first use.
  const observe = useCallback(element => {
    if (!element || !ResizeObserverImpl) return;
    observer.current ??= new ResizeObserverImpl(() => recompute());
    observer.current.observe(element);
  }, [ResizeObserverImpl, recompute]);
  const unobserve = useCallback(element => {
    if (element) observer.current?.unobserve(element);
  }, []);

  const rootRef = useCallback(element => {
    unobserve(root.current);
    root.current = element;
    observe(element);
  }, [observe, unobserve]);

  const measure = useCallback(panelId => {
    if (!refs.current.has(panelId)) {
      refs.current.set(panelId, element => {
        const previous = panels.current.get(panelId);
        if (previous && previous !== element) {
          unobserve(previous);
          panels.current.delete(panelId);
        }
        if (element) {
          panels.current.set(panelId, element);
          observe(element);
        }
      });
    }
    return refs.current.get(panelId);
  }, [observe, unobserve]);

  // After every render: a panel that came or went (the inspector, the maximised map) changes the insets at once.
  useLayoutEffect(() => { recompute(); });

  useLayoutEffect(() => () => {
    observer.current?.disconnect();
    observer.current = null;
  }, []);

  return { insets: enabled ? insets : ZERO, rootRef, measure };
}
