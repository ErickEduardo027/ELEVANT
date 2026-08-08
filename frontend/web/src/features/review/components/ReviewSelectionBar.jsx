import { CornerUpLeftIcon, CheckCircleIcon, XIcon } from './icons';

export default function ReviewSelectionBar({ count, onApproveSelected, onReturnSelected, onClearSelection }) {
  if (count === 0) return null;

  return (
    <div
      role="region"
      aria-label="Acciones sobre la selección"
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent-600/30 bg-accent-600/10 px-4 py-2.5"
    >
      <p className="text-sm font-medium text-ink-900 dark:text-text-primary-dark">
        {count === 1 ? '1 operación seleccionada' : `${count} operaciones seleccionadas`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onApproveSelected}
          className="inline-flex items-center gap-1.5 rounded-lg bg-status-success px-3 py-1.5 text-xs font-semibold text-white hover:bg-status-success/90"
        >
          <CheckCircleIcon className="h-3.5 w-3.5" />
          Aprobar seleccionadas
        </button>
        <button
          type="button"
          onClick={onReturnSelected}
          className="inline-flex items-center gap-1.5 rounded-lg border border-status-danger/40 px-3 py-1.5 text-xs font-semibold text-status-danger hover:bg-status-danger/10"
        >
          <CornerUpLeftIcon className="h-3.5 w-3.5" />
          Devolver seleccionadas
        </button>
        <button
          type="button"
          onClick={onClearSelection}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-text-secondary-light hover:bg-black/5 dark:text-text-secondary-dark dark:hover:bg-white/5"
        >
          <XIcon className="h-3.5 w-3.5" />
          Limpiar selección
        </button>
      </div>
    </div>
  );
}
