import { useEffect, useState } from 'react';
import { listRampAgentReadiness } from '../../../services/humanResourcesShiftsReadService';

const LABELS = {
  agent_active: 'Perfil de rampa activo',
  mobile_account: 'Cuenta de la tablet',
  mobile_role: 'Rol Agente de rampa',
  membership: 'Personal de AVIAM',
  station_scope: 'Estación',
  terminal_scope: 'Terminal',
  airport_id: 'Carnet aeroportuario',
  ramp_driver_license: 'Licencia de conducción en rampa',
  qualifications: 'Habilitaciones',
  upcoming_shifts: 'Turnos',
  approved_absence: 'Ausencias',
};
const STATUS = {
  Ok: { icon: '✓', label: 'Listo', className: 'text-status-success' },
  Expiring: { icon: '!', label: 'Vence pronto', className: 'text-status-warning' },
  Missing: { icon: '✕', label: 'Falta', className: 'text-status-danger' },
  Info: { icon: 'i', label: 'Información', className: 'text-text-secondary-light' },
};

/**
 * «¿Puede operar?» (ADR-0026): what each ramp agent still needs before OCC can assign it, with
 * the same rules OCC applies per flight. Gestión Humana fixes the gaps here, not at planning time.
 */
export default function RampReadinessPanel() {
  const [state, setState] = useState({ status: 'loading' });
  const [open, setOpen] = useState(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    listRampAgentReadiness()
      .then(rows => { if (active) setState({ status: 'success', rows }); })
      .catch(error => { if (active) setState({ status: error?.status === 403 ? 'forbidden' : 'error' }); });
    return () => { active = false; };
  }, [revision]);

  if (state.status === 'forbidden') return null;
  return (
    <section aria-label="¿Puede operar?" className="space-y-3 rounded-2xl border border-black/5 bg-white/70 p-4 shadow-sm dark:border-white/5 dark:bg-surface-dark-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">¿Puede operar?</h2>
          <p className="text-xs text-text-secondary-light">Cuenta de la tablet, estación, carnet, licencia y habilitaciones de cada agente.</p>
        </div>
        <button type="button" onClick={() => setRevision(value => value + 1)} className="rounded-lg border px-3 py-2 text-sm">Actualizar</button>
      </div>
      {state.status === 'loading' && <p role="status" className="text-sm">Revisando agentes…</p>}
      {state.status === 'error' && <p role="alert" className="text-sm text-status-danger">No se pudo revisar a los agentes.
        <button type="button" onClick={() => setRevision(value => value + 1)} className="ml-2 underline">Reintentar</button></p>}
      {state.status === 'success' && (state.rows.length === 0
        ? <p className="text-sm">No hay agentes de rampa activos.</p>
        : <>
          <p className="text-sm">{state.rows.filter(row => row.ready).length} de {state.rows.length} agentes pueden operar.</p>
          <ul className="divide-y divide-black/5 dark:divide-white/5">
            {state.rows.map(row => {
              const missing = row.items.filter(item => item.status === 'Missing');
              const expanded = open === row.rampProfileId;
              return <li key={row.rampProfileId} className="py-2">
                <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : row.rampProfileId)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
                  <span className="font-semibold">{row.agentName} <span className="text-xs font-normal text-text-secondary-light">{row.employeeNumber}</span></span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${row.ready
                    ? 'bg-status-success/15 text-status-success' : 'bg-status-danger/15 text-status-danger'}`}>
                    {row.ready ? 'Puede operar' : `Le falta: ${missing.map(item => LABELS[item.key] ?? item.key).join(', ')}`}</span>
                </button>
                {expanded && <ul aria-label={`Requisitos de ${row.agentName}`} className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                  {row.items.map(item => {
                    const meta = STATUS[item.status] ?? STATUS.Info;
                    return <li key={item.key} className="flex gap-2">
                      <span aria-hidden="true" className={`w-4 font-bold ${meta.className}`}>{meta.icon}</span>
                      <span><strong>{LABELS[item.key] ?? item.key}</strong> · <span className={meta.className}>{meta.label}</span>
                        {item.detail && <span className="block text-xs text-text-secondary-light">{item.detail}</span>}</span>
                    </li>;
                  })}
                </ul>}
              </li>;
            })}
          </ul>
        </>)}
    </section>
  );
}
