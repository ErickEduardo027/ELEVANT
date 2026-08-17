import { SearchIcon } from '../../planning/components/icons';

function FilterSelect({ label, value, onChange, options }) {
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
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterInput({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <label className="flex min-w-[150px] flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
      {label}
      <input
        type={type}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        className="rounded-lg border border-black/10 bg-white/80 px-2 py-1.5 text-sm text-ink-900 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
      />
    </label>
  );
}

export default function ReviewFilters({ filters, onFilterChange, onResetFilters, hasActiveFilters, options }) {
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
              placeholder="Vuelo, aerolínea, agente, supervisor, posición"
              className="w-full rounded-lg border border-black/10 bg-white/80 py-1.5 pl-7 pr-2 text-sm text-ink-900 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
            />
          </span>
        </label>

        <FilterSelect label="Aerolínea" value={filters.airline} onChange={value => onFilterChange('airline', value)} options={options.airlines} />
        <FilterSelect label="Agente" value={filters.agent} onChange={value => onFilterChange('agent', value)} options={options.agents} />
        <FilterSelect label="Supervisor" value={filters.supervisor} onChange={value => onFilterChange('supervisor', value)} options={options.supervisors} />
        <FilterSelect label="Posición / Stand" value={filters.position} onChange={value => onFilterChange('position', value)} options={options.positions} />
        <FilterSelect label="Tipo de servicio" value={filters.serviceType} onChange={value => onFilterChange('serviceType', value)} options={options.serviceTypes} />
        <FilterInput label="Número de vuelo" value={filters.flightNumber} onChange={value => onFilterChange('flightNumber', value)} placeholder="Ej. DM161" />
        <FilterInput label="Referencia de orden" value={filters.orderReference} onChange={value => onFilterChange('orderReference', value)} placeholder="Ej. WO-1001" />
        <FilterInput label="Desde" type="date" value={filters.dateFrom} onChange={value => onFilterChange('dateFrom', value)} />
        <FilterInput label="Hasta" type="date" value={filters.dateTo} onChange={value => onFilterChange('dateTo', value)} />

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
    </div>
  );
}
