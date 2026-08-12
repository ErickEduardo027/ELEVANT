import { SearchIcon, XIcon } from '../../../shell/components/icons';
import { USER_TYPE_OPTIONS, PORTAL_OPTIONS, ACCOUNT_STATUS_OPTIONS } from '../statusMeta';

const selectClassName =
  'rounded-lg border border-black/10 bg-white/70 px-3 py-1.5 text-xs text-ink-900 focus:border-accent-600 focus:outline-none dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark';

function FilterSelect({ label, value, onChange, options }) {
  return (
    <select value={value} onChange={event => onChange(event.target.value)} className={selectClassName} aria-label={label}>
      <option value="all">{label}</option>
      {options.map(option => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

// Filtros dinámicos: los selects de faceta (rol/terminal/aerolínea/
// departamento) solo aparecen si hay opciones reales en `availableOptions`
// (skill.md §5). Búsqueda y facetas fijas (tipo/portal/estado) están
// siempre visibles.
export default function UserFilterBar({ filters, onFilterChange, onResetFilters, hasActiveFilters, availableOptions }) {
  const roleOptions = availableOptions.roles.map(role => ({ value: role, label: role }));
  const terminalOptions = availableOptions.terminals.map(terminal => ({ value: terminal, label: `Terminal ${terminal}` }));
  const airlineOptions = availableOptions.airlines.map(airline => ({ value: airline, label: airline }));
  const departmentOptions = availableOptions.departments.map(department => ({ value: department, label: department }));

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-black/5 bg-white/70 p-3 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <div className="relative min-w-[220px] flex-1">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary-light dark:text-text-secondary-dark" />
        <input
          type="search"
          value={filters.search}
          onChange={event => onFilterChange('search', event.target.value)}
          placeholder="Buscar por nombre, correo o identificación"
          aria-label="Buscar usuarios"
          className="w-full rounded-lg border border-black/10 bg-transparent py-1.5 pl-9 pr-3 text-sm text-ink-900 placeholder:text-text-secondary-light focus:border-accent-600 focus:outline-none dark:border-white/10 dark:text-text-primary-dark dark:placeholder:text-text-secondary-dark"
        />
      </div>

      <FilterSelect label="Tipo de usuario" value={filters.userType} onChange={value => onFilterChange('userType', value)} options={USER_TYPE_OPTIONS} />
      <FilterSelect label="Portal" value={filters.portal} onChange={value => onFilterChange('portal', value)} options={PORTAL_OPTIONS} />
      <FilterSelect label="Estado" value={filters.status} onChange={value => onFilterChange('status', value)} options={ACCOUNT_STATUS_OPTIONS} />

      {roleOptions.length > 0 && (
        <FilterSelect label="Rol" value={filters.role} onChange={value => onFilterChange('role', value)} options={roleOptions} />
      )}
      {terminalOptions.length > 0 && (
        <FilterSelect label="Terminal" value={filters.terminal} onChange={value => onFilterChange('terminal', value)} options={terminalOptions} />
      )}
      {airlineOptions.length > 0 && (
        <FilterSelect label="Aerolínea" value={filters.airline} onChange={value => onFilterChange('airline', value)} options={airlineOptions} />
      )}
      {departmentOptions.length > 0 && (
        <FilterSelect label="Departamento" value={filters.department} onChange={value => onFilterChange('department', value)} options={departmentOptions} />
      )}

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
