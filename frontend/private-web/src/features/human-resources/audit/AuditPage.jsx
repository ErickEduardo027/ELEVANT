import { useMemo, useState } from 'react';
import KpiCard from '../../../components/KpiCard';
import Toast from '../../../components/Toast';
import { useToast } from '../../../hooks/useToast';
import { useAuditData } from './useAuditData';
import {
  buildAuditSummary,
  groupAuditEntries,
} from './auditMappers';
import AuditFilterBar from './components/AuditFilterBar';
import AuditTimeline from './components/AuditTimeline';
import AuditSkeleton from './components/AuditSkeleton';
import AuditEmptyState from './components/AuditEmptyState';
import { AlertTriangleIcon, ChecklistIcon, MapPinIcon, RefreshCwIcon, ShieldCheckIcon, UsersIcon } from '../../shell/components/icons';

function createDefaultFilters() {
  return {
    search: '',
    executor: '',
    dateFrom: '',
    dateTo: '',
    actionGroups: [],
  };
}

function isSameFilters(left, right) {
  return (
    left.search === right.search &&
    left.executor === right.executor &&
    left.dateFrom === right.dateFrom &&
    left.dateTo === right.dateTo &&
    left.actionGroups.length === right.actionGroups.length &&
    left.actionGroups.every((value, index) => value === right.actionGroups[index])
  );
}

function filterAuditEntries(entries, filters) {
  const search = filters.search.trim().toLowerCase();

  return entries.filter(entry => {
    if (search) {
      const searchable = [
        entry.affectedUserName,
        entry.executorName,
        entry.actionLabel,
        entry.detail,
        entry.changes?.map(change => [change.field, change.previousValue, change.nextValue].join(' ')).join(' '),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!searchable.includes(search)) return false;
    }

    if (filters.executor && entry.executorName !== filters.executor) return false;
    if (filters.actionGroups.length > 0) {
      if (!filters.actionGroups.includes(entry.category)) return false;
    }

    if (filters.dateFrom && entry.occurredAt.slice(0, 10) < filters.dateFrom) return false;
    if (filters.dateTo && entry.occurredAt.slice(0, 10) > filters.dateTo) return false;
    return true;
  });
}

export default function AuditPage() {
  const { status, entries, error, refresh, exportAuditLog } = useAuditData();
  const { toasts, showToast, dismissToast } = useToast();

  const [filters, setFilters] = useState(() => createDefaultFilters());
  const [expandedEntryId, setExpandedEntryId] = useState(null);

  const executors = useMemo(
    () => Array.from(new Set(entries.map(entry => entry.executorName))).sort((a, b) => a.localeCompare(b, 'es')),
    [entries]
  );

  const filteredEntries = useMemo(() => filterAuditEntries(entries, filters), [entries, filters]);
  const summary = useMemo(() => buildAuditSummary(filteredEntries), [filteredEntries]);
  const groupedEntries = useMemo(() => groupAuditEntries(filteredEntries), [filteredEntries]);

  const hasActiveFilters = !isSameFilters(filters, createDefaultFilters());
  const isLoading = status === 'loading';
  const isError = status === 'error';

  const exportFn = ({ format }) => exportAuditLog({ format, filters });

  function updateFilter(key, value) {
    setFilters(current => ({ ...current, [key]: value }));
    if (key === 'search' || key === 'executor' || key === 'dateFrom' || key === 'dateTo' || key === 'actionGroups') {
      setExpandedEntryId(null);
    }
  }

  function toggleActionGroup(actionGroup) {
    setFilters(current => {
      const nextGroups = current.actionGroups.includes(actionGroup)
        ? current.actionGroups.filter(value => value !== actionGroup)
        : [...current.actionGroups, actionGroup];
      return { ...current, actionGroups: nextGroups };
    });
    setExpandedEntryId(null);
  }

  function resetFilters() {
    setFilters(createDefaultFilters());
    setExpandedEntryId(null);
  }

  function handleExported(result) {
    showToast(`Exportación completada: ${result.fileName}.`, 'success');
  }

  function handleExportError() {
    showToast('No fue posible exportar la trazabilidad. Intente nuevamente.', 'danger');
  }

  if (isError) {
    return (
      <div
        role="alert"
        className="mx-auto flex max-w-[1440px] 3xl:max-w-[1760px] flex-col items-start gap-3 rounded-2xl border border-status-danger/30 bg-white/70 p-6 backdrop-blur-md dark:bg-surface-dark-card"
      >
        <p className="text-sm font-semibold text-status-danger">No fue posible cargar la trazabilidad.</p>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {error?.message ?? 'Verifique la conexión e intente nuevamente.'}
        </p>
        <button
          type="button"
          onClick={refresh}
          className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-4">
      <div className="rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Gestión Humana / Trazabilidad</p>
            <h1 className="text-lg font-semibold text-ink-900 dark:text-text-primary-dark">Trazabilidad / Auditoría</h1>
            <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
              Consulta acciones críticas del sistema: cuentas, roles, permisos, habilitaciones, carnets y asignaciones.
            </p>
          </div>

          <button
            type="button"
            onClick={refresh}
            aria-label="Actualizar"
            className="flex items-center gap-1.5 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs font-medium text-ink-900 hover:bg-black/5 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
          >
            <RefreshCwIcon className="h-3.5 w-3.5" />
            Actualizar
          </button>
        </div>

        <div className="mt-4">
          <AuditFilterBar
            filters={filters}
            executors={executors}
            onFilterChange={updateFilter}
            onToggleActionGroup={toggleActionGroup}
            onResetFilters={resetFilters}
            hasActiveFilters={hasActiveFilters}
            exportReportId="audit"
            exportFn={exportFn}
            onExported={handleExported}
            onExportError={handleExportError}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Total de acciones" value={summary.total} icon={ChecklistIcon} loading={isLoading} />
        <KpiCard label="Cuentas" value={summary.accounts} icon={UsersIcon} loading={isLoading} tone={summary.accounts > 0 ? 'success' : 'default'} />
        <KpiCard label="Roles / permisos" value={summary.roles} icon={ShieldCheckIcon} loading={isLoading} tone={summary.roles > 0 ? 'signal' : 'default'} />
        <KpiCard label="Habilitaciones / carnets" value={summary.documents} icon={AlertTriangleIcon} loading={isLoading} tone={summary.documents > 0 ? 'warning' : 'default'} />
        <KpiCard label="Asignaciones" value={summary.assignments} icon={MapPinIcon} loading={isLoading} tone={summary.assignments > 0 ? 'signal' : 'default'} />
      </div>

      {isLoading ? (
        <AuditSkeleton />
      ) : groupedEntries.length === 0 ? (
        <AuditEmptyState message={hasActiveFilters ? 'No hay resultados para los filtros seleccionados.' : 'No hay acciones registradas.'} />
      ) : (
        <AuditTimeline
          groups={groupedEntries}
          expandedEntryId={expandedEntryId}
          onToggleEntry={entryId => setExpandedEntryId(current => (current === entryId ? null : entryId))}
        />
      )}

      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
