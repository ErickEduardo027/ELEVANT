import { SearchIcon } from './icons';
import { getPlanningStatusMeta } from '../planningStatus';
import { OCC_STATION_CODE, OCC_STATION_NAME } from '../../admin-occ/useOccStation';
import { useTranslation } from '../../../i18n/LanguageScope';
import { planningMessages } from '../planningMessages';

const QUICK_FILTERS = ['delayed', 'unassigned'];

function FieldLabel({ label, children, className = '' }) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark ${className}`}>
      {label}
      {children}
    </label>
  );
}

function FilterSelect({ label, value, onChange, options = [], formatOption = option => option }) {
  const { t } = useTranslation(planningMessages);
  return (
    <FieldLabel label={label} className="min-w-[140px]">
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="rounded-lg border border-black/10 bg-white/80 px-2 py-1.5 text-sm text-ink-900 outline-none transition focus:border-accent-600 focus:ring-2 focus:ring-accent-600/20 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
      >
        <option value="">{t('filters.all')}</option>
        {options.map(option => (
          <option key={option} value={option}>
            {formatOption(option)}
          </option>
        ))}
      </select>
    </FieldLabel>
  );
}

export default function PlanningFilters({
  filters,
  onFilterChange,
  quickFilter,
  onQuickFilter,
  onReset,
  options = { airlines: [], statuses: [], aircraftTypes: [], positions: [], terminals: [], agents: [] },
  stationScopes = [],
  selectedStationId = '',
  selectedDate = '',
  onDateChange,
}) {
  const { t, language } = useTranslation(planningMessages);
  return (
    <div data-occ-surface data-occ-filter-layout className="overflow-hidden rounded-2xl border border-black/5 bg-white/70 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <div className="flex flex-wrap items-end gap-3 border-b border-accent-600/10 bg-accent-600/[0.04] p-4 dark:bg-accent-600/[0.08]">
        <div className="mr-auto min-w-[200px]">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-600">{t('filters.scope')}</p>
          <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
            {t('filters.scopeHint')}
          </p>
        </div>
        <div role="group" aria-labelledby="occ-planning-station-label" className="flex min-w-[180px] flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
          <span id="occ-planning-station-label">{t('filters.station')}</span>
          <p className="flex min-h-[34px] items-center gap-2 text-sm">
            <span className="font-mono font-semibold tracking-wider text-accent-600 dark:text-[#5B9BF5]">
              {stationScopes.find(scope => scope.stationId === selectedStationId)?.stationCode ?? OCC_STATION_CODE}
            </span>
            <span className="truncate text-xs text-text-secondary-light dark:text-text-secondary-dark">{OCC_STATION_NAME}</span>
          </p>
        </div>
        <FieldLabel label={t('filters.operationalDate')} className="min-w-[170px]">
          <input
            aria-label={t('filters.operationalDate')}
            type="date"
            value={selectedDate}
            onChange={event => onDateChange?.(event.target.value)}
            disabled={!selectedStationId}
            className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm font-semibold text-ink-900 outline-none transition focus:border-accent-600 focus:ring-2 focus:ring-accent-600/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
          />
        </FieldLabel>
      </div>

      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <FieldLabel label={t('filters.search')} className="min-w-[240px] flex-1">
            <span className="relative">
              <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-secondary-light dark:text-text-secondary-dark" />
              <input
                type="search"
                value={filters.search}
                onChange={event => onFilterChange('search', event.target.value)}
                placeholder={t('filters.searchPlaceholder')}
                className="w-full rounded-lg border border-black/10 bg-white/80 py-1.5 pl-7 pr-2 text-sm text-ink-900 outline-none transition focus:border-accent-600 focus:ring-2 focus:ring-accent-600/20 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
              />
            </span>
          </FieldLabel>
          <FilterSelect label={t('filters.airline')} value={filters.airlineIata} onChange={value => onFilterChange('airlineIata', value)} options={options.airlines} />
          <FilterSelect label={t('filters.status')} value={filters.status} onChange={value => onFilterChange('status', value)} options={options.statuses} formatOption={option => getPlanningStatusMeta(option, language).label} />
          <FilterSelect label={t('filters.aircraft')} value={filters.aircraftType} onChange={value => onFilterChange('aircraftType', value)} options={options.aircraftTypes} />
          <FilterSelect label={t('filters.position')} value={filters.position} onChange={value => onFilterChange('position', value)} options={options.positions} />
          <FilterSelect label={t('filters.terminal')} value={filters.terminal} onChange={value => onFilterChange('terminal', value)} options={options.terminals} />
          <FilterSelect label={t('filters.agent')} value={filters.agent} onChange={value => onFilterChange('agent', value)} options={options.agents} />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {QUICK_FILTERS.map(id => (
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
              {t(`filters.${id}`)}
            </button>
          ))}
          <button
            type="button"
            onClick={onReset}
            className="ml-auto rounded-lg px-2 py-1 text-xs font-semibold text-accent-600 hover:bg-accent-600/10"
          >
            {t('filters.reset')}
          </button>
        </div>
      </div>
    </div>
  );
}
