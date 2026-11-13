import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { notificationKindLabel } from '../../notifications/notificationKinds';
import { ALERT_PRIORITIES, alertPriority, alertSummary, isReceived } from './alertModel';

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
});
