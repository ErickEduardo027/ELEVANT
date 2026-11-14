import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n/languageStore';
import { createMapFlights, TRAFFIC_FLIGHT_KEY, TRAFFIC_NOON } from '../../maps/testing/trafficFixtures';
import { classifyTurnarounds } from '../dashboardModel';
import { buildBoard, filterVisits } from './boardModel';
import { consoleMessages } from './consoleMessages';
import { ARRIVING_WINDOW_MS, buildFigures } from './consoleModel';

const NOW = Date.parse(TRAFFIC_NOON);
const MINUTE = 60_000;
const at = minutes => new Date(NOW + minutes * MINUTE).toISOString();
const t = createTranslator(consoleMessages, 'es');

// Turnarounds of the planning snapshot as the API sends them, with only what the figures read.
const turnaround = (id, status, extra = {}) => ({ id, operationCode: id, status, stand: { code: 'A1' },
  agents: [{ agentId: 'agent-1', displayName: 'Agente de prueba' }], operation: null, ...extra });
const NOTHING = Object.freeze({ turnarounds: null, inOperation: null, arriving60: null, needsResources: null,
  toReview: null, toReviewIsLowerBound: false, completed: null });

describe('buildFigures', () => {
  it('counts in operation with isInOperation (turnaround or operation InProgress/Returned)', () => {
    const turnarounds = [
      turnaround('arrived', 'InProgress'),
      // The demo worker writes the landing and leaves the turnaround Confirmed while the agent works (revision 13).
      turnaround('working', 'Confirmed', { operation: { id: 'op-1', status: 'InProgress' } }),
      turnaround('returned', 'Confirmed', { operation: { id: 'op-2', status: 'Returned' } }),
      turnaround('assigned', 'Confirmed', { operation: { id: 'op-3', status: 'Assigned' } }),
      turnaround('done', 'Completed', { operation: { id: 'op-4', status: 'Approved' } }),
      turnaround('missing', 'Scheduled', { stand: null, agents: [] }),
    ];
    const figures = buildFigures({ planning: { turnarounds }, nowMs: NOW });
    expect(figures).toMatchObject({ turnarounds: 6, inOperation: 3, needsResources: 1, completed: 1 });
    // The old summary counted only the turnaround's own status.
    expect(classifyTurnarounds(turnarounds).inProgress).toHaveLength(1);
  });

  it('a source that has not answered yields null, not zero', () => {
    expect(buildFigures()).toEqual(NOTHING);
    expect(buildFigures({ planning: null, reviewQueue: null, flights: null, nowMs: NOW })).toEqual(NOTHING);

    // Each figure waits for its own read: the planning snapshot alone gives its four.
    const planningOnly = buildFigures({ planning: { turnarounds: [] }, nowMs: NOW });
    expect(planningOnly).toEqual({ ...NOTHING, turnarounds: 0, inOperation: 0, needsResources: 0, completed: 0 });
    // An answered empty queue is a zero; an empty window of flights too.
    expect(buildFigures({ reviewQueue: { operations: [], hasMore: false }, flights: [], nowMs: NOW }))
      .toEqual({ ...NOTHING, toReview: 0, arriving60: 0 });
    // Without the server's time the window cannot be counted.
    expect(buildFigures({ flights: createMapFlights().flights }).arriving60).toBeNull();
  });

  it('counts «Sin recursos» as «Escalas» files them once the board has its visits', () => {
    const { flights } = createMapFlights();
    const id161 = flights.find(flight => flight.flightKey === TRAFFIC_FLIGHT_KEY.arrival).turnaroundId;
    const figureOf = (rows, turnarounds) => {
      const board = buildBoard({ flights: rows, planningTurnarounds: turnarounds, nowMs: NOW, t });
      const figures = buildFigures({ planning: { turnarounds }, visits: board.visits, nowMs: NOW });
      // The figure and the filter of «Escalas» always say the same.
      expect(figures.needsResources).toBe(filterVisits(board.visits, 'needsResources').length);
      return figures.needsResources;
    };

    // Assigned on another screen after the planning snapshot was read: the snapshot has no stand yet, the map flights
    // say A5 (contratos 2.7). The snapshot alone counts it; with the board's visits nothing is missing.
    const unassigned = [turnaround(id161, 'Confirmed', { stand: null })];
    expect(buildFigures({ planning: { turnarounds: unassigned }, nowMs: NOW }).needsResources).toBe(1);
    expect(figureOf(flights, unassigned)).toBe(0);
    // Released on another screen: the snapshot still has its stand, the map flights none.
    const released = flights.map(flight => (flight.turnaroundId === id161 ? { ...flight, stand: null } : flight));
    expect(figureOf(released, [turnaround(id161, 'Confirmed')])).toBe(1);
    // Without the planning snapshot the figure waits for it, whatever the board holds.
    expect(buildFigures({ visits: buildBoard({ flights: released, nowMs: NOW, t }).visits, nowMs: NOW }).needsResources)
      .toBeNull();
  });

  it('review lower bound when hasMore', () => {
    const operations = ['PendingReview', 'InReview', 'Approved', 'Returned', 'PendingReview']
      .map((status, index) => ({ operationId: `op-${index}`, operationCode: `OP-${index}`, status }));
    expect(buildFigures({ reviewQueue: { operations, hasMore: false } })).toMatchObject({ toReview: 3,
      toReviewIsLowerBound: false });
    expect(buildFigures({ reviewQueue: { operations, hasMore: true } })).toMatchObject({ toReview: 3,
      toReviewIsLowerBound: true });
  });

  it('arriving in 60 min is a time window', () => {
    expect(ARRIVING_WINDOW_MS).toBe(60 * MINUTE);
    const { flights } = createMapFlights();
    // ZZ9001 in 5 min, ZZ161 in 10 and ZZ500 in 48; ZZ300 is already on its stand and departures never count.
    expect(buildFigures({ flights, nowMs: NOW }).arriving60).toBe(3);
    // The map flights model counts the same as its rows.
    expect(buildFigures({ flights: { flights }, nowMs: NOW }).arriving60).toBe(3);
    // A quarter of an hour later ZZ9001 and ZZ161 are due already: only ZZ500 is still ahead in the window.
    expect(buildFigures({ flights, nowMs: NOW + 15 * MINUTE }).arriving60).toBe(1);

    const arrival = (key, minutes, extra = {}) => ({ flightKey: key, direction: 'Arrival', phase: 'scheduled',
      scheduledAt: at(minutes), estimatedAt: null, actualAt: null, milestones: [], ...extra });
    const edges = [
      arrival('now', 0), arrival('edge', 60), arrival('past-edge', 61), arrival('late', -1),
      arrival('landed', 20, { phase: 'landed', actualAt: at(-1) }),
      arrival('cancelled', 20, { phase: 'cancelled' }),
      arrival('blocked', 20, { milestones: [{ code: 'BLOCK_ON', actualAt: at(-2) }] }),
      { ...arrival('departure', 30), direction: 'Departure' },
    ];
    // The ends of the window count; a flight landed, cancelled or on its stand does not, whatever its time says.
    expect(buildFigures({ flights: edges, nowMs: NOW }).arriving60).toBe(2);
  });
});
