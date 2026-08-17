import { ACCOUNT_STATUS_META, USER_TYPE_META, PORTAL_META } from './statusMeta';

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(fromDate, toDate) {
  const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((startOfDay(toDate) - startOfDay(fromDate)) / DAY_MS);
}

export function formatRelativeDate(isoString, now = new Date()) {
  if (!isoString) return 'Nunca';
  const days = daysBetween(new Date(isoString), now);
  if (days <= 0) return 'Hoy';
  if (days === 1) return 'Hace 1 día';
  return `Hace ${days} días`;
}

export function formatDate(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatEventDateTime(isoString) {
  return new Date(isoString).toLocaleString('es-DO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function stationOrDepartmentLabel(record, airlinesById) {
  if (record.userType === 'ramp_agent' && record.rampAgent) {
    return record.rampAgent.terminals.length > 1 ? 'Terminal A/B' : `Terminal ${record.rampAgent.terminals[0]}`;
  }
  if (record.userType === 'airline_client' && record.airlineClient) {
    return airlinesById?.[record.airlineClient.airlineId]?.name ?? null;
  }
  if (record.backOffice) return record.backOffice.department;
  return null;
}

// Aplana un UserRecord (identidad + cuenta + acceso) en una fila de tabla.
// El registro completo viaja en `record` para poder abrir el detalle/editar
// sin una segunda llamada al servicio.
export function mapUserToListItem(record, airlinesById = {}) {
  const { identity, account, access, userType } = record;
  const statusMeta = ACCOUNT_STATUS_META[account.status] ?? ACCOUNT_STATUS_META.pending_activation;
  const typeMeta = USER_TYPE_META[userType];
  const portalMeta = PORTAL_META[access.portal];

  return {
    id: identity.id,
    fullName: `${identity.firstName} ${identity.lastName}`,
    email: identity.email,
    avatarUrl: identity.avatarUrl,
    identificationNumber: identity.identificationNumber,
    userType,
    userTypeLabel: typeMeta?.label ?? userType,
    portal: access.portal,
    portalLabel: portalMeta?.label ?? access.portal,
    roleName: access.roleName,
    stationOrDepartmentLabel: stationOrDepartmentLabel(record, airlinesById),
    status: account.status,
    statusLabel: statusMeta.label,
    statusTone: statusMeta.tone,
    createdAt: account.createdAt,
    createdAtLabel: formatDate(account.createdAt),
    lastLoginAt: account.lastLoginAt,
    lastLoginLabel: formatRelativeDate(account.lastLoginAt),
    record,
  };
}

export function mapUsersToListItems(records, airlinesById = {}) {
  return records.map(record => mapUserToListItem(record, airlinesById));
}

// Los KPIs se derivan siempre de la misma lista mapeada (no de contadores
// independientes) para que nunca queden desincronizados con la tabla, igual
// que deriveExpirationKpis en el Dashboard.
export function deriveUserKpis(items) {
  const activeCount = items.filter(item => item.status === 'active').length;
  const pendingCount = items.filter(item => item.status === 'pending_activation' || item.status === 'invitation_sent').length;
  const disabledCount = items.filter(item => item.status === 'disabled' || item.status === 'blocked').length;

  const byPortal = items.reduce((accumulator, item) => {
    accumulator[item.portal] = (accumulator[item.portal] ?? 0) + 1;
    return accumulator;
  }, {});

  return { activeCount, pendingCount, disabledCount, byPortal, total: items.length };
}
