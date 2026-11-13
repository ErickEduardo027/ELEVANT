import { describe, expect, it } from 'vitest';
import { SELECTION_KEYS, matchFlight, readSelection, relatedEntities, writeSelection } from './mapSelection';

const BASE = 'stationId=20000000-0000-7000-8000-000000000003&operationId=op-7&tab=plan';

// Synthetic map flights in the shape of contracts 1.3: a demo visit before the import and a manual visit.
const FLIGHTS = [
  {
    flightKey: 'p:prop-arr', visitKey: 'p:prop-arr', proposalId: 'prop-arr', legId: null, turnaroundId: null,
    direction: 'Arrival', phase: 'approaching', scheduledAt: '2026-11-12T15:05:00Z', estimatedAt: null, actualAt: null,
    stand: null, suggestedStandCode: 'A05',
  },
  {
    flightKey: 'p:prop-dep', visitKey: 'p:prop-arr', proposalId: 'prop-dep', legId: null, turnaroundId: null,
    direction: 'Departure', phase: 'scheduled', scheduledAt: '2026-11-12T16:05:00Z', estimatedAt: null, actualAt: null,
    stand: null, suggestedStandCode: 'A05',
  },
  {
    flightKey: 'l:leg-dep', visitKey: 't:turn-9', proposalId: null, legId: 'leg-dep', turnaroundId: 'turn-9',
    direction: 'Departure', phase: 'scheduled', scheduledAt: '2026-11-12T13:40:00Z', estimatedAt: null, actualAt: null,
    stand: { id: 'stand-b21', code: 'B21', terminalCode: 'B' },
  },
  {
    flightKey: 'l:leg-arr', visitKey: 't:turn-9', proposalId: null, legId: 'leg-arr', turnaroundId: 'turn-9',
    direction: 'Arrival', phase: 'arrived', scheduledAt: '2026-11-12T12:10:00Z', estimatedAt: null,
    actualAt: '2026-11-12T12:02:00Z', stand: { id: 'stand-b21', code: 'B21', terminalCode: 'B' },
  },
];

describe('map selection in the URL', () => {
  it('round-trips flight, stand and aircraft selections and keeps stationId and operationId', () => {
    for (const selection of [{ kind: 'flight', id: 'p:prop-arr' }, { kind: 'stand', id: 'B21' }, { kind: 'aircraft', id: 'a1b2c3' }]) {
      const written = writeSelection(new URLSearchParams(BASE), { selection });
      expect(readSelection(written).selection, selection.kind).toEqual(selection);
      expect(written.get('stationId')).toBe('20000000-0000-7000-8000-000000000003');
      expect(written.get('operationId')).toBe('op-7');
      expect(written.get('tab')).toBe('plan');
    }
    const params = writeSelection(new URLSearchParams(BASE), {
      selection: { kind: 'flight', id: 'p:prop-arr' }, view: 'approach', follow: true, focus: 'map',
    });
    expect(params.toString()).toBe(`${BASE}&flightId=p%3Aprop-arr&view=approach&follow=1&focus=map`);
    expect(readSelection(params)).toEqual({
      selection: { kind: 'flight', id: 'p:prop-arr' }, view: 'approach', terminal: null, follow: true, focus: 'map',
    });
    // A string and Next's read-only params read the same; the input is never changed.
    const source = new URLSearchParams(BASE);
    writeSelection(source, { selection: { kind: 'stand', id: 'A5' }, view: 'ramp' });
    expect(source.toString()).toBe(BASE);
    expect(readSelection(`${BASE}&hex=A1B2C3`).selection).toEqual({ kind: 'aircraft', id: 'a1b2c3' });
    expect(readSelection(null)).toEqual({ selection: null, view: null, terminal: null, follow: false, focus: null });

    // Clearing deletes only the selection keys; follow and focus off delete theirs.
    const cleared = writeSelection(params, { selection: null, follow: false, focus: null });
    expect(cleared.toString()).toBe(`${BASE}&view=approach`);
    expect(SELECTION_KEYS).toEqual(['flightId', 'stand', 'hex', 'view', 'terminal', 'follow', 'focus']);
    // Only the patched keys change.
    expect(writeSelection(params, {}).toString()).toBe(params.toString());
    expect(writeSelection(params, { follow: 'yes' }).has('follow')).toBe(false);
    expect(readSelection(`${BASE}&follow=true&focus=list`)).toMatchObject({ follow: false, focus: null });
  });

  it('one selection at a time: selecting a stand removes flightId and hex', () => {
    const both = new URLSearchParams(`${BASE}&flightId=l%3Aleg-arr&hex=0d0a1b&view=ramp`);
    const stand = writeSelection(both, { selection: { kind: 'stand', id: 'B21' } });
    expect([...stand.keys()]).toEqual(['stationId', 'operationId', 'tab', 'view', 'stand']);
    expect(readSelection(stand).selection).toEqual({ kind: 'stand', id: 'B21' });

    const aircraft = writeSelection(stand, { selection: { kind: 'aircraft', id: '0D0A1B' } });
    expect(aircraft.has('stand')).toBe(false);
    expect(aircraft.get('hex')).toBe('0d0a1b');
    const flight = writeSelection(aircraft, { selection: { kind: 'flight', id: 'leg-arr' } });
    expect([flight.has('hex'), flight.has('stand'), flight.get('flightId')]).toEqual([false, false, 'leg-arr']);

    // A hand-written URL with two keys reads as one selection: flight, then stand, then aircraft.
    expect(readSelection(both).selection).toEqual({ kind: 'flight', id: 'l:leg-arr' });
    // An unknown kind or an empty id selects nothing and still clears the others.
    expect(writeSelection(flight, { selection: { kind: 'gate', id: 'G1' } }).has('flightId')).toBe(false);
    expect([...writeSelection(flight, { selection: { kind: 'stand', id: '  ' } }).keys()])
      .toEqual(['stationId', 'operationId', 'tab', 'view']);
  });

  it('normalizes the stand code and drops invalid view and terminal values; terminal only with ramp', () => {
    expect(writeSelection(BASE, { selection: { kind: 'stand', id: 'a01' } }).get('stand')).toBe('A1');
    expect(writeSelection(BASE, { selection: { kind: 'stand', id: ' BN06 ' } }).get('stand')).toBe('BN6');
    expect(readSelection(`${BASE}&stand=b021`).selection).toEqual({ kind: 'stand', id: 'B21' });
    // A code that is not letters and a number is kept as typed (upper case): equivalences are never inferred.
    expect(writeSelection(BASE, { selection: { kind: 'stand', id: '9a' } }).get('stand')).toBe('9A');

    const ramp = writeSelection(BASE, { view: 'ramp', terminal: 'fbo' });
    expect([ramp.get('view'), ramp.get('terminal')]).toEqual(['ramp', 'FBO']);
    expect(readSelection(ramp)).toMatchObject({ view: 'ramp', terminal: 'FBO' });
    // Leaving the ramp drops the terminal; a terminal alone never sticks to another view.
    const airfield = writeSelection(ramp, { view: 'airfield' });
    expect([airfield.get('view'), airfield.has('terminal')]).toEqual(['airfield', false]);
    expect(writeSelection(airfield, { terminal: 'A' }).has('terminal')).toBe(false);
    expect(writeSelection(writeSelection(BASE, { view: 'ramp' }), { terminal: 'B' }).get('terminal')).toBe('B');
    // Invalid values are not written: the key goes.
    expect(writeSelection(ramp, { view: 'weather' }).has('view')).toBe(false);
    expect(writeSelection(ramp, { view: 'weather' }).has('terminal')).toBe(false);
    expect(writeSelection(ramp, { terminal: 'C' }).has('terminal')).toBe(false);
    expect(writeSelection(ramp, { terminal: 'C' }).get('view')).toBe('ramp');
    expect(readSelection(`${BASE}&view=weather&terminal=A`)).toMatchObject({ view: null, terminal: null });
    expect(readSelection(`${BASE}&view=airfield&terminal=A`)).toMatchObject({ view: 'airfield', terminal: null });
  });

  it('a flight id resolves against flightKey, visitKey, leg id and turnaround id (legacy flightId links keep working)', () => {
    const [demoArrival, demoDeparture, legDeparture, legArrival] = FLIGHTS;
    expect(matchFlight(FLIGHTS, 'p:prop-dep')).toBe(demoDeparture);
    expect(matchFlight(FLIGHTS, 'l:leg-dep')).toBe(legDeparture);
    // The visit and the turnaround name both legs: they resolve to the arrival.
    expect(matchFlight(FLIGHTS, 'p:prop-arr')).toBe(demoArrival);
    expect(matchFlight(FLIGHTS, 't:turn-9')).toBe(legArrival);
    expect(matchFlight(FLIGHTS, 'turn-9')).toBe(legArrival);
    // Today's links carry a leg id.
    expect(matchFlight(FLIGHTS, 'leg-dep')).toBe(legDeparture);
    expect(matchFlight(FLIGHTS, ' leg-arr ')).toBe(legArrival);
    // After a 3-N07 link the proposal key is gone from the list: the old key resolves through the proposal id.
    const linked = [{ ...legArrival, proposalId: 'prop-old' }];
    expect(matchFlight(linked, 'p:prop-old')).toBe(linked[0]);
    // The flight lists of today's screens use `id`.
    const legacy = [{ id: 'leg-42', flightNumber: 'AA904' }];
    expect(matchFlight(legacy, 'leg-42')).toBe(legacy[0]);
    expect(matchFlight(FLIGHTS, 'leg-404')).toBeNull();
    expect(matchFlight(FLIGHTS, '')).toBeNull();
    expect(matchFlight(null, 'leg-dep')).toBeNull();
  });

  it('relates a flight to its stand and a stand to its current or next flight', () => {
    expect(relatedEntities({ kind: 'flight', id: 'l:leg-dep' }, { flights: FLIGHTS }))
      .toEqual({ standCode: 'B21', flightKey: 'l:leg-dep' });
    // A demo flight not yet imported relates its suggested stand.
    expect(relatedEntities({ kind: 'flight', id: 'p:prop-arr' }, { flights: FLIGHTS }))
      .toEqual({ standCode: 'A5', flightKey: 'p:prop-arr' });
    // The arrival on B21 has arrived, not left: it is the current flight of the stand.
    expect(relatedEntities({ kind: 'stand', id: 'b021' }, { flights: FLIGHTS, stands: [] }))
      .toEqual({ standCode: 'B21', flightKey: 'l:leg-arr' });
    const departed = FLIGHTS.map(flight => (flight.flightKey === 'l:leg-arr' ? { ...flight, phase: 'departed' } : flight));
    expect(relatedEntities({ kind: 'stand', id: 'B21' }, { flights: departed }).flightKey).toBe('l:leg-dep');
    expect(relatedEntities({ kind: 'stand', id: 'A5' }, { flights: FLIGHTS }).flightKey).toBe('p:prop-arr');
    expect(relatedEntities({ kind: 'stand', id: 'B30' }, { flights: FLIGHTS })).toEqual({ standCode: 'B30', flightKey: null });
    expect(relatedEntities({ kind: 'aircraft', id: 'a1b2c3' }, { flights: FLIGHTS })).toEqual({ standCode: null, flightKey: null });
    expect(relatedEntities(null)).toEqual({ standCode: null, flightKey: null });
  });
});
