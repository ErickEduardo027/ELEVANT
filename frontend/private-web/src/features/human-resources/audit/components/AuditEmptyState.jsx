import { ChecklistIcon } from '../../../shell/components/icons';

export default function AuditEmptyState({ message = 'No hay acciones para los filtros seleccionados.' }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-black/5 bg-white/70 px-6 py-16 text-center backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <ChecklistIcon className="h-6 w-6 text-text-secondary-light dark:text-text-secondary-dark" />
      <p className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{message}</p>
      <p className="max-w-md text-xs text-text-secondary-light dark:text-text-secondary-dark">
        Ajusta la búsqueda, el tipo de acción o el rango de fechas para ver más eventos.
      </p>
    </div>
  );
}

