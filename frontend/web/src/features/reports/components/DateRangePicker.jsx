import { DATE_PRESETS } from '../reportsMappers';

export default function DateRangePicker({ datePreset, onSelectPreset, customRange, onCustomDateChange }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-wrap gap-1 rounded-lg border border-black/10 bg-white/60 p-1 dark:border-white/10 dark:bg-surface-dark-card">
        {DATE_PRESETS.map(preset => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onSelectPreset(preset.id)}
            aria-pressed={datePreset === preset.id}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-200 ${
              datePreset === preset.id
                ? 'bg-accent-600 text-white'
                : 'text-text-secondary-light hover:text-ink-900 dark:text-text-secondary-dark dark:hover:text-text-primary-dark'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
        Desde
        <input
          type="date"
          value={customRange.from}
          onChange={event => onCustomDateChange('from', event.target.value)}
          className="rounded-lg border border-black/10 bg-white/80 px-2 py-1.5 text-sm text-ink-900 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
        Hasta
        <input
          type="date"
          value={customRange.to}
          onChange={event => onCustomDateChange('to', event.target.value)}
          className="rounded-lg border border-black/10 bg-white/80 px-2 py-1.5 text-sm text-ink-900 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
        />
      </label>
    </div>
  );
}
