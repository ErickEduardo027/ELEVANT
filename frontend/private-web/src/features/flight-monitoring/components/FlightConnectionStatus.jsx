import { AlertTriangleIcon, RefreshCwIcon } from '../../dashboard/components/icons';
import { formatClockTime } from '../../dashboard/mappers';
import { useTranslation } from '../../../i18n/LanguageScope';
import { flightMonitoringMessages } from '../flightMonitoringMessages';

const STATUS_META = {
  connected: { colorClass: 'text-status-success', dotClass: 'bg-status-success' },
  syncing: { colorClass: 'text-status-warning', dotClass: 'bg-status-warning' },
  disconnected: { colorClass: 'text-status-danger', dotClass: 'bg-status-danger' },
};

export default function FlightConnectionStatus({ source, connection, lastUpdatedAt, onRefresh }) {
  const { t, locale } = useTranslation(flightMonitoringMessages);
  const known = STATUS_META[connection] ? connection : null;
  const meta = STATUS_META[known ?? 'disconnected'];
  const title = source === 'planning'
    ? known && t(`connection.planning.${known}`)
    : t(`connection.flyAware.${known ?? 'disconnected'}`);
  const Icon = connection === 'disconnected' ? AlertTriangleIcon : RefreshCwIcon;

  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-3 rounded-xl border border-black/5 bg-white/70 px-4 py-3 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card ${
        connection === 'disconnected' ? 'ring-1 ring-status-danger/40' : ''
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dotClass}`} aria-hidden="true" />
      <Icon className={`h-4 w-4 shrink-0 ${meta.colorClass}`} />
      <span className={`text-sm font-medium ${meta.colorClass}`}>{title}</span>
      <span className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
        {lastUpdatedAt ? t('connection.lastUpdate', { time: formatClockTime(lastUpdatedAt, locale) }) : t('connection.noUpdates')}
      </span>
      <button
        type="button"
        onClick={onRefresh}
        className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-accent-600/30 px-3 py-1.5 text-xs font-semibold text-accent-600 hover:bg-accent-600/10"
      >
        <RefreshCwIcon className="h-3.5 w-3.5" />
        {t('connection.refresh')}
      </button>
    </div>
  );
}
