import { useEffect, useState } from 'react';
import StatusBadge from '../../../components/StatusBadge';
import { getStatusLabel, getStatusMeta } from '../../dashboard/statusMeta';
import { formatClockTime } from '../../dashboard/mappers';
import { formatRemaining } from '../flightMonitoringMappers';
import { XIcon } from './icons';
import { useTranslation } from '../../../i18n/LanguageScope';
import { flightMonitoringMessages } from '../flightMonitoringMessages';

const EDITABLE_STATUSES = [
  'scheduled', 'delayed', 'enRoute', 'landed', 'taxiing',
  'arrived', 'gateArrival', 'cancelled', 'diverted', 'unknown',
];

export default function FlightDetailPopover({ flight, now, style, inline = false, onClose, onStatusChange }) {
  const { t, language, locale } = useTranslation(flightMonitoringMessages);
  const [selectedStatus, setSelectedStatus] = useState(flight?.status ?? 'scheduled');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setSelectedStatus(flight?.status ?? 'scheduled'); setError(''); }, [flight?.id, flight?.status]);
  if (!flight) return null;

  const meta = getStatusMeta('flight', flight.status);

  return (
    <div
      data-testid="flight-detail-popover"
      role={inline ? undefined : 'dialog'}
      aria-label={inline ? undefined : t('detail.dialog', { flight: flight.flightNumber })}
      style={style}
      className={inline ? 'space-y-4 text-sm' : 'absolute z-20 w-72 space-y-2 rounded-2xl border border-black/10 bg-white/95 p-4 text-sm shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card'}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="font-mono text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
            {flight.flightNumber} · {flight.airline}
          </p>
          <StatusBadge tone={meta.color} label={getStatusLabel('flight', flight.status, language)} />
        </div>
        {!inline && <button
          type="button"
          aria-label={t('detail.close')}
          onClick={onClose}
          className="rounded-md p-1 text-text-secondary-light hover:bg-black/5 dark:text-text-secondary-dark dark:hover:bg-white/5"
        >
          <XIcon className="h-4 w-4" />
        </button>}
      </div>

      <p className="text-text-secondary-light dark:text-text-secondary-dark">
        {flight.origin} → {flight.destination} · {flight.aircraft} · {flight.registration}
      </p>

      <dl className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
        <dt>ETA</dt>
        <dd>{flight.eta ? formatClockTime(flight.eta, locale) : '—'}</dd>
        <dt>ETD</dt>
        <dd>{flight.etd ? formatClockTime(flight.etd, locale) : '—'}</dd>
        <dt>{t('detail.actual')}</dt>
        <dd>
          {flight.actualArrival ?? flight.actualDeparture
            ? formatClockTime(flight.actualArrival ?? flight.actualDeparture, locale)
            : t('detail.pending')}
        </dd>
        <dt>{t('detail.altitude')}</dt>
        <dd>{flight.altitude == null ? t('detail.noTelemetry') : `${flight.altitude.toLocaleString('en-US')} ft`}</dd>
        <dt>{t('detail.speed')}</dt>
        <dd>{flight.speed == null ? '—' : `${flight.speed} kt`}</dd>
        <dt>{t('detail.heading')}</dt>
        <dd>{flight.heading == null ? '—' : `${flight.heading}°`}</dd>
        <dt>{t('detail.stand')}</dt>
        <dd>{flight.stand ?? t('detail.unassigned')}</dd>
        <dt>{t('detail.supervisor')}</dt>
        <dd>{flight.supervisor ?? t('detail.unassigned')}</dd>
        <dt>{t('detail.agents')}</dt>
        <dd>{flight.agents}</dd>
        <dt>{t('detail.remaining')}</dt>
        <dd>{formatRemaining(flight.eta ?? flight.etd, now, t)}</dd>
      </dl>

      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
        {t('detail.services', { services: flight.services.length > 0 ? flight.services.join(', ') : t('detail.noServices') })}
      </p>

      {onStatusChange && <div className="space-y-2 rounded-xl bg-accent-600/5 p-3">
        <label className="block text-xs font-semibold">{t('detail.updateStatus')}
          <select value={selectedStatus} onChange={event => setSelectedStatus(event.target.value)} className="mt-1 w-full rounded-lg border border-black/10 bg-white px-2 py-2 text-xs dark:border-white/10 dark:bg-surface-dark">
            {EDITABLE_STATUSES.map(value => <option key={value} value={value}>{t(`detail.editable.${value}`)}</option>)}
          </select>
        </label>
        {error && <p role="alert" className="text-xs text-status-danger">{error}</p>}
        <button type="button" disabled={saving || selectedStatus === flight.status} onClick={async () => {
          setSaving(true); setError('');
          try { await onStatusChange(flight.id, selectedStatus); }
          catch (reason) { setError(reason?.message || t('detail.saveError')); }
          finally { setSaving(false); }
        }} className="w-full rounded-lg bg-accent-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
          {saving ? t('detail.saving') : t('detail.save')}
        </button>
      </div>}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          disabled
          title={t('detail.comingSoon')}
          className="cursor-not-allowed rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-text-secondary-light/60 dark:border-white/10 dark:text-text-secondary-dark/60"
        >
          {t('detail.viewPlanning')}
        </button>
        <button
          type="button"
          disabled
          title={t('detail.comingSoon')}
          className="cursor-not-allowed rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-text-secondary-light/60 dark:border-white/10 dark:text-text-secondary-dark/60"
        >
          {t('detail.viewPositions')}
        </button>
      </div>
    </div>
  );
}
