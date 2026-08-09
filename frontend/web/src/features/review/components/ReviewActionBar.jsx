import { CheckCircleIcon, CornerUpLeftIcon, HistoryIcon } from './icons';

export default function ReviewActionBar({ onApproveClick, onReturnClick, onViewHistory }) {
  return (
    <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-black/5 bg-white/95 px-5 py-3 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <button
        type="button"
        onClick={onViewHistory}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary-light hover:text-ink-900 dark:text-text-secondary-dark dark:hover:text-text-primary-dark"
      >
        <HistoryIcon className="h-3.5 w-3.5" />
        Ver historial
      </button>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onReturnClick}
          className="inline-flex items-center gap-1.5 rounded-lg border border-status-danger/40 px-3 py-1.5 text-xs font-semibold text-status-danger hover:bg-status-danger/10"
        >
          <CornerUpLeftIcon className="h-3.5 w-3.5" />
          Devolver con correcciones
        </button>
        <button
          type="button"
          onClick={onApproveClick}
          className="inline-flex items-center gap-1.5 rounded-lg bg-status-success px-3 py-1.5 text-xs font-semibold text-white hover:bg-status-success/90"
        >
          <CheckCircleIcon className="h-3.5 w-3.5" />
          Aprobar
        </button>
      </div>
    </div>
  );
}
