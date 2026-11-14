import { describe, expect, it } from 'vitest';
import { createMapFlights, TRAFFIC_FLIGHT_KEY } from '../../maps/testing/trafficFixtures';
import { demoArrivalsSince, followView } from './newArrivals';

const FLIGHTS = createMapFlights().flights;
const DEMO_ARRIVAL = FLIGHTS.find(flight => flight.flightKey === TRAFFIC_FLIGHT_KEY.demoArrival);
const WITHOUT_DEMO = FLIGHTS.filter(flight => !flight.isDemo);
const numbers = flights => flights.map(flight => flight.flightNumber);

// A second demo flight the superadministrator triggers later, with keys of its own.
const another = (state = 'Active') => ({ ...DEMO_ARRIVAL, flightKey: 'p:5b000000-0000-4000-8000-000000009003',
  visitKey: 'p:5b000000-0000-4000-8000-000000009003', flightNumber: 'ZZ9003', demo: { ...DEMO_ARRIVAL.demo, state } });

describe('newArrivals', () => {
  it('the first read only learns', () => {
    // The demo flight was already there when the console opened: nothing is announced.
    const first = demoArrivalsSince(null, FLIGHTS);
    expect(first.arrived).toEqual([]);
    expect([...first.seen].sort()).toEqual(FLIGHTS.map(flight => flight.flightKey).sort());
    expect(demoArrivalsSince(undefined, FLIGHTS).arrived).toEqual([]);
    // The same read again announces nothing either.
    expect(demoArrivalsSince(first.seen, FLIGHTS).arrived).toEqual([]);
  });

  it('a new active demo arrival is announced once', () => {
    const { seen } = demoArrivalsSince(null, WITHOUT_DEMO);
    const next = demoArrivalsSince(seen, FLIGHTS);
    // The arrival is announced; its departure, the other flights and the next reads are not.
    expect(numbers(next.arrived)).toEqual(['ZZ9001']);
    expect(next.arrived[0]).toBe(DEMO_ARRIVAL);
    const again = demoArrivalsSince(next.seen, FLIGHTS);
    expect(again.arrived).toEqual([]);
    // Gone from a read and back: still announced once.
    const gone = demoArrivalsSince(again.seen, WITHOUT_DEMO);
    expect(demoArrivalsSince(gone.seen, FLIGHTS).arrived).toEqual([]);
    // Only an active demo arrival: a cancelled or finished one, or a flight that is not a demo, is not news.
    expect(demoArrivalsSince(seen, [...WITHOUT_DEMO, another('Cancelled')]).arrived).toEqual([]);
    expect(demoArrivalsSince(seen, [...WITHOUT_DEMO, { ...another(), isDemo: false }]).arrived).toEqual([]);
    expect(numbers(demoArrivalsSince(seen, [...WITHOUT_DEMO, another()]).arrived)).toEqual(['ZZ9003']);
    expect(demoArrivalsSince(seen, null)).toEqual({ seen, arrived: [] });
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
