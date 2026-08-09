export const CHAT_QUICK_FILTERS = [
  { id: 'all', label: 'Todas' },
  { id: 'unread', label: 'No leídas' },
  { id: 'active', label: 'En curso' },
  { id: 'pending', label: 'Pendientes' },
  { id: 'closed', label: 'Cerradas' },
];

// PUJ / Atlantic Standard Time — mismo criterio que reviewMappers.js/notificationsMappers.js.
const STATION_UTC_OFFSET_MS = 4 * 60 * 60 * 1000;

function stationDateKey(date) {
  return new Date(date.getTime() - STATION_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

export function extractDateKey(isoString) {
  if (!isoString) return '';
  return stationDateKey(new Date(isoString));
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

const SHORT_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function formatDateKeyLong(dateKey) {
  const [, month, day] = dateKey.split('-').map(Number);
  return `${String(day).padStart(2, '0')} de ${
    ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][
      month - 1
    ]
  }`;
}

export function formatRelativeTime(iso, nowIso) {
  const diffMinutes = Math.max(0, Math.round((new Date(nowIso).getTime() - new Date(iso).getTime()) / 60000));

  if (diffMinutes < 1) return 'Justo ahora';
  if (diffMinutes < 60) return `hace ${diffMinutes} min`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `hace ${diffHours} h`;

  const todayKey = extractDateKey(nowIso);
  const yesterdayKey = addDaysToDateKey(todayKey, -1);
  const itemKey = extractDateKey(iso);
  if (itemKey === yesterdayKey) return 'ayer';

  return `${SHORT_MONTHS[Number(itemKey.split('-')[1]) - 1]} ${itemKey.split('-')[2]}`;
}

// Agrupa el historial de mensajes de una conversación en orden cronológico ascendente
// (a diferencia del feed de Notificaciones, que agrupa de más reciente a más antiguo).
export function groupMessagesByDate(messages, nowIso) {
  const todayKey = extractDateKey(nowIso);
  const yesterdayKey = addDaysToDateKey(todayKey, -1);
  const weekStartKey = startOfWeekDateKey(todayKey);

  const buckets = new Map();

  for (const message of messages) {
    const itemKey = extractDateKey(message.createdAt);
    let bucketKey;
    let label;
    if (itemKey === todayKey) {
      bucketKey = 'today';
      label = 'Hoy';
    } else if (itemKey === yesterdayKey) {
      bucketKey = 'yesterday';
      label = 'Ayer';
    } else if (itemKey >= weekStartKey) {
      bucketKey = 'week';
      label = 'Esta semana';
    } else {
      bucketKey = itemKey;
      label = formatDateKeyLong(itemKey);
    }

    if (!buckets.has(bucketKey)) buckets.set(bucketKey, { key: bucketKey, label, dateKey: itemKey, items: [] });
    buckets.get(bucketKey).items.push(message);
  }

  return [...buckets.values()].sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
}

export function matchesConversationSearch(conversation, query) {
  if (!query) return true;
  const haystack = [
    conversation.flightNumber,
    conversation.airline,
    conversation.agentName,
    conversation.operationId,
    conversation.position,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function computeConversationCounts(conversations) {
  return {
    total: conversations.length,
    unread: conversations.filter(conversation => conversation.unreadCount > 0).length,
    active: conversations.filter(conversation => conversation.status === 'active').length,
    pending: conversations.filter(conversation => conversation.status === 'pending').length,
    closed: conversations.filter(conversation => conversation.status === 'closed').length,
  };
}

export function sortConversationsByRecency(conversations) {
  return [...conversations].sort((a, b) => new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime());
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'];

export function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), SIZE_UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${exponent === 0 ? value : value.toFixed(1)} ${SIZE_UNITS[exponent]}`;
}
