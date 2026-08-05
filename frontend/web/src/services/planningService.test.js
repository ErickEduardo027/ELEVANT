import { describe, expect, it } from 'vitest';
import { getPlanningSnapshot } from './planningService';

describe('getPlanningSnapshot', () => {
  it('resolves with station, date, and a flights array shaped like the documented contract', async () => {
    const snapshot = await getPlanningSnapshot();
    expect(snapshot).toEqual(
      expect.objectContaining({
        station: expect.objectContaining({ code: 'PUJ' }),
        date: expect.any(String),
        flights: expect.any(Array),
      })
    );
    expect(snapshot.flights.length).toBe(20);
    for (const flight of snapshot.flights) {
      expect(flight).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          flightNumber: expect.any(String),
          airlineIata: expect.any(String),
          airlineName: expect.any(String),
          status: expect.any(String),
          scheduledTime: expect.any(String),
          estimatedTime: expect.any(String),
          origin: expect.any(String),
          destination: expect.any(String),
          aircraftType: expect.any(String),
          station: 'PUJ',
          agents: expect.any(Array),
          teams: expect.any(Array),
          services: expect.any(Array),
          observations: expect.any(String),
          history: expect.any(Array),
        })
      );
    }
  });

  it('reflects the requested station code on every flight', async () => {
    const snapshot = await getPlanningSnapshot('MDT');
    expect(snapshot.station.code).toBe('MDT');
    expect(snapshot.flights.every(flight => flight.station === 'MDT')).toBe(true);
  });

  it('defaults the operation date when none is requested', async () => {
    const snapshot = await getPlanningSnapshot();
    expect(snapshot.date).toBe('2026-08-05');
  });

  it('includes two flights sharing position B21 with linked conflict reasons', async () => {
    const snapshot = await getPlanningSnapshot();
    const conflicted = snapshot.flights.filter(flight => flight.conflict !== null);
    expect(conflicted).toHaveLength(2);
    expect(conflicted.map(flight => flight.position)).toEqual(['B21', 'B21']);
    expect(conflicted[0].conflict.reason).toContain('DL2210');
    expect(conflicted[1].conflict.reason).toContain('AA904');
  });

  it('includes at least one flight pending assignment (no position or no agents)', async () => {
    const snapshot = await getPlanningSnapshot();
    const pending = snapshot.flights.filter(flight => !flight.position || flight.agents.length === 0);
    expect(pending.length).toBe(9);
  });

  it('threads the dateISO parameter through to flight timestamps', async () => {
    const snapshot = await getPlanningSnapshot('PUJ', '2026-09-01');
    expect(snapshot.date).toBe('2026-09-01');
    expect(snapshot.flights[0].scheduledTime).toMatch(/^2026-09-01T/);
  });
});
