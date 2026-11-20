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

/**
 * Where the stack sits. `top-right` (the default) keeps the corner the OCC screens use. `bottom-right` (D-N33) is for
 * the department shells, whose topbar has the bell and the user menu at the top right: a toast there covered them.
 * Literal classes, so that Tailwind generates them; below 640 px the stack spans the screen with a 1 rem margin.
 */
export const TOAST_PLACEMENTS = Object.freeze({
  'top-right': 'fixed inset-x-4 top-4 z-toast flex flex-col gap-2 sm:left-auto sm:w-full sm:max-w-sm',
  'bottom-right': 'fixed inset-x-4 bottom-4 z-toast flex flex-col gap-2 sm:left-auto sm:w-full sm:max-w-sm',
});

// The toasts `useToast` feeds, in the corner `placement` names (a key of TOAST_PLACEMENTS; any other value takes the
// top right). Purely presentational: it never decides when a toast shows.
export default function Toast({ toasts, onDismiss, placement = 'top-right' }) {
  if (!toasts.length) return null;
  const corner = Object.hasOwn(TOAST_PLACEMENTS, placement) ? placement : 'top-right';

  return (
    <div data-placement={corner} className={TOAST_PLACEMENTS[corner]}>
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
            {toast.action && (
              <button
                type="button"
                onClick={() => { toast.action.onClick(); onDismiss(toast.id); }}
                className="shrink-0 rounded-lg border border-current px-2 py-0.5 text-xs font-semibold"
              >
                {toast.action.label}
              </button>
            )}
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
