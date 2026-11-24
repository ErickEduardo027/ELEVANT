import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n/languageStore';
import {
  createAirPicture, createDemoBlock, createDemoFlights, createEstimates, createMapFlights, TRAFFIC_FLIGHT_KEY, TRAFFIC_NOON,
  trafficInstant,
} from '../../maps/testing/trafficFixtures';
import { buildSituation, toFlightsModel, toPictureModel } from '../../maps/traffic/situationModel';
import { readSelection, writeSelection } from '../../maps/core/mapSelection';
import {
  BOARD_LEGEND_KEYS, bestTime, boardLegendKeys, buildBoard, filterVisits, flightStatus, providerArrivalStatusKey,
  selectionIdOf, VISIT_FILTERS,
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
      { at: NOW - 22 * MINUTE, kind: 'actual', actualKind: 'OnBlock' }, { at: NOW + 10 * MINUTE, kind: 'estimated' },
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

  it('an actual time keeps the kind the map flights give it: a runway time only says that it landed (N23)', () => {
    const leg = actualKind => ({ scheduledAt: '2026-11-13T15:00:00Z', actualAt: '2026-11-13T14:58:00Z', actualKind });
    expect(bestTime(leg('Runway'))).toEqual({ at: NOW - 2 * MINUTE, kind: 'actual', actualKind: 'Runway' });
    expect(bestTime(leg('OnBlock'))).toEqual({ at: NOW - 2 * MINUTE, kind: 'actual', actualKind: 'OnBlock' });
    // A planning leg tells no kind, and an estimate or a schedule has none.
    expect(bestTime(leg(undefined))).toEqual({ at: NOW - 2 * MINUTE, kind: 'actual' });
    expect(bestTime({ scheduledAt: '2026-11-13T15:00:00Z', actualAt: null, actualKind: null }))
      .toEqual({ at: NOW, kind: 'scheduled' });
    // The strips carry it: ZZ300's on-block time, written by «Registrar llegada», and ZZ700's take-off.
    const board = buildBoard({ flights: FLIGHTS, nowMs: NOW, t });
    expect(board.arrivals.find(item => item.flightNumber === 'ZZ300').time.actualKind).toBe('OnBlock');
    expect(board.departures.find(item => item.flightNumber === 'ZZ700').time.actualKind).toBe('Runway');
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

  it('the legend names only the marks the visible tab draws', () => {
    expect(BOARD_LEGEND_KEYS).toEqual(['attention', 'urgent', 'demo', 'estimated', 'delay']);
    const situation = buildSituation({ picture: toPictureModel(createAirPicture()),
      flights: toFlightsModel(createMapFlights()), nowMs: NOW, estimates: createEstimates() });
    const board = buildBoard({ flights: FLIGHTS, aircraft: situation.aircraft, nowMs: NOW, t });
    // «Llegadas» with «Por importar»: the demo arrival without a stand, due within the hour (amber), demo and estimated.
    const arrivals = [...board.arrivals, ...board.toImport.arrivals];
    expect(arrivals.find(item => item.flightNumber === 'ZZ9001')).toMatchObject({ demo: true, estimated: true,
      status: { key: 'noStand', signal: 'attention' } });
    // The synthetic day also runs a few arrivals late (CN-32): their delay chips add the delay to the legend.
    expect(boardLegendKeys({ strips: arrivals })).toEqual(['attention', 'demo', 'estimated', 'delay']);
    // Without the demo pair and the late ones the same tab has nothing to explain: no legend.
    const plain = arrivals.filter(item => !item.demo && !(item.delayMinutes >= 5));
    expect(plain.some(item => item.status.signal || item.estimated)).toBe(false);
    expect(boardLegendKeys({ strips: plain })).toEqual([]);
    // An urgent strip says so; a strip that is only demo, only that.
    expect(boardLegendKeys({ strips: [{ status: { signal: 'urgent' } }, { demo: true, status: { signal: null } }] }))
      .toEqual(['urgent', 'demo']);
    // «Escalas»: a visit without a stand or an agent draws the amber triangle; a demo visit its plate.
    expect(boardLegendKeys({ visits: [{ missing: ['agents'], demo: false }, { missing: [], demo: true }] }))
      .toEqual(['attention', 'demo']);
    expect(boardLegendKeys({ visits: [{ missing: null }, { missing: [] }] })).toEqual([]);
    expect(boardLegendKeys()).toEqual([]);
    // A delay chip (CN-32) names its meaning from 5 minutes, and the amber triangle it carries from 15.
    const late = minutes => ({ status: { signal: null }, delayMinutes: minutes });
    expect(boardLegendKeys({ strips: [late(4)] })).toEqual([]);
    expect(boardLegendKeys({ strips: [late(8)] })).toEqual(['delay']);
    expect(boardLegendKeys({ strips: [late(20)] })).toEqual(['attention', 'delay']);
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
    // ZZ161 has no stand yet, in the planning snapshot and in the map flights alike.
    const flights = FLIGHTS.map(flight => (flight.turnaroundId === id161 ? { ...flight, stand: null } : flight));
    const planning = [
      planTurnaround(id161, { stand: null }),
      planTurnaround(id300, { status: 'InProgress' }),
      planTurnaround('5d000000-0000-4000-8000-000000000060', { status: 'Completed', stand: null, agents: [] }),
      // Returned to the agent: still in operation (isInOperation), with the turnaround Confirmed.
      planTurnaround('5d000000-0000-4000-8000-000000000070', { operation: { id: 'op-70', status: 'Returned' } }),
    ];
    const { visits } = buildBoard({ flights, planningTurnarounds: planning, nowMs: NOW, t });
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

  it('takes the stand of a visit from its map flights, fresher than the planning snapshot', () => {
    const id161 = legOf(TRAFFIC_FLIGHT_KEY.arrival).turnaroundId;
    const visitOf = board => board.visits.find(item => item.turnaroundId === id161);
    const lacking = board => filterVisits(board.visits, 'needsResources').map(item => item.operationCode);

    // Assigned on another screen after the snapshot was read (contratos 2.7: the map flights are re-read on
    // occ_planning, the snapshot on its 60 s poll): the snapshot has no stand yet, the map flights say A5.
    const assigned = buildBoard({ flights: FLIGHTS, planningTurnarounds: [planTurnaround(id161, { stand: null })],
      nowMs: NOW, t });
    expect(visitOf(assigned)).toMatchObject({ standCode: 'A5', missing: [], source: 'map' });
    expect(visitOf(assigned).arrival.status.key).toBe('approaching');
    expect(lacking(assigned)).toEqual([]);

    // Released on another screen: the snapshot still says A05, the map flights no stand, as the strip says.
    const released = FLIGHTS.map(flight => (flight.turnaroundId === id161 ? { ...flight, stand: null } : flight));
    const freed = buildBoard({ flights: released, planningTurnarounds: [planTurnaround(id161)], nowMs: NOW, t });
    expect(visitOf(freed)).toMatchObject({ standCode: null, missing: ['stand'] });
    expect(visitOf(freed).arrival.status).toMatchObject({ key: 'noStand', label: 'Llegada sin posición asignada' });
    expect(lacking(freed)).toEqual(['ZZ161-1113']);

    // The agents are still the snapshot's: the map flights carry none.
    const unstaffed = buildBoard({ flights: FLIGHTS, nowMs: NOW, t,
      planningTurnarounds: [planTurnaround(id161, { stand: null, agents: [] })] });
    expect(visitOf(unstaffed).missing).toEqual(['agents']);

    // A leg the map's window leaves out takes the stand of its visit too: ZZ501 leaves tomorrow from B30.
    const id500 = legOf(TRAFFIC_FLIGHT_KEY.noFix).turnaroundId;
    const ahead = buildBoard({ flights: FLIGHTS, nowMs: NOW, t, planningTurnarounds: [planTurnaround(id500, {
      stand: null,
      departure: { id: 'leg-501', flightNumber: 'ZZ501', origin: { iataCode: 'PUJ' }, destination: { iataCode: 'MIA' },
        scheduledAt: '2026-11-14T05:00:00Z', estimatedAt: null, actualAt: null } })] });
    expect(ahead.visits.find(item => item.turnaroundId === id500)).toMatchObject({ standCode: 'B30', missing: [],
      departure: { flightNumber: 'ZZ501', flightKey: null, standCode: 'B30' } });
  });

  it('reads «En posición» by the evidence of the stand states, never by the provider’s «Arrived»', () => {
    const id300 = legOf(TRAFFIC_FLIGHT_KEY.parkedArrival).turnaroundId;
    // ZZ300 before its operation starts, so that only the evidence of the stand decides: `milestones` are its
    // operation's (both legs carry them) and `arrival` replaces fields of its arrival leg.
    const flightsWith = (arrival, milestones = []) => FLIGHTS.map(flight => (flight.turnaroundId !== id300 ? flight : {
      ...flight, milestones, turnaround: { ...flight.turnaround, status: 'Confirmed', operationStatus: 'Assigned' },
      ...(flight.direction === 'Arrival' ? arrival : null) }));
    const read = flights => {
      const visit = buildBoard({ flights, nowMs: NOW, t }).visits.find(item => item.turnaroundId === id300);
      return [visit.arrival.status.key, visit.departure.status.key, visit.onStand];
    };
    const arrived = { phase: 'arrived', actualAt: null, actualKind: null };

    // The provider says «Arrived» and nothing recorded the on-block: it landed, it is not on its stand yet.
    expect(read(flightsWith(arrived))).toEqual(['landed', 'scheduled', false]);
    expect(t('status.landed')).toBe('Aterrizó');
    // A runway time only says that it landed, too.
    expect(read(flightsWith({ phase: 'landed', actualAt: trafficInstant(-22 * 60), actualKind: 'Runway' })))
      .toEqual(['landed', 'scheduled', false]);
    // OCC's «Registrar llegada» wrote the on-block time: on its stand, and its departure strip says so as well.
    expect(read(flightsWith({ ...arrived, actualAt: trafficInstant(-22 * 60), actualKind: 'OnBlock' })))
      .toEqual(['onStand', 'onStand', true]);
    // So does a recorded BLOCK_ON, whatever the provider says; and its PUSHBACK ends the visit.
    expect(read(flightsWith(arrived, [{ code: 'BLOCK_ON', actualAt: trafficInstant(-20 * 60) }])))
      .toEqual(['onStand', 'onStand', true]);
    expect(read(flightsWith(arrived, [{ code: 'BLOCK_ON', actualAt: trafficInstant(-20 * 60) },
      { code: 'PUSHBACK', actualAt: trafficInstant(-60) }]))).toEqual(['landed', 'departed', false]);
    // One flight alone reads the same way.
    const [leg] = flightsWith(arrived).filter(flight => flight.flightKey === TRAFFIC_FLIGHT_KEY.parkedArrival);
    expect(flightStatus(leg, { nowMs: NOW }).key).toBe('landed');
    expect(flightStatus({ ...leg, actualAt: trafficInstant(-22 * 60), actualKind: 'OnBlock' }, { nowMs: NOW }).key)
      .toBe('onStand');

    // A demo flight is on its stand from the server's on-block instant (in 5 minutes), not before.
    const demoTurnaround = '5d000000-0000-4000-8000-000000009001';
    const demo = FLIGHTS.map(flight => (flight.visitKey === TRAFFIC_FLIGHT_KEY.demoArrival ? { ...flight,
      imported: true, turnaroundId: demoTurnaround, stand: { id: 'stand-b21', code: 'B21', terminalCode: 'B' } } : flight));
    const demoVisit = nowMs => buildBoard({ flights: demo, nowMs, t }).visits
      .find(item => item.turnaroundId === demoTurnaround);
    expect(demoVisit(NOW)).toMatchObject({ onStand: false, arrival: { status: { key: 'approaching' } } });
    expect(demoVisit(NOW + 6 * MINUTE)).toMatchObject({ onStand: true, arrival: { status: { key: 'onStand' } },
      departure: { status: { key: 'onStand' } } });
  });

  it('says what operation each visit has and when its aircraft left its stand (N30)', () => {
    const visitOf = (board, turnaroundId) => board.visits.find(item => item.turnaroundId === turnaroundId);
    const id700 = legOf(TRAFFIC_FLIGHT_KEY.departed).turnaroundId;
    const board = buildBoard({ flights: FLIGHTS, nowMs: NOW, t });
    // ZZ700 pushed back 14 minutes ago and took off 8 minutes ago: the first evidence, its PUSHBACK, says when it left.
    expect(visitOf(board, id700)).toMatchObject({ operationStatus: 'PendingReview', departedAt: NOW - 14 * MINUTE,
      ended: true });
    // Without its PUSHBACK, its take-off.
    const takeoffOnly = FLIGHTS.map(flight => (flight.turnaroundId === id700 ? { ...flight, milestones: [] } : flight));
    expect(visitOf(buildBoard({ flights: takeoffOnly, nowMs: NOW, t }), id700).departedAt).toBe(NOW - 8 * MINUTE);
    // ZZ300 is still on A2, its operation in progress; ZZ500 has no operation yet. Neither left.
    expect(visitOf(board, legOf(TRAFFIC_FLIGHT_KEY.parkedArrival).turnaroundId))
      .toMatchObject({ operationStatus: 'InProgress', departedAt: null, onStand: true });
    expect(visitOf(board, legOf(TRAFFIC_FLIGHT_KEY.noFix).turnaroundId))
      .toMatchObject({ operationStatus: null, departedAt: null });
    // A diverted or a cancelled arrival ends its visit without leaving the stand.
    const id161 = legOf(TRAFFIC_FLIGHT_KEY.arrival).turnaroundId;
    for (const phase of ['diverted', 'cancelled']) {
      const flights = FLIGHTS.map(flight => (flight.flightKey === TRAFFIC_FLIGHT_KEY.arrival ? { ...flight, phase } : flight));
      expect(visitOf(buildBoard({ flights, nowMs: NOW, t }), id161), phase).toMatchObject({ ended: true, departedAt: null });
    }

    // A demo flight OCC imported: the server's clock took its aircraft off the stand 82 minutes ago (its off-block,
    // 30 minutes after its on-block), with neither a PUSHBACK nor a take-off time on its legs.
    const left = createDemoFlights(createDemoBlock({ imported: true, offBlockAfterMin: 30,
      appearAt: NOW - 120 * MINUTE }), { imported: true });
    const demoId = left.flights.find(flight => flight.flightKey === TRAFFIC_FLIGHT_KEY.demoArrival).turnaroundId;
    expect(visitOf(buildBoard({ flights: left.flights, nowMs: NOW, t }), demoId))
      .toMatchObject({ operationStatus: 'Assigned', departedAt: NOW - 82 * MINUTE, ended: true });
    // An off-block the clock already decided is no departure while the timeline keeps the aircraft parked.
    const parked = createDemoFlights(createDemoBlock({ imported: true, offBlockAfterMin: 30,
      appearAt: NOW - 20 * MINUTE }), { imported: true });
    expect(visitOf(buildBoard({ flights: parked.flights, nowMs: NOW, t }), demoId))
      .toMatchObject({ departedAt: null, onStand: true });

    // A turnaround the map's window leaves out: the planning snapshot's departure time and operation.
    const morning = planTurnaround('5d000000-0000-4000-8000-000000000050', {
      departure: { id: 'leg-51', flightNumber: 'ZZ51', origin: { iataCode: 'PUJ' }, destination: { iataCode: 'SDQ' },
        scheduledAt: '2026-11-13T07:00:00Z', estimatedAt: null, actualAt: '2026-11-13T07:04:00Z' },
      operation: { id: 'op-50', status: 'InProgress' } });
    expect(visitOf(buildBoard({ flights: FLIGHTS, planningTurnarounds: [morning], nowMs: NOW, t }), morning.id))
      .toMatchObject({ source: 'planning', operationStatus: 'InProgress', departedAt: Date.parse('2026-11-13T07:04:00Z') });
    expect(visitOf(buildBoard({ flights: FLIGHTS, planningTurnarounds: [planTurnaround(morning.id)], nowMs: NOW, t }),
      morning.id)).toMatchObject({ operationStatus: null, departedAt: null });
    // The map flights are fresher than the snapshot: ZZ700's operation is theirs.
    const stale = planTurnaround(id700, { operation: { id: 'op-700', status: 'InProgress' } });
    expect(visitOf(buildBoard({ flights: FLIGHTS, planningTurnarounds: [stale], nowMs: NOW, t }), id700).operationStatus)
      .toBe('PendingReview');
  });

  it('names a proposed arrival as the board names its phase, never in the provider’s words (N22)', () => {
    const arrival = (providerStatus, extra = {}) => ({ direction: 'Arrival', flightNumber: 'ZZ9001', providerStatus,
      runwayAt: null, ...extra });
    const said = (providerStatus, extra) => t(`status.${providerArrivalStatusKey(arrival(providerStatus, extra))}`);
    // The server's table (MapFlightPhases.cs, ADR-0042 decision 7): the phase of each word of the provider before the
    // flight's time; a word it does not know, «Landed» and «En Route» among them, is `unknown`.
    const phases = {
      Expected: 'scheduled', Unknown: 'scheduled', CheckIn: 'scheduled', Boarding: 'scheduled', GateClosed: 'scheduled',
      Delayed: 'scheduled', Departed: 'departed', EnRoute: 'enroute', Approaching: 'approaching', Arrived: 'arrived',
      Canceled: 'cancelled', Cancelled: 'cancelled', CanceledUncertain: 'cancelled', Diverted: 'diverted',
      Landed: 'unknown', 'En Route': 'unknown', 'Something else': 'unknown',
    };
    // What the board says of an arrival in that phase, on its assigned stand and not there yet.
    const boardKey = phase => flightStatus({ direction: 'Arrival', phase, stand: { code: 'A05' } },
      { nowMs: NOW, onStand: false }).key;
    for (const [word, phase] of Object.entries(phases)) {
      // In any case and without the spaces around it, as the server reads it.
      for (const written of [word, word.toUpperCase(), word.toLowerCase(), `  ${word}\t`]) {
        expect(providerArrivalStatusKey(arrival(written)), written).toBe(boardKey(phase));
      }
    }

    // Grouped as the board groups them: the provider's nuances are not kept.
    expect(['Approaching', 'Arrived', 'EnRoute', 'Departed', 'Canceled', 'Diverted'].map(word => said(word)))
      .toEqual(['En aproximación', 'Aterrizó', 'En ruta', 'En ruta', 'Cancelado', 'Desviado']);
    expect(['Delayed', 'CheckIn', 'GateClosed', 'Expected'].map(word => said(word))).toEqual(Array(4).fill('Programado'));
    // A word the server does not know is «Sin estado», as on the board.
    expect([said('Holding'), said('Landed'), said('En Route')]).toEqual(Array(3).fill('Sin estado'));
    // Without a word, as a leg nobody reports.
    expect([said(null), said(''), said('   ')]).toEqual(Array(3).fill('Programado'));

    // The runway time decides first: it landed, whatever the provider still says.
    for (const word of ['Expected', 'Approaching', 'Delayed', 'Canceled', 'Something else', null]) {
      expect(providerArrivalStatusKey(arrival(word, { runwayAt: '2026-11-13T14:58:00Z' })), String(word)).toBe('landed');
    }
    expect(said('Expected', { runwayAt: '2026-11-13T14:58:00.1234567+00:00' })).toBe('Aterrizó');

    // Only an arrival: a departure, or no item, has no answer.
    expect(providerArrivalStatusKey({ direction: 'Departure', providerStatus: 'Departed', runwayAt: null })).toBeNull();
    expect(providerArrivalStatusKey({ direction: 'Departure', providerStatus: 'Expected',
      runwayAt: '2026-11-13T14:58:00Z' })).toBeNull();
    expect(providerArrivalStatusKey(null)).toBeNull();
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
