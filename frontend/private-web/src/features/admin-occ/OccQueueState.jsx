import { OCC_STATION_CODE, OCC_STATION_NAME } from './useOccStation';
import { useTranslation } from '../../i18n/LanguageScope';
import { occQueueMessages } from './occQueueMessages';

// Contexto fijo de estación del espacio OCC: informa, no permite cambiarla.
export function OccStationBadge({ className = '' }) {
  return <p className={`inline-flex items-center gap-2 rounded-md border border-black/10 px-2.5 py-1.5 text-xs dark:border-white/10 ${className}`}>
    <span className="font-mono font-semibold tracking-wider text-accent-600 dark:text-[#5B9BF5]">{OCC_STATION_CODE}</span>
    <span className="text-text-secondary-light dark:text-text-secondary-dark">{OCC_STATION_NAME}</span>
  </p>;
}

export function OccQueueState({ queue }) {
  const { t } = useTranslation(occQueueMessages);
  if (queue.status === 'empty-scope') return <p role="status" className="rounded-xl bg-white/80 p-5 dark:bg-surface-dark-card">{t('emptyScope')}</p>;
  if (queue.status === 'loading') return <p role="status" className="rounded-xl bg-white/80 p-5 dark:bg-surface-dark-card">{t('loading')}</p>;
  if (queue.status === 'error') return <div role="alert" className="rounded-xl border border-status-danger/30 bg-white/80 p-5 dark:bg-surface-dark-card">
    <p>{t('error')}</p>
    <button type="button" onClick={queue.refresh} className="mt-3 min-h-11 rounded-lg bg-accent-600 px-4 py-2 font-semibold text-white">{t('retry')}</button>
  </div>;
  return null;
}
