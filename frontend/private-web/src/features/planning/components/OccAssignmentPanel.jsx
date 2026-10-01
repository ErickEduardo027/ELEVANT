import { useEffect, useState } from 'react';

const ELIGIBILITY_REASON_LABELS = {
  agent_inactive: 'Agente inactivo',
  mobile_account_unavailable: 'Sin cuenta móvil disponible',
  station_scope_missing: 'Sin alcance para esta estación',
  terminal_scope_missing: 'Sin alcance para esta terminal',
  operational_position_unavailable: 'Sin posición operativa compatible',
  qualification_not_current: 'Habilitación no vigente',
  airport_id_not_current: 'Identificación aeroportuaria no vigente',
  ramp_driver_license_not_current: 'Licencia de rampa no vigente',
  shift_not_compatible: 'Turno no compatible',
  approved_absence: 'Ausencia aprobada para la fecha',
  assignment_conflict: 'Conflicto con otra asignación activa',
};

function EmptyValue({ children }) {
  return <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">{children}</p>;
}

function OptionsFailure({ state, onRetry }) {
  if (state.status === 'unauthorized') {
    return <p role="alert" className="text-sm text-status-danger">La sesión expiró. Será redirigido al acceso.</p>;
  }

  if (state.status === 'forbidden') {
    return <p role="alert" className="text-sm text-status-danger">Su cuenta no tiene permiso para consultar las opciones de esta escala.</p>;
  }

  return (
    <div role="alert" className="space-y-2 rounded-xl border border-status-warning/30 bg-status-warning/10 p-3">
      <p className="text-xs font-semibold text-status-warning">
        {state.reason === 'options-conflict'
          ? 'La operación cambió o no tiene una versión asignable. Actualice la planificación y revise su estado.'
          : 'No fue posible consultar las opciones de esta escala.'}
      </p>
      {state.recoverable && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded text-xs font-semibold text-accent-600 hover:underline focus:outline-none focus:ring-2 focus:ring-accent-600 focus:ring-offset-2"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}

function assignmentBlocker({ assignable, contract, services, eligibleAgents, etag }) {
  if (!assignable) return 'Esta operación ya tiene un agente activo o dejó de estar disponible para asignación inicial.';
  if (!contract) return 'La operación necesita un contrato aplicable antes de asignar un agente.';
  if (services.length === 0) return 'El contrato no contiene servicios operativos para materializar.';
  if (eligibleAgents.length === 0) return 'No hay agentes elegibles para el turno, estación y posición requeridos.';
  if (!etag) return 'La versión operativa no está disponible. Actualice las opciones antes de asignar.';
  return null;
}

export default function OccAssignmentPanel({
  optionsState,
  assignmentState,
  assignable = true,
  onAssign,
  onRetryOptions,
}) {
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const optionVersion = `${optionsState.data?.turnaround?.id ?? ''}|${optionsState.etag ?? ''}`;

  useEffect(() => {
    setSelectedAgentId('');
  }, [optionVersion]);

  if (!assignable) {
    return (
      <div className="space-y-3">
        <p role="status" className="rounded-xl border border-status-warning/25 bg-status-warning/10 p-3 text-xs text-status-warning">
          Esta operación ya tiene un agente activo o dejó de estar disponible para asignación inicial.
        </p>
        <button
          type="button"
          disabled
          className="w-full cursor-not-allowed rounded-xl bg-accent-600 px-4 py-3 text-sm font-semibold text-white opacity-45"
        >
          Asignar operación
        </button>
      </div>
    );
  }

  if (optionsState.status === 'idle' || optionsState.status === 'loading') {
    return (
      <p role="status" className="animate-pulse text-sm text-text-secondary-light dark:text-text-secondary-dark">
        Consultando contrato y elegibilidad…
      </p>
    );
  }

  if (['unauthorized', 'forbidden', 'error'].includes(optionsState.status)) {
    return <OptionsFailure state={optionsState} onRetry={onRetryOptions} />;
  }

  const { contract = null, services = [], agents = [] } = optionsState.data ?? {};
  const eligibleAgents = agents.filter(agent => agent.eligible === true);
  const blocker = assignmentBlocker({
    assignable,
    contract,
    services,
    eligibleAgents,
    etag: optionsState.etag,
  });
  const isSubmitting = assignmentState.status === 'submitting';
  const canSubmit = !blocker && Boolean(selectedAgentId) && !isSubmitting;

  function submitAssignment(event) {
    event.preventDefault();
    if (!canSubmit) return;
    onAssign(selectedAgentId);
  }

  return (
    <form
      onSubmit={submitAssignment}
      aria-label="Asignación de operación"
      aria-busy={isSubmitting}
      className="space-y-4"
    >
      <div className="overflow-hidden rounded-2xl border border-ink-900/10 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.025]">
        <div className="border-l-4 border-signal-500 bg-ink-900/[0.035] px-4 py-3 dark:bg-white/[0.035]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-signal-500">
                Manifiesto de despacho
              </p>
              <p className="mt-1 text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
                Agente + servicios contratados
              </p>
            </div>
            <span className="rounded-full border border-status-success/25 bg-status-success/10 px-2 py-1 text-[10px] font-semibold text-status-success">
              Versión sincronizada
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-text-secondary-light dark:text-text-secondary-dark">
            El servidor valida el alcance, determina la posición y agrega todos los servicios aplicables al confirmar.
          </p>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary-light dark:text-text-secondary-dark">
              Contrato aplicable
            </p>
            {contract ? (
              <p className="mt-1 text-sm font-medium">
                {contract.code} <span className="text-text-secondary-light dark:text-text-secondary-dark">· versión {contract.version} · {contract.currencyCode}</span>
              </p>
            ) : (
              <EmptyValue>Sin contrato aplicable para esta escala.</EmptyValue>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary-light dark:text-text-secondary-dark">
                Servicios automáticos
              </p>
              {services.length > 0 && (
                <span className="font-mono text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                  {services.length} línea{services.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
            {services.length === 0 ? (
              <EmptyValue>Sin servicios contratados disponibles.</EmptyValue>
            ) : (
              <ol className="mt-2 divide-y divide-black/5 border-y border-black/5 dark:divide-white/5 dark:border-white/5">
                {services.map((service, index) => (
                  <li key={service.id} className="grid grid-cols-[1.75rem_1fr_auto] items-start gap-2 py-2.5">
                    <span className="font-mono text-[10px] font-semibold text-signal-500">{String(index + 1).padStart(2, '0')}</span>
                    <span className="text-xs">
                      <strong>{service.code}</strong> · {service.name}
                    </span>
                    <span className="whitespace-nowrap font-mono text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                      {service.minimumQuantity} {service.billingUnit}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-2 text-[11px] text-text-secondary-light dark:text-text-secondary-dark">
              Se incluirán automáticamente; no se modifican desde esta pantalla.
            </p>
          </div>
        </div>
      </div>

      <fieldset disabled={isSubmitting || Boolean(blocker)} className="space-y-2">
        <legend className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary-light dark:text-text-secondary-dark">
          Agente de rampa
        </legend>
        {agents.length === 0 ? (
          <EmptyValue>Sin agentes candidatos para este contexto.</EmptyValue>
        ) : (
          <div className="space-y-2">
            {agents.map(agent => {
              const isSelected = selectedAgentId === agent.id;
              return (
                <label
                  key={agent.id}
                  className={`block rounded-xl border px-3 py-3 transition-colors ${
                    agent.eligible
                      ? isSelected
                        ? 'border-accent-600 bg-accent-600/[0.06] ring-1 ring-accent-600'
                        : 'cursor-pointer border-black/10 hover:border-accent-600/45 dark:border-white/10'
                      : 'cursor-not-allowed border-black/5 bg-black/[0.025] opacity-70 dark:border-white/5 dark:bg-white/[0.025]'
                  }`}
                >
                  <span className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="occ-assignment-agent"
                      value={agent.id}
                      checked={isSelected}
                      disabled={!agent.eligible || isSubmitting || Boolean(blocker)}
                      onChange={() => setSelectedAgentId(agent.id)}
                      className="mt-0.5 h-4 w-4 accent-accent-600 focus:ring-2 focus:ring-accent-600 focus:ring-offset-2"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{agent.displayName}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${agent.eligible ? 'bg-status-success/10 text-status-success' : 'bg-status-warning/10 text-status-warning'}`}>
                          {agent.eligible ? 'Elegible' : 'No elegible'}
                        </span>
                      </span>
                      <span className="mt-0.5 block font-mono text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                        {agent.employeeNumber}
                      </span>
                      {!agent.eligible && agent.eligibilityReasons.length > 0 && (
                        <span className="mt-1.5 block text-[11px] leading-relaxed text-text-secondary-light dark:text-text-secondary-dark">
                          {agent.eligibilityReasons
                            .map(reason => ELIGIBILITY_REASON_LABELS[reason] ?? 'No cumple una condición operativa')
                            .join(' · ')}
                        </span>
                      )}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </fieldset>

      {blocker && (
        <p role="status" className="rounded-xl border border-status-warning/25 bg-status-warning/10 p-3 text-xs text-status-warning">
          {blocker}
        </p>
      )}

      {assignmentState.status === 'error' && (
        <p role="alert" className="rounded-xl border border-status-danger/25 bg-status-danger/10 p-3 text-xs text-status-danger">
          {assignmentState.error?.message ?? 'No fue posible confirmar la asignación.'}
        </p>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-xl bg-accent-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-600/90 focus:outline-none focus:ring-2 focus:ring-accent-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {isSubmitting ? 'Asignando operación…' : 'Asignar operación'}
      </button>
    </form>
  );
}
