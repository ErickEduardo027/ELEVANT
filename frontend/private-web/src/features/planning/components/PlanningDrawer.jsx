import { useEffect, useRef } from 'react';
import { XIcon } from './icons';
import StatusBadge from '../../../components/StatusBadge';
import { getPlanningStatusMeta } from '../planningStatus';
import { formatPlanningClock, formatPlanningDate } from '../planningTime';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const ELIGIBILITY_REASON_LABELS = {
  agent_inactive: 'Agente inactivo',
  mobile_account_unavailable: 'Sin cuenta móvil disponible',
  station_scope_missing: 'Sin alcance para esta estación',
  terminal_scope_missing: 'Sin alcance para esta terminal',
  qualification_not_current: 'Habilitación no vigente',
  airport_id_not_current: 'Identificación aeroportuaria no vigente',
  ramp_driver_license_not_current: 'Licencia de rampa no vigente',
  shift_not_compatible: 'Turno no compatible',
};

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

function OptionsPanel({ state, onRetry }) {
  if (state.status === 'idle' || state.status === 'loading') {
    return <p role="status" className="animate-pulse text-text-secondary-light dark:text-text-secondary-dark">Consultando contrato y elegibilidad…</p>;
  }

  if (state.status === 'unauthorized') {
    return <p role="alert" className="text-status-danger">La sesión expiró. Será redirigido al acceso.</p>;
  }

  if (state.status === 'forbidden') {
    return <p role="alert" className="text-status-danger">Su cuenta no tiene permiso para consultar las opciones de esta escala.</p>;
  }

  if (state.status === 'error') {
    return (
      <div role="alert" className="space-y-2 rounded-lg border border-status-warning/30 bg-status-warning/10 p-3">
        <p className="text-xs font-semibold text-status-warning">
          {state.reason === 'contract-ambiguity'
            ? 'Hay más de un contrato aplicable. Revise la configuración contractual antes de asignar servicios.'
            : 'No fue posible consultar las opciones de esta escala.'}
        </p>
        {state.recoverable && (
          <button type="button" onClick={onRetry} className="text-xs font-semibold text-accent-600 hover:underline">Reintentar</button>
        )}
      </div>
    );
  }

  const { contract, services, agents } = state.data;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark">Contrato aplicable</p>
        {contract ? (
          <p className="mt-1">{contract.code} · versión {contract.version} · {contract.currencyCode}</p>
        ) : <EmptyValue>Sin contrato aplicable para esta escala.</EmptyValue>}
      </div>
      <div>
        <p className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark">Servicios contratados</p>
        <ResourceList items={services} emptyLabel="Sin servicios contratados disponibles.">
          {service => (
            <li key={service.id} className="flex items-start justify-between gap-3 rounded-lg bg-black/[0.025] px-3 py-2 dark:bg-white/[0.035]">
              <span><strong>{service.code}</strong> · {service.name}</span>
              <span className="whitespace-nowrap font-mono text-xs">{service.minimumQuantity} {service.billingUnit}</span>
            </li>
          )}
        </ResourceList>
      </div>
      <div>
        <p className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark">Elegibilidad de agentes</p>
        <ResourceList items={agents} emptyLabel="Sin agentes candidatos para este contexto.">
          {agent => (
            <li key={agent.id} className="rounded-lg bg-black/[0.025] px-3 py-2 dark:bg-white/[0.035]">
              <div className="flex items-center justify-between gap-3">
                <span>{agent.displayName} <span className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">{agent.employeeNumber}</span></span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${agent.eligible ? 'bg-status-success/10 text-status-success' : 'bg-status-warning/10 text-status-warning'}`}>
                  {agent.eligible ? 'Elegible' : 'No elegible'}
                </span>
              </div>
              {!agent.eligible && agent.eligibilityReasons.length > 0 && (
                <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                  {agent.eligibilityReasons.map(reason => ELIGIBILITY_REASON_LABELS[reason] ?? reason).join(' · ')}
                </p>
              )}
            </li>
          )}
        </ResourceList>
      </div>
    </div>
  );
}

export default function PlanningDrawer({
  flight,
  onClose,
  optionsState = { status: 'idle', data: null, reason: null, recoverable: false },
  onRetryOptions,
}) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const returnFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

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
        onCloseRef.current();
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

  return (
    <>
      <div aria-hidden="true" className="fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-sm" onClick={onClose} />
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
            <p id="planning-drawer-description" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-secondary-light dark:text-text-secondary-dark">Escala operativa · consulta de solo lectura</p>
            <h2 id="planning-drawer-title" className="mt-1 font-mono text-base font-semibold text-ink-900 dark:text-text-primary-dark">{flight.operationCode}</h2>
            <div className="mt-2"><StatusBadge tone={meta.color} label={meta.label} /></div>
          </div>
          <button ref={closeButtonRef} type="button" aria-label="Cerrar panel" onClick={onClose} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-secondary-light hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-accent-600 dark:text-text-secondary-dark dark:hover:bg-white/5">
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

          <Section title="Opciones autorizadas">
            <OptionsPanel state={optionsState} onRetry={onRetryOptions} />
          </Section>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {['Asignar recursos', 'Editar planificación', 'Crear Work Order'].map(label => (
            <button key={label} type="button" disabled title="Próximamente" className="cursor-not-allowed rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-text-secondary-light/50 dark:border-white/10 dark:text-text-secondary-dark/50">{label}</button>
          ))}
        </div>
      </aside>
    </>
  );
}
