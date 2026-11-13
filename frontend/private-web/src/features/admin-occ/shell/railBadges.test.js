import { describe, expect, it } from 'vitest';
import { ADMIN_OCC_NAVIGATION } from '../navigation';
import { COUNT_PLATE_LIMIT, countPlateText, railBadges } from './railBadges';

const READ_AT = '2026-11-12T17:50:00Z';

// Synthetic notices in the shape of OperationalNotificationResponse, with invented ids.
let sequence = 0;
function notice(kind, overrides = {}) {
  sequence += 1;
  const suffix = String(sequence).padStart(12, '0');
  return { id: `93000000-0000-4000-8000-${suffix}`, operationId: `73000000-0000-4000-8000-${suffix}`,
    operationCode: `OP-${400 + sequence}`, stationCode: 'PUJ', kind, sourceId: `83000000-0000-4000-8000-${suffix}`,
    occurredAt: '2026-11-12T17:45:00Z', readAt: null, ...overrides };
}

describe('railBadges', () => {
  it('counts unread agent messages, unread hand-offs and all unread notices', () => {
    const items = [
      notice('agent_message'),
      notice('agent_message'),
      notice('agent_message', { readAt: READ_AT }),
      notice('operation_submitted'),
      notice('operation_submitted', { readAt: READ_AT }),
      // Unread notices of other kinds count only on «Notificaciones».
      notice('occ_message'),
      notice('incident_reported'),
      notice('kind_from_tomorrow'),
      notice('flight_changed', { readAt: READ_AT }),
    ];

    expect(railBadges(items)).toEqual({ chat: 2, approvals: 1, notifications: 6 });
    // Each count is named after the module that shows it: Chat interno, Revisión and Notificaciones.
    expect(ADMIN_OCC_NAVIGATION.filter(item => item.id in railBadges(items)).map(item => item.path)).toEqual([
      '/admin-occ/review', '/admin-occ/notifications', '/admin-occ/chat',
    ]);
    // Reading every notice clears every plate.
    expect(railBadges(items.map(item => ({ ...item, readAt: READ_AT })))).toEqual({ chat: 0, approvals: 0, notifications: 0 });
  });

  it('counts nothing without a list of notices', () => {
    for (const items of [undefined, null, [], 'notices', { length: 2 }, [null, undefined]]) {
      expect(railBadges(items), String(items)).toEqual({ chat: 0, approvals: 0, notifications: 0 });
    }
  });

  it('spells a count out up to 99 and shows 99+ above it', () => {
    expect(COUNT_PLATE_LIMIT).toBe(99);
    expect([1, 9, 10, 99, 100, 250].map(countPlateText)).toEqual(['1', '9', '10', '99', '99+', '99+']);
  });
});
