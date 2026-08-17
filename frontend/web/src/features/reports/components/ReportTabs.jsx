import { REPORT_TABS } from '../reportsMappers';

export default function ReportTabs({ tabs = REPORT_TABS, active, onChange }) {
  return (
    <div
      role="tablist"
      aria-label="Tipo de reporte"
      className="inline-flex flex-wrap gap-1 rounded-xl border border-black/10 bg-white/70 p-1 dark:border-white/10 dark:bg-surface-dark-card"
    >
      {tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-200 ${
            active === tab.id
              ? 'bg-accent-600 text-white'
              : 'text-text-secondary-light hover:text-ink-900 dark:text-text-secondary-dark dark:hover:text-text-primary-dark'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
