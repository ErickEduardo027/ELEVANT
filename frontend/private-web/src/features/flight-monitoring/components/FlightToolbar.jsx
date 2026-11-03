import FlightConnectionStatus from './FlightConnectionStatus';
import { getStatusLabel } from '../../dashboard/statusMeta';
import { useTranslation } from '../../../i18n/LanguageScope';
import { flightMonitoringMessages } from '../flightMonitoringMessages';

function FilterSelect({ label, value, onChange, options, formatOption = option => option }) {
  const { t } = useTranslation(flightMonitoringMessages);
  return (
    <label className="flex min-w-[140px] flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
      {label}
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="rounded-lg border border-black/10 bg-white/80 px-2 py-1.5 text-sm text-ink-900 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
      >
        <option value="">{t('toolbar.all')}</option>
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
  stationCode = 'PUJ',
  source,
  connection,
  lastUpdatedAt,
  onRefresh,
  filters,
  onFilterChange,
  options,
  onlyStationRelated,
  onToggleStationRelated,
}) {
  const { t, language } = useTranslation(flightMonitoringMessages);
  return (
    <div data-occ-toolbar="" className="space-y-3 rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <FlightConnectionStatus source={source} connection={connection} lastUpdatedAt={lastUpdatedAt} onRefresh={onRefresh} />

      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect label={t('toolbar.date')} value={filters.date} onChange={value => onFilterChange('date', value)} options={options.dates} />
        <FilterSelect label={t('toolbar.airline')} value={filters.airline} onChange={value => onFilterChange('airline', value)} options={options.airlines} />
        <FilterSelect
          label={t('toolbar.status')}
          value={filters.status}
          onChange={value => onFilterChange('status', value)}
          options={options.statuses}
          formatOption={option => getStatusLabel('flight', option, language)}
        />
        <FilterSelect label={t('toolbar.origin')} value={filters.origin} onChange={value => onFilterChange('origin', value)} options={options.origins} />
        <FilterSelect label={t('toolbar.destination')} value={filters.destination} onChange={value => onFilterChange('destination', value)} options={options.destinations} />

        <label className="ml-auto flex items-center gap-2 text-xs text-text-secondary-light dark:text-text-secondary-dark">
          <input
            type="checkbox"
            role="switch"
            aria-checked={onlyStationRelated}
            checked={onlyStationRelated}
            onChange={event => onToggleStationRelated(event.target.checked)}
            className="h-4 w-4 rounded accent-accent-600"
          />
          {t('toolbar.onlyStation', { station: stationCode })}
        </label>
      </div>
    </div>
  );
}
