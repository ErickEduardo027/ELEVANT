import { CheckCircleIcon, AlertTriangleIcon, XIcon } from '../features/shell/components/icons';

const TONE_ICON = {
  success: CheckCircleIcon,
  danger: AlertTriangleIcon,
  info: CheckCircleIcon,
};

const TONE_CLASSES = {
  success: 'border-status-success/30 text-status-success',
  danger: 'border-status-danger/30 text-status-danger',
  info: 'border-accent-600/30 text-accent-600',
};

// Pila de toasts fija en la esquina superior derecha, alimentada por
// `useToast`. Presentacional puro: no decide cuándo mostrarse.
export default function Toast({ toasts, onDismiss }) {
  if (!toasts.length) return null;

  return (
    <div className="fixed right-4 top-4 z-[60] flex w-full max-w-sm flex-col gap-2">
      {toasts.map(toast => {
        const Icon = TONE_ICON[toast.tone] ?? TONE_ICON.success;
        return (
          <div
            key={toast.id}
            role={toast.tone === 'danger' ? 'alert' : 'status'}
            className={`flex items-start gap-2 rounded-xl border bg-white/95 p-3 shadow-lg backdrop-blur-md dark:bg-surface-dark-card ${
              TONE_CLASSES[toast.tone] ?? TONE_CLASSES.success
            }`}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="flex-1 text-sm text-ink-900 dark:text-text-primary-dark">{toast.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Cerrar notificación"
              className="text-text-secondary-light hover:text-ink-900 dark:text-text-secondary-dark dark:hover:text-text-primary-dark"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
