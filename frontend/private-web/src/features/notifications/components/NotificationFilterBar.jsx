import { SearchIcon } from '../../planning/components/icons';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_DATE_PRESETS, NOTIFICATION_SEVERITIES } from '../notificationsMappers';

const STATUS_OPTIONS = [
  { id: '', label: 'Todas' },
  { id: 'unread', label: 'Solo no leídas' },
  { id: 'read', label: 'Leídas' },
];

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label className="flex min-w-[160px] flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
      {label}
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="rounded-lg border border-black/10 bg-white/80 px-2 py-1.5 text-sm text-ink-900 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
      >
        {options.map(option => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function NotificationFilterBar({
  filters,
  onFilterChange,
  onDatePreset,
  onCustomDate,
  onResetFilters,
  hasActiveFilters,
  categoryOptions = NOTIFICATION_CATEGORIES,
  severityOptions = NOTIFICATION_SEVERITIES,
  datePresetOptions = NOTIFICATION_DATE_PRESETS,
  statusOptions = STATUS_OPTIONS,
  searchPlaceholder = 'Buscar por vuelo, referencia o descripción...',
  statusControlVariant = 'select',
}) {
  const isStatusToggle = statusControlVariant === 'toggle';

  return (
    <div className="space-y-3 rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
          Búsqueda
          <span className="relative">
            <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-secondary-light dark:text-text-secondary-dark" />
            <input
              type="text"
              value={filters.search}
              onChange={event => onFilterChange('search', event.target.value)}
              placeholder={searchPlaceholder}
              className="w-full rounded-lg border border-black/10 bg-white/80 py-1.5 pl-7 pr-2 text-sm text-ink-900 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
            />
          </span>
        </label>

        <FilterSelect
          label="Categoría"
          value={filters.category}
          onChange={value => onFilterChange('category', value)}
          options={[{ id: '', label: 'Todas' }, ...categoryOptions]}
        />
        <FilterSelect
          label="Severidad"
          value={filters.severity}
          onChange={value => onFilterChange('severity', value)}
          options={[{ id: '', label: 'Todas' }, ...severityOptions]}
        />

        {isStatusToggle ? (
          <div className="flex min-w-[180px] flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
            Estado
            <div className="flex flex-wrap gap-1 rounded-lg border border-black/10 bg-white/60 p-1 dark:border-white/10 dark:bg-surface-dark-card">
              {statusOptions.map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onFilterChange('status', option.id)}
                  aria-pressed={filters.status === option.id}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-200 ${
                    filters.status === option.id
                      ? 'bg-accent-600 text-white'
                      : 'text-text-secondary-light hover:text-ink-900 dark:text-text-secondary-dark dark:hover:text-text-primary-dark'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <FilterSelect
            label="Estado"
            value={filters.status}
            onChange={value => onFilterChange('status', value)}
            options={statusOptions}
          />
        )}

        <button
          type="button"
          onClick={onResetFilters}
          disabled={!hasActiveFilters}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-200 ${
            hasActiveFilters
              ? 'border border-black/10 text-ink-900 hover:bg-black/5 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5'
              : 'cursor-not-allowed border border-black/10 text-text-secondary-light/60 dark:border-white/10 dark:text-text-secondary-dark/60'
          }`}
        >
          Limpiar filtros
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg border border-black/10 bg-white/60 p-1 dark:border-white/10 dark:bg-surface-dark-card">
          {datePresetOptions.map(preset => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onDatePreset(preset.id)}
              aria-pressed={filters.datePreset === preset.id}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-200 ${
                filters.datePreset === preset.id
                  ? 'bg-accent-600 text-white'
                  : 'text-text-secondary-light hover:text-ink-900 dark:text-text-secondary-dark dark:hover:text-text-primary-dark'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {filters.datePreset === 'custom' && (
          <>
            <label className="flex flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
              Desde
              <input
                type="date"
                value={filters.customRange.from}
                onChange={event => onCustomDate('from', event.target.value)}
                className="rounded-lg border border-black/10 bg-white/80 px-2 py-1.5 text-sm text-ink-900 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
              Hasta
              <input
                type="date"
                value={filters.customRange.to}
                onChange={event => onCustomDate('to', event.target.value)}
                className="rounded-lg border border-black/10 bg-white/80 px-2 py-1.5 text-sm text-ink-900 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
              />
            </label>
          </>
        )}
      </div>
    </div>
  );
}
