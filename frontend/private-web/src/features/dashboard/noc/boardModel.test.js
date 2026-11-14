import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n/languageStore';
import {
  createAirPicture, createEstimates, createMapFlights, TRAFFIC_FLIGHT_KEY, TRAFFIC_NOON,
} from '../../maps/testing/trafficFixtures';
import { buildSituation, toFlightsModel, toPictureModel } from '../../maps/traffic/situationModel';
import { readSelection, writeSelection } from '../../maps/core/mapSelection';
import {
  bestTime, buildBoard, filterVisits, flightStatus, selectionIdOf, VISIT_FILTERS,
} from './boardModel';
import { consoleMessages } from './consoleMessages';

const NOW = Date.parse(TRAFFIC_NOON);
const MINUTE = 60_000;
const t = createTranslator(consoleMessages, 'es');
const FLIGHTS = createMapFlights().flights;
const legOf = key => FLIGHTS.find(flight => flight.flightKey === key);
const numbers = strips => strips.map(item => item.flightNumber);

// A turnaround of the planning snapshot as the API sends it (OccTurnaroundResponse), synthetic.
function planTurnaround(id, overrides = {}) {
  return {
    id, operationCode: `PLAN-${id.slice(-3)}`, operationDate: '2026-11-13', status: 'Confirmed',
    airline: { id: 'airline-1', iataCode: 'ZZ', icaoCode: 'ZZZ', name: 'Zeta Air de prueba' },
    aircraft: null, stand: { id: 'stand-a5', code: 'A05', terminal: { id: 'terminal-a', code: 'A', name: 'Terminal A' } },
    arrival: null, departure: null, operation: null,
    agents: [{ assignmentId: `assignment-${id}`, agentId: 'agent-1', displayName: 'Agente de prueba' }],
    equipment: [], services: [],
    ...overrides,
  };
}

describe('boardModel', () => {
  it('orders arrivals and departures by their best time with its kind', () => {
    // Seven decimals, as .NET writes them, cut to milliseconds.
    expect(bestTime({ scheduledAt: '2026-11-13T15:00:00Z', estimatedAt: '2026-11-13T15:05:00.1234567+00:00',
      actualAt: null })).toEqual({ at: NOW + 5 * MINUTE + 123, kind: 'estimated' });
    expect(bestTime({ scheduledAt: '2026-11-13T15:00:00Z', actualAt: '2026-11-13T14:58:00Z' }))
      .toEqual({ at: NOW - 2 * MINUTE, kind: 'actual' });
    expect(bestTime({ scheduledAt: '2026-11-13T15:00:00Z' })).toEqual({ at: NOW, kind: 'scheduled' });
    expect(bestTime({ scheduledAt: null })).toBeNull();
    expect(bestTime(null)).toBeNull();

    const board = buildBoard({ flights: FLIGHTS, nowMs: NOW, t });
    // ZZ300 landed 22 min ago (actual), ZZ161 comes in 10 min (estimated), ZZ500 in 48 (estimated).
    expect(numbers(board.arrivals)).toEqual(['ZZ300', 'ZZ161', 'ZZ500']);
    expect(board.arrivals.map(item => item.time)).toEqual([
      { at: NOW - 22 * MINUTE, kind: 'actual' }, { at: NOW + 10 * MINUTE, kind: 'estimated' },
      { at: NOW + 48 * MINUTE, kind: 'estimated' },
    ]);
    expect(numbers(board.departures)).toEqual(['ZZ700', 'ZZ301', 'ZZ162']);
    expect(board.departures.map(item => item.time.kind)).toEqual(['actual', 'scheduled', 'scheduled']);
    // The order does not depend on the order of the read.
    expect(numbers(buildBoard({ flights: [...FLIGHTS].reverse(), nowMs: NOW, t }).arrivals))
      .toEqual(['ZZ300', 'ZZ161', 'ZZ500']);

    // Each strip has the shape of OccFlightStrip, its stand normalized, and the keys the console selects with.
    expect(board.arrivals[1]).toMatchObject({
      id: TRAFFIC_FLIGHT_KEY.arrival, flightKey: TRAFFIC_FLIGHT_KEY.arrival, visitKey: TRAFFIC_FLIGHT_KEY.arrival,
      direction: 'Arrival', flightNumber: 'ZZ161', counterpartIata: 'MIA', standCode: 'A5', imported: true,
      status: { key: 'approaching', label: 'En aproximación', signal: null }, demo: false, estimated: false,
    });
    expect(board.arrivals[0].status).toMatchObject({ key: 'inOperation', label: 'En operación' });
    expect(board.departures[0].status).toMatchObject({ key: 'departed', label: 'Salió' });
    expect(board.arrivals[2].status.label).toBe('En ruta');
    expect(board.counts).toEqual({ arrivals: 3, departures: 3, toImport: 2, visits: 4 });
  });

  it('an arrival without a stand reads «Llegada sin posición asignada» and turns attention within 60 min', () => {
    const demo = legOf(TRAFFIC_FLIGHT_KEY.demoArrival);
    // Due in 5 minutes, with only a suggested stand: no stand is assigned yet.
    expect(flightStatus(demo, { nowMs: NOW })).toEqual({ key: 'noStand', signal: 'attention' });
    const later = { ...demo, scheduledAt: new Date(NOW + 90 * MINUTE).toISOString(),
      estimatedAt: new Date(NOW + 90 * MINUTE).toISOString() };
    expect(flightStatus(later, { nowMs: NOW })).toEqual({ key: 'noStand', signal: null });
    expect(flightStatus(later, { nowMs: NOW + 30 * MINUTE })).toEqual({ key: 'noStand', signal: 'attention' });
    // Overdue and still without a stand: still attention.
    expect(flightStatus(later, { nowMs: NOW + 120 * MINUTE }).signal).toBe('attention');
    // A cancelled or diverted flight says so first; a departure never asks for a stand.
    expect(flightStatus({ ...demo, phase: 'cancelled' }, { nowMs: NOW })).toEqual({ key: 'cancelled', signal: 'attention' });
    expect(flightStatus({ ...demo, phase: 'diverted' }, { nowMs: NOW })).toEqual({ key: 'diverted', signal: 'attention' });
    expect(flightStatus(legOf(TRAFFIC_FLIGHT_KEY.demoDeparture), { nowMs: NOW }).key).toBe('scheduled');

    const [strip] = buildBoard({ flights: FLIGHTS, nowMs: NOW, t }).toImport.arrivals;
    expect(strip.status).toEqual({ key: 'noStand', label: 'Llegada sin posición asignada', signal: 'attention' });
    expect(strip.standCode).toBeNull();
    expect(buildBoard({ flights: FLIGHTS, nowMs: NOW, t: createTranslator(consoleMessages, 'en') })
      .toImport.arrivals[0].status.label).toBe('Arrival without an assigned stand');
  });

  it('proposals not imported go to Por importar and keep their demo mark', () => {
    const board = buildBoard({ flights: FLIGHTS, nowMs: NOW, t });
    expect(numbers(board.toImport.arrivals)).toEqual(['ZZ9001']);
    expect(numbers(board.toImport.departures)).toEqual(['ZZ9002']);
    expect(board.toImport.arrivals[0]).toMatchObject({ demo: true, imported: false,
      proposalId: legOf(TRAFFIC_FLIGHT_KEY.demoArrival).proposalId, visitKey: TRAFFIC_FLIGHT_KEY.demoArrival });
    expect(board.toImport.departures[0].demo).toBe(true);
    // They are not repeated on the tabs, and a pair without a turnaround is no «Escala» yet.
    expect([...numbers(board.arrivals), ...numbers(board.departures)]).not.toContain('ZZ9001');
    expect(board.visits.map(item => item.visitKey)).not.toContain(TRAFFIC_FLIGHT_KEY.demoArrival);

    // Once imported, the same key moves to «Llegadas».
    const imported = FLIGHTS.map(flight => (flight.visitKey === TRAFFIC_FLIGHT_KEY.demoArrival
      ? { ...flight, imported: true, turnaroundId: '5d000000-0000-4000-8000-000000009001' } : flight));
    const after = buildBoard({ flights: imported, nowMs: NOW, t });
    expect(after.toImport).toEqual({ arrivals: [], departures: [] });
    expect(numbers(after.arrivals)).toContain('ZZ9001');
    expect(after.arrivals.find(item => item.flightNumber === 'ZZ9001').demo).toBe(true);
  });

  it('marks a strip estimated only when its aircraft position is estimated', () => {
    // The situation the map draws: ZZ161 has its live aircraft, the demo arrival an estimated position (M6).
    const situation = buildSituation({ picture: toPictureModel(createAirPicture()),
      flights: toFlightsModel(createMapFlights()), nowMs: NOW, estimates: createEstimates() });
    const board = buildBoard({ flights: FLIGHTS, aircraft: situation.aircraft, nowMs: NOW, t });
    const all = [...board.arrivals, ...board.departures, ...board.toImport.arrivals, ...board.toImport.departures];
    expect(all.filter(item => item.estimated).map(item => item.flightNumber)).toEqual(['ZZ9001']);
    // ZZ161's time is an estimate, yet its aircraft is live: the time says «est.» by its kind, the strip is not estimated.
    const live = board.arrivals.find(item => item.flightNumber === 'ZZ161');
    expect(live).toMatchObject({ estimated: false, time: { kind: 'estimated' } });
    // Without the situation nothing is estimated.
    expect(buildBoard({ flights: FLIGHTS, nowMs: NOW, t }).toImport.arrivals[0].estimated).toBe(false);
  });

  it('groups the two legs of a visit and its missing resources', () => {
    const flights = FLIGHTS;
    const id161 = legOf(TRAFFIC_FLIGHT_KEY.arrival).turnaroundId;
    const id300 = legOf(TRAFFIC_FLIGHT_KEY.parkedArrival).turnaroundId;
    const morning = '5d000000-0000-4000-8000-000000000050';
    const planning = [
      planTurnaround(id161, { agents: [] }),
      planTurnaround(id300, { status: 'InProgress', stand: { id: 'stand-a2', code: 'A02', terminal: null } }),
      // Completed this morning, before the map's window: it stays on «Escalas».
      planTurnaround(morning, { status: 'Completed', stand: null, agents: [],
        arrival: { id: 'leg-50', flightNumber: 'ZZ50', origin: { iataCode: 'SDQ' }, destination: { iataCode: 'PUJ' },
          scheduledAt: '2026-11-13T11:00:00Z', estimatedAt: null, actualAt: '2026-11-13T11:05:00Z' },
        departure: { id: 'leg-51', flightNumber: 'ZZ51', origin: { iataCode: 'PUJ' }, destination: { iataCode: 'SDQ' },
          scheduledAt: '2026-11-13T12:00:00Z', estimatedAt: null, actualAt: '2026-11-13T12:10:00Z' } }),
    ];
    const { visits } = buildBoard({ flights, planningTurnarounds: planning, nowMs: NOW, t });
    // By the first time of each visit: this morning, ZZ300 on its stand since 22 min ago, ZZ700 gone 8 min ago, then
    // ZZ161 and ZZ500 to come.
    expect(visits.map(item => item.operationCode)).toEqual(['PLAN-050', 'ZZ300-1113', 'ZZ700-1113', 'ZZ161-1113',
      'ZZ500-1113']);

    const visit161 = visits.find(item => item.turnaroundId === id161);
    expect(visit161).toMatchObject({ visitKey: TRAFFIC_FLIGHT_KEY.arrival, standCode: 'A5', source: 'map',
      missing: ['agents'], agentsCount: 0, inOperation: false, airlineName: 'Zeta Air de prueba' });
    expect(visit161.arrival.flightNumber).toBe('ZZ161');
    expect(visit161.departure.flightNumber).toBe('ZZ162');

    const parked = visits.find(item => item.turnaroundId === id300);
    expect(parked).toMatchObject({ missing: [], inOperation: true, onStand: true, ended: false });
    expect([parked.arrival.flightNumber, parked.departure.flightNumber]).toEqual(['ZZ300', 'ZZ301']);
    // ZZ700 pushed back and left: its visit ended; ZZ500 is not in the day's planning snapshot, so nothing is claimed.
    expect(visits.find(item => item.operationCode === 'ZZ700-1113')).toMatchObject({ ended: true, onStand: false });
    expect(visits.find(item => item.operationCode === 'ZZ500-1113')).toMatchObject({ missing: null, agentsCount: null });

    const earlier = visits.find(item => item.turnaroundId === morning);
    expect(earlier).toMatchObject({ source: 'planning', completed: true, missing: [], standCode: null });
    expect(earlier.arrival).toMatchObject({ flightNumber: 'ZZ50', counterpartIata: 'SDQ', flightKey: null,
      time: { at: Date.parse('2026-11-13T11:05:00Z'), kind: 'actual' }, status: { key: 'completed', label: 'Completada' } });
    expect(earlier.departure.counterpartIata).toBe('SDQ');

    // ZZ500 departs tomorrow, past the map's window: its visit takes that leg from the planning snapshot.
    const id500 = legOf(TRAFFIC_FLIGHT_KEY.noFix).turnaroundId;
    const withDeparture = buildBoard({ flights, nowMs: NOW, t, planningTurnarounds: [planTurnaround(id500, {
      stand: { id: 'stand-b30', code: 'B30', terminal: null },
      departure: { id: 'leg-501', flightNumber: 'ZZ501', origin: { iataCode: 'PUJ' }, destination: { iataCode: 'MIA' },
        scheduledAt: '2026-11-14T05:00:00Z', estimatedAt: null, actualAt: null } })] });
    const visit500 = withDeparture.visits.find(item => item.turnaroundId === id500);
    expect(visit500.arrival.flightKey).toBe(TRAFFIC_FLIGHT_KEY.noFix);
    expect(visit500.departure).toMatchObject({ flightNumber: 'ZZ501', flightKey: null, legId: 'leg-501',
      counterpartIata: 'MIA', standCode: 'B30', time: { kind: 'scheduled' } });
    expect(visit500).toMatchObject({ missing: [], agentsCount: 1 });
    // Still one visit per turnaround, and the departure stays off «Salidas», which lists the map's window.
    expect(withDeparture.visits.filter(item => item.turnaroundId === id500)).toHaveLength(1);
    expect(numbers(withDeparture.departures)).not.toContain('ZZ501');
  });

  it('filters visits by derived resource state', () => {
    const id161 = legOf(TRAFFIC_FLIGHT_KEY.arrival).turnaroundId;
    const id300 = legOf(TRAFFIC_FLIGHT_KEY.parkedArrival).turnaroundId;
    const planning = [
      planTurnaround(id161, { stand: null }),
      planTurnaround(id300, { status: 'InProgress' }),
      planTurnaround('5d000000-0000-4000-8000-000000000060', { status: 'Completed', stand: null, agents: [] }),
      // Returned to the agent: still in operation (isInOperation), with the turnaround Confirmed.
      planTurnaround('5d000000-0000-4000-8000-000000000070', { operation: { id: 'op-70', status: 'Returned' } }),
    ];
    const { visits } = buildBoard({ flights: FLIGHTS, planningTurnarounds: planning, nowMs: NOW, t });
    const codes = list => list.map(item => item.operationCode).sort();
    expect(VISIT_FILTERS).toEqual(['all', 'inOperation', 'needsResources', 'completed']);
    expect(filterVisits(visits, 'all')).toHaveLength(visits.length);
    expect(codes(filterVisits(visits, 'inOperation'))).toEqual(['PLAN-070', 'ZZ300-1113', 'ZZ700-1113']);
    // The turnaround without a stand needs resources; a completed one never does.
    expect(codes(filterVisits(visits, 'needsResources'))).toEqual(['ZZ161-1113']);
    expect(codes(filterVisits(visits, 'completed'))).toEqual(['PLAN-060']);
    expect(filterVisits(undefined, 'all')).toEqual([]);
    expect(() => filterVisits(visits, 'inProgress')).toThrow(RangeError);
  });

  it('selects through the one store with the flightKey of the map flight', () => {
    const board = buildBoard({ flights: FLIGHTS, nowMs: NOW, t });
    const strip = board.arrivals.find(item => item.flightNumber === 'ZZ161');
    expect(selectionIdOf(strip, FLIGHTS)).toBe(TRAFFIC_FLIGHT_KEY.arrival);
    // A leg id or a turnaround id (a band bar, a pending item) resolves to the leg the map holds: of a visit, its arrival.
    const parked = legOf(TRAFFIC_FLIGHT_KEY.parkedArrival);
    expect(selectionIdOf({ legId: parked.legId }, FLIGHTS)).toBe(TRAFFIC_FLIGHT_KEY.parkedArrival);
    expect(selectionIdOf({ flightKey: null, turnaroundId: parked.turnaroundId }, FLIGHTS))
      .toBe(TRAFFIC_FLIGHT_KEY.parkedArrival);
    // Without a map flight, the leg id the URL accepts; nothing to select, null.
    expect(selectionIdOf({ flightKey: null, legId: 'leg-50', turnaroundId: 't-50' }, FLIGHTS)).toBe('leg-50');
    expect(selectionIdOf({}, FLIGHTS)).toBeNull();
    // Written and read back by the selection store of the maps lane, every other key of the URL kept.
    const query = writeSelection('stationId=s-1', { selection: { kind: 'flight', id: selectionIdOf(strip, FLIGHTS) } });
    expect(query.get('stationId')).toBe('s-1');
    expect(readSelection(query).selection).toEqual({ kind: 'flight', id: TRAFFIC_FLIGHT_KEY.arrival });
  });
});
