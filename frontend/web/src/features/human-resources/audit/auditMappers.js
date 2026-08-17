export const AUDIT_CATEGORY_META = {
  accounts: { label: 'Cuentas', tone: 'success' },
  roles: { label: 'Roles / permisos', tone: 'active' },
  documents: { label: 'Habilitaciones / carnets', tone: 'warning' },
  assignments: { label: 'Asignaciones', tone: 'warning' },
};

export const AUDIT_ACTION_META = {
  account_created: { label: 'Creación de cuenta', tone: 'success', category: 'accounts' },
  account_activated: { label: 'Activación de cuenta', tone: 'success', category: 'accounts' },
  account_disabled: { label: 'Desactivación de cuenta', tone: 'danger', category: 'accounts' },
  role_changed: { label: 'Cambio de rol', tone: 'active', category: 'roles' },
  permissions_changed: { label: 'Ajuste de permisos', tone: 'active', category: 'roles' },
  user_updated: { label: 'Edición de datos', tone: 'info', category: 'accounts' },
  agent_assigned: { label: 'Asignación operativa', tone: 'warning', category: 'assignments' },
  agent_unassigned: { label: 'Remoción operativa', tone: 'warning', category: 'assignments' },
  qualification_renewed: { label: 'Renovación de habilitación', tone: 'warning', category: 'documents' },
  permit_renewed: { label: 'Renovación de carnet', tone: 'warning', category: 'documents' },
};

export const AUDIT_ACTION_GROUP_OPTIONS = [
  { value: 'accounts', label: 'Cuentas' },
  { value: 'roles', label: 'Roles / permisos' },
  { value: 'documents', label: 'Habilitaciones / carnets' },
  { value: 'assignments', label: 'Asignaciones' },
];

export function getAuditActionMeta(actionType) {
  return AUDIT_ACTION_META[actionType] ?? { label: actionType, tone: 'neutral', category: 'accounts' };
}

export function getAuditCategoryMeta(category) {
  return AUDIT_CATEGORY_META[category] ?? { label: category, tone: 'neutral' };
}

export function formatAuditDateTime(isoString) {
  return new Date(isoString).toLocaleString('es-DO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatAuditTime(isoString) {
  return new Date(isoString).toLocaleTimeString('es-DO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function buildAuditSummary(entries) {
  return {
    total: entries.length,
    accounts: entries.filter(entry => getAuditActionMeta(entry.actionType).category === 'accounts').length,
    roles: entries.filter(entry => getAuditActionMeta(entry.actionType).category === 'roles').length,
    documents: entries.filter(entry => getAuditActionMeta(entry.actionType).category === 'documents').length,
    assignments: entries.filter(entry => getAuditActionMeta(entry.actionType).category === 'assignments').length,
  };
}

export function resolveAuditTimelineGroup(occurredAt, now = new Date()) {
  const date = new Date(occurredAt);
  const todayKey = now.toISOString().slice(0, 10);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);

  const dateKey = date.toISOString().slice(0, 10);
  if (dateKey === todayKey) return 'Hoy';
  if (dateKey === yesterdayKey) return 'Ayer';

  const startOfWeek = new Date(now);
  const day = startOfWeek.getDay();
  const diff = day === 0 ? 6 : day - 1;
  startOfWeek.setDate(startOfWeek.getDate() - diff);
  startOfWeek.setHours(0, 0, 0, 0);

  return date >= startOfWeek ? 'Esta semana' : 'Anteriores';
}

export function groupAuditEntries(entries, now = new Date()) {
  const grouped = entries.reduce(
    (acc, entry) => {
      const group = resolveAuditTimelineGroup(entry.occurredAt, now);
      acc[group].push(entry);
      return acc;
    },
    { Hoy: [], Ayer: [], 'Esta semana': [], Anteriores: [] }
  );

  return Object.entries(grouped)
    .filter(([, items]) => items.length > 0)
    .map(([group, items]) => ({
      group,
      items: items.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)),
    }));
}

export function getEntrySearchableText(entry) {
  return [
    entry.actionLabel,
    entry.affectedUserName,
    entry.executorName,
    entry.detail,
    entry.category,
    entry.changes?.map(change => `${change.field} ${change.previousValue} ${change.nextValue}`).join(' '),
  ]
    .filter(Boolean)
    .join(' ');
}

