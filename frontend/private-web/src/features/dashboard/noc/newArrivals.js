import { instantMs } from './boardModel';

// The pill «Llegada nueva: ZZ9001 Demo» with «Ver y seguir» (contratos 2.5): a demo flight the superadministrator
// triggered, seen in the map flights the console already reads. Pure.

const isObject = value => value !== null && typeof value === 'object';

// The phases of a demo arrival before its on-block instant (contratos 1.1: the server's DemoFlightTimeline).
const ARRIVING_PHASES = new Set(['Approach', 'TaxiIn']);

/** An arrival of a demo flight whose timeline is still running (contratos 1.1: the state is `Active`). */
const isActiveDemoArrival = flight => flight.isDemo === true && flight.direction === 'Arrival'
  && flight.demo?.state === 'Active';

/**
 * Whether a map flight is an active demo arrival still on its way to its stand at `nowMs` (the server's time): before
 * the server's on-block instant (`demo.onBlockAt`), or, without that instant or without a time, while the phase the
 * server gave it is `Approach` or `TaxiIn`. Once on its stand it is no longer news.
 */
export function isArrivingDemo(flight, nowMs) {
  if (!isObject(flight) || !isActiveDemoArrival(flight)) return false;
  const onBlockAt = instantMs(flight.demo.onBlockAt ?? null);
  if (onBlockAt !== null && Number.isFinite(nowMs)) return nowMs < onBlockAt;
  return ARRIVING_PHASES.has(flight.demo.phase);
}

// The newest trigger last: by the instant the server made the flight appear, flights without one first.
const appearedAt = flight => instantMs(flight.demo?.appearAt ?? null) ?? Number.NEGATIVE_INFINITY;
const byAppearance = (left, right) => {
  const [a, b] = [appearedAt(left), appearedAt(right)];
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

/**
 * The demo arrivals to announce after a read of the map flights. `seenKeys` is the `seen` of the previous call (`null`
 * before the first read), `flights` the map flights of this read, `nowMs` the server's time and `closed` the flightKeys
 * whose pill the person closed in this tab session (arrivalMemory.js), which are never announced again. Returns
 * `{ seen, arrived }`: `seen` holds every flightKey seen so far, and `arrived` the flights to announce, the newest
 * trigger last:
 * - on the first read, the active demo arrivals still on their way to their stand (isArrivingDemo): the console cannot
 *   tell whether the superadministrator triggered them before it opened, and one still coming is news, also after a
 *   reload or on coming back from another module; one already on its stand is not;
 * - on a later read, the active demo arrivals with a key never seen before, wherever they are.
 * A flight is announced once per call sequence, also when it leaves the window and comes back.
 */
export function demoArrivalsSince(seenKeys, flights, { nowMs = null, closed = null } = {}) {
  const rows = (Array.isArray(flights) ? flights : []).filter(row => isObject(row) && typeof row.flightKey === 'string');
  const keys = rows.map(row => row.flightKey);
  const first = !(seenKeys instanceof Set);
  const news = first
    ? rows.filter(row => isArrivingDemo(row, nowMs))
    : rows.filter(row => !seenKeys.has(row.flightKey) && isActiveDemoArrival(row));
  const arrived = news.filter(row => !(closed instanceof Set && closed.has(row.flightKey))).sort(byAppearance);
  return { seen: new Set(first ? keys : [...seenKeys, ...keys]), arrived };
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
