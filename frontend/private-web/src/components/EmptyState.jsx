// Generaliza el bloque "sin datos" repetido inline en varios paneles del
// Dashboard de Gestión Humana (p. ej. PendingAccountsList) para que tablas y
// paneles nuevos no reinventen el markup.
export default function EmptyState({ icon: IconComponent, title, description, action }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      {IconComponent && (
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/5 text-text-secondary-light dark:bg-white/5 dark:text-text-secondary-dark">
          <IconComponent className="h-5 w-5" />
        </span>
      )}
      <p className="text-sm font-medium text-ink-900 dark:text-text-primary-dark">{title}</p>
      {description && (
        <p className="max-w-sm text-xs text-text-secondary-light dark:text-text-secondary-dark">{description}</p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
