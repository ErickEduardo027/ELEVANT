import { SearchIcon, XIcon } from '../../../shell/components/icons';
import { TERMINAL_OPTIONS, QUALIFICATION_STATUS_OPTIONS } from '../statusMeta';
import { AGENT_SORT_OPTIONS } from '../useQualificationFilters';

const selectClassName =
  'rounded-lg border border-black/10 bg-white/70 px-3 py-1.5 text-xs text-ink-900 focus:border-accent-600 focus:outline-none dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark';

function FilterSelect({ label, value, onChange, options, includeAll = true }) {
  return (
    <select value={value} onChange={event => onChange(event.target.value)} className={selectClassName} aria-label={label}>
      {includeAll && <option value="all">{label}</option>}
      {options.map(option => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

// Filtros combinables + ordenamiento de la vista "Por agente" (skill.md
// §"FILTROS"/"ORDENAMIENTO"). Terminal, estado y tipo de equipo son
// catálogos fijos del dominio, por eso se muestran siempre (a diferencia de
// los filtros de faceta condicionales del módulo de usuarios).
export default function QualificationFilters({ filters, onFilterChange, onResetFilters, hasActiveFilters, equipmentOptions, sortBy, onSortChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-black/5 bg-white/70 p-3 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <div className="relative min-w-[220px] flex-1">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary-light dark:text-text-secondary-dark" />
        <input
          type="search"
          value={filters.search}
          onChange={event => onFilterChange('search', event.target.value)}
          placeholder="Buscar por nombre, código o identificación"
          aria-label="Buscar agentes"
          className="w-full rounded-lg border border-black/10 bg-transparent py-1.5 pl-9 pr-3 text-sm text-ink-900 placeholder:text-text-secondary-light focus:border-accent-600 focus:outline-none dark:border-white/10 dark:text-text-primary-dark dark:placeholder:text-text-secondary-dark"
        />
      </div>

      <FilterSelect label="Terminal" value={filters.terminal} onChange={value => onFilterChange('terminal', value)} options={TERMINAL_OPTIONS.map(option => ({ ...option, label: `Terminal ${option.value}` }))} />
      <FilterSelect label="Estado" value={filters.status} onChange={value => onFilterChange('status', value)} options={QUALIFICATION_STATUS_OPTIONS} />
      <FilterSelect label="Tipo de equipo" value={filters.equipment} onChange={value => onFilterChange('equipment', value)} options={equipmentOptions} />

      <FilterSelect label="Ordenar por" value={sortBy} onChange={onSortChange} options={AGENT_SORT_OPTIONS} includeAll={false} />

      <button
        type="button"
        onClick={onResetFilters}
        disabled={!hasActiveFilters}
        className="ml-auto flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-ink-900 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
      >
        <XIcon className="h-3.5 w-3.5" />
        Limpiar filtros
      </button>
    </div>
  );
}
