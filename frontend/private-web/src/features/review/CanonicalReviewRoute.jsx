import { useEffect, useMemo, useRef, useState } from 'react';
import { BREAKPOINTS } from '../../config/breakpoints';
import { useAppSearchParams as useSearchParams } from '../../hooks/useAppSearchParams';
import { useAuth } from '../auth/AuthContext';
import { selectOccStationScopes } from '../admin-occ/useOccStation';
import { useOccReviewChangeVersion } from '../admin-occ/useOccReviewQueue';
import { abortForEffectCleanup, isAbortError } from '../../lib/abort';
import { useTranslation } from '../../i18n/LanguageScope';
import { createCommandKeyHolder } from '../../services/commandKeys';
import {
  decideOccReview, loadOccReviewDetail, loadOccReviewQueue,
  loadOccReviewSubmissionDetail, loadOccReviewSubmissionHistory,
} from '../../services/occReviewService';
import { reviewMessages } from './reviewMessages';
import { reviewStatusTone } from './reviewStatusTone';
import {
  checklistAnswerLabel, checklistStatusLabel, incidentSeverityLabel, incidentStatusLabel, incidentTypeLabel,
  serviceOrderStateLabel, serviceStatusLabel, submissionStatusLabel, unitLabel,
} from '../operations/operationLabels';
import OperationIncidentsPanel from '../incidents/OperationIncidentsPanel';
import OccButton from '../occ-ui/OccButton';
import OccDataTable from '../occ-ui/OccDataTable';
import OccDialog from '../occ-ui/OccDialog';
import OccEmptyState from '../occ-ui/OccEmptyState';
import { OccTextareaField } from '../occ-ui/OccField';
import OccGlyph from '../occ-ui/OccGlyph';
import OccPanel from '../occ-ui/OccPanel';
import OccPlate from '../occ-ui/OccPlate';
import OccSegmented from '../occ-ui/OccSegmented';
import OccStatTile, { OccStatList } from '../occ-ui/OccStatTile';
import OccStatusPill from '../occ-ui/OccStatusPill';
import OccToolbar from '../occ-ui/OccToolbar';
import { formatClock } from '../occ-ui/occTime';
import OperationDocumentsSection from './components/OperationDocumentsSection';
import OperationCloseSection from './components/OperationCloseSection';
import ReopenReviewSection from './components/ReopenReviewSection';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_ROWS = Object.freeze([]);
// From 1280 px the detail is docked at the right of the queue (template C of the design, «Mesa de trabajo»).
const DOCKED = `(min-width: ${BREAKPOINTS.xl}px)`;
const isDocked = () => typeof window !== 'undefined' && window.matchMedia?.(DOCKED)?.matches === true;

// Sections inside the detail: a 1 px joint on the panel slab, no shadow.
const SUBSECTION = 'min-w-0 rounded-md border border-occ-line p-3';
const SUBHEADING = 'text-sm font-semibold text-occ-text';
const TERM = 'text-xs font-medium text-occ-muted';
const NOTE = 'flex items-start gap-1.5 text-sm text-occ-text';

function useReviewText() {
  const { t, language, locale } = useTranslation(reviewMessages);
  const statuses = reviewMessages[language].status;
  // 3-N22: an unknown state is «Otro (código)», never the raw code.
  return { t, locale, language,
    statusLabel: value => (Object.hasOwn(statuses, value ?? '') ? statuses[value] : submissionStatusLabel(value, language)) };
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

// The local calendar day of an instant in the station's zone, as `YYYY-MM-DD` (en-CA writes it that way).
function localDay(value, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone })
      .format(new Date(value));
  } catch {
    return '';
  }
}

/**
 * When a hand-off arrived, in the station's time: «14:32», with its day in front («24/09 00:15») when the agent sent it
 * on another local day than the operation's.
 */
function submittedText(row, timeZone, locale) {
  try {
    const clock = formatClock(row.submittedAt, locale, timeZone);
    if (localDay(row.submittedAt, timeZone) === row.operationDate) return clock;
    const day = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', timeZone }).format(new Date(row.submittedAt));
    return `${day} ${clock}`;
  } catch {
    return dateTime(row.submittedAt, 'UTC', locale);
  }
}

// The queue's read as one of the states of OccRemoteView (useOccResource's names): a 403 is the no-permission state.
function queueViewStatus(queue) {
  if (queue.status === 'success') return 'success';
  if (queue.status !== 'error') return 'loading';
  if (queue.error?.status === 403) return 'forbidden';
  if (queue.error?.status === 401) return 'unauthorized';
  return 'error';
}

function Notice({ title, children, onRetry }) {
  const { t } = useTranslation(reviewMessages);
  return (
    <div role="alert" className="rounded-md border border-occ-line bg-occ-panel-raised p-3 text-sm text-occ-text">
      <p className="font-semibold">{title}</p>
      {children && <p className="mt-1 text-occ-muted">{children}</p>}
      {onRetry && <OccButton size="sm" className="mt-3" onClick={onRetry}>{t('retry')}</OccButton>}
    </div>
  );
}

/** What a command answered: a plain slab for a success, the amber slab with its triangle for a refusal. */
function ReviewMessage({ message }) {
  const refused = message.kind === 'error';
  return (
    <div role={refused ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-md border border-occ-line px-3 py-2 text-sm text-occ-text ${refused ? 'bg-occ-warn-soft' : 'bg-occ-panel-raised'}`}>
      {refused ? <OccGlyph name="attention" className="mt-0.5" /> : null}
      <p className="min-w-0">{message.text}</p>
    </div>
  );
}

function ReviewEvidence({ detail }) {
  const { t, locale, language } = useTranslation(reviewMessages);
  return (
    // Two columns only while the detail has the width of the page (below 1280 px); docked, one.
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-1">
      <section aria-label={t('evidence.services')} className={SUBSECTION}>
        <h3 className={SUBHEADING}>{t('evidence.servicesTitle', { count: detail.services.length })}</h3>
        {detail.services.length === 0 ? <p className="mt-2 text-sm text-occ-muted">{t('evidence.noServices')}</p> : (
          <ul className="mt-2 divide-y divide-occ-line text-sm">
            {detail.services.map(service => (
              <li key={service.id} className="flex justify-between gap-3 py-2">
                <span className="min-w-0">{service.name} <span className="font-mono text-xs text-occ-muted">({service.code})</span></span>
                <span className="text-right">{t('evidence.quantity', { executed: service.executedQuantity, contracted: service.contractedQuantity, unit: unitLabel(service.unit) })}<br />{serviceStatusLabel(service.status, language)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label={t('evidence.checklist')} className={SUBSECTION}>
        <h3 className={SUBHEADING}>{t('evidence.checklistTitle', { status: checklistStatusLabel(detail.checklistStatus, language) })}</h3>
        {detail.checklistAnswers.length === 0 ? <p className="mt-2 text-sm text-occ-muted">{t('evidence.noAnswers')}</p> : (
          <dl className="mt-2 divide-y divide-occ-line text-sm">
            {detail.checklistAnswers.map(answer => (
              <div key={`${answer.section}:${answer.code}`} className="py-2">
                <dt className="font-medium text-occ-text">{answer.section} · {answer.label}</dt>
                <dd className="text-occ-muted">{checklistAnswerLabel(answer.value, language)}{answer.note ? ` — ${answer.note}` : ''}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <section aria-label={t('evidence.incidents')} className={`${SUBSECTION} lg:col-span-2 xl:col-span-1`}>
        <h3 className={SUBHEADING}>{t('evidence.incidentsTitle', { count: detail.incidents.length })}</h3>
        {detail.incidents.length === 0 ? <p className="mt-2 text-sm text-occ-muted">{t('evidence.noIncidents')}</p> : (
          <ul className="mt-2 divide-y divide-occ-line text-sm">
            {detail.incidents.map(incident => (
              <li key={incident.id} className="py-2">
                <strong className="font-semibold">{incidentTypeLabel(incident.type, language)} · {incidentSeverityLabel(incident.severity, language)}</strong> · {incidentStatusLabel(incident.status, language)}
                {incident.delayCode && <OccPlate kind="code" className="ml-2">IATA {incident.delayCode}</OccPlate>}
                <span className="ml-2 font-mono text-xs text-occ-muted">{dateTime(incident.occurredAt, detail.ianaTimeZone, locale)}</span>
                <p className="text-occ-text">{incident.description}</p>
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

  return (
    <OccPanel headingLevel={3} title={t('history.title')}>
      <div className="space-y-3 p-3 text-sm">
        {history.status === 'loading' && <p role="status" className="text-occ-muted">{t('history.loading')}</p>}
        {history.status === 'error' && <Notice title={t('history.error')} onRetry={() => setRetryVersion(value => value + 1)}>{history.error?.message}</Notice>}
        {history.status === 'success' && <>
          {history.data.hasMore && <p role="status" className="text-occ-muted">{t('history.hasMore')}</p>}
          <div className="flex flex-wrap gap-2">{history.data.submissions.map(item =>
            <OccButton key={item.submissionId} size="sm" disabled={item.submissionId === currentSubmissionId}
              onClick={() => setSelectedId(item.submissionId === selectedId ? null : item.submissionId)}
              aria-pressed={selectedId === item.submissionId}
              className="aria-pressed:border-occ-accent aria-pressed:bg-occ-accent-soft aria-pressed:text-occ-accent">
              {t('history.revision', { number: item.revisionNumber, status: statusLabel(item.status) })}
              {item.submissionId === currentSubmissionId ? t('history.current') : ''}
            </OccButton>)}</div>
        </>}
        {selected.status === 'loading' && <p role="status" className="text-occ-muted">{t('history.loadingSelected')}</p>}
        {selected.status === 'error' && <Notice title={t('history.selectedError')}>{selected.error?.message}</Notice>}
        {selected.status === 'success' && <div className="space-y-3 rounded-md bg-occ-panel-raised p-3">
          <p className="font-semibold">{t('history.revisionAt', { number: selected.data.revisionNumber, date: dateTime(selected.data.submittedAt, timeZone, locale) })}</p>
          {selected.data.decision && <p>{t('history.decision', { outcome: statusLabel(selected.data.decision.outcome) })}{selected.data.decision.reason ? ` — ${selected.data.decision.reason}` : ''}</p>}
          <ReviewEvidence detail={selected.data} />
        </div>}
      </div>
    </OccPanel>
  );
}

/**
 * 3-N02: the Service Order OCC may approve, signed or corrected after the signature; a server before phase 3, block D
 * sends no state, and its decision stays the server's.
 */
const isApprovableOrder = state => !state || state === 'Signed' || state === 'Corrected';

/**
 * The review of one station, template C of the design («Mesa de trabajo»): the toolbar with the queue's filters, the
 * figures, the queue at the left and the detail of the chosen hand-off at the right. From 1280 px the page takes the
 * height of the screen and the queue and the detail scroll on their own, so the detail stays docked beside the queue;
 * below that width they stack and choosing a hand-off scrolls its detail into view. The detail ends with the decision
 * bar fixed at its bottom; the decision is confirmed in a dialog drawn inside the detail.
 */
function ReviewStation({ stationId, stationCode, selectedId, onSelectOperation }) {
  const { t, locale, language, statusLabel } = useReviewText();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [queue, setQueue] = useState({ status: 'loading', data: null, error: null });
  const [detail, setDetail] = useState({ status: 'idle', data: null, error: null });
  const [decision, setDecision] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [filter, setFilter] = useState('all');
  const decisionInFlight = useRef(false);
  const decisionAbort = useRef(null);
  // 3-H: the decision's Idempotency-Key, kept while OCC retries the same intent after an answer that never arrived.
  const decisionKeys = useRef(createCommandKeyHolder());
  const detailRef = useRef(null);
  const reasonRef = useRef(null);
  const liveVersion = useOccReviewChangeVersion();
  const shownVersion = useRef(null);
  const preparedDecision = useRef(null);

  useEffect(() => () => decisionAbort.current?.abort(), []);
  useEffect(() => { shownVersion.current = detail.status === 'success' ? detail.data.reviewVersion : null; }, [detail]);
  useEffect(() => { preparedDecision.current = decision; }, [decision]);

  // 3-N23: an `occ_review` announcement re-reads the queue and the open detail without showing «cargando»: the table
  // keeps its rows until the new answer arrives. A decision prepared on a hand-off that changed is discarded, so OCC
  // reviews the new version before confirming; one prepared on the same version keeps what OCC typed.
  useEffect(() => {
    if (liveVersion === 0 || decisionInFlight.current) return undefined;
    const controller = new AbortController();
    loadOccReviewQueue(stationId, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setQueue({ status: 'success', data, error: null }); })
      .catch(() => {});
    if (selectedId) {
      loadOccReviewDetail(selectedId, { signal: controller.signal })
        .then(data => {
          if (controller.signal.aborted) return;
          if (preparedDecision.current && shownVersion.current !== null && shownVersion.current !== data.reviewVersion) {
            setDecision(null);
            setReason('');
            setMessage({ kind: 'error', text: t('detail.changedLive') });
          }
          setDetail({ status: 'success', data, error: null });
        })
        .catch(() => {});
    }
    return () => abortForEffectCleanup(controller);
  // A live re-read follows the announcements only; the scope and the selection have their own reads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveVersion]);

  // Below 1280 px the detail sits under the queue: choosing a hand-off brings it into view, so it is not left off the
  // screen of a phone or a tablet. Docked at the right it is already in view; it starts again from its top.
  useEffect(() => {
    if (!selectedId) return;
    if (isDocked()) {
      if (detailRef.current) detailRef.current.scrollTop = 0;
      return;
    }
    detailRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
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
    if (decision === 'Approved' && !isApprovableOrder(current.serviceOrderState)) return;
    if (decision === 'Returned' && current.reopening) return;
    const correction = reason.trim();
    if (decision === 'Returned' && (correction.length < 8 || correction.length > 2000)) return;
    decisionInFlight.current = true;
    setBusy(true);
    setMessage(null);
    const controller = new AbortController();
    decisionAbort.current = controller;
    const command = {
      submissionId: current.submissionId,
      outcome: decision,
      ...(decision === 'Returned' ? { reason: correction } : {}),
    };
    try {
      await decisionKeys.current.run('decide',
        { operationId: current.operationId, ...command, version: current.reviewVersion },
        key => decideOccReview(current.operationId, command, current.reviewVersion,
          { signal: controller.signal, idempotencyKey: key }));
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

  function closeDecision() {
    setDecision(null);
    setReason('');
  }

  const rows = queue.data?.operations ?? NO_ROWS;
  const pendingCount = rows.filter(row => row.status === 'PendingReview').length;
  const visibleRows = filter === 'pending' ? rows.filter(row => row.status === 'PendingReview') : rows;
  const counted = queue.status === 'success';
  const timeZone = queue.data?.ianaTimeZone ?? 'UTC';
  const current = detail.status === 'success' ? detail.data : null;
  const sameStation = current !== null && current.stationId === stationId;
  const deciding = sameStation && current.status === 'PendingReview';
  const approvable = current !== null && isApprovableOrder(current.serviceOrderState);
  const correction = reason.trim();
  const validCorrection = correction.length >= 8 && correction.length <= 2000;

  const columns = [
    {
      key: 'operation', header: t('queue.operation'),
      render: row => (
        <span className="flex min-w-0 flex-col items-start gap-1">
          <OccPlate kind="code">{row.operationCode}</OccPlate>
          <span className="flex flex-wrap gap-x-2 text-xs text-occ-muted">
            <span>{row.airlineName}</span>
            <span className="font-mono">{row.operationDate}</span>
          </span>
        </span>
      ),
    },
    { key: 'agent', header: t('queue.agent'), render: row => row.agentName },
    {
      key: 'submitted', header: t('queue.submitted'), mono: true,
      render: row => <span className="whitespace-nowrap">{submittedText(row, timeZone, locale)}</span>,
    },
    {
      key: 'status', header: t('queue.status'),
      render: row => (
        <span className="flex flex-col items-start gap-0.5">
          <OccStatusPill size="sm" tone={reviewStatusTone(row.status)} label={statusLabel(row.status)} />
          <span className="text-xs text-occ-muted">{t('queue.counts', { services: row.serviceCount, incidents: row.incidentCount })}</span>
        </span>
      ),
    },
    {
      // «Ver detalle» is the first button of its row: the cycle E2E and the guide open a hand-off with it.
      key: 'review', header: t('queue.review'),
      render: row => <OccButton size="sm" onClick={() => onSelectOperation(row.operationId)}>{t('queue.viewDetail')}</OccButton>,
    },
  ];

  const queueLabels = {
    loading: t('queue.loading'), error: t('queue.error'), retry: t('retry'),
    empty: rows.length === 0 ? t('queue.empty') : t('queue.filters.empty'),
  };
  const moreNote = queue.data?.hasMore ? (
    <p role="note" className="flex items-start gap-1.5 text-xs text-occ-muted">
      <OccGlyph name="notice" />
      <span className="min-w-0">{t('queue.hasMore')} {t('queue.hasMoreHint')}</span>
    </p>
  ) : null;

  return (
    <>
      <OccToolbar title={t('title')}>
        <OccSegmented label={t('queue.filters.label')} value={filter} onChange={setFilter} options={[
          { id: 'all', label: t('queue.filters.all'), count: counted ? rows.length : undefined },
          { id: 'pending', label: t('queue.filters.pending'), count: counted ? pendingCount : undefined },
        ]} />
      </OccToolbar>
      {message && <ReviewMessage message={message} />}
      {(queue.status === 'loading' || counted) && (
        <OccStatList className="flex flex-wrap gap-x-10 gap-y-2 rounded-md border border-occ-line bg-occ-panel px-3 py-2">
          <OccStatTile label={t('queue.pendingVisible')} value={counted ? pendingCount : undefined} loading={!counted} />
          <OccStatTile label={t('queue.visible')} value={counted ? rows.length : undefined} loading={!counted} />
          <OccStatTile label={t('queue.station')}
            value={<span className="font-mono">{queue.data?.stationCode ?? stationCode}</span>} />
        </OccStatList>
      )}
      <div data-review-layout=""
        className="grid min-w-0 items-start gap-3 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_minmax(28rem,42%)] xl:grid-rows-[minmax(0,1fr)]">
        <OccPanel title={t('queue.title')} className="xl:max-h-full" bodyClassName="xl:overflow-y-auto xl:overscroll-contain">
          {/* Docked, the panel's body scrolls the rows, so the header of the table sticks to its top. */}
          <OccDataTable caption={t('queue.title')} columns={columns} rows={visibleRows}
            getRowId={row => row.operationId} selectedId={selectedId} onSelectRow={id => onSelectOperation(id)}
            status={queueViewStatus(queue)} onRetry={() => setRefreshVersion(value => value + 1)} labels={queueLabels}
            footer={moreNote} scrollClassName="xl:overflow-visible" />
        </OccPanel>
        {selectedId ? (
          <section ref={detailRef} aria-label={t('detail.title')} data-review-detail=""
            className="flex min-w-0 scroll-mt-4 flex-col rounded-md border border-occ-line bg-occ-panel text-occ-text xl:max-h-full xl:overflow-y-auto xl:overscroll-contain">
            <header className="sticky top-0 z-[1] flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-occ-line bg-occ-panel px-3 py-2">
              <h2 className="text-sm font-semibold text-occ-text">{t('detail.title')}</h2>
              <OccButton size="sm" onClick={() => onSelectOperation(null)}>{t('detail.close')}</OccButton>
            </header>
            <div className="flex-1 space-y-3 p-3">
              {detail.status === 'loading' && <p role="status" className="text-sm text-occ-muted">{t('detail.loading')}</p>}
              {/* 3-G: an operation still on the ramp has no hand-off yet (404); OCC manages its incidents meanwhile. */}
              {detail.status === 'error' && detail.error?.status === 404 && <>
                <Notice title={t('detail.noSubmission')} onRetry={() => setRefreshVersion(value => value + 1)}>{t('detail.noSubmissionHint')}</Notice>
                <OperationIncidentsPanel operationId={selectedId} refreshToken={liveVersion} />
              </>}
              {detail.status === 'error' && detail.error?.status !== 404 && <Notice title={t('detail.error')} onRetry={() => setRefreshVersion(value => value + 1)}>{detail.error?.message}</Notice>}
              {current && !sameStation && (
                <Notice title={t('detail.otherStation')}>{t('detail.otherStationHint')}</Notice>
              )}
              {sameStation && <>
                <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className={TERM}>{t('queue.operation')}</dt>
                    <dd className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <OccPlate kind="code">{current.operationCode}</OccPlate>
                      <span>{current.airlineName}</span>
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className={TERM}>{t('detail.status')}</dt>
                    <dd className="mt-1">
                      <OccStatusPill tone={reviewStatusTone(current.status, { reopened: Boolean(current.reopening) })}
                        label={statusLabel(current.status)} />
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className={TERM}>{t('detail.agent')}</dt>
                    <dd className="mt-1 font-semibold">{current.agentName}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className={TERM}>{t('detail.submitted')}</dt>
                    <dd className="mt-1 font-semibold">{dateTime(current.submittedAt, current.ianaTimeZone, locale)}</dd>
                  </div>
                </dl>
                <div className="grid gap-x-4 gap-y-1 text-sm text-occ-muted sm:grid-cols-2 xl:grid-cols-1 3xl:grid-cols-2">
                  <p>{t('detail.plannedStart', { date: dateTime(current.plannedStartAt, current.ianaTimeZone, locale) })}<br />{t('detail.actualStart', { date: dateTime(current.actualStartAt, current.ianaTimeZone, locale) })}</p>
                  <p>{t('detail.plannedEnd', { date: dateTime(current.plannedEndAt, current.ianaTimeZone, locale) })}<br />{t('detail.actualEnd', { date: dateTime(current.actualEndAt, current.ianaTimeZone, locale) })}</p>
                </div>
                {current.serviceOrderState && <p className="text-sm">{t('detail.serviceOrder')}: <strong className="font-semibold">{serviceOrderStateLabel(current.serviceOrderState, language)}</strong></p>}
                {current.reopening && <div role="note" className="flex items-start gap-2 rounded-md border border-occ-line bg-occ-warn-soft p-3 text-sm text-occ-text">
                  <OccGlyph name="attention" className="mt-0.5" />
                  <div className="min-w-0">
                    <p className="font-semibold">{t('detail.reopened', { reason: current.reopening.reason })}</p>
                    <p className="text-xs">{t('detail.reopenedBy', { by: current.reopening.reopenedBy, number: current.reopening.fromRevisionNumber,
                      date: dateTime(current.reopening.reopenedAt, current.ianaTimeZone, locale) })}</p>
                  </div>
                </div>}
                {current.agentNote && <p className="rounded-md bg-occ-panel-raised p-3 text-sm"><strong className="font-semibold">{t('detail.agentNote')}</strong> {current.agentNote}</p>}
                <ReviewEvidence detail={current} />
                <OperationIncidentsPanel operationId={current.operationId} refreshToken={liveVersion} />
                {current.close && <OperationCloseSection detail={current} disabled={busy}
                  onChanged={(text, kind = 'success') => { setMessage({ kind, text }); setRefreshVersion(value => value + 1); }} />}
                <OperationDocumentsSection key={current.operationId} operationId={current.operationId}
                  timeZone={current.ianaTimeZone} />
                <HistoricalSubmissions operationId={current.operationId} currentSubmissionId={current.submissionId} timeZone={current.ianaTimeZone} />
                {current.decision && <p className="rounded-md bg-occ-panel-raised p-3 text-sm">{t('detail.decision')}<strong className="font-semibold">{statusLabel(current.decision.outcome)}</strong> · {dateTime(current.decision.decidedAt, current.ianaTimeZone, locale)}{current.decision.reason ? ` — ${current.decision.reason}` : ''}</p>}
                <ReopenReviewSection key={current.submissionId} detail={current} disabled={busy}
                  onReopened={text => { setMessage({ kind: 'success', text }); setRefreshVersion(value => value + 1); }}
                  onRefused={text => { setMessage({ kind: 'error', text }); setRefreshVersion(value => value + 1); }} />
              </>}
            </div>
            {deciding && <div data-review-decision="" className="sticky bottom-0 z-[1] space-y-2 border-t border-occ-line bg-occ-panel px-3 py-3">
              <p className="text-xs text-occ-muted">{t('decision.intro')}</p>
              {/* 3-N02: OCC approves only the Service Order the airline and AVIAM signed, or its recorded correction. */}
              {!approvable && <p role="note" className={NOTE}><OccGlyph name="attention" className="mt-0.5" /><span className="min-w-0">{current.serviceOrderState === 'Stale' ? t('decision.stale') : t('decision.unsigned')}</span></p>}
              {/* 3-H: a reopened revision has nobody on the ramp to correct it: OCC corrects it here and approves it. */}
              {current.reopening && <p role="note" className={NOTE}><OccGlyph name="attention" className="mt-0.5" /><span className="min-w-0">{t('decision.reopenedNoReturn')}</span></p>}
              <div className="flex flex-wrap gap-2">
                <OccButton variant="primary" disabled={busy || !approvable} onClick={() => setDecision('Approved')}>{t('decision.approve')}</OccButton>
                {!current.reopening && <OccButton disabled={busy} onClick={() => setDecision('Returned')}>{t('decision.return')}</OccButton>}
              </div>
            </div>}
            <OccDialog open={deciding && decision !== null} onClose={closeDecision} title={t('decision.confirmLabel')}
              busy={busy} initialFocusRef={decision === 'Returned' ? reasonRef : undefined}
              footer={(
                <>
                  <OccButton variant="primary" busy={busy} busyLabel={t('decision.confirming')}
                    disabled={decision === 'Returned' && !validCorrection} onClick={() => void confirmDecision()}>
                    {t('decision.confirm')}
                  </OccButton>
                  <OccButton data-occ-dialog-cancel="" disabled={busy} onClick={closeDecision}>{t('decision.cancel')}</OccButton>
                </>
              )}>
              <p>{decision === 'Approved' ? t('decision.confirmApprove') : t('decision.confirmReturn')}</p>
              {decision === 'Returned' && (
                <OccTextareaField ref={reasonRef} className="mt-3" label={t('decision.corrections')} value={reason}
                  onChange={event => setReason(event.target.value)} minLength={8} maxLength={2000} required rows={4} />
              )}
            </OccDialog>
          </section>
        ) : visibleRows.length > 0 && (
          // Docked, the empty right-hand side says what to do; it is not the detail's region.
          <div data-review-placeholder="" className="hidden rounded-md border border-occ-line bg-occ-panel p-3 xl:block">
            <OccEmptyState title={t('detail.placeholder')} />
          </div>
        )}
      </div>
    </>
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
  const stationCode = stationScopes.find(scope => scope.stationId === stationId)?.stationCode ?? '';

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

  // The station is in the status bar of the OCC frame: the page has no badge of its own, nor a line above or under its
  // title (design E.1).
  return (
    <section className="flex min-w-0 flex-col gap-3 text-occ-text xl:h-full xl:min-h-0">
      {stationScopes.length === 0 ? <>
        <OccToolbar title={t('title')} />
        <Notice title={t('noStations')}>{t('noStationsHint')}</Notice>
      </> : (
        <ReviewStation key={stationId} stationId={stationId} stationCode={stationCode}
          selectedId={UUID.test(selectedId ?? '') ? selectedId : null} onSelectOperation={selectOperation} />
      )}
    </section>
  );
}
