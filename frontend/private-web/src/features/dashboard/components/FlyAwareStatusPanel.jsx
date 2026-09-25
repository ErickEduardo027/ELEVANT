import { AlertTriangleIcon, RefreshCwIcon } from './icons';

const STATUS_META = {
  online: {
    title: 'FlyAware en línea',
    colorClass: 'text-status-success',
    dotClass: 'bg-status-success',
  },
  degraded: {
    title: 'FlyAware con demoras',
    colorClass: 'text-status-warning',
    dotClass: 'bg-status-warning',
  },
  error: {
    title: 'FlyAware sin conexión',
    colorClass: 'text-status-danger',
    dotClass: 'bg-status-danger',
  },
};

const DEFAULT_META = {
  title: 'Fuente aeronáutica no conectada',
  colorClass: 'text-text-secondary-light dark:text-text-secondary-dark',
  dotClass: 'bg-text-secondary-light',
};

export default function FlyAwareStatusPanel({ status, lastSyncMinutesAgo }) {
  const meta = STATUS_META[status] || DEFAULT_META;
  const Icon = status === 'error' ? AlertTriangleIcon : RefreshCwIcon;

  return (
    <div
      role="status"
      className={`flex items-center gap-3 rounded-xl border border-black/5 bg-white/70 px-4 py-3 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card ${
        status === 'error' ? 'ring-1 ring-status-danger/40' : ''
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dotClass}`} aria-hidden="true" />
      <Icon className={`h-4 w-4 shrink-0 ${meta.colorClass}`} />
      <span className={`text-sm font-medium ${meta.colorClass}`}>{meta.title}</span>
      <span className="ml-auto text-xs text-text-secondary-light dark:text-text-secondary-dark">
        {Number.isFinite(lastSyncMinutesAgo) ? `Última sincronización hace ${lastSyncMinutesAgo} min` : 'Sin sincronización verificada'}
      </span>
    </div>
  );
}
