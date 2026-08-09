import FlightConnectionStatus from './FlightConnectionStatus';
import { getStatusMeta } from '../../dashboard/statusMeta';

function FilterSelect({ label, value, onChange, options, formatOption = option => option }) {
  return (
    <label className="flex min-w-[140px] flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
      {label}
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="rounded-lg border border-black/10 bg-white/80 px-2 py-1.5 text-sm text-ink-900 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
      >
        <option value="">Todos</option>
        {options.map(option => (
          <option key={option} value={option}>
            {formatOption(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function FlightToolbar({
  connection,
  lastUpdatedAt,
  onRefresh,
  filters,
  onFilterChange,
  options,
  onlyStationRelated,
  onToggleStationRelated,
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <FlightConnectionStatus connection={connection} lastUpdatedAt={lastUpdatedAt} onRefresh={onRefresh} />

      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect label="Fecha" value={filters.date} onChange={value => onFilterChange('date', value)} options={options.dates} />
        <FilterSelect label="Aerolínea" value={filters.airline} onChange={value => onFilterChange('airline', value)} options={options.airlines} />
        <FilterSelect
          label="Estado"
          value={filters.status}
          onChange={value => onFilterChange('status', value)}
          options={options.statuses}
          formatOption={option => getStatusMeta('flight', option).label}
        />
        <FilterSelect label="Origen" value={filters.origin} onChange={value => onFilterChange('origin', value)} options={options.origins} />
        <FilterSelect label="Destino" value={filters.destination} onChange={value => onFilterChange('destination', value)} options={options.destinations} />

        <label className="ml-auto flex items-center gap-2 text-xs text-text-secondary-light dark:text-text-secondary-dark">
          <input
            type="checkbox"
            role="switch"
            aria-checked={onlyStationRelated}
            checked={onlyStationRelated}
            onChange={event => onToggleStationRelated(event.target.checked)}
            className="h-4 w-4 rounded accent-accent-600"
          />
          Solo vuelos relacionados con PUJ
        </label>
      </div>
    </div>
  );
}
