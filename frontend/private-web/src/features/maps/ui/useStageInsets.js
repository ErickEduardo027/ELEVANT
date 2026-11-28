'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { insetsFromPanels, sameInsets } from './stageInsets';

const ZERO = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const NOTHING_MEASURED = Object.freeze({ insets: ZERO, width: 0, height: 0 });
const NO_EDGES = Object.freeze({});

// The browser's ResizeObserver, or null (jsdom has none: the tests pass one of their own).
const browserObserver = () => (typeof globalThis.ResizeObserver === 'function' ? globalThis.ResizeObserver : null);

/**
 * The map insets of a map screen (contratos 2.5; M1): what its open floating panels and its folded pills cover of its
 * full-screen map (stageInsets.js).
 * - `rootRef` goes on the box the map fills; `measure(panelId)` gives the ref of a floating panel (one stable callback
 *   per panel), whose edge comes from the screen's `edges` map (`{ [panelId]: edge }`: the console's is
 *   CONSOLE_PANEL_EDGES; a panel the map names no edge for takes nothing) and whose fold from its `data-folded`.
 * - A ResizeObserver watches the box and every panel, so a fold, a panel that grows and a window that changes size
 *   are measured again; the insets are measured after every render too, so a panel that comes or goes counts at once.
 *   Without a ResizeObserver (`ResizeObserverImpl` null) only the renders measure.
 * - `enabled: false` (the console's fallback grid, where there is no map to float over) measures nothing: the insets
 *   are 0. The maximised map (`focus=map`) still measures what stays over it, such as the console's status bar.
 * Returns `{ insets, rootRef, measure, measured }`; `insets` keeps its identity while it measures the same.
 * `measured()` (a stable function) answers the last measurement, `{ insets, width, height }`, with the size of the box
 * in pixels: right after a render that measured new insets they differ from `insets` until the next render has them,
 * so a caller can tell that the map is about to take another room.
 * A panel placed by the insets themselves (occ-map.css places «Seguir en 3D» inside the top and bottom insets) is never
 * measured: folded, its pill would feed the inset it is placed by.
 */
export function useStageInsets({ edges = NO_EDGES, enabled = true, ResizeObserverImpl = browserObserver() } = {}) {
  const [insets, setInsets] = useState(ZERO);
  const root = useRef(null);
  const panels = useRef(new Map());
  const refs = useRef(new Map());
  const observer = useRef(null);
  const last = useRef(NOTHING_MEASURED);
  const latest = useRef({ edges, enabled });
  useLayoutEffect(() => { latest.current = { edges, enabled }; });

  const recompute = useCallback(() => {
    const { edges: sides, enabled: on } = latest.current;
    const box = root.current;
    if (!on || !box) {
      last.current = NOTHING_MEASURED;
      setInsets(current => (sameInsets(current, ZERO) ? current : ZERO));
      return;
    }
    const rect = box.getBoundingClientRect();
    const next = insetsFromPanels(rect, [...panels.current].map(([panelId, element]) => ({
      side: sides?.[panelId], rect: element.getBoundingClientRect(), folded: element.dataset.folded === 'true',
    })));
    last.current = {
      insets: next, width: Math.max(0, rect.right - rect.left), height: Math.max(0, rect.bottom - rect.top),
    };
    setInsets(current => (sameInsets(current, next) ? current : next));
  }, []);
  const measured = useCallback(() => last.current, []);

  // One observer for the life of the screen, created on first use.
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

  // After every render: a panel that came or went (an inspector, the panels the maximised map hides) changes the insets
  // at once.
  useLayoutEffect(() => { recompute(); });

  useLayoutEffect(() => () => {
    observer.current?.disconnect();
    observer.current = null;
  }, []);

  return { insets: enabled ? insets : ZERO, rootRef, measure, measured };
}
