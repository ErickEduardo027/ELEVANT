const VIEWS = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'table', label: 'Tabla' },
  { id: 'calendar', label: 'Calendario' },
];

export default function ViewSwitcher({ active, onChange }) {
  return (
    <div
      role="group"
      aria-label="Vistas de planificación"
      className="inline-flex rounded-xl border border-black/10 bg-white/70 p-1 dark:border-white/10 dark:bg-surface-dark-card"
    >
      {VIEWS.map(view => (
        <button
          key={view.id}
          type="button"
          aria-pressed={active === view.id}
          onClick={() => onChange(view.id)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-200 ${
            active === view.id
              ? 'bg-accent-600 text-white'
              : 'text-text-secondary-light hover:text-ink-900 dark:text-text-secondary-dark dark:hover:text-text-primary-dark'
          }`}
        >
          {view.label}
        </button>
      ))}
    </div>
  );
}
