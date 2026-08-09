import { EXPIRATION_STATUS_META, getExpirationStatusKey } from './statusMeta';

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(fromDate, toDate) {
  const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((startOfDay(toDate) - startOfDay(fromDate)) / DAY_MS);
}

export function formatRelativeDaysAgo(isoString, now = new Date()) {
  const days = daysBetween(new Date(isoString), now);
  if (days <= 0) return 'Hoy';
  if (days === 1) return 'Hace 1 día';
  return `Hace ${days} días`;
}

export function formatDueLabel(daysRemaining) {
  if (daysRemaining < 0) return 'Vencido';
  if (daysRemaining === 0) return 'Vence hoy';
  if (daysRemaining === 1) return 'Vence en 1 día';
  return `Vence en ${daysRemaining} días`;
}

export function formatEventDateTime(isoString) {
  return new Date(isoString).toLocaleString('es-DO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

const EXPIRATION_KIND_ROUTE = {
  certification: 'certifications',
  permit: 'permits',
};

// Enriquece cada vencimiento con días restantes, estado y ruta contextual.
// Los KPIs de "próximas a vencer" / "vencidos" se derivan de esta misma
// lista (no de contadores independientes) para que el panel de
// vencimientos y las tarjetas KPI nunca queden desincronizados.
export function mapExpiration(expiration, now = new Date()) {
  const daysRemaining = daysBetween(now, new Date(expiration.dueDate));
  const statusKey = getExpirationStatusKey(daysRemaining);

  return {
    ...expiration,
    daysRemaining,
    statusKey,
    statusTone: EXPIRATION_STATUS_META[statusKey].tone,
    statusLabel: EXPIRATION_STATUS_META[statusKey].label,
    dueLabel: formatDueLabel(daysRemaining),
    modulePath: `/human-resources/${EXPIRATION_KIND_ROUTE[expiration.kind] ?? 'certifications'}`,
  };
}

export function mapExpirations(expirations, now = new Date()) {
  return expirations
    .map(expiration => mapExpiration(expiration, now))
    .sort((a, b) => a.daysRemaining - b.daysRemaining);
}

export function deriveExpirationKpis(mappedExpirations) {
  return {
    expiringSoonCount: mappedExpirations.filter(item => item.statusKey === 'expiringSoon').length,
    expiredCount: mappedExpirations.filter(item => item.statusKey === 'expired').length,
  };
}
