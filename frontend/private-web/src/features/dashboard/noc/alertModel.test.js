import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { notificationKindLabel } from '../../notifications/notificationKinds';
import { ALERT_PRIORITIES, alertPriority, alertSummary, buildAlertQueue, isReceived, receivedAt } from './alertModel';

// Every kind of the notices catalogue: the keys of its Spanish labels, without the fallback. The catalogue does not
// export its table, so it is read from the source: a kind added there has to get a priority here.
function catalogueKinds() {
  const source = readFileSync(resolve(process.cwd(), 'src/features/notifications/notificationKinds.js'), 'utf8');
  const spanish = /\r?\n {2}es: \{\r?\n([\s\S]*?)\r?\n {2}\},/.exec(source)?.[1] ?? '';
  return [...spanish.matchAll(/^ {4}([a-z_]+):/gm)].map(([, kind]) => kind).filter(kind => kind !== 'fallback');
}

const URGENT = ['incident_reported'];
const ATTENTION = ['deviation_reported', 'flight_cancelled_by_provider', 'flight_diverted_by_provider', 'agent_released',
  'stand_change_unassigned', 'agent_document_not_current', 'contract_not_in_force'];
const RECEIVED_AT = '2026-11-12T14:05:00Z';

// Synthetic notices in the shape of OperationalNotificationResponse, with invented ids.
let sequence = 0;
function notice(kind, overrides = {}) {
  sequence += 1;
  const suffix = String(sequence).padStart(12, '0');
  return { id: `91000000-0000-4000-8000-${suffix}`, operationId: `71000000-0000-4000-8000-${suffix}`,
    operationCode: `OP-${200 + sequence}`, stationCode: 'PUJ', kind, sourceId: `81000000-0000-4000-8000-${suffix}`,
    occurredAt: '2026-11-12T13:59:00Z', readAt: null, ...overrides };
}

describe('alertPriority', () => {
  it('reads the seventeen kinds of the notices catalogue', () => {
    const kinds = catalogueKinds();
    expect(kinds).toHaveLength(17);
    // Each one is a real kind with a label of its own, not the fallback.
    for (const kind of kinds) expect(notificationKindLabel(kind), kind).not.toBe(notificationKindLabel('kind_unknown'));
    for (const kind of [...URGENT, ...ATTENTION]) expect(kinds).toContain(kind);
  });

  it('incident_reported is urgent whatever its severity', () => {
    expect(alertPriority('incident_reported')).toBe('urgent');
    // The notice carries no severity; whatever a caller adds to it changes nothing.
    for (const severity of ['Low', 'Medium', 'High', 'Critical', undefined]) {
      expect(alertSummary([notice('incident_reported', { severity })]), String(severity))
        .toEqual({ unreceivedCount: 1, highest: 'urgent' });
    }
  });

  it.each(ATTENTION)('deviation, provider cancellation and diversion, agent released, stand change without eligible agent, '
    + 'document and contract not in force ask for attention (%s)', kind => {
    expect(alertPriority(kind)).toBe('attention');
    expect(alertSummary([notice(kind)])).toEqual({ unreceivedCount: 1, highest: 'attention' });
  });

  it('every other kind is a notice, unknown kinds included', () => {
    const others = catalogueKinds().filter(kind => !URGENT.includes(kind) && !ATTENTION.includes(kind));
    // Hand-offs, decisions, messages, assignments, starts and flight changes: none of them is an alert.
    expect(others).toEqual(['operation_submitted', 'operation_approved', 'operation_returned', 'agent_message',
      'occ_message', 'operation_assigned', 'assignment_released', 'operation_started', 'flight_changed']);
    for (const kind of [...others, 'kind_from_a_newer_api', 'INCIDENT_REPORTED', '', null, undefined]) {
      expect(alertPriority(kind), String(kind)).toBe('notice');
      expect(alertSummary([notice(kind)]), String(kind)).toEqual({ unreceivedCount: 0, highest: null });
    }
  });

  it('lists the priorities from the most to the least pressing', () => {
    expect(ALERT_PRIORITIES).toEqual(['urgent', 'attention', 'notice']);
    expect(Object.isFrozen(ALERT_PRIORITIES)).toBe(true);
  });
});

describe('alertSummary', () => {
  it('alertSummary counts only unreceived urgent and attention alerts and names the highest', () => {
    expect(alertSummary([])).toEqual({ unreceivedCount: 0, highest: null });
    expect(alertSummary()).toEqual({ unreceivedCount: 0, highest: null });
    expect(alertSummary(null)).toEqual({ unreceivedCount: 0, highest: null });

    const day = [
      notice('deviation_reported'),
      notice('agent_released'),
      notice('operation_submitted'),
      notice('agent_message'),
      notice('incident_reported', { readAt: RECEIVED_AT }),
      notice('contract_not_in_force', { readAt: RECEIVED_AT }),
    ];
    expect(alertSummary(day)).toEqual({ unreceivedCount: 2, highest: 'attention' });

    // An unreceived incident outranks them wherever it sits in the list.
    expect(alertSummary([...day, notice('incident_reported')])).toEqual({ unreceivedCount: 3, highest: 'urgent' });
    expect(alertSummary([notice('incident_reported'), ...day])).toEqual({ unreceivedCount: 3, highest: 'urgent' });

    // Only notices, or every alert received: nothing to count.
    expect(alertSummary([notice('operation_started'), notice('deviation_reported', { readAt: RECEIVED_AT })]))
      .toEqual({ unreceivedCount: 0, highest: null });
  });

  it('a notice with readAt was received, through the account read receipt', () => {
    expect(isReceived(notice('incident_reported', { readAt: RECEIVED_AT }))).toBe(true);
    expect(isReceived(notice('incident_reported'))).toBe(false);
    expect(isReceived({ kind: 'incident_reported' })).toBe(false);
    expect(isReceived(null)).toBe(false);
    expect(isReceived(undefined)).toBe(false);
  });

  it('receivedAt is the instant of the read receipt, or null', () => {
    expect(receivedAt(notice('deviation_reported', { readAt: RECEIVED_AT }))).toBe(RECEIVED_AT);
    expect(receivedAt(notice('deviation_reported'))).toBeNull();
    expect(receivedAt({ kind: 'deviation_reported' })).toBeNull();
    expect(receivedAt(null)).toBeNull();
  });
});

describe('buildAlertQueue', () => {
  const at = minute => `2026-11-12T14:${String(minute).padStart(2, '0')}:00Z`;
  const ids = entries => entries.map(entry => entry.notice.operationCode);

  it('orders unreceived before received, then urgent before attention, then newest first', () => {
    const items = [
      notice('deviation_reported', { operationCode: 'OP-A10', occurredAt: at(10) }),
      notice('incident_reported', { operationCode: 'OP-U05', occurredAt: at(5) }),
      notice('agent_released', { operationCode: 'OP-A20', occurredAt: at(20) }),
      notice('incident_reported', { operationCode: 'OP-R-U30', occurredAt: at(30), readAt: at(31) }),
      notice('incident_reported', { operationCode: 'OP-U15', occurredAt: at(15) }),
      notice('contract_not_in_force', { operationCode: 'OP-R-A40', occurredAt: at(40), readAt: at(41) }),
      notice('flight_diverted_by_provider', { operationCode: 'OP-R-A25', occurredAt: at(25), readAt: at(26) }),
      notice('operation_submitted', { operationCode: 'OP-N50', occurredAt: at(50) }),
    ];
    const { alerts } = buildAlertQueue(items);
    // Unreceived: urgent (newest first), then attention (newest first); then the received ones in the same order.
    expect(ids(alerts)).toEqual(['OP-U15', 'OP-U05', 'OP-A20', 'OP-A10', 'OP-R-U30', 'OP-R-A40', 'OP-R-A25']);
    expect(alerts.map(entry => entry.priority)).toEqual(['urgent', 'urgent', 'attention', 'attention', 'urgent',
      'attention', 'attention']);
    expect(alerts.map(entry => entry.receivedAt)).toEqual([null, null, null, null, at(31), at(41), at(26)]);
    // Each entry carries the server's notice untouched.
    expect(alerts[0]).toEqual({ id: items[4].id, priority: 'urgent', receivedAt: null, notice: items[4] });
    expect(alerts[0].notice).toBe(items[4]);

    // The order does not depend on the order the server sent them in; a notice without a time goes last.
    const undated = notice('deviation_reported', { operationCode: 'OP-A-NONE', occurredAt: null });
    expect(ids(buildAlertQueue([undated, ...[...items].reverse()]).alerts))
      .toEqual(['OP-U15', 'OP-U05', 'OP-A20', 'OP-A10', 'OP-A-NONE', 'OP-R-U30', 'OP-R-A40', 'OP-R-A25']);
  });

  it('counts only unreceived alerts', () => {
    const items = [
      notice('incident_reported'),
      notice('deviation_reported'),
      notice('stand_change_unassigned'),
      notice('incident_reported', { readAt: RECEIVED_AT }),
      notice('agent_document_not_current', { readAt: RECEIVED_AT }),
      notice('operation_started'),
      notice('agent_message'),
    ];
    const queue = buildAlertQueue(items);
    expect(queue.unreceivedCount).toBe(3);
    // The status bar counts the same alerts.
    expect(queue.unreceivedCount).toBe(alertSummary(items).unreceivedCount);
    expect(queue.alerts).toHaveLength(5);

    // Plain notices are never counted, received or not; nothing at all counts zero.
    expect(buildAlertQueue([notice('flight_changed'), notice('operation_approved', { readAt: RECEIVED_AT })]))
      .toMatchObject({ alerts: [], unreceivedCount: 0 });
    for (const empty of [[], undefined, null, [null, 'text']]) {
      expect(buildAlertQueue(empty), String(empty)).toEqual({ alerts: [], recent: [], unreceivedCount: 0 });
    }
  });

  it('keeps every unreceived alert and at most limitReceived received ones', () => {
    const unreceived = Array.from({ length: 12 }, (_, index) => notice('deviation_reported', { occurredAt: at(index) }));
    const received = Array.from({ length: 12 }, (_, index) => notice('deviation_reported',
      { occurredAt: at(20 + index), readAt: at(40 + index) }));
    const queue = buildAlertQueue([...received, ...unreceived]);
    // Ten received by default, and no unreceived alert is ever cut.
    expect(queue.alerts).toHaveLength(22);
    expect(queue.unreceivedCount).toBe(12);
    expect(queue.alerts.slice(12).map(entry => entry.notice.id))
      .toEqual([...received].reverse().slice(0, 10).map(item => item.id));
    expect(buildAlertQueue([...received, ...unreceived], { limitReceived: 2 }).alerts).toHaveLength(14);
    expect(buildAlertQueue([...received, ...unreceived], { limitReceived: 0 }).alerts).toHaveLength(12);
  });

  it('puts notices in Avisos recientes, newest first, within the limit', () => {
    const notices = [
      notice('operation_submitted', { operationCode: 'OP-N12', occurredAt: at(12) }),
      notice('agent_message', { operationCode: 'OP-N30', occurredAt: at(30), readAt: at(31) }),
      notice('flight_changed', { operationCode: 'OP-N05', occurredAt: at(5) }),
      notice('operation_started', { operationCode: 'OP-N44', occurredAt: at(44) }),
    ];
    const queue = buildAlertQueue([notice('incident_reported', { occurredAt: at(50) }), ...notices]);
    // Read or not, a plain notice is recent and never an alert.
    expect(ids(queue.recent)).toEqual(['OP-N44', 'OP-N30', 'OP-N12', 'OP-N05']);
    expect(queue.recent.every(entry => entry.priority === 'notice')).toBe(true);
    expect(queue.recent[1].receivedAt).toBe(at(31));
    expect(queue.alerts).toHaveLength(1);

    // Ten by default, or the limit asked for.
    const many = Array.from({ length: 14 }, (_, index) => notice('operation_assigned', { occurredAt: at(index) }));
    expect(buildAlertQueue(many).recent).toHaveLength(10);
    expect(buildAlertQueue(many).recent[0].notice).toBe(many[13]);
    expect(ids(buildAlertQueue(notices, { limitRecent: 2 }).recent)).toEqual(['OP-N44', 'OP-N30']);
  });
});
