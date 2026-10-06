import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getFlightMonitoringSnapshot, subscribeToFlightUpdates, nudgePosition } from './flightMonitoringService';

describe('getFlightMonitoringSnapshot', () => {
  it('resolves with a station and a flights array shaped like the documented AeroAPI-aligned contract', async () => {
    const snapshot = await getFlightMonitoringSnapshot();
    expect(snapshot.station).toEqual({ code: 'PUJ', localAbbr: 'AST' });
    expect(snapshot.flights.length).toBe(17);
    for (const flight of snapshot.flights) {
      expect(flight).toEqual(
        expect.objectContaining({
          id: expect.any(Number),
          flightNumber: expect.any(String),
          airline: expect.any(String),
          origin: expect.any(String),
          destination: expect.any(String),
          registration: expect.any(String),
          aircraft: expect.any(String),
          status: expect.any(String),
          eta: expect.any(String),
          etd: expect.any(String),
          actualArrival: null,
          actualDeparture: null,
          agents: expect.any(Number),
          heading: expect.any(Number),
          speed: expect.any(Number),
          altitude: expect.any(Number),
          latitude: expect.any(Number),
          longitude: expect.any(Number),
          services: expect.any(Array),
        })
      );
    }
  });

  it('reflects the requested station code', async () => {
    const snapshot = await getFlightMonitoringSnapshot('MDT');
    expect(snapshot.station.code).toBe('MDT');
  });

  it('covers every supported flight status at least once', async () => {
    const snapshot = await getFlightMonitoringSnapshot();
    const statuses = new Set(snapshot.flights.map(flight => flight.status));
    [
      'scheduled', 'taxiing', 'leftGate', 'enRoute', 'delayed', 'approaching',
      'landed', 'taxiingToGate', 'arrived', 'cancelled', 'diverted', 'unknown',
    ].forEach(status => expect(statuses.has(status)).toBe(true));
  });

  it('includes at least one flight unrelated to the station, to exercise the "only PUJ" toggle', async () => {
    const snapshot = await getFlightMonitoringSnapshot();
    const unrelated = snapshot.flights.filter(flight => flight.origin !== 'PUJ' && flight.destination !== 'PUJ');
    expect(unrelated.length).toBeGreaterThan(0);
  });
});

describe('nudgePosition', () => {
  it('moves the flight along its heading by a fixed step and applies the heading jitter', () => {
    const result = nudgePosition({ latitude: 18, longitude: -68, heading: 0 }, 0);
    expect(result.latitude).toBeCloseTo(18.02, 5);
    expect(result.longitude).toBeCloseTo(-68, 5);
    expect(result.heading).toBe(0);
  });

  it('wraps the heading into [0, 360)', () => {
    const result = nudgePosition({ latitude: 18, longitude: -68, heading: 358 }, 5);
    expect(result.heading).toBe(3);
  });
});

describe('subscribeToFlightUpdates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('emits a position update for every movement-eligible flight on each tick', () => {
    const onUpdate = vi.fn();
    subscribeToFlightUpdates(onUpdate);

    vi.advanceTimersByTime(4000);

    const updatedIds = onUpdate.mock.calls.map(([update]) => update.id).sort((a, b) => a - b);
    // Flights 1 (approaching), 4 (leftGate), 6 (taxiing), 10 & 17 (enRoute), 13 (taxiingToGate).
    expect(updatedIds).toEqual([1, 4, 6, 10, 13, 17]);
  });

  it('never emits updates for a cancelled or scheduled flight', () => {
    const onUpdate = vi.fn();
    subscribeToFlightUpdates(onUpdate);

    vi.advanceTimersByTime(4000);

    const updatedIds = onUpdate.mock.calls.map(([update]) => update.id);
    expect(updatedIds).not.toContain(9); // cancelled
    expect(updatedIds).not.toContain(3); // scheduled
  });

  it('stops emitting once unsubscribed', () => {
    const onUpdate = vi.fn();
    const unsubscribe = subscribeToFlightUpdates(onUpdate);
    unsubscribe();

    vi.advanceTimersByTime(8000);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('occasionally mutates status/eta/stand on an eligible flight, including the change in that update', () => {
    const onUpdate = vi.fn();
    subscribeToFlightUpdates(onUpdate);

    // Ticks 1 and 2 carry only position fields; the periodic mutation rule fires on tick 3.
    vi.advanceTimersByTime(8000);
    const mutatedSoFar = onUpdate.mock.calls
      .map(([update]) => update)
      .filter(update => 'status' in update || 'eta' in update || 'stand' in update);
    expect(mutatedSoFar).toHaveLength(0);

    vi.advanceTimersByTime(4000); // tick 3
    const mutatedAtTickThree = onUpdate.mock.calls
      .map(([update]) => update)
      .filter(update => 'status' in update || 'eta' in update || 'stand' in update);
    expect(mutatedAtTickThree).toHaveLength(1);

    const [mutation] = mutatedAtTickThree;
    // Flight 10 (enRoute) is the deterministic tick-3 target; its stand is null in the seed
    // data, so the periodic rule assigns one from the stand pool on this tick.
    expect(mutation.id).toBe(10);
    expect(mutation.stand).toBe('A1');
  });
});