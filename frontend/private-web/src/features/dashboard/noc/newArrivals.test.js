import { describe, expect, it } from 'vitest';
import { createMapFlights, TRAFFIC_FLIGHT_KEY, TRAFFIC_NOON } from '../../maps/testing/trafficFixtures';
import { demoArrivalsSince, followView, isArrivingDemo } from './newArrivals';

const FLIGHTS = createMapFlights().flights;
const DEMO_ARRIVAL = FLIGHTS.find(flight => flight.flightKey === TRAFFIC_FLIGHT_KEY.demoArrival);
const DEMO_DEPARTURE = FLIGHTS.find(flight => flight.flightKey === TRAFFIC_FLIGHT_KEY.demoDeparture);
const WITHOUT_DEMO = FLIGHTS.filter(flight => !flight.isDemo);
const numbers = flights => flights.map(flight => flight.flightNumber);
// The fixtures' noon: the demo arrival appeared 3 minutes ago and is due on its stand 5 minutes from now.
const NOW = Date.parse(TRAFFIC_NOON);
const MINUTE = 60_000;
const ON_BLOCK = Date.parse(DEMO_ARRIVAL.demo.onBlockAt);

// A second demo flight the superadministrator triggers later, with keys of its own.
const another = (state = 'Active', demo = {}) => ({ ...DEMO_ARRIVAL, flightKey: 'p:5b000000-0000-4000-8000-000000009003',
  visitKey: 'p:5b000000-0000-4000-8000-000000009003', flightNumber: 'ZZ9003',
  demo: { ...DEMO_ARRIVAL.demo, state, ...demo } });
const withDemo = (flight, demo) => ({ ...flight, demo: { ...flight.demo, ...demo } });

describe('newArrivals', () => {
  it('a demo arrival is on its way until the server says it is on its stand', () => {
    expect(ON_BLOCK).toBe(NOW + 5 * MINUTE);
    expect(isArrivingDemo(DEMO_ARRIVAL, NOW)).toBe(true);
    expect(isArrivingDemo(DEMO_ARRIVAL, ON_BLOCK - 1)).toBe(true);
    // From the on-block instant the aircraft is on its stand: no longer news, whatever phase the read said.
    expect(isArrivingDemo(DEMO_ARRIVAL, ON_BLOCK)).toBe(false);
    expect(isArrivingDemo(withDemo(DEMO_ARRIVAL, { phase: 'TaxiIn' }), ON_BLOCK + MINUTE)).toBe(false);
    // Without a time, or without the instant, the phase the server gave it.
    for (const phase of ['Approach', 'TaxiIn']) {
      expect(isArrivingDemo(withDemo(DEMO_ARRIVAL, { phase }), null), phase).toBe(true);
      expect(isArrivingDemo(withDemo(DEMO_ARRIVAL, { phase, onBlockAt: null }), NOW), phase).toBe(true);
    }
    for (const phase of ['Parked', 'TaxiOut', 'Departed', 'Gone']) {
      expect(isArrivingDemo(withDemo(DEMO_ARRIVAL, { phase }), null), phase).toBe(false);
    }
    // Only an active demo arrival: its departure, a cancelled or finished one, or a flight that is not a demo, never.
    expect(isArrivingDemo(DEMO_DEPARTURE, NOW)).toBe(false);
    expect(isArrivingDemo(another('Cancelled'), NOW)).toBe(false);
    expect(isArrivingDemo(another('Finished'), NOW)).toBe(false);
    expect(isArrivingDemo({ ...DEMO_ARRIVAL, isDemo: false }, NOW)).toBe(false);
    expect(isArrivingDemo(WITHOUT_DEMO[0], NOW)).toBe(false);
    expect(isArrivingDemo(null, NOW)).toBe(false);
  });

  it('the first read announces a demo arrival already on its way, and nothing else', () => {
    // The superadministrator fired the flight before the console opened (or the console reloaded): it is announced.
    const first = demoArrivalsSince(null, FLIGHTS, { nowMs: NOW });
    expect(first.arrived).toEqual([DEMO_ARRIVAL]);
    expect([...first.seen].sort()).toEqual(FLIGHTS.map(flight => flight.flightKey).sort());
    expect(demoArrivalsSince(undefined, FLIGHTS, { nowMs: NOW }).arrived).toEqual([DEMO_ARRIVAL]);
    // The same flight is not announced again by the next reads.
    expect(demoArrivalsSince(first.seen, FLIGHTS, { nowMs: NOW }).arrived).toEqual([]);
    // Already on its stand when the console opened: not news.
    expect(demoArrivalsSince(null, FLIGHTS, { nowMs: ON_BLOCK + MINUTE }).arrived).toEqual([]);
    // A pill the person closed in this tab never comes back.
    expect(demoArrivalsSince(null, FLIGHTS, { nowMs: NOW, closed: new Set([DEMO_ARRIVAL.flightKey]) }).arrived)
      .toEqual([]);
    // A day without demo flights announces nothing.
    expect(demoArrivalsSince(null, WITHOUT_DEMO, { nowMs: NOW }).arrived).toEqual([]);
    expect(demoArrivalsSince(null, null)).toEqual({ seen: new Set(), arrived: [] });
  });

  it('a new active demo arrival is announced once, the newest trigger last', () => {
    const { seen } = demoArrivalsSince(null, WITHOUT_DEMO, { nowMs: NOW });
    const next = demoArrivalsSince(seen, FLIGHTS, { nowMs: NOW });
    // The arrival is announced; its departure, the other flights and the next reads are not.
    expect(numbers(next.arrived)).toEqual(['ZZ9001']);
    expect(next.arrived[0]).toBe(DEMO_ARRIVAL);
    const again = demoArrivalsSince(next.seen, FLIGHTS, { nowMs: NOW });
    expect(again.arrived).toEqual([]);
    // Gone from a read and back: still announced once.
    const gone = demoArrivalsSince(again.seen, WITHOUT_DEMO);
    expect(demoArrivalsSince(gone.seen, FLIGHTS).arrived).toEqual([]);
    // Only an active demo arrival: a cancelled or finished one, or a flight that is not a demo, is not news.
    expect(demoArrivalsSince(seen, [...WITHOUT_DEMO, another('Cancelled')]).arrived).toEqual([]);
    expect(demoArrivalsSince(seen, [...WITHOUT_DEMO, { ...another(), isDemo: false }]).arrived).toEqual([]);
    expect(numbers(demoArrivalsSince(seen, [...WITHOUT_DEMO, another()]).arrived)).toEqual(['ZZ9003']);
    // A flight that appears after the first read is news wherever it is, unless the person closed it.
    expect(numbers(demoArrivalsSince(seen, [...WITHOUT_DEMO, another('Active', { phase: 'Parked' })],
      { nowMs: NOW + 30 * MINUTE }).arrived)).toEqual(['ZZ9003']);
    expect(demoArrivalsSince(seen, [...WITHOUT_DEMO, another()], { closed: new Set([another().flightKey]) }).arrived)
      .toEqual([]);
    expect(demoArrivalsSince(seen, null)).toEqual({ seen, arrived: [] });

    // Two flights in one read: the one the superadministrator triggered last comes last, whatever the server's order.
    const later = another('Active', { appearAt: new Date(NOW - MINUTE).toISOString() });
    expect(numbers(demoArrivalsSince(null, [later, DEMO_ARRIVAL], { nowMs: NOW }).arrived)).toEqual(['ZZ9001', 'ZZ9003']);
    expect(numbers(demoArrivalsSince(null, [DEMO_ARRIVAL, later], { nowMs: NOW }).arrived)).toEqual(['ZZ9001', 'ZZ9003']);
  });

  it('the view to follow follows the demo phase', () => {
    const demo = phase => ({ ...DEMO_ARRIVAL, demo: { ...DEMO_ARRIVAL.demo, phase } });
    expect(followView(demo('Approach'))).toBe('approach');
    expect(followView(demo('TaxiIn'))).toBe('airfield');
    for (const phase of ['Parked', 'TaxiOut', 'Departed', 'Gone']) expect(followView(demo(phase)), phase).toBe('ramp');
    // Another flight by its map phase.
    const arrival = FLIGHTS.find(flight => flight.flightKey === TRAFFIC_FLIGHT_KEY.arrival);
    expect(followView(arrival)).toBe('approach');
    expect(followView({ ...arrival, phase: 'landed' })).toBe('airfield');
    expect(followView({ ...arrival, phase: 'enroute' })).toBe('region');
    expect(followView(FLIGHTS.find(flight => flight.flightKey === TRAFFIC_FLIGHT_KEY.parkedArrival))).toBe('ramp');
    expect(followView(null)).toBe('ramp');
  });
});
