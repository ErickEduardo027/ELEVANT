import { useEffect, useRef, useState } from 'react';
import { XIcon } from './icons';
import StatusBadge from '../../../components/StatusBadge';
import { getPlanningStatusMeta } from '../planningStatus';
import { isInitialAssignmentCandidate } from '../planningMappers';
import { formatPlanningClock, formatPlanningDate } from '../planningTime';
import OccAssignmentPanel from './OccAssignmentPanel';
import OccShiftPanel from './OccShiftPanel';
import OccAttendancePanel from './OccAttendancePanel';
import { useTranslation } from '../../../i18n/LanguageScope';
import { planningMessages } from '../planningMessages';

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
              {agent => <li key={agent.assignmentId}>{agent.displayName} <span className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">{agent.employeeNumber}{agent.positionCode ? ` · ${agent.positionCode}` : ''}</span></li>}
            </ResourceList>
          </Section>

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

          <Section title={t('drawer.occAssignment')}>
            <OccShiftPanel flight={flight} optionsState={optionsState}
              onProgrammed={onShiftProgrammed} />
            <OccAssignmentPanel
              optionsState={optionsState}
              assignmentState={assignmentState}
              assignable={isInitialAssignmentAvailable}
              onAssign={onAssign}
              onRetryOptions={onRetryOptions}
            />
          </Section>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {['editPlanning', 'workOrder'].map(key => (
            <button key={key} type="button" disabled title={t('drawer.comingSoon')} className="cursor-not-allowed rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-text-secondary-light/50 dark:border-white/10 dark:text-text-secondary-dark/50">{t(`drawer.${key}`)}</button>
          ))}
        </div>
      </aside>
    </>
  );
}
