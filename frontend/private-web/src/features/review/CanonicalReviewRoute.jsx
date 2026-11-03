import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppSearchParams as useSearchParams } from '../../hooks/useAppSearchParams';
import { useAuth } from '../auth/AuthContext';
import { OccStationBadge } from '../admin-occ/OccQueueState';
import { selectOccStationScopes } from '../admin-occ/useOccStation';
import { abortForEffectCleanup, isAbortError } from '../../lib/abort';
import { useTranslation } from '../../i18n/LanguageScope';
import {
  decideOccReview, loadOccReviewDetail, loadOccReviewQueue,
  loadOccReviewSubmissionDetail, loadOccReviewSubmissionHistory,
} from '../../services/occReviewService';
import { reviewMessages } from './reviewMessages';
import layouts from '../admin-occ/ui/OccModuleLayouts.module.css';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function useReviewText() {
  const { t, language, locale } = useTranslation(reviewMessages);
  const statuses = reviewMessages[language].status;
  return { t, locale, statusLabel: value => statuses[value] ?? value };
}

function dateTime(value, timeZone, locale) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium', timeStyle: 'short', timeZone,
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function Notice({ title, children, onRetry }) {
  const { t } = useTranslation(reviewMessages);
  return (
    <div role="alert" className="rounded-2xl border border-status-warning/30 bg-white/80 p-5 text-ink-900 dark:bg-surface-dark-card dark:text-text-primary-dark">
      <p className="font-semibold">{title}</p>
      {children && <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">{children}</p>}
      {onRetry && <button type="button" onClick={onRetry} className="mt-3 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">{t('retry')}</button>}
    </div>
  );
}

function ReviewEvidence({ detail }) {
  const { t, locale } = useTranslation(reviewMessages);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section aria-label={t('evidence.services')} className="rounded-xl border border-black/10 p-4 dark:border-white/10">
        <h3 className="font-semibold">{t('evidence.servicesTitle', { count: detail.services.length })}</h3>
        {detail.services.length === 0 ? <p className="mt-2 text-sm">{t('evidence.noServices')}</p> : (
          <ul className="mt-2 divide-y divide-black/10 text-sm dark:divide-white/10">
            {detail.services.map(service => (
              <li key={service.id} className="flex justify-between gap-3 py-2">
                <span>{service.name} <span className="text-text-secondary-light">({service.code})</span></span>
                <span className="text-right">{service.executedQuantity} / {service.contractedQuantity} {service.unit}<br />{service.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label={t('evidence.checklist')} className="rounded-xl border border-black/10 p-4 dark:border-white/10">
        <h3 className="font-semibold">{t('evidence.checklistTitle', { status: detail.checklistStatus })}</h3>
        {detail.checklistAnswers.length === 0 ? <p className="mt-2 text-sm">{t('evidence.noAnswers')}</p> : (
          <dl className="mt-2 divide-y divide-black/10 text-sm dark:divide-white/10">
            {detail.checklistAnswers.map(answer => (
              <div key={`${answer.section}:${answer.code}`} className="py-2">
                <dt className="font-medium">{answer.section} · {answer.label}</dt>
                <dd>{answer.value}{answer.note ? ` — ${answer.note}` : ''}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <section aria-label={t('evidence.incidents')} className="rounded-xl border border-black/10 p-4 dark:border-white/10 lg:col-span-2">
        <h3 className="font-semibold">{t('evidence.incidentsTitle', { count: detail.incidents.length })}</h3>
        {detail.incidents.length === 0 ? <p className="mt-2 text-sm">{t('evidence.noIncidents')}</p> : (
          <ul className="mt-2 divide-y divide-black/10 text-sm dark:divide-white/10">
            {detail.incidents.map(incident => (
              <li key={incident.id} className="py-2">
                <strong>{incident.type} · {incident.severity}</strong> · {incident.status}
                <span className="ml-2 text-text-secondary-light">{dateTime(incident.occurredAt, detail.ianaTimeZone, locale)}</span>
                <p>{incident.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function HistoricalSubmissions({ operationId, currentSubmissionId, timeZone }) {
  const { t, locale, statusLabel } = useReviewText();
  const [history, setHistory] = useState({ status: 'loading', data: null, error: null });
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState({ status: 'idle', data: null, error: null });
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setHistory({ status: 'loading', data: null, error: null });
    loadOccReviewSubmissionHistory(operationId, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setHistory({ status: 'success', data, error: null });
      })
      .catch(error => {
        if (!controller.signal.aborted && !isAbortError(error)) setHistory({ status: 'error', data: null, error });
      });
    return () => abortForEffectCleanup(controller);
  }, [operationId, retryVersion]);

  useEffect(() => {
    if (!selectedId) {
      setSelected({ status: 'idle', data: null, error: null });
      return undefined;
    }
    const controller = new AbortController();
    setSelected({ status: 'loading', data: null, error: null });
    loadOccReviewSubmissionDetail(operationId, selectedId, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setSelected({ status: 'success', data, error: null });
      })
      .catch(error => {
        if (!controller.signal.aborted && !isAbortError(error)) setSelected({ status: 'error', data: null, error });
      });
    return () => abortForEffectCleanup(controller);
  }, [operationId, selectedId]);

  return <section aria-label={t('history.title')} className="space-y-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
    <h3 className="font-semibold">{t('history.title')}</h3>
    {history.status === 'loading' && <p role="status" className="text-sm">{t('history.loading')}</p>}
    {history.status === 'error' && <Notice title={t('history.error')} onRetry={() => setRetryVersion(value => value + 1)}>{history.error?.message}</Notice>}
    {history.status === 'success' && <>
      {history.data.hasMore && <p role="status" className="text-sm">{t('history.hasMore')}</p>}
      <div className="flex flex-wrap gap-2">{history.data.submissions.map(item =>
        <button key={item.submissionId} type="button" disabled={item.submissionId === currentSubmissionId}
          onClick={() => setSelectedId(item.submissionId === selectedId ? null : item.submissionId)}
          aria-pressed={selectedId === item.submissionId}
          className="min-h-11 rounded-lg border border-accent-600/40 px-3 py-2 text-sm disabled:cursor-default disabled:opacity-60">
          {t('history.revision', { number: item.revisionNumber, status: statusLabel(item.status) })}
          {item.submissionId === currentSubmissionId ? t('history.current') : ''}
        </button>)}</div>
    </>}
    {selected.status === 'loading' && <p role="status">{t('history.loadingSelected')}</p>}
    {selected.status === 'error' && <Notice title={t('history.selectedError')}>{selected.error?.message}</Notice>}
    {selected.status === 'success' && <div className="space-y-3 rounded-xl bg-accent-600/5 p-4">
      <p className="font-semibold">{t('history.revisionAt', { number: selected.data.revisionNumber, date: dateTime(selected.data.submittedAt, timeZone, locale) })}</p>
      {selected.data.decision && <p className="text-sm">{t('history.decision', { outcome: statusLabel(selected.data.decision.outcome) })}{selected.data.decision.reason ? ` — ${selected.data.decision.reason}` : ''}</p>}
      <ReviewEvidence detail={selected.data} />
    </div>}
  </section>;
}

function ReviewStation({ stationId, selectedId, onSelectOperation }) {
  const { t, locale, statusLabel } = useReviewText();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [queue, setQueue] = useState({ status: 'loading', data: null, error: null });
  const [detail, setDetail] = useState({ status: 'idle', data: null, error: null });
  const [decision, setDecision] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const decisionInFlight = useRef(false);
  const decisionAbort = useRef(null);
  const detailRef = useRef(null);

  useEffect(() => () => decisionAbort.current?.abort(), []);

  // En teléfono y tablet el detalle se apila bajo la cola; al seleccionar se
  // lleva a la vista y se respeta la preferencia de movimiento reducido.
  useEffect(() => {
    if (selectedId) detailRef.current?.scrollIntoView?.({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }, [selectedId]);

  useEffect(() => {
    const controller = new AbortController();
    setQueue({ status: 'loading', data: null, error: null });
    loadOccReviewQueue(stationId, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setQueue({ status: 'success', data, error: null });
      })
      .catch(error => {
        if (!controller.signal.aborted && !isAbortError(error)) setQueue({ status: 'error', data: null, error });
      });
    return () => abortForEffectCleanup(controller);
  }, [stationId, refreshVersion]);

  useEffect(() => {
    if (!selectedId) {
      setDetail({ status: 'idle', data: null, error: null });
      return undefined;
    }
    const controller = new AbortController();
    setDetail({ status: 'loading', data: null, error: null });
    setDecision(null);
    setReason('');
    loadOccReviewDetail(selectedId, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setDetail({ status: 'success', data, error: null });
      })
      .catch(error => {
        if (!controller.signal.aborted && !isAbortError(error)) setDetail({ status: 'error', data: null, error });
      });
    return () => abortForEffectCleanup(controller);
  }, [selectedId, refreshVersion]);

  async function confirmDecision() {
    const current = detail.data;
    if (decisionInFlight.current || !current || current.stationId !== stationId ||
        current.status !== 'PendingReview' || !decision) return;
    const correction = reason.trim();
    if (decision === 'Returned' && (correction.length < 8 || correction.length > 2000)) return;
    decisionInFlight.current = true;
    setBusy(true);
    setMessage(null);
    const controller = new AbortController();
    decisionAbort.current = controller;
    try {
      await decideOccReview(current.operationId, {
        submissionId: current.submissionId,
        outcome: decision,
        ...(decision === 'Returned' ? { reason: correction } : {}),
      }, current.reviewVersion, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setMessage({ kind: 'success', text: decision === 'Approved'
        ? t('decision.approved') : t('decision.returned') });
      onSelectOperation(null);
    } catch (error) {
      if (controller.signal.aborted) return;
      setMessage({ kind: 'error', text: error.message });
    } finally {
      if (!controller.signal.aborted) {
        setDecision(null);
        setReason('');
        setRefreshVersion(value => value + 1);
        setBusy(false);
      }
      decisionInFlight.current = false;
      decisionAbort.current = null;
    }
  }

  const rows = queue.data?.operations ?? [];
  const pendingCount = rows.filter(row => row.status === 'PendingReview').length;
  const timeZone = queue.data?.ianaTimeZone ?? 'UTC';

  return (
    <div className={selectedId ? layouts.reviewLayout : 'space-y-5'}>
      <section className={layouts.reviewQueue}>
      {message && <div role={message.kind === 'error' ? 'alert' : 'status'} className="rounded-xl border border-accent-600/25 bg-accent-600/10 px-4 py-3 text-sm">{message.text}</div>}
      {queue.status === 'loading' && <div role="status" className="rounded-xl bg-white/80 p-5 dark:bg-surface-dark-card">{t('queue.loading')}</div>}
      {queue.status === 'error' && <Notice title={t('queue.error')} onRetry={() => setRefreshVersion(value => value + 1)}>{queue.error?.message}</Notice>}
      {queue.status === 'success' && <>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-white/80 p-4 dark:bg-surface-dark-card"><p className="text-xs uppercase tracking-wide">{t('queue.pendingVisible')}</p><strong className="text-2xl">{pendingCount}</strong></div>
          <div className="rounded-xl bg-white/80 p-4 dark:bg-surface-dark-card"><p className="text-xs uppercase tracking-wide">{t('queue.visible')}</p><strong className="text-2xl">{rows.length}</strong></div>
          <div className="rounded-xl bg-white/80 p-4 dark:bg-surface-dark-card"><p className="text-xs uppercase tracking-wide">{t('queue.station')}</p><strong className="text-2xl">{queue.data.stationCode}</strong></div>
        </div>
        {queue.data.hasMore && <Notice title={t('queue.hasMore')}>{t('queue.hasMoreHint')}</Notice>}
        {rows.length === 0 ? <Notice title={t('queue.empty')} /> : (
          <ul className={layouts.reviewQueueList}>{rows.map(row => <li key={row.operationId}>
            <article className={layouts.reviewCard} data-selected={selectedId === row.operationId}>
              <div className="flex flex-wrap items-start justify-between gap-2"><h2 id={`review-operation-${row.operationId}`} className="text-base font-semibold">{row.operationCode}</h2><span className={layouts.reviewStatus}>{statusLabel(row.status)}</span></div>
              <p className="mt-1 text-sm">{row.airlineName} · {row.operationDate}</p>
              <dl className="mt-4 grid gap-3 text-sm"><div><dt className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{t('queue.agent')}</dt><dd>{row.agentName}</dd></div><div><dt className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{t('queue.submitted')}</dt><dd>{dateTime(row.submittedAt, timeZone, locale)}</dd></div></dl>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs">{t('queue.counts', { services: row.serviceCount, incidents: row.incidentCount })}</p><button type="button" onClick={() => onSelectOperation(row.operationId)} aria-pressed={selectedId === row.operationId} className="min-h-11 rounded-lg border border-accent-600 px-4 py-2 text-sm font-semibold text-accent-600 hover:bg-accent-600/10">{t('queue.viewDetail')}</button></div>
            </article>
          </li>)}</ul>
        )}
      </>}
      </section>
      {selectedId && <section data-occ-surface data-occ-detail ref={detailRef} aria-label={t('detail.title')} className={`${layouts.reviewDetail} scroll-mt-4 space-y-4`}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{t('detail.title')}</h2><button type="button" onClick={() => onSelectOperation(null)} className="min-h-11 rounded-lg border px-4 py-2">{t('detail.close')}</button></div>
        {detail.status === 'loading' && <p role="status">{t('detail.loading')}</p>}
        {detail.status === 'error' && <Notice title={t('detail.error')} onRetry={() => setRefreshVersion(value => value + 1)}>{detail.error?.message}</Notice>}
        {detail.status === 'success' && detail.data.stationId !== stationId && (
          <Notice title={t('detail.otherStation')}>{t('detail.otherStationHint')}</Notice>
        )}
        {detail.status === 'success' && detail.data.stationId === stationId && <>
          <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4"><p><strong>{detail.data.operationCode}</strong><br />{detail.data.airlineName}</p><p>{t('detail.agent')}<br /><strong>{detail.data.agentName}</strong></p><p>{t('detail.submitted')}<br /><strong>{dateTime(detail.data.submittedAt, detail.data.ianaTimeZone, locale)}</strong></p><p>{t('detail.status')}<br /><strong>{statusLabel(detail.data.status)}</strong></p></div>
          <div className="grid gap-2 text-sm sm:grid-cols-2"><p>{t('detail.plannedStart', { date: dateTime(detail.data.plannedStartAt, detail.data.ianaTimeZone, locale) })}<br />{t('detail.actualStart', { date: dateTime(detail.data.actualStartAt, detail.data.ianaTimeZone, locale) })}</p><p>{t('detail.plannedEnd', { date: dateTime(detail.data.plannedEndAt, detail.data.ianaTimeZone, locale) })}<br />{t('detail.actualEnd', { date: dateTime(detail.data.actualEndAt, detail.data.ianaTimeZone, locale) })}</p></div>
          {detail.data.agentNote && <p className="rounded-xl bg-accent-600/10 p-3 text-sm"><strong>{t('detail.agentNote')}</strong> {detail.data.agentNote}</p>}
          <ReviewEvidence detail={detail.data} />
          <HistoricalSubmissions operationId={detail.data.operationId} currentSubmissionId={detail.data.submissionId} timeZone={detail.data.ianaTimeZone} />
          {detail.data.decision && <p className="rounded-xl bg-accent-600/10 p-3 text-sm">{t('detail.decision')}<strong>{statusLabel(detail.data.decision.outcome)}</strong> · {dateTime(detail.data.decision.decidedAt, detail.data.ianaTimeZone, locale)}{detail.data.decision.reason ? ` — ${detail.data.decision.reason}` : ''}</p>}
          {detail.data.status === 'PendingReview' && <div className="space-y-3 border-t border-black/10 pt-4 dark:border-white/10">
            <p className="text-sm">{t('decision.intro')}</p>
            <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => setDecision('Approved')} className="min-h-11 rounded-lg bg-accent-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{t('decision.approve')}</button><button type="button" disabled={busy} onClick={() => setDecision('Returned')} className="min-h-11 rounded-lg border border-status-warning px-4 py-2 font-semibold disabled:opacity-50">{t('decision.return')}</button></div>
            {decision && <div className="space-y-3 rounded-xl border border-status-warning/40 p-4" aria-label={t('decision.confirmLabel')}>
              <p className="font-semibold">{decision === 'Approved' ? t('decision.confirmApprove') : t('decision.confirmReturn')}</p>
              {decision === 'Returned' && <label className="block text-sm">{t('decision.corrections')}<textarea value={reason} onChange={event => setReason(event.target.value)} minLength={8} maxLength={2000} required rows={4} className="mt-1 block w-full rounded-lg border border-black/20 bg-white p-3 text-ink-900" /></label>}
              <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || (decision === 'Returned' && (reason.trim().length < 8 || reason.trim().length > 2000))} onClick={confirmDecision} className="min-h-11 rounded-lg bg-accent-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? t('decision.confirming') : t('decision.confirm')}</button><button type="button" disabled={busy} onClick={() => { setDecision(null); setReason(''); }} className="min-h-11 rounded-lg border px-4 py-2">{t('decision.cancel')}</button></div>
            </div>}
          </div>}
        </>}
      </section>}
    </div>
  );
}

export default function CanonicalReviewRoute() {
  const { t } = useTranslation(reviewMessages);
  const { session } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const stationScopes = useMemo(() => selectOccStationScopes(session?.stationScopes)
    .filter(scope => UUID.test(scope.stationId)), [session?.stationScopes]);
  const [stationId, setStationId] = useState(() => stationScopes[0]?.stationId ?? '');
  const selectedId = searchParams.get('operationId');

  useEffect(() => {
    if (stationScopes.some(scope => scope.stationId === stationId)) return;
    setStationId(stationScopes[0]?.stationId ?? '');
  }, [stationId, stationScopes]);

  function selectOperation(id) {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('operationId', id);
    else next.delete('operationId');
    setSearchParams(next);
  }

  return (
    <section className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-5 text-ink-900 dark:text-text-primary-dark">
      <header data-occ-header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-accent-600">{t('eyebrow')}</p><h1 className="text-2xl font-bold">{t('title')}</h1><p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">{t('subtitle')}</p></div>
        <OccStationBadge />
      </header>
      {stationScopes.length === 0 ? <Notice title={t('noStations')}>{t('noStationsHint')}</Notice> : (
        <ReviewStation key={stationId} stationId={stationId} selectedId={UUID.test(selectedId ?? '') ? selectedId : null} onSelectOperation={selectOperation} />
      )}
    </section>
  );
}
