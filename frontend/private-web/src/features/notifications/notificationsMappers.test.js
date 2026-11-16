import { describe, expect, it } from 'vitest';
import {
  computeNotificationCounts,
  formatRelativeTime,
  groupNotificationsByDate,
  matchesNotificationSearch,
  resolveNotificationDateRange,
} from './notificationsMappers';

const NOW_ISO = '2026-08-08T14:00:00-04:00';

function makeNotification(overrides) {
  return {
    id: 'NOT-1',
    category: 'operational',
    severity: 'info',
    title: 'Título',
    description: 'Descripción',
    read: false,
    createdAt: NOW_ISO,
    flightNumber: null,
    airline: null,
    position: null,
    operationId: null,
    relatedModule: null,
    relatedRoute: null,
    source: 'Sistema',
    metadata: {},
    ...overrides,
  };
}

describe('resolveNotificationDateRange', () => {
  it('resolves "today" to the station-local current date', () => {
    expect(resolveNotificationDateRange('today', '', '', NOW_ISO)).toEqual({ from: '2026-08-08', to: '2026-08-08' });
  });

  it('resolves "last30" to a 30-day inclusive span ending today', () => {
    const range = resolveNotificationDateRange('last30', '', '', NOW_ISO);
    expect(range.to).toBe('2026-08-08');
    expect(range.from).toBe('2026-07-10');
  });

  it('resolves "custom" to the provided from/to', () => {
    expect(resolveNotificationDateRange('custom', '2026-08-01', '2026-08-03', NOW_ISO)).toEqual({
      from: '2026-08-01',
      to: '2026-08-03',
    });
  });
});

describe('formatRelativeTime', () => {
  it('formats a 5-minute-old timestamp', () => {
    const fiveMinutesAgo = '2026-08-08T13:55:00-04:00';
    expect(formatRelativeTime(fiveMinutesAgo, NOW_ISO)).toBe('Hace 5 min');
  });

  it('formats a 2-hour-old timestamp', () => {
    const twoHoursAgo = '2026-08-08T12:00:00-04:00';
    expect(formatRelativeTime(twoHoursAgo, NOW_ISO)).toBe('Hace 2 h');
  });

  it('formats yesterday', () => {
    const yesterday = '2026-08-07T10:00:00-04:00';
    expect(formatRelativeTime(yesterday, NOW_ISO)).toBe('Ayer');
  });

  it('formats an older date as a short date', () => {
    const older = '2026-07-01T10:00:00-04:00';
    expect(formatRelativeTime(older, NOW_ISO)).toBe('01 jul');
  });
});

describe('groupNotificationsByDate', () => {
  it('buckets notifications into today/yesterday/week/older and skips empty groups', () => {
    const notifications = [
      makeNotification({ id: 'today-1', createdAt: '2026-08-08T09:00:00-04:00' }),
      makeNotification({ id: 'yesterday-1', createdAt: '2026-08-07T09:00:00-04:00' }),
      makeNotification({ id: 'older-1', createdAt: '2026-07-01T09:00:00-04:00' }),
    ];

    const groups = groupNotificationsByDate(notifications, NOW_ISO);
    const keys = groups.map(group => group.key);

    expect(keys).toEqual(['today', 'yesterday', 'older']);
    expect(groups.find(g => g.key === 'today').items.map(n => n.id)).toEqual(['today-1']);
    expect(groups.find(g => g.key === 'older').items.map(n => n.id)).toEqual(['older-1']);
  });
});

describe('computeNotificationCounts', () => {
  it('computes total, unread, critical and needsAttention', () => {
    const notifications = [
      makeNotification({ id: '1', read: false, severity: 'critical' }),
      makeNotification({ id: '2', read: false, severity: 'warning' }),
      makeNotification({ id: '3', read: true, severity: 'critical' }),
      makeNotification({ id: '4', read: true, severity: 'info' }),
    ];

    expect(computeNotificationCounts(notifications)).toEqual({
      total: 4,
      unread: 2,
      critical: 2,
      needsAttention: 2,
    });
  });
});

describe('matchesNotificationSearch', () => {
  it('matches by flight number, airline, title, description, operation id and position', () => {
    const notification = makeNotification({
      flightNumber: 'DM161',
      airline: 'Arajet',
      title: 'Vuelo fuera de tiempo',
      description: 'no llegó a la posición asignada',
      operationId: 'REV-1002',
      position: 'A5',
    });

    expect(matchesNotificationSearch(notification, 'dm161')).toBe(true);
    expect(matchesNotificationSearch(notification, 'arajet')).toBe(true);
    expect(matchesNotificationSearch(notification, 'REV-1002')).toBe(true);
    expect(matchesNotificationSearch(notification, 'a5')).toBe(true);
    expect(matchesNotificationSearch(notification, 'no-match')).toBe(false);
  });

  it('matches everything when the query is empty', () => {
    expect(matchesNotificationSearch(makeNotification({}), '')).toBe(true);
  });
});