import { useState } from 'react';
import { rememberArrivals } from '../traffic/referenceFeatures';

// The recent live arrivals of the runway in use (contracts 2.3, PR M8), kept from one render to the next: the votes of
// the aircraft seen on final in the last ten minutes of the server's clock (traffic/referenceFeatures.js:
// rememberArrivals). OccMap reads them for its runway in use, so the runway holds after a landing and between two
// arrivals. They change only with a new list of aircraft (an air picture), another layout or the server's minute,
// never per frame, and make no request.

const NONE = Object.freeze([]);

/**
 * The votes of the recent live arrivals at `nowMs` (the server's time, on the minute): those kept from the renders before
 * and those of `aircraft` (the map's RenderAircraft) on final now, for the runway ends of `layout`. Another layout starts
 * them over. The same `aircraft`, `layout` and `nowMs` give the same list.
 */
export function useRecentArrivals(aircraft, { layout, nowMs }) {
  const [memory, setMemory] = useState(() => ({
    aircraft, layout, nowMs, votes: rememberArrivals(NONE, aircraft, { layout, nowMs }),
  }));
  if (memory.aircraft === aircraft && memory.layout === layout && memory.nowMs === nowMs) return memory.votes;
  // What the renders before saw is kept in state and adjusted while rendering, as React documents for information from
  // previous renders: this render already draws the new votes, with no effect and no render in between.
  const votes = rememberArrivals(memory.layout === layout ? memory.votes : NONE, aircraft, { layout, nowMs });
  setMemory({ aircraft, layout, nowMs, votes });
  return votes;
}
