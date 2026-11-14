import { useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { reviewMessages } from '../reviewMessages';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import {
  addOccReviewCharge, removeOccReviewCharge, setOccReviewBillingExclusion,
} from '../../../services/occReviewService';
import { chargeSourceLabel } from '../../operations/operationLabels';
import OccButton from '../../occ-ui/OccButton';
import OccDialog from '../../occ-ui/OccDialog';
import { OccSelectField, OccTextareaField } from '../../occ-ui/OccField';
import OccGlyph from '../../occ-ui/OccGlyph';
import OccMilestoneStrip from '../../occ-ui/OccMilestoneStrip';
import OccPanel from '../../occ-ui/OccPanel';
import OccStatusPill from '../../occ-ui/OccStatusPill';
import { buildMilestonePhases } from '../../occ-ui/milestonePhases';

// A label over its figure, as the review's other figures read; the figure keeps tabular digits.
const TERM = 'text-xs font-medium text-occ-muted';
const FIGURE = 'mt-0.5 text-lg font-semibold tabular-nums text-occ-text';
// Who marked a charge, or what OCC decided about a service, is a plain outlined tag: a normal state carries no hue.
const TAG = 'ml-2 inline-flex rounded-sm border border-occ-line px-1.5 text-xs font-medium text-occ-muted';
const SUBHEADING = 'text-sm font-semibold text-occ-text';
const ROW = 'flex flex-wrap items-center justify-between gap-2 py-2';

/**
 * «Cierre de la operación» (ADR-0034): ground time against Finance's allowance, the Flight Report
 * milestones and the charges Finance will value. While the delivery is pending, OCC adds or removes
 * a charge with a reason; each change moves the review version the decision is sent with.
 *
 * Phase 3, block D: a service in Exception with an executed quantity is billed unless OCC excludes it here with a reason
 * (3-N11); a change after the Service Order was signed becomes its corrected version (3-N02). Each change carries its
 * intent's Idempotency-Key; a refusal for a stale version is reported with `onChanged(text, 'error')`, which re-reads.
 *
 * U6: the panel keeps the region «Cierre de la operación»; the milestones are the full strip of the flight report in the
 * station's time, and each change is confirmed in a dialog drawn inside the panel, named after its confirm button.
 */
export default function OperationCloseSection({ detail, disabled, onChanged }) {
  const { t, locale, language } = useTranslation(reviewMessages);
  const close = detail.close;
  const keys = useRef(createCommandKeyHolder());
  const reasonRef = useRef(null);
  const serviceRef = useRef(null);
  const formId = useId();
  const [removing, setRemoving] = useState(null);
  const [adding, setAdding] = useState(false);
  const [exclusion, setExclusion] = useState(null);
  const [serviceId, setServiceId] = useState('');
  const [chargeId, setChargeId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const phases = useMemo(() => buildMilestonePhases(close.milestones, language), [close.milestones, language]);
  const timing = close.timing;
  const minutes = value => (value === null || value === undefined ? t('close.unknown') : t('close.minutes', { value: Math.round(value) }));
  const overrun = timing.groundMinutes != null && timing.allowedGroundMinutes != null
    ? Math.max(0, Math.round(timing.groundMinutes - timing.allowedGroundMinutes)) : 0;
  const serviceName = id => detail.services.find(service => service.id === id)?.name ?? '';
  const options = close.chargeOptions.filter(option => !serviceId || option.serviceIds.includes(serviceId));
  const validReason = reason.trim().length >= 8 && reason.trim().length <= 500;
  const exclusions = close.billingExclusions ?? [];
  const exclusionOf = id => exclusions.find(item => item.serviceId === id) ?? null;
  // 3-N11: what OCC may exclude from billing, plus whatever it already excluded.
  const billable = detail.services.filter(service =>
    (service.status === 'Exception' && service.executedQuantity > 0) || exclusionOf(service.id));
  const signed = detail.serviceOrderState === 'Signed' || detail.serviceOrderState === 'Corrected';
  const changing = Boolean(removing || adding || exclusion);

  function reset() {
    setRemoving(null);
    setAdding(false);
    setExclusion(null);
    setServiceId('');
    setChargeId('');
    setReason('');
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || !validReason) return;
    const trimmed = reason.trim();
    const version = detail.reviewVersion;
    setBusy(true);
    setError('');
    try {
      if (removing) {
        const command = { submissionId: detail.submissionId, reason: trimmed };
        await keys.current.run('remove', { markId: removing, ...command, version }, key =>
          removeOccReviewCharge(detail.operationId, removing, command, version, { idempotencyKey: key }));
        reset();
        onChanged(t('close.removed'));
      } else if (exclusion) {
        const command = { submissionId: detail.submissionId, excluded: exclusion.excluded, reason: trimmed };
        await keys.current.run('exclusion', { serviceId: exclusion.serviceId, ...command, version }, key =>
          setOccReviewBillingExclusion(detail.operationId, exclusion.serviceId, command, version, key));
        const excluded = exclusion.excluded;
        reset();
        onChanged(excluded ? t('close.excludedDone') : t('close.includedDone'));
      } else {
        const command = { submissionId: detail.submissionId, serviceId, chargeId, reason: trimmed };
        await keys.current.run('add', { ...command, version }, key =>
          addOccReviewCharge(detail.operationId, command, version, { idempotencyKey: key }));
        reset();
        onChanged(t('close.added'));
      }
    } catch (failure) {
      // A stale version or a state that moved: the screen re-reads before OCC forms a new intent.
      if (failure?.status === 409 || failure?.status === 412) {
        reset();
        onChanged(failure.message, 'error');
      } else {
        setError(failure.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const confirmLabel = removing ? t('close.confirmRemove')
    : exclusion ? (exclusion.excluded ? t('close.confirmExclude') : t('close.confirmInclude'))
      : t('close.confirmAdd');

  return (
    <OccPanel headingLevel={3} title={t('close.title')}>
      <div className="space-y-4 p-3 text-sm">
        <p className="text-occ-muted">{t('close.intro')}</p>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3 xl:grid-cols-2 3xl:grid-cols-3">
          <div className="min-w-0">
            <dt className={TERM}>{t('close.ground')}</dt>
            <dd className={FIGURE}>{minutes(timing.groundMinutes)}</dd>
            {overrun > 0 && (
              <dd className="mt-1">
                <OccStatusPill size="sm" tone="attention" label={t('close.exceeded', { value: overrun })} />
              </dd>
            )}
          </div>
          <div className="min-w-0">
            <dt className={TERM}>{t('close.allowed')}</dt>
            <dd className={FIGURE}>
              {timing.allowedGroundMinutes != null ? minutes(timing.allowedGroundMinutes) : t('close.unknown')}
            </dd>
            <dd className="mt-0.5 text-xs text-occ-muted">
              {timing.aircraftCategory ? t(`close.category.${timing.aircraftCategory}`) : t('close.noAllowance')}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className={TERM}>{t('close.delay')}</dt>
            <dd className={FIGURE}>{minutes(timing.arrivalDelayMinutes)}</dd>
          </div>
        </dl>
        <div>
          <h4 className={SUBHEADING}>{t('close.milestones')}</h4>
          {close.milestones.length === 0 ? <p className="mt-1 text-occ-muted">{t('close.noMilestones')}</p> : (
            <OccMilestoneStrip variant="full" phases={phases} locale={locale} timeZone={detail.ianaTimeZone}
              className="mt-2 sm:grid-cols-2" />
          )}
          {close.damageCount > 0 && <p className="mt-2 text-xs text-occ-muted">{t('close.damages', { count: close.damageCount })}</p>}
        </div>
        <div>
          <h4 className={SUBHEADING}>{t('close.charges')}</h4>
          {!close.canAdjustCharges && <p className="mt-1 text-xs text-occ-muted">{t('close.frozen')}</p>}
          {close.charges.length === 0 ? <p className="mt-1 text-occ-muted">{t('close.noCharges')}</p> : (
            <ul className="mt-1 divide-y divide-occ-line">
              {close.charges.map(charge => (
                <li key={charge.markId} className={ROW}>
                  <span className="min-w-0">
                    <strong className="font-semibold">{charge.name}</strong>{' '}
                    <span className="font-mono text-xs text-occ-muted">({charge.code})</span> · {serviceName(charge.serviceId) || charge.serviceCode}
                    <span className={TAG}>{chargeSourceLabel(charge.source, language)}</span>
                    {charge.reason && <span className="block text-xs text-occ-muted">{charge.reason}</span>}
                  </span>
                  {close.canAdjustCharges && (
                    <OccButton size="sm" disabled={disabled || busy} onClick={() => { reset(); setRemoving(charge.markId); }}>
                      {t('close.remove')}
                    </OccButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        {billable.length > 0 && (
          <div>
            <h4 className={SUBHEADING}>{t('close.billing')}</h4>
            <p className="mt-0.5 text-xs text-occ-muted">{t('close.billingIntro')}</p>
            <ul className="mt-1 divide-y divide-occ-line">
              {billable.map(service => {
                const excluded = exclusionOf(service.id);
                return (
                  <li key={service.id} className={ROW}>
                    <span className="min-w-0">
                      <strong className="font-semibold">{service.name}</strong>{' '}
                      <span className="font-mono text-xs text-occ-muted">({service.code})</span>
                      <span className={TAG}>{excluded ? t('close.excluded', { reason: excluded.reason }) : t('close.billed')}</span>
                    </span>
                    {close.canAdjustCharges && (
                      <OccButton size="sm" disabled={disabled || busy}
                        onClick={() => { reset(); setExclusion({ serviceId: service.id, excluded: !excluded }); }}>
                        {excluded ? t('close.include') : t('close.exclude')}
                      </OccButton>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {close.canAdjustCharges && close.chargeOptions.length > 0 && (
          <OccButton size="sm" disabled={disabled || busy || changing} onClick={() => { reset(); setAdding(true); }}>
            {t('close.add')}
          </OccButton>
        )}
      </div>
      <OccDialog open={changing} onClose={reset} title={confirmLabel} busy={busy}
        initialFocusRef={adding ? serviceRef : reasonRef}
        footer={(
          <>
            <OccButton type="submit" form={formId} variant="primary" busy={busy} busyLabel={t('close.saving')}
              disabled={!validReason || (adding && (!serviceId || !chargeId))}>
              {confirmLabel}
            </OccButton>
            <OccButton data-occ-dialog-cancel="" disabled={busy} onClick={reset}>{t('close.cancel')}</OccButton>
          </>
        )}>
        <form id={formId} onSubmit={event => void submit(event)} className="space-y-3">
          {exclusion && <p className="font-semibold">{exclusion.excluded ? t('close.exclude') : t('close.include')} · {serviceName(exclusion.serviceId)}</p>}
          {signed && (
            <p role="note" className="flex items-start gap-1.5 text-xs text-occ-text">
              <OccGlyph name="attention" />
              <span className="min-w-0">{t('close.correction')}</span>
            </p>
          )}
          {adding && (
            <div className="grid gap-3 sm:grid-cols-2">
              <OccSelectField ref={serviceRef} label={t('close.service')} required value={serviceId}
                onChange={event => { setServiceId(event.target.value); setChargeId(''); }}>
                <option value="">{t('close.select')}</option>
                {detail.services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}
              </OccSelectField>
              <OccSelectField label={t('close.charge')} required value={chargeId} disabled={!serviceId}
                onChange={event => setChargeId(event.target.value)}>
                <option value="">{t('close.select')}</option>
                {options.map(option => <option key={option.chargeId} value={option.chargeId}>{option.name} ({option.code})</option>)}
              </OccSelectField>
            </div>
          )}
          <OccTextareaField ref={reasonRef} label={t('close.reason')} required minLength={8} maxLength={500} rows={2}
            value={reason} onChange={event => setReason(event.target.value)} />
          {error && (
            <p role="alert" className="flex items-start gap-1.5 text-sm text-occ-text">
              <OccGlyph name="attention" className="mt-0.5" />
              <span className="min-w-0">{error}</span>
            </p>
          )}
        </form>
      </OccDialog>
    </OccPanel>
  );
}
