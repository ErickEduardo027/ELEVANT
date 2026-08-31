import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNotificationFilters } from './useNotificationFilters';

const NOW_ISO = '2026-08-08T14:00:00-04:00';

function makeNotification(overrides) {
  return {
    id: 'NOT-1',
    category: 'operational',
    severity: 'info',
    title: 'Vuelo DM161 fuera de tiempo',
    description: 'no llegó a la posición asignada',
    read: false,
    createdAt: NOW_ISO,
    flightNumber: 'DM161',
    airline: 'Arajet',
    position: 'A5',
    operationId: null,
    relatedModule: null,
    relatedRoute: null,
    source: 'Sistema',
    metadata: {},
    ...overrides,
  };
}

const NOTIFICATIONS = [
  makeNotification({ id: '1', category: 'operational', severity: 'warning', read: false }),
  makeNotification({
    id: '2',
    category: 'review',
    severity: 'info',
    read: true,
    createdAt: '2026-08-07T09:00:00-04:00',
    flightNumber: 'AA904',
    airline: 'American Airlines',
    title: 'Nueva operación pendiente de revisión',
    description: 'requiere revisión',
  }),
  makeNotification({ id: '3', category: 'system', severity: 'critical', read: false, flightNumber: null, title: 'FlyAware desconectado' }),
];

describe('useNotificationFilters', () => {
  it('filters independently by category, severity, status and search, combined with AND', () => {
    const { result } = renderHook(() => useNotificationFilters(NOTIFICATIONS, NOW_ISO));

    act(() => result.current.setFilter('category', 'system'));
    expect(result.current.filteredNotifications.map(n => n.id)).toEqual(['3']);

    act(() => result.current.resetFilters());
    act(() => result.current.setFilter('severity', 'critical'));
    expect(result.current.filteredNotifications.map(n => n.id)).toEqual(['3']);

    act(() => result.current.resetFilters());
    act(() => result.current.setFilter('status', 'read'));
    expect(result.current.filteredNotifications.map(n => n.id)).toEqual(['2']);

    act(() => result.current.resetFilters());
    act(() => result.current.setFilter('search', 'dm161'));
    expect(result.current.filteredNotifications.map(n => n.id)).toEqual(['1']);

    act(() => result.current.resetFilters());
    act(() => result.current.setFilter('category', 'operational'));
    act(() => result.current.setFilter('status', 'read'));
    expect(result.current.filteredNotifications).toEqual([]);
  });

  it('filters by date preset', () => {
    const { result } = renderHook(() => useNotificationFilters(NOTIFICATIONS, NOW_ISO));

    act(() => result.current.setDatePreset('today'));
    expect(result.current.filteredNotifications.map(n => n.id).sort()).toEqual(['1', '3']);
  });

  it('resetFilters clears every filter and hasActiveFilters becomes false', () => {
    const { result } = renderHook(() => useNotificationFilters(NOTIFICATIONS, NOW_ISO));

    act(() => result.current.setFilter('category', 'system'));
    expect(result.current.hasActiveFilters).toBe(true);

    act(() => result.current.resetFilters());
    expect(result.current.hasActiveFilters).toBe(false);
    expect(result.current.filteredNotifications).toHaveLength(3);
  });

  it('exposes unfiltered counts for the header strip', () => {
    const { result } = renderHook(() => useNotificationFilters(NOTIFICATIONS, NOW_ISO));
    act(() => result.current.setFilter('category', 'system'));

    expect(result.current.counts).toEqual({ total: 3, unread: 2, critical: 1, needsAttention: 2 });
  });
});
