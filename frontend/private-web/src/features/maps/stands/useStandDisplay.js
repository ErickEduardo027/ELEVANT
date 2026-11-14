import { useMemo } from 'react';
import { useMinuteClock } from '../core/useMinuteClock';
import { withStandDisplay } from './standModel';

/**
 * The stands of a screen with how each reads now (standModel.js: withStandDisplay): `displayStatus`, `signals` and
 * `display` next to the screen's own fields. The list keeps its identity while the positions and the minute are the
 * same, so a map given it writes nothing in between. `nowMs` holds a fixed instant (the map lab's frozen clock);
 * without it the minute clock runs. `flightsByTurnaround` and `aircraftByTurnaround` are the optional inputs of the
 * state rule (the map flights of PR A3, the aircraft positions of PR M5); pass them with a stable identity. It never
 * imports the airport layout.
 */
export function useStandDisplay(positions, { nowMs = null, flightsByTurnaround, aircraftByTurnaround } = {}) {
  const minute = useMinuteClock({ frozenAt: Number.isFinite(nowMs) ? nowMs : null });
  return useMemo(
    () => withStandDisplay(positions, { nowMs: minute, flightsByTurnaround, aircraftByTurnaround }),
    [positions, minute, flightsByTurnaround, aircraftByTurnaround],
  );
}
