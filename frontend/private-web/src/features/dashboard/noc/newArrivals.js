// The pill «Llegada nueva: ZZ9001 Demo» with «Ver y seguir» (contratos 2.5): a demo flight the superadministrator just
// triggered, seen in the map flights the console already reads. Pure.

const isObject = value => value !== null && typeof value === 'object';

/** An arrival of a demo flight whose timeline is still running (contratos 1.1: the state is `Active`). */
const isActiveDemoArrival = flight => flight.isDemo === true && flight.direction === 'Arrival'
  && flight.demo?.state === 'Active';

/**
 * The demo arrivals that appeared since the last read: `seenKeys` is the `seen` of the previous call (`null` before the
 * first read) and `flights` the map flights of this read. Returns `{ seen, arrived }`: `seen` holds every flightKey
 * seen so far, and `arrived` the flights with a key never seen before that are active demo arrivals. The first read
 * only learns the keys, so opening the console never announces a flight that was already there; each flight is
 * announced once, also when it leaves the window and comes back.
 */
export function demoArrivalsSince(seenKeys, flights) {
  const rows = (Array.isArray(flights) ? flights : []).filter(row => isObject(row) && typeof row.flightKey === 'string');
  const keys = rows.map(row => row.flightKey);
  if (!(seenKeys instanceof Set)) return { seen: new Set(keys), arrived: [] };
  const arrived = rows.filter(row => !seenKeys.has(row.flightKey) && isActiveDemoArrival(row));
  return { seen: new Set([...seenKeys, ...keys]), arrived };
}

/**
 * The view of the map that follows a flight (contratos 2.1 and 2.3) from where it is: a demo flight by the phase of its
 * timeline (`Approach` → `approach`, `TaxiIn` → `airfield`, any other → `ramp`); another flight by its map phase (an
 * arrival `approaching` → `approach`, `landed` → `airfield`, `enroute` → `region`, anything else → `ramp`).
 */
export function followView(flight) {
  const demoPhase = flight?.demo?.phase ?? null;
  if (typeof demoPhase === 'string') {
    if (demoPhase === 'Approach') return 'approach';
    return demoPhase === 'TaxiIn' ? 'airfield' : 'ramp';
  }
  if (flight?.direction === 'Arrival') {
    if (flight.phase === 'approaching') return 'approach';
    if (flight.phase === 'landed') return 'airfield';
    if (flight.phase === 'enroute') return 'region';
  }
  return 'ramp';
}
