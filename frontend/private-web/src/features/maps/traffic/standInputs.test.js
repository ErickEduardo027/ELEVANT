import { describe, expect, it } from 'vitest';
import {
  createAirPicture, createEstimates, createMapFlights, TRAFFIC_FLIGHT_KEY, TRAFFIC_NOON,
} from '../testing/trafficFixtures';
import { buildSituation, toFlightsModel, toPictureModel } from './situationModel';
import { STAND_INPUTS_MEMO_SIZE, standInputsOf } from './standInputs';

const NOON = Date.parse(TRAFFIC_NOON);

// The situation of the lab's noon, read from fresh answers each time (new objects, as every read brings them).
function situationOf({ picture = createAirPicture(), flights = createMapFlights(), estimates = createEstimates() } = {}) {
  return buildSituation({ picture: toPictureModel(picture), flights: toFlightsModel(flights), nowMs: NOON, estimates });
}

const rowOf = key => createMapFlights().flights.find(row => row.flightKey === key);

describe('standInputsOf', () => {
  it('maps the legs and the drawn ELEVANT aircraft by turnaround', () => {
    const inputs = standInputsOf(situationOf());
    const arrival = rowOf(TRAFFIC_FLIGHT_KEY.arrival);
    const parked = rowOf(TRAFFIC_FLIGHT_KEY.parkedArrival);
    // Every imported visit with its legs in the answer's order; the demo pair nobody imported has no turnaround.
    expect([...inputs.flightsByTurnaround.keys()]).toEqual([
      arrival.turnaroundId, parked.turnaroundId, rowOf(TRAFFIC_FLIGHT_KEY.noFix).turnaroundId,
      rowOf(TRAFFIC_FLIGHT_KEY.departed).turnaroundId,
    ]);
    expect(inputs.flightsByTurnaround.get(arrival.turnaroundId).map(row => row.flightKey))
      .toEqual([TRAFFIC_FLIGHT_KEY.arrival, TRAFFIC_FLIGHT_KEY.departure]);
    expect(inputs.flightsByTurnaround.get(parked.turnaroundId)[0]).toMatchObject({
      flightNumber: 'ZZ300', milestones: [{ code: 'BLOCK_ON' }], stand: { code: 'A2' },
    });
    // ZZ161 on final, live: where the map draws it, in the air. The transponder parked inside A2 is other traffic, and the
    // estimated demo flight has no turnaround.
    expect([...inputs.aircraftByTurnaround.keys()]).toEqual([arrival.turnaroundId]);
    const place = inputs.aircraftByTurnaround.get(arrival.turnaroundId);
    expect(place).toMatchObject({ onGround: false, quality: 'live' });
    expect(place.position).toHaveLength(2);
    expect(place.gsMs).toBeCloseTo(150 * 1852 / 3600, 1);
    expect(Object.isFrozen(place)).toBe(true);
  });

  it('keeps its identity while the content stays the same', () => {
    const first = standInputsOf(situationOf());
    // A re-read of the same answers, in new objects, gives the same inputs: the stands are not read again.
    expect(standInputsOf(situationOf())).toBe(first);
    // A moved aircraft gives new ones; going back gives the first again.
    const moved = createAirPicture();
    moved.aircraft = moved.aircraft.map(item => (item.matchedFlightKey === TRAFFIC_FLIGHT_KEY.arrival
      ? { ...item, latitude: item.latitude + 0.01 } : item));
    const next = standInputsOf(situationOf({ picture: moved }));
    expect(next).not.toBe(first);
    expect(next.aircraftByTurnaround.get(rowOf(TRAFFIC_FLIGHT_KEY.arrival).turnaroundId).position[1])
      .toBeCloseTo(first.aircraftByTurnaround.get(rowOf(TRAFFIC_FLIGHT_KEY.arrival).turnaroundId).position[1] + 0.01, 6);
    expect(standInputsOf(situationOf())).toBe(first);
    // A change below the decimetre is no change.
    const nudged = createAirPicture();
    nudged.aircraft = nudged.aircraft.map(item => (item.matchedFlightKey === TRAFFIC_FLIGHT_KEY.arrival
      ? { ...item, latitude: item.latitude + 1e-8 } : item));
    expect(standInputsOf(situationOf({ picture: nudged }))).toBe(first);
    // The memo keeps a few: old ones go.
    expect(STAND_INPUTS_MEMO_SIZE).toBeGreaterThan(1);
  });

  it('prefers a position from a fix to an estimate of the same visit, and leaves out what the map does not draw', () => {
    // An estimate for ZZ300 parked at A2 (no fix of its own), and one for ZZ161, which has a live fix.
    const parked = rowOf(TRAFFIC_FLIGHT_KEY.parkedArrival);
    const estimates = [
      { flightKey: TRAFFIC_FLIGHT_KEY.parkedArrival, lon: -68.3609, lat: 18.5642, gsMs: 0, onGround: true },
      { flightKey: TRAFFIC_FLIGHT_KEY.arrival, lon: -68.3, lat: 18.6, gsMs: 70, onGround: false },
    ];
    const inputs = standInputsOf(situationOf({ estimates }));
    expect(inputs.aircraftByTurnaround.get(parked.turnaroundId))
      .toEqual({ position: [-68.3609, 18.5642], onGround: true, gsMs: 0, quality: 'estimated' });
    // buildSituation never estimates a flight that has a live aircraft: ZZ161 stays live.
    expect(inputs.aircraftByTurnaround.get(rowOf(TRAFFIC_FLIGHT_KEY.arrival).turnaroundId).quality).toBe('live');

    // Without a situation, or with nothing in it, the same empty inputs: a screen outside the OCC frame reads as before.
    const empty = standInputsOf(null);
    expect(empty.flightsByTurnaround.size + empty.aircraftByTurnaround.size).toBe(0);
    expect(standInputsOf(undefined)).toBe(empty);
    expect(standInputsOf({ flights: [], aircraft: [] })).toBe(empty);
    // A row without a turnaround, an aircraft without a position or of other traffic: nothing to read.
    const sparse = standInputsOf({
      flights: [{ flightKey: 'p:x', turnaroundId: null }],
      aircraft: [{ id: 'h:f0a002', kind: 'other', turnaroundId: parked.turnaroundId, lon: -68.36, lat: 18.56 },
        { id: 'f:l:y', kind: 'aviam', turnaroundId: parked.turnaroundId, lon: null, lat: 18.56 }],
    });
    expect([sparse.flightsByTurnaround.size, sparse.aircraftByTurnaround.size]).toEqual([0, 0]);
  });
});
