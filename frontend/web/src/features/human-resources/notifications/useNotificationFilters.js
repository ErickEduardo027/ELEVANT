import { useMemo, useState } from 'react';
import {
  computeNotificationCounts,
  extractDateKey,
  matchesNotificationSearch,
  resolveNotificationDateRange,
} from './notificationsMappers';

const INITIAL_FILTERS = {
  category: '',
  severity: '',
  status: '',
  datePreset: '',
  customRange: { from: '', to: '' },
  search: '',
};

function matchesDateRange(notification, range) {
  if (!range) return true;
  const dateKey = extractDateKey(notification.createdAt);
  if (range.from && dateKey < range.from) return false;
  if (range.to && dateKey > range.to) return false;
  return true;
}

export function useNotificationFilters(notifications, nowIso) {
  const [filters, setFilters] = useState(INITIAL_FILTERS);

  function setFilter(key, value) {
    setFilters(current => ({ ...current, [key]: value }));
  }

  function setDatePreset(preset) {
    setFilters(current => ({ ...current, datePreset: preset }));
  }

  function setCustomDate(key, value) {
    setFilters(current => ({ ...current, datePreset: 'custom', customRange: { ...current.customRange, [key]: value } }));
  }

  function resetFilters() {
    setFilters(INITIAL_FILTERS);
  }

  const dateRange = useMemo(() => {
    if (!filters.datePreset) return null;
    return resolveNotificationDateRange(filters.datePreset, filters.customRange.from, filters.customRange.to, nowIso);
  }, [filters.datePreset, filters.customRange, nowIso]);

  const filteredNotifications = useMemo(() => {
    return notifications.filter(notification => {
      if (filters.category && notification.category !== filters.category) return false;
      if (filters.severity && notification.severity !== filters.severity) return false;
      if (filters.status === 'unread' && notification.read) return false;
      if (filters.status === 'read' && !notification.read) return false;
      if (!matchesDateRange(notification, dateRange)) return false;
      if (!matchesNotificationSearch(notification, filters.search)) return false;
      return true;
    });
  }, [notifications, filters, dateRange]);

  const hasActiveFilters = useMemo(
    () =>
      filters.category !== '' ||
      filters.severity !== '' ||
      filters.status !== '' ||
      filters.datePreset !== '' ||
      filters.search !== '',
    [filters]
  );

  const counts = useMemo(() => computeNotificationCounts(notifications), [notifications]);

  return {
    filters,
    setFilter,
    setDatePreset,
    setCustomDate,
    resetFilters,
    hasActiveFilters,
    filteredNotifications,
    counts,
  };
}

