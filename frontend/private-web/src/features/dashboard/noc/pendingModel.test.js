import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n/languageStore';
import { createMapFlights, TRAFFIC_FLIGHT_KEY, TRAFFIC_NOON, trafficInstant } from '../../maps/testing/trafficFixtures';
import { createPlanningFlight } from '../../planning/testing/planningFixtures';
import { buildBoard } from './boardModel';
import { consoleMessages } from './consoleMessages';
import { buildPending, PENDING_KINDS, PENDING_NOTE_KINDS, PENDING_SOURCES, pendingCoverage } from './pendingModel';

// 11:40 at Punta Cana on the planning fixtures' day: their arrival is estimated at 12:10.
const NOW = Date.parse('2026-08-19T15:40:00Z');
const t = createTranslator(consoleMessages, 'es');
const summary = items => items.map(item => [item.kind, item.priority, item.label]);

// A turnaround of the planning fixtures arriving at `localTime` (Punta Cana), synthetic.
function flightAt(id, flightNumber, localTime, overrides = {}) {
  const base = createPlanningFlight();
  return createPlanningFlight({
    id, turnaroundId: id, operationCode: `DEV-${id}`,
    arrival: { ...base.arrival, id: `leg-${id}`, flightNumber, scheduledAt: `2026-08-19T${localTime}:00-04:00`,
      estimatedAt: null, actualAt: null },
    departure: null,
    ...overrides,
  });
}

const unfit = (turnaroundId, number) => ({ assignmentId: `assignment-${number}`, turnaroundId,
  agentId: `agent-${number}`, reasons: ['airport_permit_not_current'] });

// The arrival of a planning turnaround as the map flights give it (contratos 1.3), on `stand` (null: none), synthetic:
// the shape of the map lab's ZZ161 with the turnaround's own identifiers and times.
function mapArrivalOf(flight, stand) {
  const base = createMapFlights().flights.find(item => item.flightKey === TRAFFIC_FLIGHT_KEY.arrival);
  return { ...base, flightKey: `l:${flight.arrival.id}`, visitKey: `t:${flight.turnaroundId}`, proposalId: null,
    legId: flight.arrival.id, turnaroundId: flight.turnaroundId, flightNumber: flight.arrival.flightNumber,
    scheduledAt: flight.arrival.scheduledAt, estimatedAt: flight.arrival.estimatedAt, actualAt: null, phase: 'enroute',
    turnaround: { id: flight.turnaroundId, operationCode: flight.operationCode, status: flight.status, operationId: null,
      operationStatus: 'Planned' },
    stand: stand === null ? null : { id: `stand-${stand}`, code: stand, terminalCode: 'B' }, milestones: [] };
}

describe('buildPending', () => {
  it('a turnaround without agent due soon is pending with Asignar agente', () => {
    const due = createPlanningFlight({ assignedAgents: [], agents: [] });
    const later = flightAt('t-later', 'ZZ104', '15:00', { assignedAgents: [], agents: [] });
    const closed = flightAt('t-closed', 'ZZ106', '12:30', { status: 'Completed', assignedAgents: [], stand: null });
    const pending = buildPending({ planningFlights: [later, closed, due], nowMs: NOW, t });
    // Due in 30 minutes, within the hour: attention. In 3 h 20 min: a plain notice. A completed turnaround is not pending.
    expect(summary(pending)).toEqual([
      ['noAgent', 'attention', 'ZZ102 sin agente, llega en 30 min'],
      ['noAgent', 'notice', 'ZZ104 sin agente, llega en 3 h 20 min'],
    ]);
    expect(pending[0]).toMatchObject({ id: `noAgent:${due.turnaroundId}`, turnaroundId: due.turnaroundId,
      at: Date.parse('2026-08-19T16:10:00Z'), action: { kind: 'assign', target: due.turnaroundId } });
    expect(t(`pending.actions.${pending[0].action.kind}`)).toBe('Asignar agente');

    // Without a stand it also asks for one; a time that passed says so, honestly.
    const late = flightAt('t-late', 'ZZ108', '11:30', { stand: null, assignedAgents: [], agents: [] });
    const landed = flightAt('t-landed', 'ZZ110', '11:20', { stand: null });
    landed.arrival.actualAt = '2026-08-19T11:25:00-04:00';
    const both = buildPending({ planningFlights: [late, landed], nowMs: NOW, t });
    expect(summary(both)).toEqual([
      ['noStand', 'attention', 'ZZ110 sin posición, llegó hace 15 min'],
      ['noStand', 'attention', 'ZZ108 sin posición, debía llegar hace 10 min'],
      ['noAgent', 'attention', 'ZZ108 sin agente, debía llegar hace 10 min'],
    ]);
    expect(both[0].action).toEqual({ kind: 'chooseStand', target: 't-landed' });
    expect(t('pending.actions.chooseStand')).toBe('Elegir posición');
  });

  it('decides «sin posición» with the stand of the map flights when the board holds the visit', () => {
    // Assigned on another screen after the planning snapshot was read (contratos 2.7: the map flights are re-read on
    // occ_planning, the snapshot on its 60 s poll): the snapshot has no stand yet, the map flights say B20.
    const unassigned = createPlanningFlight({ stand: null });
    const assigned = buildBoard({ flights: [mapArrivalOf(unassigned, 'B20')], nowMs: NOW, t });
    expect(assigned.arrivals[0].standCode).toBe('B20');
    expect(buildPending({ board: assigned, planningFlights: [unassigned], nowMs: NOW, t })).toEqual([]);

    // Released on another screen: the snapshot still says A02, the map flights no stand, as the board's strip says.
    const planned = createPlanningFlight();
    const released = buildBoard({ flights: [mapArrivalOf(planned, null)], nowMs: NOW, t });
    expect(released.arrivals[0].status.label).toBe('Llegada sin posición asignada');
    const pending = buildPending({ board: released, planningFlights: [planned], nowMs: NOW, t });
    expect(summary(pending)).toEqual([['noStand', 'attention', 'ZZ102 sin posición, llega en 30 min']]);
    expect(pending[0]).toMatchObject({ flightKey: `l:${planned.arrival.id}`,
      action: { kind: 'chooseStand', target: planned.turnaroundId } });

    // Without its visit on the board, the snapshot decides.
    expect(buildPending({ planningFlights: [unassigned], nowMs: NOW, t }).map(item => item.kind)).toEqual(['noStand']);
    expect(buildPending({ planningFlights: [planned], nowMs: NOW, t })).toEqual([]);
  });

  it('an aircraft past its departure time is overdue only when it is on its stand', () => {
    const later = Date.parse(TRAFFIC_NOON) + 45 * 60_000;
    const { flights } = createMapFlights();
    const id300 = flights.find(flight => flight.flightKey === TRAFFIC_FLIGHT_KEY.parkedArrival).turnaroundId;
    // ZZ300 without its BLOCK_ON and before its operation starts: only its arrival leg says where the aircraft is.
    const withArrival = arrival => flights.map(flight => (flight.turnaroundId !== id300 ? flight : { ...flight,
      milestones: [], turnaround: { ...flight.turnaround, status: 'Confirmed', operationStatus: 'Assigned' },
      ...(flight.direction === 'Arrival' ? arrival : null) }));
    const overdue = arrival => buildPending({ board: buildBoard({ flights: withArrival(arrival), nowMs: later, t }),
      nowMs: later, t }).filter(item => item.kind === 'overdue').map(item => item.label);

    // The provider says «Arrived»: it landed, and nothing says that it is on its stand, as the stand reads it.
    expect(overdue({ phase: 'arrived', actualAt: null, actualKind: null })).toEqual([]);
    // OCC's «Registrar llegada» wrote its on-block time: on its stand, 5 minutes past its departure time.
    expect(overdue({ phase: 'arrived', actualAt: trafficInstant(-22 * 60), actualKind: 'OnBlock' }))
      .toEqual(['ZZ301 pasó su hora de salida']);
  });

  it('an arrival the map flights give with its runway time «aterrizó hace», never «llegó» (N23)', () => {
    // ZZ102 touched down 12 minutes ago, as the feed or the demo worker writes it, and nobody is assigned yet.
    const flight = createPlanningFlight({ assignedAgents: [], agents: [] });
    const boardWith = actualKind => buildBoard({ flights: [{ ...mapArrivalOf(flight, 'A02'), phase: 'landed',
      actualAt: new Date(NOW - 12 * 60_000).toISOString(), actualKind }], nowMs: NOW, t });
    const labels = (actualKind, translate = t) => buildPending({ board: boardWith(actualKind), planningFlights: [flight],
      nowMs: NOW, t: translate }).map(item => item.label);
    expect(labels('Runway')).toEqual(['ZZ102 sin agente, aterrizó hace 12 min']);
    expect(labels('Runway', createTranslator(consoleMessages, 'en'))).toEqual(['ZZ102 without an agent, landed 12 min ago']);
    // OCC's «Registrar llegada» writes its on-block time: then it arrived.
    expect(labels('OnBlock')).toEqual(['ZZ102 sin agente, llegó hace 12 min']);

    // A demo flight to import that already landed says so too.
    const noon = Date.parse(TRAFFIC_NOON);
    const flights = createMapFlights().flights.map(item => (item.flightKey !== TRAFFIC_FLIGHT_KEY.demoArrival ? item
      : { ...item, phase: 'landed', actualAt: new Date(noon - 2 * 60_000).toISOString(), actualKind: 'Runway' }));
    expect(summary(buildPending({ board: buildBoard({ flights, nowMs: noon, t }), nowMs: noon, t })))
      .toEqual([['toImport', 'attention', 'ZZ9001 por importar, aterrizó hace 2 min']]);
  });

  it('a readiness mark becomes agentCannotOperate', () => {
    const flight = createPlanningFlight();
    const readiness = { stationId: 'station', date: '2026-08-19',
      assignments: [unfit(flight.turnaroundId, 1), unfit(flight.turnaroundId, 2)] };
    const pending = buildPending({ planningFlights: [flight], readiness, nowMs: NOW, t });
    // One item for the turnaround, whatever the number of unfit agents; it has agents, so nothing else is pending.
    expect(summary(pending)).toEqual([['agentCannotOperate', 'attention', 'ZZ102: un agente asignado no puede operar']]);
    expect(pending[0].action).toEqual({ kind: 'assign', target: flight.turnaroundId });
    expect(buildPending({ planningFlights: [flight], readiness: { assignments: [] }, nowMs: NOW, t })).toEqual([]);
  });

  it('awaiting-decision reviews become Revisar', () => {
    const operations = [
      { operationId: 'op-1', operationCode: 'OP-0412', status: 'PendingReview', submittedAt: '2026-08-19T14:00:00Z' },
      { operationId: 'op-2', operationCode: 'OP-0409', status: 'InReview', submittedAt: '2026-08-19T13:00:00Z' },
      { operationId: 'op-3', operationCode: 'OP-0401', status: 'Approved', submittedAt: '2026-08-19T12:00:00Z' },
    ];
    const pending = buildPending({ reviewQueue: { operations, hasMore: false }, nowMs: NOW, t });
    expect(summary(pending)).toEqual([
      ['toReview', 'notice', 'OP-0409 por revisar'],
      ['toReview', 'notice', 'OP-0412 por revisar'],
    ]);
    expect(pending.map(item => item.action))
      .toEqual([{ kind: 'review', target: 'op-2' }, { kind: 'review', target: 'op-1' }]);
    expect(t('pending.actions.review')).toBe('Revisar');
  });

  it('a demo proposal to import is pending with Importar', () => {
    const noon = Date.parse(TRAFFIC_NOON);
    const { flights } = createMapFlights();
    const board = buildBoard({ flights, nowMs: noon, t });
    const pending = buildPending({ board, nowMs: noon, t });
    // The pair is imported from its arrival: one item, amber, due in 5 minutes.
    expect(summary(pending)).toEqual([['toImport', 'attention', 'ZZ9001 por importar, llega en 5 min']]);
    const proposalId = flights.find(flight => flight.flightKey === TRAFFIC_FLIGHT_KEY.demoArrival).proposalId;
    expect(pending[0]).toMatchObject({ flightKey: TRAFFIC_FLIGHT_KEY.demoArrival,
      action: { kind: 'import', target: proposalId } });
    expect(t('pending.actions.import')).toBe('Importar');
    // In English inside the scope.
    expect(buildPending({ board, nowMs: noon, t: createTranslator(consoleMessages, 'en') })[0].label)
      .toBe('ZZ9001 to import, arrives in 5 min');
  });

  it('orders by priority then time', () => {
    expect(PENDING_KINDS).toEqual(['noStand', 'noAgent', 'agentCannotOperate', 'toImport', 'toReview', 'overdue']);
    const soon = createPlanningFlight({ assignedAgents: [], agents: [] });
    const landed = flightAt('t-landed', 'ZZ200', '11:30', { stand: null });
    landed.arrival.actualAt = '2026-08-19T11:25:00-04:00';
    const marked = flightAt('t-marked', 'ZZ300', '13:00');
    const evening = flightAt('t-evening', 'ZZ400', '15:00', { assignedAgents: [], agents: [] });
    const pending = buildPending({
      planningFlights: [evening, marked, soon, landed],
      readiness: { assignments: [unfit('t-marked', 1), unfit('t-unknown', 2)] },
      reviewQueue: { operations: [{ operationId: 'op-1', operationCode: 'OP-0412', status: 'PendingReview',
        submittedAt: '2026-08-19T14:00:00Z' }] },
      nowMs: NOW, t,
    });
    // Attention first, by time; then the notices by time. The mark of a turnaround the snapshot does not hold yet
    // waits for its next read.
    expect(pending.map(item => [item.priority, item.label])).toEqual([
      ['attention', 'ZZ200 sin posición, llegó hace 15 min'],
      ['attention', 'ZZ102 sin agente, llega en 30 min'],
      ['attention', 'ZZ300: un agente asignado no puede operar'],
      ['notice', 'OP-0412 por revisar'],
      ['notice', 'ZZ400 sin agente, llega en 3 h 20 min'],
    ]);

    // An aircraft still on its stand after its departure time is overdue (the board's visits), with no action.
    const noon = Date.parse(TRAFFIC_NOON);
    const board = buildBoard({ flights: createMapFlights().flights, nowMs: noon + 45 * 60_000, t });
    const overdue = buildPending({ board, nowMs: noon + 45 * 60_000, t }).filter(item => item.kind === 'overdue');
    expect(summary(overdue)).toEqual([['overdue', 'attention', 'ZZ301 pasó su hora de salida']]);
    expect(overdue[0]).toMatchObject({ action: null, flightKey: TRAFFIC_FLIGHT_KEY.parkedDeparture });
  });
});

describe('pendingCoverage', () => {
  const source = (id, status, extra = {}) => ({ id, status, staleSince: null, onRetry: undefined, ...extra });
  const kinds = coverage => coverage.notes.map(note => [note.id, note.kind]);

  it('says nothing while every read answered and is current', () => {
    expect(PENDING_SOURCES).toEqual(['planning', 'readiness', 'flights', 'reviewQueue']);
    expect(PENDING_NOTE_KINDS).toEqual(['loading', 'failed', 'refused', 'stale']);
    const coverage = pendingCoverage(PENDING_SOURCES.map(id => source(id, id === 'planning' ? 'empty' : 'success')));
    // A day without turnarounds is an answer like any other: an empty list may say that nothing is pending.
    expect(coverage).toEqual({ loading: false, complete: true, notes: [] });
  });

  it('waits for the first answer, then lets each read blank only its own items', () => {
    // Nothing answered and something on its way: the list waits.
    expect(pendingCoverage([source('planning', 'loading'), source('flights', 'idle')]).loading).toBe(true);
    // The map flights answered first: their items show, with a line for the read still on its way.
    const early = pendingCoverage([source('planning', 'loading'), source('flights', 'success'),
      source('reviewQueue', 'success')]);
    expect([early.loading, early.complete]).toEqual([false, false]);
    expect(kinds(early)).toEqual([['planning', 'loading']]);

    // A refused planning and a failed queue: their lines, never a claim that nothing is pending.
    const retry = () => {};
    const refused = pendingCoverage([source('planning', 'forbidden'), source('flights', 'success'),
      source('reviewQueue', 'error', { onRetry: retry }), source('readiness', 'unauthorized')]);
    expect([refused.loading, refused.complete]).toEqual([false, false]);
    expect(kinds(refused)).toEqual([['planning', 'refused'], ['reviewQueue', 'failed'], ['readiness', 'refused']]);
    expect(refused.notes[1].onRetry).toBe(retry);
    expect(refused.notes[0].onRetry).toBeNull();
    // Nothing answered and nothing on its way: no wait, only the lines.
    const down = pendingCoverage([source('planning', 'timeout'), source('flights', 'error')]);
    expect([down.loading, down.complete]).toEqual([false, false]);
    expect(kinds(down)).toEqual([['planning', 'failed'], ['flights', 'failed']]);

    // A read whose last refresh failed keeps its items and says since when.
    const stale = pendingCoverage([source('planning', 'success', { staleSince: '2026-08-19T15:32:00Z' }),
      source('flights', 'success')]);
    expect(stale.complete).toBe(true);
    expect(stale.notes).toEqual([{ id: 'planning', kind: 'stale', staleSince: '2026-08-19T15:32:00Z', onRetry: null }]);
    // Reads it does not know, and nothing at all, are not reads of the list.
    expect(pendingCoverage([source('weather', 'error'), null])).toEqual({ loading: false, complete: false, notes: [] });
    expect(pendingCoverage()).toEqual({ loading: false, complete: false, notes: [] });
  });

  it('names every read and every note in both languages', () => {
    for (const language of ['es', 'en']) {
      const translate = createTranslator(consoleMessages, language);
      for (const id of PENDING_SOURCES) expect(translate(`pending.sources.${id}`), `${language}: ${id}`).not.toMatch(/^pending/);
      for (const kind of PENDING_NOTE_KINDS) {
        expect(translate(`pending.notes.${kind}`, { source: 'X', time: '14:32' }), `${language}: ${kind}`).toContain('X');
      }
    }
    expect(t('pending.notes.failed', { source: t('pending.sources.planning') }))
      .toBe('La consulta de la planificación del día falló.');
    expect(t('pending.notes.refused', { source: t('pending.sources.reviewQueue') }))
      .toBe('No tienes permiso para ver la cola de revisión.');
    expect(t('pending.notes.stale', { source: t('pending.sources.flights'), time: '14:32' }))
      .toBe('La última actualización de los vuelos del mapa falló; se muestra lo consultado a las 14:32.');
  });
});
