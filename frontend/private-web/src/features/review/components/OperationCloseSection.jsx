import { useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { reviewMessages } from '../reviewMessages';
import { addOccReviewCharge, removeOccReviewCharge } from '../../../services/occReviewService';

const SOURCE_TONE = {
  Agent: 'bg-black/5 dark:bg-white/10',
  Automatic: 'bg-accent-600/10 text-accent-600',
  Occ: 'bg-status-warning/15',
};

function time(value, timeZone, locale) {
  try {
    return new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone }).format(new Date(value));
  } catch {
    return value;
  }
}

/**
 * «Cierre de la operación» (ADR-0034): ground time against Finance's allowance, the Flight Report
 * milestones and the charges Finance will value. While the delivery is pending, OCC adds or removes
 * a charge with a reason; each change moves the review version the decision is sent with.
 */
export default function OperationCloseSection({ detail, disabled, onChanged }) {
  const { t, locale } = useTranslation(reviewMessages);
  const close = detail.close;
  const [removing, setRemoving] = useState(null);
  const [adding, setAdding] = useState(false);
  const [serviceId, setServiceId] = useState('');
  const [chargeId, setChargeId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const timing = close.timing;
  const minutes = value => (value === null || value === undefined ? t('close.unknown') : t('close.minutes', { value: Math.round(value) }));
  const overrun = timing.groundMinutes != null && timing.allowedGroundMinutes != null
    ? Math.max(0, Math.round(timing.groundMinutes - timing.allowedGroundMinutes)) : 0;
  const serviceName = id => detail.services.find(service => service.id === id)?.name ?? '';
  const options = close.chargeOptions.filter(option => !serviceId || option.serviceIds.includes(serviceId));
  const validReason = reason.trim().length >= 8 && reason.trim().length <= 500;

  function reset() {
    setRemoving(null);
    setAdding(false);
    setServiceId('');
    setChargeId('');
    setReason('');
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || !validReason) return;
    setBusy(true);
    setError('');
    try {
      if (removing) {
        await removeOccReviewCharge(detail.operationId, removing,
          { submissionId: detail.submissionId, reason: reason.trim() }, detail.reviewVersion);
        reset();
        onChanged(t('close.removed'));
      } else {
        await addOccReviewCharge(detail.operationId,
          { submissionId: detail.submissionId, serviceId, chargeId, reason: reason.trim() }, detail.reviewVersion);
        reset();
        onChanged(t('close.added'));
      }
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={t('close.title')} className="space-y-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
      <div>
        <h3 className="font-semibold">{t('close.title')}</h3>
        <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">{t('close.intro')}</p>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-lg bg-black/[0.03] p-3 dark:bg-white/5">
          <dt className="text-xs uppercase tracking-wide">{t('close.ground')}</dt>
          <dd className="text-lg font-semibold tabular-nums">{minutes(timing.groundMinutes)}</dd>
          {overrun > 0 && <dd className="text-xs font-semibold text-status-warning">{t('close.exceeded', { value: overrun })}</dd>}
        </div>
        <div className="rounded-lg bg-black/[0.03] p-3 dark:bg-white/5">
          <dt className="text-xs uppercase tracking-wide">{t('close.allowed')}</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {timing.allowedGroundMinutes != null ? minutes(timing.allowedGroundMinutes) : t('close.unknown')}
          </dd>
          <dd className="text-xs">{timing.aircraftCategory ? t(`close.category.${timing.aircraftCategory}`) : t('close.noAllowance')}</dd>
        </div>
        <div className="rounded-lg bg-black/[0.03] p-3 dark:bg-white/5">
          <dt className="text-xs uppercase tracking-wide">{t('close.delay')}</dt>
          <dd className="text-lg font-semibold tabular-nums">{minutes(timing.arrivalDelayMinutes)}</dd>
        </div>
      </dl>
      <div>
        <h4 className="text-sm font-semibold">{t('close.milestones')}</h4>
        {close.milestones.length === 0 ? <p className="text-sm">{t('close.noMilestones')}</p> : (
          <ul className="mt-1 flex flex-wrap gap-2 text-xs">
            {close.milestones.map(item => (
              <li key={`${item.code}:${item.actualAt}`} className="rounded-full border border-black/10 px-2.5 py-1 dark:border-white/10">
                {item.code} · <span className="tabular-nums">{time(item.actualAt, detail.ianaTimeZone, locale)}</span>
              </li>
            ))}
          </ul>
        )}
        {close.damageCount > 0 && <p className="mt-1 text-xs">{t('close.damages', { count: close.damageCount })}</p>}
      </div>
      <div>
        <h4 className="text-sm font-semibold">{t('close.charges')}</h4>
        {!close.canAdjustCharges && <p className="text-xs text-text-secondary-light">{t('close.frozen')}</p>}
        {close.charges.length === 0 ? <p className="text-sm">{t('close.noCharges')}</p> : (
          <ul className="mt-1 divide-y divide-black/10 text-sm dark:divide-white/10">
            {close.charges.map(charge => (
              <li key={charge.markId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong>{charge.name}</strong> <span className="text-text-secondary-light">({charge.code})</span> · {serviceName(charge.serviceId) || charge.serviceCode}
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${SOURCE_TONE[charge.source] ?? ''}`}>
                    {t(`close.source.${charge.source}`)}
                  </span>
                  {charge.reason && <span className="block text-xs text-text-secondary-light">{charge.reason}</span>}
                </span>
                {close.canAdjustCharges && (
                  <button type="button" disabled={disabled || busy} onClick={() => { reset(); setRemoving(charge.markId); }}
                    className="min-h-10 rounded-lg border border-status-warning px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
                    {t('close.remove')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {close.canAdjustCharges && !removing && !adding && close.chargeOptions.length > 0 && (
        <button type="button" disabled={disabled || busy} onClick={() => { reset(); setAdding(true); }}
          className="min-h-10 rounded-lg border border-accent-600 px-3 py-1.5 text-sm font-semibold text-accent-600 disabled:opacity-50">
          {t('close.add')}
        </button>
      )}
      {(removing || adding) && (
        <form onSubmit={event => void submit(event)} className="space-y-2 rounded-lg border border-status-warning/40 p-3 text-sm">
          {adding && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">{t('close.service')}
                <select required value={serviceId} onChange={event => { setServiceId(event.target.value); setChargeId(''); }}
                  className="mt-1 block w-full rounded-lg border border-black/20 bg-white p-2 text-ink-900">
                  <option value="">{t('close.select')}</option>
                  {detail.services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}
                </select>
              </label>
              <label className="block">{t('close.charge')}
                <select required value={chargeId} onChange={event => setChargeId(event.target.value)} disabled={!serviceId}
                  className="mt-1 block w-full rounded-lg border border-black/20 bg-white p-2 text-ink-900 disabled:opacity-50">
                  <option value="">{t('close.select')}</option>
                  {options.map(option => <option key={option.chargeId} value={option.chargeId}>{option.name} ({option.code})</option>)}
                </select>
              </label>
            </div>
          )}
          <label className="block">{t('close.reason')}
            <textarea required minLength={8} maxLength={500} rows={2} value={reason} onChange={event => setReason(event.target.value)}
              className="mt-1 block w-full rounded-lg border border-black/20 bg-white p-2 text-ink-900" />
          </label>
          {error && <p role="alert" className="text-status-danger">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !validReason || (adding && (!serviceId || !chargeId))}
              className="min-h-10 rounded-lg bg-accent-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50">
              {busy ? t('close.saving') : removing ? t('close.confirmRemove') : t('close.confirmAdd')}
            </button>
            <button type="button" disabled={busy} onClick={reset} className="min-h-10 rounded-lg border px-3 py-1.5">{t('close.cancel')}</button>
          </div>
        </form>
      )}
    </section>
  );
}
