import { SearchIcon } from './icons';
import { getPlanningStatusMeta } from '../planningStatus';
import { OCC_STATION_CODE, OCC_STATION_NAME } from '../../admin-occ/useOccStation';
import { useTranslation } from '../../../i18n/LanguageScope';
import { planningMessages } from '../planningMessages';
import { occButtonClass } from '../../occ-ui/OccButton';
import { occControlClass } from '../../occ-ui/OccField';
import { standDisplayCode } from '../../../services/standCodes';

const QUICK_FILTERS = ['delayed', 'unassigned'];

function FieldLabel({ label, children, className = '' }) {
  return (
    <label className={`flex flex-col gap-1 text-xs font-medium text-occ-muted ${className}`}>
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
        className={occControlClass({ kind: 'select' })}
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
    <div className="rounded-md border border-occ-line bg-occ-panel">
      <div className="flex flex-wrap items-end gap-3 border-b border-occ-line px-3 py-2.5">
        <div className="mr-auto min-w-[200px]">
          <p className="text-sm font-semibold text-occ-text">{t('filters.scope')}</p>
          <p className="mt-1 text-xs text-occ-muted">
            {t('filters.scopeHint')}
          </p>
        </div>
        <div role="group" aria-labelledby="occ-planning-station-label" className="flex min-w-[180px] flex-col gap-1 text-xs font-medium text-occ-muted">
          <span id="occ-planning-station-label">{t('filters.station')}</span>
          <p className="flex min-h-[34px] items-center gap-2 text-sm">
            <span className="rounded-sm border border-occ-line-strong px-1 font-mono font-semibold text-occ-text">
              {stationScopes.find(scope => scope.stationId === selectedStationId)?.stationCode ?? OCC_STATION_CODE}
            </span>
            <span className="truncate text-xs text-occ-muted">{OCC_STATION_NAME}</span>
          </p>
        </div>
        <FieldLabel label={t('filters.operationalDate')} className="min-w-[170px]">
          <input
            aria-label={t('filters.operationalDate')}
            type="date"
            value={selectedDate}
            onChange={event => onDateChange?.(event.target.value)}
            disabled={!selectedStationId}
            className={`${occControlClass({ kind: 'input' })} font-mono disabled:cursor-not-allowed disabled:text-occ-faint`}
          />
        </FieldLabel>
      </div>

      <div className="space-y-2.5 px-3 py-2.5">
        <div className="flex flex-wrap items-end gap-3">
          <FieldLabel label={t('filters.search')} className="min-w-[240px] flex-1">
            <span className="relative">
              <SearchIcon aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-occ-muted" />
              <input
                type="search"
                value={filters.search}
                onChange={event => onFilterChange('search', event.target.value)}
                placeholder={t('filters.searchPlaceholder')}
                className={`w-full pl-8 ${occControlClass({ kind: 'input' })}`}
              />
            </span>
          </FieldLabel>
          <FilterSelect label={t('filters.airline')} value={filters.airlineIata} onChange={value => onFilterChange('airlineIata', value)} options={options.airlines} />
          <FilterSelect label={t('filters.status')} value={filters.status} onChange={value => onFilterChange('status', value)} options={options.statuses} formatOption={option => getPlanningStatusMeta(option, language).label} />
          <FilterSelect label={t('filters.aircraft')} value={filters.aircraftType} onChange={value => onFilterChange('aircraftType', value)} options={options.aircraftTypes} />
          <FilterSelect label={t('filters.position')} value={filters.position} onChange={value => onFilterChange('position', value)} options={options.positions} formatOption={standDisplayCode} />
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
              className={`min-h-8 rounded border px-3 text-sm font-medium [@media(pointer:coarse)]:min-h-11 ${
                quickFilter === id
                  ? 'border-occ-accent bg-occ-accent-soft text-occ-text'
                  : 'border-occ-line text-occ-muted hover:border-occ-line-strong hover:text-occ-text'
              }`}
            >
              {t(`filters.${id}`)}
            </button>
          ))}
          <button
            type="button"
            onClick={onReset}
            className={`ml-auto ${occButtonClass({ variant: 'ghost', size: 'sm' })}`}
          >
            {t('filters.reset')}
          </button>
        </div>
      </div>
    </div>
  );
}
