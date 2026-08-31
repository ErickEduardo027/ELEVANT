import { PERMIT_STATUS_META, getPermitStatusKey, PERMIT_DOCUMENT_TYPE_META, AGENT_PERMIT_STATUS_META, getAgentPermitStatusKey } from './statusMeta';

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(fromDate, toDate) {
  const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((startOfDay(toDate) - startOfDay(fromDate)) / DAY_MS);
}

export function formatDate(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDueLabel(daysRemaining) {
  if (daysRemaining < 0) return `Vencido hace ${Math.abs(daysRemaining)} día${Math.abs(daysRemaining) === 1 ? '' : 's'}`;
  if (daysRemaining === 0) return 'Vence hoy';
  if (daysRemaining === 1) return 'Vence en 1 día';
  return `Vence en ${daysRemaining} días`;
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

// Aplana un AirportPermitRecord en la fila que consumen tabla/drawer. El
// estado nunca se lee de un campo almacenado: se deriva de `expiresAt` +
// "hoy" (mismo criterio que Habilitaciones y certificaciones).
export function mapPermit(record, now = new Date()) {
  const daysRemaining = daysBetween(now, new Date(record.expiresAt));
  const statusKey = getPermitStatusKey(daysRemaining);
  const statusMeta = PERMIT_STATUS_META[statusKey];

  return {
    id: record.id,
    agentId: record.agentId,
    agentName: record.agentName,
    employeeNumber: record.employeeNumber,
    terminals: record.terminals,
    type: record.type,
    typeLabel: PERMIT_DOCUMENT_TYPE_META[record.type].label,
    status: statusKey,
    statusLabel: statusMeta.label,
    statusTone: statusMeta.tone,
    daysRemaining,
    dueLabel: formatDueLabel(daysRemaining),
    record,
  };
}

export function mapPermits(records, now = new Date()) {
  return records.map(record => mapPermit(record, now));
}

// Agrupa los documentos (ya mapeados) por agente en exactamente dos slots
// fijos — carnet y licencia — a diferencia del catálogo variable de
// Habilitaciones. `identityById` aporta identificación/fecha de ingreso
// del catálogo de agentes (no viene en el documento).
export function deriveAgentPermitSummaries(items, identityById = new Map()) {
  const byAgent = new Map();

  for (const item of items) {
    if (!byAgent.has(item.agentId)) {
      byAgent.set(item.agentId, {
        agentId: item.agentId,
        agentName: item.agentName,
        employeeNumber: item.employeeNumber,
        terminals: item.terminals,
        carnet: null,
        licencia: null,
      });
    }
    byAgent.get(item.agentId)[item.type] = item;
  }

  return Array.from(byAgent.values()).map(agent => {
    const documents = [agent.carnet, agent.licencia].filter(Boolean);
    const expiredCount = documents.filter(item => item.status === 'expired').length;
    const expiringSoonCount = documents.filter(item => item.status === 'expiringSoon').length;
    const overallStatus = getAgentPermitStatusKey({ expiredCount, expiringSoonCount });
    const overallMeta = AGENT_PERMIT_STATUS_META[overallStatus];

    const nextExpiration = documents.reduce(
      (earliest, item) => (!earliest || new Date(item.record.expiresAt) < new Date(earliest.record.expiresAt) ? item : earliest),
      null
    );
    const updatedAt = documents.reduce(
      (latest, item) => (!latest || new Date(item.record.updatedAt) > new Date(latest) ? item.record.updatedAt : latest),
      null
    );

    const identity = identityById.get(agent.agentId);

    return {
      ...agent,
      identificationNumber: identity?.identificationNumber,
      hireDate: identity?.hireDate,
      overallStatus,
      overallStatusLabel: overallMeta.label,
      overallStatusTone: overallMeta.tone,
      nextExpirationAt: nextExpiration?.record.expiresAt ?? null,
      updatedAt,
    };
  });
}

// Orden por urgencia (skill.md §"TABLA": "orden por urgencia"): vencidos
// primero, luego próximos a vencer, luego vigentes; dentro de cada grupo,
// por próximo vencimiento y luego por nombre de agente. A diferencia de
// Habilitaciones, este orden no es opcional/seleccionable — es el
// comportamiento por defecto exigido por el skill.
export function sortAgentPermitsByUrgency(summaries) {
  const weight = { action_required: 0, attention: 1, current: 2 };
  return [...summaries].sort((a, b) => {
    const byStatus = weight[a.overallStatus] - weight[b.overallStatus];
    if (byStatus !== 0) return byStatus;
    const byNextExpiration = new Date(a.nextExpirationAt ?? 0) - new Date(b.nextExpirationAt ?? 0);
    if (byNextExpiration !== 0) return byNextExpiration;
    return a.agentName.localeCompare(b.agentName, 'es');
  });
}

export function derivePermitKpis(items) {
  const byType = type => items.filter(item => item.type === type);
  const countBy = (list, status) => list.filter(item => item.status === status).length;
  const carnetItems = byType('carnet');
  const licenciaItems = byType('licencia');

  return {
    carnetActiveCount: countBy(carnetItems, 'current'),
    carnetExpiringSoonCount: countBy(carnetItems, 'expiringSoon'),
    carnetExpiredCount: countBy(carnetItems, 'expired'),
    licenciaActiveCount: countBy(licenciaItems, 'current'),
    licenciaExpiringSoonCount: countBy(licenciaItems, 'expiringSoon'),
    licenciaExpiredCount: countBy(licenciaItems, 'expired'),
  };
}
