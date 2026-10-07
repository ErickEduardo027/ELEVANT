import { AlertTriangleIcon } from '../../dashboard/components/icons';
import { XIcon } from '../../flight-monitoring/components/icons';

const KIND_META = {
  disabled: { colorClass: 'text-status-danger', icon: AlertTriangleIcon },
  error: { colorClass: 'text-status-danger', icon: AlertTriangleIcon },
};

function Toast({ toast, onDismiss }) {
  const meta = KIND_META[toast.kind] ?? KIND_META.disabled;
  const Icon = meta.icon;

  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-black/10 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card [animation:elevant-fade-in_180ms_ease-out]"
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.colorClass}`} />
      <span className="text-ink-900 dark:text-text-primary-dark">
        <span className="block font-semibold">{toast.title}</span>
        <span className="block text-text-secondary-light dark:text-text-secondary-dark">{toast.description}</span>
      </span>
      <button
        type="button"
        aria-label="Descartar aviso"
        onClick={() => onDismiss(toast.id)}
        className="ml-auto shrink-0 rounded-md p-0.5 text-text-secondary-light hover:bg-black/5 dark:text-text-secondary-dark dark:hover:bg-white/5"
      >
        <XIcon className="h-3 w-3" />
      </button>
    </div>
  );
}

export default function PositionToastStack({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-toast flex flex-col gap-2 sm:left-auto sm:w-80">
      {toasts.map(toast => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
