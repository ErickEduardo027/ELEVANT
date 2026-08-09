import { CheckCircleIcon, UserMinusIcon, XIcon } from '../../../shell/components/icons';

// Barra contextual de selección múltiple (skill.md §17). Las acciones aquí
// solo abren la confirmación correspondiente — la mutación real ocurre tras
// confirmar, nunca al pulsar este botón directamente.
export default function BulkActionsBar({ count, onActivateSelected, onDeactivateSelected, onClearSelection }) {
  if (count === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-accent-600/30 bg-accent-600/5 p-3 text-sm">
      <span className="font-medium text-ink-900 dark:text-text-primary-dark">
        {count} usuario{count > 1 ? 's' : ''} seleccionado{count > 1 ? 's' : ''}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onActivateSelected}
          className="flex items-center gap-1.5 rounded-lg border border-status-success/40 px-3 py-1.5 text-xs font-semibold text-status-success hover:bg-status-success/10"
        >
          <CheckCircleIcon className="h-3.5 w-3.5" /> Activar seleccionados
        </button>
        <button
          type="button"
          onClick={onDeactivateSelected}
          className="flex items-center gap-1.5 rounded-lg border border-status-danger/40 px-3 py-1.5 text-xs font-semibold text-status-danger hover:bg-status-danger/10"
        >
          <UserMinusIcon className="h-3.5 w-3.5" /> Desactivar seleccionados
        </button>
        <button
          type="button"
          onClick={onClearSelection}
          aria-label="Limpiar selección"
          className="rounded-lg p-1.5 text-text-secondary-light hover:bg-black/5 dark:text-text-secondary-dark dark:hover:bg-white/5"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
