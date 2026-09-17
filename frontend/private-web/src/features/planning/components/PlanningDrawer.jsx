import { useEffect, useRef } from 'react';
import { XIcon } from './icons';
import StatusBadge from '../../../components/StatusBadge';
import { getPlanningStatusMeta } from '../planningStatus';
import { isInitialAssignmentCandidate } from '../planningMappers';
import { formatPlanningClock, formatPlanningDate } from '../planningTime';
import OccAssignmentPanel from './OccAssignmentPanel';

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

function FlightLegDetail({ label, leg, timeZone }) {
  if (!leg) return <EmptyValue>Sin tramo de {label.toLowerCase()} registrado.</EmptyValue>;
  return (
    <div className="rounded-lg border border-black/5 p-3 dark:border-white/5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-accent-600">{label}</span>
        <span className="font-mono text-xs font-semibold">{leg.flightNumber}</span>
      </div>
      <p className="mt-1 font-mono text-sm">{leg.origin.iataCode} → {leg.destination.iataCode}</p>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div><dt className="text-text-secondary-light dark:text-text-secondary-dark">Programado</dt><dd className="font-mono">{formatPlanningClock(leg.scheduledAt, timeZone)}</dd></div>
        <div><dt className="text-text-secondary-light dark:text-text-secondary-dark">Estimado</dt><dd className="font-mono">{formatPlanningClock(leg.estimatedAt, timeZone)}</dd></div>
        <div><dt className="text-text-secondary-light dark:text-text-secondary-dark">Real</dt><dd className="font-mono">{formatPlanningClock(leg.actualAt, timeZone)}</dd></div>
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
}) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const returnFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const isSubmittingRef = useRef(false);
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

  const meta = getPlanningStatusMeta(flight.status);
  const timeZone = flight.station?.ianaTimeZone;
  const isInitialAssignmentAvailable = isInitialAssignmentCandidate(flight);

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
            <p id="planning-drawer-description" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-secondary-light dark:text-text-secondary-dark">Escala operativa · asignación controlada</p>
            <h2 id="planning-drawer-title" className="mt-1 font-mono text-base font-semibold text-ink-900 dark:text-text-primary-dark">{flight.operationCode}</h2>
            <div className="mt-2"><StatusBadge tone={meta.color} label={meta.label} /></div>
          </div>
          <button ref={closeButtonRef} type="button" aria-label="Cerrar panel" onClick={onClose} disabled={isSubmitting} title={isSubmitting ? 'Espere a que termine la asignación' : undefined} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-secondary-light hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-accent-600 disabled:cursor-wait disabled:opacity-40 dark:text-text-secondary-dark dark:hover:bg-white/5">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <Section title="Contexto">
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div><dt className="text-text-secondary-light dark:text-text-secondary-dark">Fecha</dt><dd>{formatPlanningDate(flight.operationDate)}</dd></div>
              <div><dt className="text-text-secondary-light dark:text-text-secondary-dark">Estación</dt><dd>{flight.station ? `${flight.station.code} · ${flight.station.name}` : 'Sin estación'}</dd></div>
              <div><dt className="text-text-secondary-light dark:text-text-secondary-dark">Aerolínea</dt><dd>{flight.airline ? `${flight.airline.iataCode} · ${flight.airline.name}` : (flight.airlineName ?? 'Sin aerolínea')}</dd></div>
              <div><dt className="text-text-secondary-light dark:text-text-secondary-dark">Operación</dt><dd>{flight.operationStatus ?? 'Sin operación creada'}</dd></div>
            </dl>
          </Section>

          <Section title="Tramos de vuelo">
            <div className="space-y-2">
              <FlightLegDetail label="Llegada" leg={flight.arrival} timeZone={timeZone} />
              <FlightLegDetail label="Salida" leg={flight.departure} timeZone={timeZone} />
            </div>
          </Section>

          <Section title="Aeronave y posición">
            <p>{flight.aircraft ? `${flight.aircraft.manufacturer} ${flight.aircraft.model}${flight.aircraft.registration ? ` · ${flight.aircraft.registration}` : ''}` : 'Sin aeronave registrada'}</p>
            <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
              {flight.position ? `Posición ${flight.position}` : 'Sin posición asignada'} · {flight.terminal ? flight.terminal.name : 'Sin terminal'}
            </p>
          </Section>

          <Section title="Agentes asignados">
            <ResourceList items={flight.assignedAgents ?? []} emptyLabel="Sin agentes asignados.">
              {agent => <li key={agent.assignmentId}>{agent.displayName} <span className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">{agent.employeeNumber}{agent.positionCode ? ` · ${agent.positionCode}` : ''}</span></li>}
            </ResourceList>
          </Section>

          <Section title="Equipos asignados">
            <ResourceList items={flight.assignedEquipment ?? []} emptyLabel="Sin equipos asignados.">
              {equipment => <li key={equipment.assignmentId}>{equipment.assetCode} · {equipment.equipmentTypeName} <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">({equipment.status})</span></li>}
            </ResourceList>
          </Section>

          <Section title="Servicios planificados">
            <ResourceList items={flight.assignedServices ?? []} emptyLabel="Sin servicios planificados.">
              {service => <li key={service.id}>{service.code} · {service.name} <span className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">{service.executedQuantity}/{service.contractedQuantity} {service.billingUnit}</span></li>}
            </ResourceList>
          </Section>

          <Section title="Asignación OCC">
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
          {['Editar planificación', 'Crear Work Order'].map(label => (
            <button key={label} type="button" disabled title="Próximamente" className="cursor-not-allowed rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-text-secondary-light/50 dark:border-white/10 dark:text-text-secondary-dark/50">{label}</button>
          ))}
        </div>
      </aside>
    </>
  );
}
