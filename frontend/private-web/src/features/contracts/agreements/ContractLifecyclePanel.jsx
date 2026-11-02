import { useCallback, useEffect, useState } from 'react';
import Modal from '../../../components/Modal';
import StatusBadge from '../../../components/StatusBadge';
import { applyContractLifecycle, getContractTimeline } from '../../../services/commercialGovernanceApi';

export const CONTRACT_STATUS = {
  Draft: { label: 'Pendiente de firmas y permiso', tone: 'warning' },
  Active: { label: 'Activo', tone: 'success' },
  Suspended: { label: 'Suspendido', tone: 'danger' },
  Terminated: { label: 'Terminado', tone: 'neutral' },
  Expired: { label: 'Vencido', tone: 'neutral' },
};
const ACTIONS = {
  Suspend: { label: 'Suspender', from: ['Active'], danger: true },
  Reactivate: { label: 'Reactivar', from: ['Suspended'] },
  Renew: { label: 'Renovar', from: ['Active', 'Suspended', 'Expired'] },
  Terminate: { label: 'Terminar', from: ['Active', 'Suspended', 'Expired'], danger: true },
};
const KIND_DOT = {
  request: 'bg-sky-500', draft: 'bg-slate-400', finance: 'bg-violet-500', signature: 'bg-accent-600',
  permit: 'bg-amber-500', status: 'bg-emerald-600', upcoming: 'border-2 border-dashed border-slate-400 bg-transparent',
};
const MESSAGES = {
  permit_required: 'La aerolínea no tiene un permiso de operación verificado y vigente.',
  no_version_in_force: 'No hay una versión aprobada vigente; renueva el contrato.',
  draft_in_progress: 'Ya hay un borrador en curso para este contrato.',
  renewal_dates_invalid: 'La nueva vigencia debe empezar después de la versión actual y terminar después de empezar.',
  status_changed: 'El contrato cambió de estado; se volvió a cargar.',
  transition_not_allowed: 'Esa acción no aplica al estado actual del contrato.',
  reason_required: 'Escribe el motivo (5 a 500 caracteres).',
};
const stamp = value => new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

/**
 * Chronological history of a contract (request → verification → approval → draft → Finance →
 * signatures → permits → active → suspensions, renewals and expiry) with the manual lifecycle
 * actions of Contratos (ADR-0024).
 */
export default function ContractLifecyclePanel({ versionId, canManage = false, onChanged }) {
  const [state, setState] = useState({ status: 'loading', timeline: null });
  const [action, setAction] = useState(null);
  const [form, setForm] = useState({ reason: '', validFrom: '', validTo: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try { setState({ status: 'ready', timeline: await getContractTimeline(versionId) }); }
    catch { setState({ status: 'error', timeline: null }); }
  }, [versionId]);
  useEffect(() => { void load(); }, [load]);

  async function submit() {
    setBusy(true); setMessage('');
    try {
      const result = await applyContractLifecycle(versionId, {
        action, reason: form.reason.trim(), expectedStatus: state.timeline.status,
        ...(action === 'Renew' ? { validFrom: form.validFrom, validTo: form.validTo || null } : {}),
      });
      setMessage(action === 'Renew'
        ? 'Se creó el borrador de renovación; complétalo en Borradores y envíalo a Finanzas.'
        : `Contrato ${CONTRACT_STATUS[result.status]?.label.toLowerCase() ?? result.status}.`);
      setAction(null); setForm({ reason: '', validFrom: '', validTo: '' });
      await load();
      onChanged?.();
    } catch (failure) {
      setMessage(MESSAGES[failure.code] ?? failure.message);
      if (failure.status === 409) await load();
    } finally { setBusy(false); }
  }

  if (state.status === 'loading') return <p role="status" className="text-sm">Cargando ciclo del contrato…</p>;
  if (state.status === 'error') return <p role="alert" className="text-sm">No se pudo cargar la línea de tiempo. <button type="button" onClick={() => void load()} className="font-semibold text-accent-600 underline">Reintentar</button></p>;
  const { timeline } = state;
  const available = Object.entries(ACTIONS).filter(([, meta]) => meta.from.includes(timeline.status));

  return (
    <section aria-label="Ciclo del contrato" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Ciclo del contrato</h3>
        <StatusBadge tone={CONTRACT_STATUS[timeline.status]?.tone} label={CONTRACT_STATUS[timeline.status]?.label ?? timeline.status} />
      </div>
      {canManage && available.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {available.map(([key, meta]) => (
            <button key={key} type="button" onClick={() => { setAction(key); setMessage(''); }}
              className={`min-h-[36px] rounded-lg border px-3 text-xs font-semibold ${meta.danger ? 'border-status-danger text-status-danger' : 'border-accent-600 text-accent-600'}`}>{meta.label}</button>
          ))}
        </div>
      )}
      {message && <p role="status" className="rounded-lg bg-accent-600/10 p-2 text-xs">{message}</p>}
      <ol className="relative ml-2 border-l border-black/10 dark:border-white/10">
        {timeline.entries.map((entry, index) => (
          <li key={`${entry.at}-${index}`} className="mb-3 ml-4">
            <span aria-hidden="true" className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${KIND_DOT[entry.kind] ?? 'bg-slate-400'}`} />
            <p className="text-[11px] text-text-secondary-light">{entry.kind === 'upcoming' ? 'Próximamente · ' : ''}{stamp(entry.at)}</p>
            <p className="text-sm font-semibold">{entry.title}</p>
            {entry.detail && <p className="text-xs text-text-secondary-light">{entry.detail}</p>}
            {entry.actor && <p className="text-[11px] text-text-secondary-light">Por {entry.actor}</p>}
          </li>
        ))}
      </ol>
      <Modal open={Boolean(action)} onClose={() => setAction(null)} title={`${ACTIONS[action]?.label ?? ''} contrato ${timeline.contractCode}`}
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setAction(null)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button type="button" disabled={busy || form.reason.trim().length < 5 || action === 'Renew' && !form.validFrom} onClick={() => void submit()}
            className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Aplicando…' : 'Confirmar'}</button></div>}>
        <div className="space-y-3 text-sm">
          {action === 'Renew' && <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-semibold">Nueva vigencia desde<input type="date" value={form.validFrom} onChange={event => setForm(current => ({ ...current, validFrom: event.target.value }))} className="mt-1 block w-full rounded-lg border px-3 py-2 dark:bg-surface-dark" /></label>
            <label className="text-xs font-semibold">Hasta (opcional)<input type="date" value={form.validTo} onChange={event => setForm(current => ({ ...current, validTo: event.target.value }))} className="mt-1 block w-full rounded-lg border px-3 py-2 dark:bg-surface-dark" /></label>
          </div>}
          <label className="block text-xs font-semibold">Motivo
            <textarea rows={3} maxLength={500} value={form.reason} onChange={event => setForm(current => ({ ...current, reason: event.target.value }))}
              className="mt-1 block w-full rounded-lg border px-3 py-2 dark:bg-surface-dark" /></label>
          {action === 'Terminate' && <p className="text-xs text-status-danger">Terminar es definitivo: el contrato deja de habilitar operaciones.</p>}
        </div>
      </Modal>
    </section>
  );
}
