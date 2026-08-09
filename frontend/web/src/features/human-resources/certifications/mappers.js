import {
  QUALIFICATION_STATUS_META,
  getQualificationStatusKey,
  AGENT_OVERALL_STATUS_META,
  getAgentOverallStatusKey,
  LIMITED_COVERAGE_AGENT_THRESHOLD,
} from './statusMeta';

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
  if (daysRemaining < 0) return `Vencida hace ${Math.abs(daysRemaining)} día${Math.abs(daysRemaining) === 1 ? '' : 's'}`;
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

// Aplana un AgentQualification en la fila que consumen tabla/tarjetas. El
// estado nunca se lee de un campo almacenado: se deriva de `expiresAt` +
// "hoy" (skill.md: "no hardcodear una fecha fija").
export function mapQualification(record, now = new Date()) {
  const daysRemaining = daysBetween(now, new Date(record.expiresAt));
  const statusKey = getQualificationStatusKey(daysRemaining);
  const statusMeta = QUALIFICATION_STATUS_META[statusKey];

  return {
    id: record.id,
    agentId: record.agentId,
    agentName: record.agentName,
    employeeNumber: record.employeeNumber,
    terminals: record.terminals,
    equipmentId: record.equipmentId,
    equipmentName: record.equipmentName,
    status: statusKey,
    statusLabel: statusMeta.label,
    statusTone: statusMeta.tone,
    daysRemaining,
    dueLabel: formatDueLabel(daysRemaining),
    record,
  };
}

export function mapQualifications(records, now = new Date()) {
  return records.map(record => mapQualification(record, now));
}

// Agrupa las habilitaciones (ya mapeadas) por agente — mismo patrón que
// mapUserToListItem/deriveUserKpis: los KPIs y la tabla "Por agente" se
// derivan siempre de esta misma lista para no desincronizarse.
export function deriveAgentSummaries(items) {
  const byAgent = new Map();

  for (const item of items) {
    if (!byAgent.has(item.agentId)) {
      byAgent.set(item.agentId, {
        agentId: item.agentId,
        agentName: item.agentName,
        employeeNumber: item.employeeNumber,
        terminals: item.terminals,
        qualifications: [],
      });
    }
    byAgent.get(item.agentId).qualifications.push(item);
  }

  return Array.from(byAgent.values()).map(agent => {
    const activeCount = agent.qualifications.filter(item => item.status === 'current').length;
    const expiringSoonCount = agent.qualifications.filter(item => item.status === 'expiringSoon').length;
    const expiredCount = agent.qualifications.filter(item => item.status === 'expired').length;
    const overallStatus = getAgentOverallStatusKey({ expiredCount, expiringSoonCount });
    const overallMeta = AGENT_OVERALL_STATUS_META[overallStatus];

    const nextExpiration = agent.qualifications.reduce(
      (earliest, item) => (!earliest || new Date(item.record.expiresAt) < new Date(earliest.record.expiresAt) ? item : earliest),
      null
    );
    const updatedAt = agent.qualifications.reduce(
      (latest, item) => (!latest || new Date(item.record.updatedAt) > new Date(latest) ? item.record.updatedAt : latest),
      null
    );

    return {
      ...agent,
      activeCount,
      expiringSoonCount,
      expiredCount,
      nextExpirationAt: nextExpiration?.record.expiresAt ?? null,
      overallStatus,
      overallStatusLabel: overallMeta.label,
      overallStatusTone: overallMeta.tone,
      updatedAt,
    };
  });
}

// Orden inicial exigido por el skill: vencidos primero, luego próximos a
// vencer, luego vigentes; dentro de cada grupo, por nombre de agente.
export function sortAgentSummariesByDefault(summaries) {
  const weight = { action_required: 0, attention: 1, current: 2 };
  return [...summaries].sort((a, b) => {
    const byStatus = weight[a.overallStatus] - weight[b.overallStatus];
    if (byStatus !== 0) return byStatus;
    return a.agentName.localeCompare(b.agentName, 'es');
  });
}

export function deriveQualificationKpis(items) {
  const activeCount = items.filter(item => item.status === 'current').length;
  const expiringSoonCount = items.filter(item => item.status === 'expiringSoon').length;
  const expiredCount = items.filter(item => item.status === 'expired').length;
  const agentsWithExpiredCount = new Set(items.filter(item => item.status === 'expired').map(item => item.agentId)).size;

  return { activeCount, expiringSoonCount, expiredCount, agentsWithExpiredCount };
}

// Cobertura operativa por tipo de equipo (skill.md §"VISTA POR TIPO DE
// EQUIPO"). `coveragePercent` es null cuando no hay ningún agente habilitado
// — no se fuerza un 0% engañoso.
export function deriveEquipmentCoverage(items, catalog) {
  return catalog.map(equipment => {
    const qualifications = items.filter(item => item.equipmentId === equipment.id);
    const totalAgents = qualifications.length;
    const activeCount = qualifications.filter(item => item.status === 'current').length;
    const expiringSoonCount = qualifications.filter(item => item.status === 'expiringSoon').length;
    const expiredCount = qualifications.filter(item => item.status === 'expired').length;
    const terminals = Array.from(new Set(qualifications.flatMap(item => item.terminals))).sort();

    return {
      equipmentId: equipment.id,
      equipmentName: equipment.name,
      terminals,
      totalAgents,
      activeCount,
      expiringSoonCount,
      expiredCount,
      coveragePercent: totalAgents > 0 ? Math.round((activeCount / totalAgents) * 100) : null,
      limitedCoverage: totalAgents > 0 && totalAgents <= LIMITED_COVERAGE_AGENT_THRESHOLD,
      qualifications,
    };
  });
}
