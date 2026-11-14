import { FLIGHT_REPORT_MILESTONES } from '@elevant/api-client';
import { describe, expect, it } from 'vitest';
import { createMapFlights, TRAFFIC_FLIGHT_KEY } from '../../maps/testing/trafficFixtures';
import { inspectorMilestones } from './milestoneModel';

const FLIGHTS = createMapFlights().flights;
const legOf = key => FLIGHTS.find(flight => flight.flightKey === key);
const phaseOf = (strip, id) => strip.phases.find(phase => phase.id === id);

describe('inspectorMilestones', () => {
  it('merges the milestones of both legs once', () => {
    const arrival = { ...legOf(TRAFFIC_FLIGHT_KEY.parkedArrival),
      milestones: [{ code: 'BLOCK_ON', actualAt: '2026-11-13T14:38:00.000Z' },
        { code: 'WALKAROUND_START', actualAt: null }] };
    const departure = { ...legOf(TRAFFIC_FLIGHT_KEY.parkedDeparture),
      milestones: [{ code: 'BLOCK_ON', actualAt: '2026-11-13T14:38:00.000Z' },
        { code: 'PUSHBACK', actualAt: '2026-11-13T15:30:00Z' }] };
    const flights = FLIGHTS.map(flight => (flight.flightKey === arrival.flightKey ? arrival
      : flight.flightKey === departure.flightKey ? departure : flight));
    const strip = inspectorMilestones(arrival, flights);
    expect(strip.status).toBe('ready');
    expect(strip.phases.map(phase => phase.id)).toEqual(['arrival', 'on_stand', 'departure', 'pushback']);
    // BLOCK_ON once, from either leg; PUSHBACK from the departure; a milestone without a time is still pending.
    const recorded = strip.phases.flatMap(phase => phase.milestones).filter(milestone => milestone.actualAt !== null);
    expect(recorded.map(milestone => milestone.code)).toEqual(['BLOCK_ON', 'PUSHBACK']);
    expect(strip.phases.reduce((sum, phase) => sum + phase.done, 0)).toBe(2);
    expect(strip.phases.reduce((sum, phase) => sum + phase.total, 0)).toBe(FLIGHT_REPORT_MILESTONES.length);
    expect(phaseOf(strip, 'pushback').milestones.find(milestone => milestone.code === 'PUSHBACK').actualAt)
      .toBe('2026-11-13T15:30:00Z');
    // Selecting the other leg reads the same strip, in the language asked for.
    expect(inspectorMilestones(departure, flights).phases).toEqual(strip.phases);
    expect(phaseOf(inspectorMilestones(departure, flights, 'en'), 'arrival').label).toBe('Arrival');
  });

  it('empty without an operation', () => {
    // ZZ500's turnaround has no operation yet; a demo flight not imported has no turnaround at all.
    expect(inspectorMilestones(legOf(TRAFFIC_FLIGHT_KEY.noFix), FLIGHTS)).toEqual({ status: 'empty', phases: [] });
    expect(inspectorMilestones(legOf(TRAFFIC_FLIGHT_KEY.demoArrival), FLIGHTS)).toEqual({ status: 'empty', phases: [] });
    expect(inspectorMilestones(null, FLIGHTS)).toEqual({ status: 'empty', phases: [] });
    // With an operation and nothing recorded, every milestone is pending.
    const ready = inspectorMilestones(legOf(TRAFFIC_FLIGHT_KEY.arrival), FLIGHTS);
    expect(ready.status).toBe('ready');
    expect(ready.phases.every(phase => phase.done === 0)).toBe(true);
  });
});
