import { SearchIcon, XIcon } from '../../../shell/components/icons';
import ExportButton from '../../../reports/components/ExportButton';
import { AUDIT_ACTION_GROUP_OPTIONS } from '../auditMappers';

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
      <span>{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="rounded-lg border border-black/10 bg-white/80 px-3 py-2 text-sm text-ink-900 focus:border-accent-600 focus:outline-none dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
      >
        <option value="">{`Todos`}</option>
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ActionChip({ label, active, onClick, tone }) {
  const activeClassByTone = {
    success: 'border-status-success bg-status-success/10 text-status-success',
    active: 'border-status-active bg-status-active/10 text-status-active',
    danger: 'border-status-danger bg-status-danger/10 text-status-danger',
    warning: 'border-status-warning bg-status-warning/10 text-status-warning',
    info: 'border-accent-600 bg-accent-600/10 text-accent-600',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? activeClassByTone[tone] ?? activeClassByTone.info
          : 'border-black/10 bg-white/60 text-text-secondary-light hover:text-ink-900 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-secondary-dark dark:hover:text-text-primary-dark'
      }`}
    >
      {label}
    </button>
  );
}

export default function AuditFilterBar({
  filters,
  executors,
  onFilterChange,
  onToggleActionGroup,
  onResetFilters,
  hasActiveFilters,
  exportReportId,
  exportFn,
  onExported,
  onExportError,
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Buscar por usuario afectado o ejecutor</span>
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary-light dark:text-text-secondary-dark" />
          <input
            type="search"
            value={filters.search}
            onChange={event => onFilterChange('search', event.target.value)}
            placeholder="Buscar por usuario afectado o ejecutor"
            className="w-full rounded-lg border border-black/10 bg-transparent py-2 pl-9 pr-3 text-sm text-ink-900 placeholder:text-text-secondary-light focus:border-accent-600 focus:outline-none dark:border-white/10 dark:text-text-primary-dark dark:placeholder:text-text-secondary-dark"
          />
        </label>

        <SelectField
          label="Usuario ejecutor"
          value={filters.executor}
          onChange={value => onFilterChange('executor', value)}
          options={executors.map(executor => ({ value: executor, label: executor }))}
        />

        <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
          <span>Desde</span>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={event => onFilterChange('dateFrom', event.target.value)}
            className="rounded-lg border border-black/10 bg-white/80 px-3 py-2 text-sm text-ink-900 focus:border-accent-600 focus:outline-none dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
          />
        </label>

        <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
          <span>Hasta</span>
          <input
            type="date"
            value={filters.dateTo}
            onChange={event => onFilterChange('dateTo', event.target.value)}
            className="rounded-lg border border-black/10 bg-white/80 px-3 py-2 text-sm text-ink-900 focus:border-accent-600 focus:outline-none dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
          />
        </label>

        <button
          type="button"
          onClick={onResetFilters}
          disabled={!hasActiveFilters}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-black/10 px-3 py-2 text-xs font-medium text-ink-900 transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
        >
          <XIcon className="h-3.5 w-3.5" />
          Limpiar filtros
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {AUDIT_ACTION_GROUP_OPTIONS.map(option => (
          <ActionChip
            key={option.value}
            label={option.label}
            active={filters.actionGroups.includes(option.value)}
            onClick={() => onToggleActionGroup(option.value)}
            tone={option.value === 'accounts' ? 'success' : option.value === 'roles' ? 'active' : 'warning'}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          La búsqueda contempla usuario afectado, ejecutor, acción y detalle.
        </p>
        <ExportButton
          reportId={exportReportId}
          exportFn={exportFn}
          onExported={onExported}
          onExportError={onExportError}
        />
      </div>
    </div>
  );
}
