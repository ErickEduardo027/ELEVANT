import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n/languageStore';
import { createMapFlights, TRAFFIC_FLIGHT_KEY, TRAFFIC_NOON } from '../../maps/testing/trafficFixtures';
import { createPlanningFlight } from '../../planning/testing/planningFixtures';
import { buildBoard } from './boardModel';
import { consoleMessages } from './consoleMessages';
import { buildPending, PENDING_KINDS } from './pendingModel';

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
