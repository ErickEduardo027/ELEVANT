import { AUDIT_ENTRIES_MOCK } from '../features/human-resources/audit/auditMock';
import { AUDIT_CATEGORY_META } from '../features/human-resources/audit/auditMappers';
import { CURRENT_USER_MOCK } from '../features/human-resources/mockData';

function delay(ms = 220) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function inDateRange(isoString, dateFrom, dateTo) {
  const dateKey = isoString.slice(0, 10);
  if (dateFrom && dateKey < dateFrom) return false;
  if (dateTo && dateKey > dateTo) return false;
  return true;
}

function matchesSearch(entry, search) {
  if (!search) return true;
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [
    entry.affectedUserName,
    entry.executorName,
    entry.actionLabel,
    entry.detail,
    entry.category ? AUDIT_CATEGORY_META[entry.category]?.label : '',
    entry.changes?.map(change => [change.field, change.previousValue, change.nextValue].join(' ')).join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

function matchesActionGroups(entry, actionGroups) {
  if (!actionGroups?.length) return true;
  return actionGroups.includes(entry.category);
}

/**
 * Contrato provisional del módulo de trazabilidad.
 * Hoy resuelve contra el mock local; mañana puede delegarse a REST sin
 * cambiar la firma pública.
 *
 * @param {Object} [filters]
 * @returns {Promise<import('../features/human-resources/audit/auditMock').AuditEntry[]>}
 */
export async function getAuditEntries(filters = {}) {
  await delay(180);

  return structuredClone(AUDIT_ENTRIES_MOCK)
    .filter(entry => matchesSearch(entry, filters.search))
    .filter(entry => matchesActionGroups(entry, filters.actionGroups))
    .filter(entry => !filters.executor || entry.executorName === filters.executor)
    .filter(entry => inDateRange(entry.occurredAt, filters.dateFrom, filters.dateTo))
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
}

/**
 * Simula la exportación del registro de auditoría.
 * @param {{ format: 'pdf' | 'excel', filters?: Record<string, unknown> }} params
 * @returns {Promise<{ reportId: string, format: 'pdf' | 'excel', fileName: string, generatedAt: string, executedBy: string }>}
 */
export async function exportAuditLog({ format, filters = {} }) {
  await delay(900);
  return {
    reportId: 'audit',
    format,
    fileName: `audit-log-${new Date().toISOString().slice(0, 10)}.${format === 'excel' ? 'xlsx' : 'pdf'}`,
    generatedAt: new Date().toISOString(),
    executedBy: CURRENT_USER_MOCK.name,
    filters,
  };
}

