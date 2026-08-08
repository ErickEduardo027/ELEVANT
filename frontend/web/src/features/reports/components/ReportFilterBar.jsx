import DateRangePicker from './DateRangePicker';
import { DATE_PRESETS } from '../reportsMappers';

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label className="flex min-w-[150px] flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
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

export default function ReportFilterBar({
  activeReport,
  datePreset,
  customRange,
  onSelectPreset,
  onCustomDateChange,
  facets,
  onFacetChange,
  options,
  hasActiveFilters,
  onResetFilters,
}) {
  const showPosition = activeReport === 'closure';

  const activeChips = [];
  if (datePreset !== 'today') {
    const preset = DATE_PRESETS.find(item => item.id === datePreset);
    activeChips.push(preset?.label ?? 'Rango personalizado');
  }
  if (facets.airline) activeChips.push(`Aerolínea: ${facets.airline}`);
  if (facets.agent) activeChips.push(`Agente: ${facets.agent}`);
  if (facets.terminal) activeChips.push(`Terminal: ${facets.terminal}`);
  if (showPosition && facets.position) activeChips.push(`Posición: ${facets.position}`);

  return (
    <div className="space-y-3 rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <DateRangePicker
          datePreset={datePreset}
          onSelectPreset={onSelectPreset}
          customRange={customRange}
          onCustomDateChange={onCustomDateChange}
        />
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
        <FilterSelect label="Aerolínea" value={facets.airline} onChange={value => onFacetChange('airline', value)} options={options.airlines} />
        <FilterSelect label="Agente" value={facets.agent} onChange={value => onFacetChange('agent', value)} options={options.agents} />
        <FilterSelect label="Terminal" value={facets.terminal} onChange={value => onFacetChange('terminal', value)} options={options.terminals} />
        {showPosition && (
          <FilterSelect label="Posición" value={facets.position} onChange={value => onFacetChange('position', value)} options={options.positions} />
        )}
      </div>

      {activeChips.length > 0 && (
        <div data-testid="active-filter-chips" aria-label="Filtros activos" className="flex flex-wrap gap-1.5">
          {activeChips.map(chip => (
            <span key={chip} className="rounded-full bg-accent-600/10 px-2.5 py-1 text-xs font-medium text-accent-600">
              {chip}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
