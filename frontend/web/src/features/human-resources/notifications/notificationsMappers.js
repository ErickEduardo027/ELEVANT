import { NOTIFICATION_SEVERITY_META } from '../../dashboard/statusMeta';

export const HUMAN_RESOURCES_NOTIFICATION_CATEGORIES = [
  { id: 'expirations', label: 'Vencimientos' },
  { id: 'accounts', label: 'Cuentas' },
  { id: 'coverage', label: 'Cobertura' },
  { id: 'confirmations', label: 'Confirmaciones' },
  { id: 'general', label: 'Generales' },
];

export const HUMAN_RESOURCES_NOTIFICATION_SEVERITIES = Object.entries(NOTIFICATION_SEVERITY_META).map(([id, meta]) => ({
  id,
  label: meta.label,
}));

export const HUMAN_RESOURCES_NOTIFICATION_DATE_PRESETS = [
  { id: 'today', label: 'Hoy' },
  { id: 'yesterday', label: 'Ayer' },
  { id: 'week', label: 'Esta semana' },
  { id: 'last30', label: 'Últimos 30 días' },
  { id: 'custom', label: 'Rango personalizado' },
];

const STATION_UTC_OFFSET_MS = 4 * 60 * 60 * 1000;

function stationDateKey(date) {
  return new Date(date.getTime() - STATION_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

function addDaysToDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() + days);
  return utcDate.toISOString().slice(0, 10);
}

function startOfWeekDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const isoWeekday = utcDate.getUTCDay() === 0 ? 7 : utcDate.getUTCDay();
  return addDaysToDateKey(dateKey, -(isoWeekday - 1));
}

export function extractDateKey(isoString) {
  if (!isoString) return '';
  return stationDateKey(new Date(isoString));
}

export function resolveNotificationDateRange(preset, customFrom, customTo, nowIso) {
  const today = stationDateKey(new Date(nowIso));

  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const yesterday = addDaysToDateKey(today, -1);
      return { from: yesterday, to: yesterday };
    }
    case 'week':
      return { from: startOfWeekDateKey(today), to: today };
    case 'last30':
      return { from: addDaysToDateKey(today, -29), to: today };
    case 'custom':
    default:
      return { from: customFrom || today, to: customTo || today };
  }
}

const SHORT_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function formatDateKeyShort(dateKey) {
  const [, month, day] = dateKey.split('-').map(Number);
  return `${String(day).padStart(2, '0')} ${SHORT_MONTHS[month - 1]}`;
}

export function formatRelativeTime(iso, nowIso) {
  const diffMinutes = Math.max(0, Math.round((new Date(nowIso).getTime() - new Date(iso).getTime()) / 60000));

  if (diffMinutes < 1) return 'Justo ahora';
  if (diffMinutes < 60) return `Hace ${diffMinutes} min`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `Hace ${diffHours} h`;

  const todayKey = extractDateKey(nowIso);
  const yesterdayKey = addDaysToDateKey(todayKey, -1);
  const itemKey = extractDateKey(iso);
  if (itemKey === yesterdayKey) return 'Ayer';

  return formatDateKeyShort(itemKey);
}

export function groupNotificationsByDate(notifications, nowIso) {
  const todayKey = extractDateKey(nowIso);
  const yesterdayKey = addDaysToDateKey(todayKey, -1);
  const weekStartKey = startOfWeekDateKey(todayKey);

  const buckets = {
    today: { key: 'today', label: 'HOY', items: [] },
    yesterday: { key: 'yesterday', label: 'AYER', items: [] },
    week: { key: 'week', label: 'ESTA SEMANA', items: [] },
    older: { key: 'older', label: 'ANTERIORES', items: [] },
  };

  for (const notification of notifications) {
    const itemKey = extractDateKey(notification.createdAt);
    if (itemKey === todayKey) buckets.today.items.push(notification);
    else if (itemKey === yesterdayKey) buckets.yesterday.items.push(notification);
    else if (itemKey >= weekStartKey) buckets.week.items.push(notification);
    else buckets.older.items.push(notification);
  }

  return Object.values(buckets).filter(group => group.items.length > 0);
}

export function computeNotificationCounts(notifications) {
  return {
    total: notifications.length,
    unread: notifications.filter(notification => !notification.read).length,
    critical: notifications.filter(notification => notification.severity === 'critical').length,
    needsAttention: notifications.filter(
      notification => !notification.read && (notification.severity === 'warning' || notification.severity === 'critical')
    ).length,
  };
}

function getSearchableFields(notification) {
  return [
    notification.title,
    notification.description,
    notification.category,
    notification.subjectName,
    notification.reference,
    notification.source,
    notification.relatedModule,
    notification.relatedRoute,
    notification.flightNumber,
    notification.airline,
    notification.position,
    notification.operationId,
    notification.detailFields?.map(field => `${field.label} ${field.value}`).join(' '),
    Object.values(notification.metadata ?? {}).join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function matchesNotificationSearch(notification, query) {
  if (!query) return true;
  return getSearchableFields(notification).includes(query.toLowerCase());
}

export function buildNotificationCategoryLabelMap(categories = HUMAN_RESOURCES_NOTIFICATION_CATEGORIES) {
  return Object.fromEntries(categories.map(category => [category.id, category.label]));
}

