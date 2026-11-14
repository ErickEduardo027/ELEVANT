'use client';

import { useEffect, useRef } from 'react';
import { useOccMap } from '../../maps/core/OccMapContext';

/**
 * Tells the console what the map engine reports (contratos 2.5): `onChange(engineStatus)` with `starting`, `ready` or
 * `unavailable` each time it changes. A child of OccMap, so it reads the map's own context; it draws nothing.
 */
export default function EngineStatusProbe({ onChange }) {
  const { engineStatus } = useOccMap();
  const listener = useRef(onChange);
  useEffect(() => { listener.current = onChange; });
  useEffect(() => { listener.current?.(engineStatus); }, [engineStatus]);
  return null;
}
