import { useMemo } from 'react';
import { useMinuteClock } from '../core/useMinuteClock';
import { useStandClock } from './useStandClock';
import { withStandDisplay } from './standModel';

/**
 * The stands of a screen with how each reads now (standModel.js: withStandDisplay): `displayStatus`, `signals` and
 * `display` next to the screen's own fields. The list keeps its identity while the positions and the minute are the
 * same, so a map given it writes nothing in between. `nowMs` holds a fixed instant (the map lab's frozen clock);
 * without it the minute clock runs. `flightsByTurnaround` and `aircraftByTurnaround` are the optional inputs of the
 * state rule (the map flights of PR A3, the aircraft positions of PR M5); pass them with a stable identity. `clock`
 * (PR M6, inside the OCC frame: the render clock the map draws its aircraft at) replaces the browser's minute clock:
 * the stands then read the server's time, on its minutes and at the demo instants of the flights (useStandClock.js),
 * so a demo stand changes state in the same moment its aircraft parks or leaves. It never imports the airport layout.
 */
export function useStandDisplay(positions, {
  nowMs = null, clock = null, flightsByTurnaround, aircraftByTurnaround,
} = {}) {
  const frozen = Number.isFinite(nowMs) ? nowMs : null;
  const live = clock && frozen === null ? clock : null;
  // The browser's minute clock runs only without a fixed instant and without the map's clock.
  const minute = useMinuteClock({ frozenAt: frozen ?? (live ? 0 : null) });
  const served = useStandClock({ clock: live, flightsByTurnaround });
  const at = served ?? minute;
  return useMemo(
    () => withStandDisplay(positions, { nowMs: at, flightsByTurnaround, aircraftByTurnaround }),
    [positions, at, flightsByTurnaround, aircraftByTurnaround],
  );
}
