'use client';

import { useLayoutEffect } from 'react';
import { restoreNow, setNow } from 'maplibre-gl';

// What every scene of the map lab shares (MapLab.jsx and LayoutQaScene.jsx): the lab's path, the plate of its header,
// the words of a frozen clock and the hook that freezes MapLibre's clock for `?t=`.

/** The path of the lab; its index lists the scenes. */
export const LAB_PATH = '/map-lab';

/** A plate of the lab's header: what the screen shows («Datos de prueba, no oficiales», «Sin mapa base»). */
export function LabPlate({ children, className = '' }) {
  return (
    <span className={`shrink-0 rounded-sm border border-occ-line-strong px-1.5 py-0.5 text-xs font-semibold text-occ-muted ${className}`.trim()}>
      {children}
    </span>
  );
}

/** A frozen instant as the header writes it: «2026-11-13 15:00 UTC». */
export function frozenLabel(time) {
  return `${new Date(time).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * Freezes MapLibre's clock at `frozenAt` (milliseconds) while the scene is open, and gives it back after. A layout
 * effect runs before the passive effect in which OccMap starts its engine (StrictMode re-runs them in the same order),
 * so the clock is frozen before the map is created.
 */
export function useFrozenMapClock(frozenAt) {
  useLayoutEffect(() => {
    if (frozenAt === null) return undefined;
    setNow(frozenAt);
    return () => restoreNow();
  }, [frozenAt]);
}
