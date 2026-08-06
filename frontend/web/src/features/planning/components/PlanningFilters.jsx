import { SearchIcon } from './icons';

const STATUS_LABELS = {
  scheduled: 'Programado',
  boarding: 'Abordando',
  taxiing: 'Rodaje',
  enRoute: 'En ruta',
  landed: 'Aterrizado',
  arrived: 'En posición',
  delayed: 'Retrasado',
  diverted: 'Desviado',
  cancelled: 'Cancelado',
};

const QUICK_FILTERS = [
  { id: 'today', label: 'Hoy' },
  { id: 'tomorrow', label: 'Mañana' },
  { id: 'delayed', label: 'Retrasados' },
  { id: 'unassigned', label: 'Sin asignación' },
  { id: 'pending', label: 'Pendientes' },
];

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
            {STATUS_LABELS[option] ?? option}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function PlanningFilters({ filters, onFilterChange, quickFilter, onQuickFilter, options }) {
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
              placeholder="Vuelo, aerolínea o ruta"
              className="w-full rounded-lg border border-black/10 bg-white/80 py-1.5 pl-7 pr-2 text-sm text-ink-900 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
            />
          </span>
        </label>
        <FilterSelect label="Fecha" value={filters.date} onChange={value => onFilterChange('date', value)} options={options.dates} />
        <FilterSelect label="Aeropuerto" value={filters.airportCode} onChange={value => onFilterChange('airportCode', value)} options={options.airports} />
        <FilterSelect label="Aerolínea" value={filters.airlineIata} onChange={value => onFilterChange('airlineIata', value)} options={options.airlines} />
        <FilterSelect label="Estado" value={filters.status} onChange={value => onFilterChange('status', value)} options={options.statuses} />
        <FilterSelect label="Aeronave" value={filters.aircraftType} onChange={value => onFilterChange('aircraftType', value)} options={options.aircraftTypes} />
        <FilterSelect label="Posición" value={filters.position} onChange={value => onFilterChange('position', value)} options={options.positions} />
        <FilterSelect label="Supervisor" value={filters.supervisor} onChange={value => onFilterChange('supervisor', value)} options={options.supervisors} />
        <FilterSelect label="Agente" value={filters.agent} onChange={value => onFilterChange('agent', value)} options={options.agents} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {QUICK_FILTERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => onQuickFilter(id)}
            aria-pressed={quickFilter === id}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-200 ${
              quickFilter === id
                ? 'border-accent-600 bg-accent-600/10 text-accent-600'
                : 'border-black/10 text-text-secondary-light hover:border-accent-600/40 dark:border-white/10 dark:text-text-secondary-dark'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
