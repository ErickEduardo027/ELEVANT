import { XIcon } from '../../review/components/icons';
import { CheckCheckIcon } from './icons';

export default function NotificationBulkActionsBar({ count, onMarkRead, onMarkUnread, onClear }) {
  if (count === 0) return null;

  return (
    <div
      role="region"
      aria-label="Acciones sobre la selección"
      className="mx-auto flex max-w-[800px] flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent-600/30 bg-accent-600/10 px-4 py-2.5"
    >
      <p className="text-sm font-medium text-ink-900 dark:text-text-primary-dark">
        {count === 1 ? '1 seleccionada' : `${count} seleccionadas`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onMarkRead}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90"
        >
          <CheckCheckIcon className="h-3.5 w-3.5" />
          Marcar como leídas
        </button>
        <button
          type="button"
          onClick={onMarkUnread}
          className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-ink-900 hover:bg-black/5 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
        >
          Marcar como no leídas
        </button>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-text-secondary-light hover:bg-black/5 dark:text-text-secondary-dark dark:hover:bg-white/5"
        >
          <XIcon className="h-3.5 w-3.5" />
          Limpiar selección
        </button>
      </div>
    </div>
  );
}
