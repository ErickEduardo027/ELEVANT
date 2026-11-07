import { useEffect, useRef, useState } from 'react';
import { XIcon } from './icons';
import StatusBadge from '../../../components/StatusBadge';
import { getPlanningStatusMeta } from '../planningStatus';
import { isInitialAssignmentCandidate, isTurnaroundChangeCandidate } from '../planningMappers';
import { formatPlanningClock, formatPlanningDate } from '../planningTime';
import OccAssignmentPanel from './OccAssignmentPanel';
import {
  handOverOccOperation, loadOccHandoverOptions, releaseOccOperationAgent,
} from '../../../services/occCoverageService';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import { problemMessage } from '../../../services/problemMessages';
import OccShiftPanel from './OccShiftPanel';
import OccAttendancePanel from './OccAttendancePanel';
import { useTranslation } from '../../../i18n/LanguageScope';
import { AGENT_COMMAND_PROBLEM_MESSAGES, planningMessages } from '../planningMessages';
import { useOptionalDepartmentAccess } from '../../access/DepartmentAccessContext';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function Section({ title, children }) {
  return (
    <section className="space-y-2 border-b border-black/5 pb-4 dark:border-white/5">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary-light dark:text-text-secondary-dark">{title}</h3>
      <div className="text-sm text-ink-900 dark:text-text-primary-dark">{children}</div>
    </section>
  );
}

function EmptyValue({ children }) {
  return <p className="text-text-secondary-light dark:text-text-secondary-dark">{children}</p>;
}

function FlightLegDetail({ kind, leg, timeZone }) {
  const { t, locale } = useTranslation(planningMessages);
  const label = t(`drawer.${kind}`);
  if (!leg) return <EmptyValue>{t(kind === 'arrival' ? 'drawer.noArrival' : 'drawer.noDeparture')}</EmptyValue>;
  return (
    <div className="rounded-lg border border-black/5 p-3 dark:border-white/5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-accent-600">{label}</span>
        <span className="font-mono text-xs font-semibold">{leg.flightNumber}</span>
      </div>
      <p className="mt-1 font-mono text-sm">{leg.origin.iataCode} → {leg.destination.iataCode}</p>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div><dt className="text-text-secondary-light dark:text-text-secondary-dark">{t('drawer.scheduled')}</dt><dd className="font-mono">{formatPlanningClock(leg.scheduledAt, timeZone, locale)}</dd></div>
        <div><dt className="text-text-secondary-light dark:text-text-secondary-dark">{t('drawer.estimated')}</dt><dd className="font-mono">{formatPlanningClock(leg.estimatedAt, timeZone, locale)}</dd></div>
        <div><dt className="text-text-secondary-light dark:text-text-secondary-dark">{t('drawer.actual')}</dt><dd className="font-mono">{formatPlanningClock(leg.actualAt, timeZone, locale)}</dd></div>
      </dl>
    </div>
  );
}

/** The message of a failed command on the operation's agent, by its Problem Details code (3-J, 3-F). */
function agentProblem(error, fallback) {
  return problemMessage(error, AGENT_COMMAND_PROBLEM_MESSAGES, {
    forbidden: 'Su acceso no permite asignar, liberar ni relevar agentes en esta estación.',
    fallback,
  });
}

/**
 * OCC frees the agent of an operation not yet started to hand it to someone else (ADR-0030); with the arrival
 * already recorded the operation takes another agent too (3-C). The release names the assignment on screen and keeps
 * its Idempotency-Key while OCC retries after an uncertain answer (3-J): another agent is never released by mistake,
 * and a conflict reads the board again.
 */
function ReleaseAgent({ flight, onReleased, onStale }) {
  const { t } = useTranslation(planningMessages);
  const [state, setState] = useState({ status: 'idle', error: null });
  const release = useRef(createCommandKeyHolder());
  if (flight.operationStatus !== 'Assigned' || !(flight.assignedAgents ?? []).length || !onReleased) return null;
  const run = async () => {
    if (!window.confirm(t('drawer.releaseConfirm'))) return;
    setState({ status: 'submitting', error: null });
    const expectedAssignmentId = flight.assignedAgents[0].assignmentId ?? null;
    try {
      await release.current.run('release', [flight.turnaroundId, expectedAssignmentId], key =>
        releaseOccOperationAgent(flight.turnaroundId,
          expectedAssignmentId ? { expectedAssignmentId, idempotencyKey: key } : {}));
      setState({ status: 'idle', error: null });
      onReleased();
    } catch (error) {
      setState({ status: 'idle', error });
      // Another agent holds it now or it already started: the board is read again before a new intent.
      if (error?.status === 409) onStale?.();
    }
  };
  return (
    <div className="mt-2 space-y-1">
      <button type="button" onClick={() => void run()} disabled={state.status === 'submitting'}
        className="min-h-11 rounded-lg border border-status-danger/40 px-3 text-xs font-semibold text-status-danger disabled:opacity-50">
        {state.status === 'submitting' ? t('drawer.releasing') : t('drawer.releaseAgent')}</button>
      {state.error && <p role="alert" className="text-xs text-status-danger">
        {agentProblem(state.error, t('drawer.releaseError'))}</p>}
    </div>
  );
}

const LOADING_HANDOVER_OPTIONS = Object.freeze({ status: 'loading', data: null, error: null });

/**
 * «Relevar agente» (3-F): OCC hands an operation the agent already started, or one returned for correction, to another
 * eligible agent of the station with a reason. The operation keeps its status and its evidence (each row keeps its
 * author) and both agents are told. The options are evaluated for what is left of the operation; the command names
 * the assignment on screen and keeps its Idempotency-Key while OCC retries after an uncertain answer. A conflict reads
 * the options and the board again before a new intent.
 */
function HandoverAgent({ flight, onHandedOver, onStale }) {
  const { t, locale } = useTranslation(planningMessages);
  const access = useOptionalDepartmentAccess();
  const visible = (flight.operationStatus === 'InProgress' || flight.operationStatus === 'Returned') &&
    Boolean(onHandedOver) && (access?.can('operations.planning.assign') ?? true);
  // The answer of one read (the flight and the attempt it belongs to); until it arrives the options are loading.
  const [answer, setAnswer] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [agentId, setAgentId] = useState('');
  const [reason, setReason] = useState('');
  const [submit, setSubmit] = useState({ status: 'idle', error: null });
  const handover = useRef(createCommandKeyHolder());
  const request = `${flight.turnaroundId}:${attempt}`;

  useEffect(() => {
    if (!visible) return undefined;
    const controller = new AbortController();
    loadOccHandoverOptions(flight.turnaroundId, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setAnswer({ request, status: 'success', data, error: null }); })
      .catch(error => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setAnswer({ request, status: error?.status === 403 ? 'forbidden' : 'error', data: null, error });
      });
    return () => controller.abort();
  }, [visible, flight.turnaroundId, request]);

  if (!visible) return null;
  const options = answer?.request === request ? answer : LOADING_HANDOVER_OPTIONS;
  const timeZone = flight.station?.ianaTimeZone;
  const reasonLabels = t('assignment.reasons');
  const describe = agent => agent.eligibilityReasons.map(item => reasonLabels[item] ?? t('assignment.unknownReason'))
    .join(', ');
  const data = options.data;
  const eligible = data?.agents.filter(agent => agent.eligible) ?? [];
  const ineligible = data?.agents.filter(agent => !agent.eligible) ?? [];
  const trimmed = reason.trim();
  const canSubmit = Boolean(agentId) && trimmed.length >= 5 && trimmed.length <= 500 && submit.status !== 'submitting';

  const send = async event => {
    event.preventDefault();
    if (!canSubmit || !data) return;
    const command = { agentId, expectedAssignmentId: data.currentAssignmentId, reason: trimmed };
    setSubmit({ status: 'submitting', error: null });
    try {
      const result = await handover.current.run('handover', [flight.turnaroundId, command],
        key => handOverOccOperation(flight.turnaroundId, command, key));
      const name = eligible.find(agent => agent.id === result.agentId)?.displayName ?? '';
      setSubmit({ status: 'idle', error: null });
      setAgentId('');
      setReason('');
      onHandedOver(name);
    } catch (error) {
      setSubmit({ status: 'idle', error });
      // The agent, the operation or the eligibility changed: the options are read again before a new intent.
      if (error?.status === 409) {
        setAgentId('');
        setAttempt(value => value + 1);
        onStale?.();
      }
    }
  };

  const field = 'mt-1 min-h-11 w-full rounded-lg border border-black/15 bg-white px-3 text-sm dark:border-white/15 dark:bg-surface-dark-card';
  return (
    <Section title={t('drawer.handover')}>
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{t('drawer.handoverHint')}</p>
      {options.status === 'loading' && <p role="status" className="mt-2 text-xs">{t('drawer.handoverLoading')}</p>}
      {options.status === 'forbidden' && <p role="alert" className="mt-2 text-xs text-status-danger">
        {t('drawer.handoverForbidden')}</p>}
      {options.status === 'error' && <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-status-danger">{agentProblem(options.error, t('drawer.handoverLoadError'))}</span>
        <button type="button" onClick={() => setAttempt(value => value + 1)}
          className="min-h-11 rounded-lg border border-accent-600/40 px-3 font-semibold text-accent-600">{t('drawer.handoverRetry')}</button>
      </div>}
      {options.status === 'success' && data && <form onSubmit={send} aria-label={t('drawer.handover')} className="mt-2 space-y-2">
        <p className="text-xs">{t('drawer.handoverCurrent', { name: data.currentAgentName })} · {t('drawer.handoverRemaining', {
          from: formatPlanningClock(data.remainingFrom, timeZone, locale),
          until: formatPlanningClock(data.remainingUntil, timeZone, locale) })}</p>
        {eligible.length === 0
          ? <p role="status" className="text-xs font-semibold">{t('drawer.handoverEmpty')}</p>
          : <label className="block text-xs font-medium">{t('drawer.handoverAgent')}
            <select value={agentId} onChange={event => setAgentId(event.target.value)} className={field}>
              <option value="">{t('drawer.handoverSelect')}</option>
              {eligible.map(agent => <option key={agent.id} value={agent.id}>{agent.displayName} · {agent.employeeNumber}</option>)}
            </select>
          </label>}
        {ineligible.length > 0 && <p className="text-[11px] text-text-secondary-light dark:text-text-secondary-dark">
          {t('drawer.handoverIneligible', { list: ineligible.map(agent => `${agent.displayName} (${describe(agent)})`)
            .join('; ') })}</p>}
        {eligible.length > 0 && <>
          <label className="block text-xs font-medium">{t('drawer.handoverReason')}
            <textarea value={reason} maxLength={500} rows={2} onChange={event => setReason(event.target.value)}
              className={`${field} py-2`} />
          </label>
          <p className="text-[11px] text-text-secondary-light dark:text-text-secondary-dark">{t('drawer.handoverReasonHint')}</p>
          {submit.error && <p role="alert" className="text-xs text-status-danger">
            {agentProblem(submit.error, t('drawer.handoverError'))}</p>}
          <button type="submit" disabled={!canSubmit}
            className="min-h-11 rounded-lg bg-accent-600 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {submit.status === 'submitting' ? t('drawer.handoverSubmitting') : t('drawer.handoverSubmit')}</button>
        </>}
      </form>}
    </Section>
  );
}

/**
 * «Editar vuelo», «Cancelar vuelo» and «Marcar desviado» (3-A, 3-N28) while the operation has not started; the dialog
 * reads the flight's current version and the changes the server allows before sending anything.
 */
function FlightChanges({ flight, onChangeFlight }) {
  const { t } = useTranslation(planningMessages);
  const access = useOptionalDepartmentAccess();
  if (!onChangeFlight || !isTurnaroundChangeCandidate(flight) ||
      !(access?.can('operations.planning.update') ?? true)) return null;
  const button = 'min-h-11 rounded-lg border px-3 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-600';
  return (
    <Section title={t('drawer.flightChanges')}>
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{t('drawer.flightChangesHint')}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => onChangeFlight('reschedule')}
          className={`${button} border-accent-600/30 text-accent-600 hover:bg-accent-600/10`}>{t('drawer.editFlight')}</button>
        <button type="button" onClick={() => onChangeFlight('cancel')}
          className={`${button} border-status-danger/40 text-status-danger hover:bg-status-danger/5`}>{t('drawer.cancelFlight')}</button>
        <button type="button" onClick={() => onChangeFlight('divert')}
          className={`${button} border-status-warning/40 text-ink-900 hover:bg-status-warning/10 dark:text-text-primary-dark`}>{t('drawer.divertFlight')}</button>
      </div>
    </Section>
  );
}

function ResourceList({ items, emptyLabel, children }) {
  if (!items?.length) return <EmptyValue>{emptyLabel}</EmptyValue>;
  return <ul className="space-y-2">{items.map(children)}</ul>;
}

export default function PlanningDrawer({
  flight,
  onClose,
  optionsState = { status: 'idle', data: null, etag: null, reason: null, recoverable: false },
  assignmentState = { status: 'idle', data: null, error: null, reason: null, refreshRequired: false },
  onAssign,
  onRetryOptions,
  onShiftProgrammed,
  onAgentReleased,
  onAgentHandedOver,
  onStale,
  onChangeFlight,
}) {
  const { t, language, locale } = useTranslation(planningMessages);
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const returnFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const isSubmittingRef = useRef(false);
  const [selectedAttendanceAssignmentId, setSelectedAttendanceAssignmentId] = useState('');
  const isSubmitting = assignmentState.status === 'submitting';

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

  useEffect(() => {
    if (!flight) return undefined;

    if (document.activeElement instanceof HTMLElement) {
      returnFocusRef.current = document.activeElement;
    }

    const dialog = dialogRef.current;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!isSubmittingRef.current) onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab' || !dialog) return;

      const focusableElements = [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)]
        .filter(element => element.getAttribute('aria-hidden') !== 'true');

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);
      const focusIsOutside = !dialog.contains(document.activeElement);

      if (event.shiftKey && (document.activeElement === firstElement || focusIsOutside)) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && (document.activeElement === lastElement || focusIsOutside)) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      const returnTarget = returnFocusRef.current;
      returnFocusRef.current = null;
      if (returnTarget?.isConnected) returnTarget.focus();
    };
  }, [flight?.id]);

  if (!flight) return null;

  const meta = getPlanningStatusMeta(flight.status, language);
  const timeZone = flight.station?.ianaTimeZone;
  const isInitialAssignmentAvailable = isInitialAssignmentCandidate(flight);
  const attendanceAgents = (flight.assignedAgents ?? []).filter(agent => agent.assignmentId);
  const attendanceAgent = attendanceAgents.find(
    agent => agent.assignmentId === selectedAttendanceAssignmentId
  ) ?? attendanceAgents[0];

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-sm"
        onClick={isSubmitting ? undefined : onClose}
      />
      <aside
        ref={dialogRef}
        data-testid="planning-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="planning-drawer-title"
        aria-describedby="planning-drawer-description"
        tabIndex={-1}
        className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto border-l border-black/5 bg-white/95 p-5 shadow-lg backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p id="planning-drawer-description" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-secondary-light dark:text-text-secondary-dark">{t('drawer.description')}</p>
            <h2 id="planning-drawer-title" className="mt-1 font-mono text-base font-semibold text-ink-900 dark:text-text-primary-dark">{flight.operationCode}</h2>
            <div className="mt-2"><StatusBadge tone={meta.color} label={meta.label} /></div>
          </div>
          <button ref={closeButtonRef} type="button" aria-label={t('drawer.close')} onClick={onClose} disabled={isSubmitting} title={isSubmitting ? t('drawer.waitAssignment') : undefined} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-secondary-light hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-accent-600 disabled:cursor-wait disabled:opacity-40 dark:text-text-secondary-dark dark:hover:bg-white/5">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <Section title={t('drawer.context')}>
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div><dt className="text-text-secondary-light dark:text-text-secondary-dark">{t('drawer.date')}</dt><dd>{formatPlanningDate(flight.operationDate, locale)}</dd></div>
              <div><dt className="text-text-secondary-light dark:text-text-secondary-dark">{t('drawer.station')}</dt><dd>{flight.station ? `${flight.station.code} · ${flight.station.name}` : t('drawer.noStation')}</dd></div>
              <div><dt className="text-text-secondary-light dark:text-text-secondary-dark">{t('drawer.airline')}</dt><dd>{flight.airline ? `${flight.airline.iataCode} · ${flight.airline.name}` : (flight.airlineName ?? t('drawer.noAirline'))}</dd></div>
              <div><dt className="text-text-secondary-light dark:text-text-secondary-dark">{t('drawer.operation')}</dt><dd>{flight.operationStatus ?? t('drawer.noOperation')}</dd></div>
            </dl>
          </Section>

          <Section title={t('drawer.legs')}>
            <div className="space-y-2">
              <FlightLegDetail kind="arrival" leg={flight.arrival} timeZone={timeZone} />
              <FlightLegDetail kind="departure" leg={flight.departure} timeZone={timeZone} />
            </div>
          </Section>

          <Section title={t('drawer.aircraftAndPosition')}>
            <p>{flight.aircraft ? `${flight.aircraft.manufacturer} ${flight.aircraft.model}${flight.aircraft.registration ? ` · ${flight.aircraft.registration}` : ''}` : t('drawer.noAircraft')}</p>
            <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
              {flight.position ? t('drawer.position', { code: flight.position }) : t('drawer.noPosition')} · {flight.terminal ? flight.terminal.name : t('drawer.noTerminal')}
            </p>
          </Section>

          <Section title={t('drawer.agents')}>
            <ResourceList items={flight.assignedAgents ?? []} emptyLabel={t('drawer.noAgents')}>
              {agent => <li key={agent.assignmentId}>{agent.displayName} <span className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">{agent.employeeNumber}{agent.positionCode ? ` · ${agent.positionCode}` : ''}</span>
                {agent.unfitReasons?.length > 0 && <span className="mt-0.5 block text-xs font-semibold text-status-danger">
                  {t('drawer.unfit', { reasons: agent.unfitReasons.map(reason => {
                    const label = t(`drawer.unfitReasons.${reason}`);
                    return label === `drawer.unfitReasons.${reason}` ? t('drawer.unfitReasons.other') : label;
                  }).join(', ') })}</span>}</li>}
            </ResourceList>
            <ReleaseAgent flight={flight} onReleased={onAgentReleased} onStale={onStale} />
          </Section>

          <HandoverAgent key={flight.turnaroundId} flight={flight} onHandedOver={onAgentHandedOver} onStale={onStale} />

          {flight.operation?.id && attendanceAgent && <Section title={t('drawer.attendance')}>
            <label className="block text-xs">{t('drawer.attendanceAgent')}
              <select value={attendanceAgent.assignmentId}
                onChange={event => setSelectedAttendanceAssignmentId(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm focus-visible:ring-2 focus-visible:ring-accent-600 dark:border-slate-700 dark:bg-surface-dark-card">
                {attendanceAgents.map(agent => <option key={agent.assignmentId}
                  value={agent.assignmentId}>{agent.displayName} · {agent.employeeNumber}</option>)}
              </select>
            </label>
            <div className="mt-3">
              <OccAttendancePanel
                key={`${flight.operation.id}|${attendanceAgent.assignmentId}`}
                operationId={flight.operation.id}
                assignmentId={attendanceAgent.assignmentId}
                displayName={attendanceAgent.displayName}
              />
            </div>
          </Section>}

          <Section title={t('drawer.equipment')}>
            <ResourceList items={flight.assignedEquipment ?? []} emptyLabel={t('drawer.noEquipment')}>
              {equipment => <li key={equipment.assignmentId}>{equipment.assetCode} · {equipment.equipmentTypeName} <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">({equipment.status})</span></li>}
            </ResourceList>
          </Section>

          <Section title={t('drawer.services')}>
            <ResourceList items={flight.assignedServices ?? []} emptyLabel={t('drawer.noServices')}>
              {service => <li key={service.id}>{service.code} · {service.name} <span className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">{service.executedQuantity}/{service.contractedQuantity} {service.billingUnit}</span></li>}
            </ResourceList>
          </Section>

          <FlightChanges flight={flight} onChangeFlight={onChangeFlight} />

          <Section title={t('drawer.occAssignment')}>
            <OccShiftPanel flight={flight} optionsState={optionsState}
              onProgrammed={onShiftProgrammed} onStale={onStale} />
            <OccAssignmentPanel
              optionsState={optionsState}
              assignmentState={assignmentState}
              assignable={isInitialAssignmentAvailable}
              onAssign={onAssign}
              onRetryOptions={onRetryOptions}
            />
          </Section>
        </div>
      </aside>
    </>
  );
}
