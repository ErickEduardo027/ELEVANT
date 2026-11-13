import { useEffect } from 'react';
import StatusBadge from '../../../components/StatusBadge';
import { getStatusLabel, getStatusMeta } from '../../dashboard/statusMeta';
import { formatClockTime } from '../../dashboard/mappers';
import { XIcon } from '../../flight-monitoring/components/icons';
import { TERMINAL_LABELS } from '../positionsMapMappers';
import CombinedPositionBanner from './CombinedPositionBanner';
import PositionActions from './PositionActions';
import { useTranslation } from '../../../i18n/LanguageScope';
import { positionsMapMessages } from '../positionsMapMessages';

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-text-secondary-light dark:text-text-secondary-dark">{label}</dt>
      <dd className="font-mono text-ink-900 dark:text-text-primary-dark">{children}</dd>
    </div>
  );
}

export default function PositionDetailDrawer({ position, onClose, onViewFlightInMonitoring, canAssign = false, candidates = [], onChanged,
  onStartPlacing, operationDate }) {
  const { t, language, locale } = useTranslation(positionsMapMessages);
  useEffect(() => {
    if (!position) return undefined;
    // Escape closes the drawer first and is marked as used, so the map keys leave the selection for the next one.
    function handleKeyDown(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [position, onClose]);

  if (!position) return null;

  const hasFlight = Boolean(position.flightId || position.flightNumber);
  const meta = getStatusMeta('position', position.status);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-sm transition-opacity duration-200" onClick={onClose} />
      <aside
        data-testid="position-detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="position-drawer-title"
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-black/5 bg-white/95 shadow-lg backdrop-blur-md transition-transform duration-200 dark:border-white/5 dark:bg-surface-dark-card lg:w-[420px]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-black/5 px-5 py-4 dark:border-white/5">
          <div className="space-y-1.5">
            <p id="position-drawer-title" className="font-mono text-base font-semibold text-ink-900 dark:text-text-primary-dark">
              {position.id}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={meta.color} label={getStatusLabel('position', position.status, language)} />
              <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                {TERMINAL_LABELS[position.terminal] ? t(`terminals.labels.${position.terminal}`) : position.terminal}
              </span>
            </div>
          </div>
          <button
            type="button"
            aria-label={t('detail.close')}
            onClick={onClose}
            className="rounded-md p-1.5 text-text-secondary-light hover:bg-black/5 dark:text-text-secondary-dark dark:hover:bg-white/5"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <CombinedPositionBanner position={position} />

          {hasFlight ? (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-xs">
              <Field label={t('detail.flight')}>{position.flightNumber}</Field>
              <Field label={t('detail.airline')}>{position.airline}</Field>
              <Field label={t('detail.registration')}>{position.aircraftRegistration}</Field>
              <Field label={t('detail.aircraftType')}>{position.aircraftType}</Field>
              <Field label={t('detail.agent')}>{position.assignedAgent ?? t('detail.unassigned')}</Field>
              <Field label={position.status === 'planned' ? t('detail.releaseUnverified') : t('detail.estimatedRelease')}>
                {position.estimatedReleaseTime ? formatClockTime(position.estimatedReleaseTime, locale) : '—'}
              </Field>
            </dl>
          ) : (
            <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">{position.status === 'unverified' ? t('detail.unverifiedNote') : t('detail.noFlight')}</p>
          )}

          {canAssign && position.standId && <PositionActions position={position} candidates={candidates} onChanged={onChanged}
            onStartPlacing={onStartPlacing} operationDate={operationDate} />}

          <p className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
            {t('detail.lastUpdate', { time: position.updatedAt ? formatClockTime(position.updatedAt, locale) : '—' })}
          </p>
        </div>

        {position.flightId && (
          <div className="border-t border-black/5 px-5 py-3 dark:border-white/5">
            <button
              type="button"
              onClick={() => onViewFlightInMonitoring(position.flightId)}
              className="w-full rounded-lg bg-accent-600 px-3 py-2 text-xs font-semibold text-white hover:bg-accent-600/90"
            >
              {t('detail.viewFlight')}
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
