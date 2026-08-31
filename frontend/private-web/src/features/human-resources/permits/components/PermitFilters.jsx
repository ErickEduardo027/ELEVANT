import { SearchIcon, XIcon, AlertTriangleIcon } from '../../../shell/components/icons';
import { TERMINAL_OPTIONS, PERMIT_STATUS_OPTIONS, PERMIT_DOCUMENT_OPTIONS } from '../statusMeta';

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

// Filtros combinables de la tabla "Por agente" (skill.md §"TABLA"). El
// toggle "Solo vencidos/próximos" se muestra como chip para que su estado
// activo/inactivo sea visualmente obvio, con el mismo lenguaje que el botón
// "Limpiar filtros" (borde + texto de acento cuando está activo).
export default function PermitFilters({ filters, onFilterChange, onResetFilters, hasActiveFilters }) {
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

      <FilterSelect
        label="Terminal"
        allLabel="Terminal"
        value={filters.terminal}
        onChange={value => onFilterChange('terminal', value)}
        options={TERMINAL_OPTIONS.map(option => ({ ...option, label: `Terminal ${option.value}` }))}
      />
      <FilterSelect label="Estado" allLabel="Estado" value={filters.status} onChange={value => onFilterChange('status', value)} options={PERMIT_STATUS_OPTIONS} />
      <FilterSelect
        label="Documento"
        allLabel="Ambos"
        value={filters.document}
        onChange={value => onFilterChange('document', value)}
        options={PERMIT_DOCUMENT_OPTIONS}
      />

      <label
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
          filters.onlyUrgent
            ? 'border-accent-600/30 bg-accent-600/10 text-accent-600'
            : 'border-black/10 text-ink-900 hover:bg-black/5 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5'
        }`}
      >
        <input
          type="checkbox"
          checked={filters.onlyUrgent}
          onChange={event => onFilterChange('onlyUrgent', event.target.checked)}
          className="h-3.5 w-3.5 rounded border-black/20 text-accent-600 focus:ring-accent-600 dark:border-white/20"
        />
        <AlertTriangleIcon className="h-3.5 w-3.5" />
        Solo vencidos/próximos
      </label>

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
