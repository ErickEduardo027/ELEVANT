import { CHAT_QUICK_FILTERS } from '../chatMappers';

export default function ConversationFilters({ active, onChange, counts }) {
  return (
    <div
      role="tablist"
      aria-label="Filtros de conversaciones"
      className="flex flex-wrap gap-1 rounded-xl border border-black/10 bg-white/70 p-1 dark:border-white/10 dark:bg-surface-dark-card"
    >
      {CHAT_QUICK_FILTERS.map(filter => (
        <button
          key={filter.id}
          type="button"
          role="tab"
          aria-selected={active === filter.id}
          onClick={() => onChange(filter.id)}
          className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors duration-200 ${
            active === filter.id
              ? 'bg-accent-600 text-white'
              : 'text-text-secondary-light hover:text-ink-900 dark:text-text-secondary-dark dark:hover:text-text-primary-dark'
          }`}
        >
          {filter.label}
          {filter.id !== 'all' && counts?.[filter.id] !== undefined && (
            <span className="ml-1 tabular-nums opacity-80">({counts[filter.id]})</span>
          )}
        </button>
      ))}
    </div>
  );
}
