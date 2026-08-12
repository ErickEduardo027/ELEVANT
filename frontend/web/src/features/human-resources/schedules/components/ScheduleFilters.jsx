import { SearchIcon, XIcon, ChevronLeftIcon, ChevronRightIcon, CalendarIcon } from '../../../shell/components/icons';
import { TERMINAL_OPTIONS } from '../statusMeta';

const selectClassName =
  'rounded-lg border border-black/10 bg-white/70 px-3 py-1.5 text-xs text-ink-900 focus:border-accent-600 focus:outline-none dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark';

function FilterSelect({ label, allLabel, value, onChange, options }) {
  return (
    <select value={value} onChange={event => onChange(event.target.value)} className={selectClassName} aria-label={label}>
      <option value="all">{allLabel}</option>
      {options.map(option => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

// Navegación de semana + filtros combinables del calendario (skill.md
// §"CALENDARIO DE TURNOS": "navegación semana anterior/siguiente" y
// "filtros por terminal, agente y semana"). Se agrupan en una sola barra
// porque ambos controles actúan sobre la misma grilla.
export default function ScheduleFilters({
  weekRangeLabel,
  isCurrentWeek,
  onPreviousWeek,
  onNextWeek,
  onToday,
  filters,
  onFilterChange,
  onResetFilters,
  hasActiveFilters,
  agentOptions,
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-black/5 bg-white/70 p-3 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <div className="flex items-center gap-1 rounded-lg border border-black/10 px-1.5 py-1 dark:border-white/10">
        <button
          type="button"
          onClick={onPreviousWeek}
          aria-label="Semana anterior"
          className="rounded-md p-1 text-ink-900 hover:bg-black/5 dark:text-text-primary-dark dark:hover:bg-white/5"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <span className="flex items-center gap-1.5 px-1.5 text-xs font-medium text-ink-900 dark:text-text-primary-dark">
          <CalendarIcon className="h-3.5 w-3.5 text-text-secondary-light dark:text-text-secondary-dark" />
          {weekRangeLabel}
        </span>
        <button
          type="button"
          onClick={onNextWeek}
          aria-label="Semana siguiente"
          className="rounded-md p-1 text-ink-900 hover:bg-black/5 dark:text-text-primary-dark dark:hover:bg-white/5"
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>

      <button
        type="button"
        onClick={onToday}
        disabled={isCurrentWeek}
        className="rounded-lg border border-black/10 px-2.5 py-1.5 text-xs font-medium text-ink-900 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
      >
        Hoy
      </button>

      <div className="relative min-w-[200px] flex-1">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary-light dark:text-text-secondary-dark" />
        <input
          type="search"
          value={filters.search}
          onChange={event => onFilterChange('search', event.target.value)}
          placeholder="Buscar agente"
          aria-label="Buscar agentes"
          className="w-full rounded-lg border border-black/10 bg-transparent py-1.5 pl-9 pr-3 text-sm text-ink-900 placeholder:text-text-secondary-light focus:border-accent-600 focus:outline-none dark:border-white/10 dark:text-text-primary-dark dark:placeholder:text-text-secondary-dark"
        />
      </div>

      <FilterSelect
        label="Terminal"
        allLabel="Terminal"
        value={filters.terminal}
        onChange={value => onFilterChange('terminal', value)}
        options={TERMINAL_OPTIONS.map(option => ({ ...option, label: `Terminal ${option.value}` }))}
      />
      <FilterSelect label="Agente" allLabel="Agente" value={filters.agentId} onChange={value => onFilterChange('agentId', value)} options={agentOptions} />

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
