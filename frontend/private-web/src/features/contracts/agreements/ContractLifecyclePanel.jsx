import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '../../../components/Modal';
import StatusBadge from '../../../components/StatusBadge';
import { applyContractLifecycle, createContractAmendment, getContractTimeline } from '../../../services/commercialGovernanceApi';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import { isConflict, problemMessage } from '../../../services/problemMessages';
import { amendmentProblemMessage } from '../drafts/draftProblemMessages';

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
  Terminate: { label: 'Terminar', from: ['Draft', 'Active', 'Suspended', 'Expired'], danger: true },
};
/** A contract that never activated is discarded, not terminated (1-B). */
const actionLabel = (action, status) => (action === 'Terminate' && status === 'Draft' ? 'Descartar contrato' : ACTIONS[action]?.label ?? '');
const KIND_DOT = {
  request: 'bg-sky-500', draft: 'bg-slate-400', finance: 'bg-violet-500', validity: 'bg-blue-600', signature: 'bg-accent-600',
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
  no_approved_version: 'El contrato no tiene una versión aprobada que renovar.',
  invalid_lifecycle_action: 'Revisa la acción y la nueva vigencia e intenta de nuevo.',
};
const stamp = value => new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const day = value => new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
/** The calendar day after an ISO date, as an ISO date. */
const dayAfter = value => new Date(Date.parse(`${value}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
/** 1-C: an amendment changes prices mid-term of a contract in force or suspended. */
const AMENDABLE = ['Active', 'Suspended'];

/**
 * Chronological history of a contract (request → verification → approval → draft → Finance →
 * signatures → permits → active → suspensions, renewals and expiry) with the manual lifecycle
 * actions of Contratos (ADR-0024) and «Crear enmienda» (1-C): a new draft from the approved version
 * in force with a later «Vigente desde». `currentVersion` is that approved version when the screen
 * shows it, to bound the date.
 */
export default function ContractLifecyclePanel({ versionId, canManage = false, canAmend = false, currentVersion = null,
  onOpenDrafts, onChanged }) {
  const [state, setState] = useState({ status: 'loading', timeline: null });
  const [action, setAction] = useState(null);
  const [form, setForm] = useState({ reason: '', validFrom: '', validTo: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const keys = useRef(createCommandKeyHolder());
  const [amending, setAmending] = useState(false);
  const [amendFrom, setAmendFrom] = useState('');
  const [amended, setAmended] = useState(false);
  const amendKeys = useRef(createCommandKeyHolder());

  const load = useCallback(async () => {
    try { setState({ status: 'ready', timeline: await getContractTimeline(versionId) }); }
    catch { setState({ status: 'error', timeline: null }); }
  }, [versionId]);
  useEffect(() => { void load(); }, [load]);

  async function submit() {
    setBusy(true); setMessage('');
    const discarding = action === 'Terminate' && state.timeline.status === 'Draft';
    const values = {
      action, reason: form.reason.trim(), expectedStatus: state.timeline.status,
      ...(action === 'Renew' ? { validFrom: form.validFrom, validTo: form.validTo || null } : {}),
    };
    try {
      // The same key goes with a retry of the same intent after an uncertain result.
      const result = await keys.current.run('lifecycle', { versionId, ...values },
        key => applyContractLifecycle(versionId, values, key));
      setMessage(action === 'Renew'
        ? 'Se creó el borrador de renovación; complétalo en Borradores y envíalo a Finanzas.'
        : discarding ? 'Contrato descartado. Sus versiones abiertas quedaron cerradas y se conservan en el historial.'
          : `Contrato ${CONTRACT_STATUS[result.status]?.label.toLowerCase() ?? result.status}.`);
      setAction(null); setForm({ reason: '', validFrom: '', validTo: '' });
      await load();
      onChanged?.();
    } catch (failure) {
      setMessage(problemMessage(failure, MESSAGES));
      if (isConflict(failure)) await load();
    } finally { setBusy(false); }
  }

  /**
   * Creates the amendment with the status on screen; the same key goes with a retry of the same intent.
   * The approved version and the contract status do not change, so the drawer is not reloaded: the
   * notice and the link to Borradores stay on screen.
   */
  async function amend() {
    setBusy(true); setMessage(''); setAmended(false);
    const command = { expectedStatus: state.timeline.status, validFrom: amendFrom };
    try {
      await amendKeys.current.run('amend', { versionId, ...command }, key => createContractAmendment(versionId, command, key));
      setAmending(false); setAmendFrom(''); setAmended(true);
      setMessage('Se creó la enmienda como borrador, con las tarifas sin confirmar. Revísela en Borradores y envíela a Finanzas.');
      await load();
    } catch (failure) {
      setMessage(amendmentProblemMessage(failure));
      setAmending(false);
      if (isConflict(failure)) await load();
    } finally { setBusy(false); }
  }

  if (state.status === 'loading') return <p role="status" className="text-sm">Cargando ciclo del contrato…</p>;
  if (state.status === 'error') return <p role="alert" className="text-sm">No se pudo cargar la línea de tiempo. <button type="button" onClick={() => void load()} className="font-semibold text-accent-600 underline">Reintentar</button></p>;
  const { timeline } = state;
  const available = Object.entries(ACTIONS).filter(([, meta]) => meta.from.includes(timeline.status));
  const amendable = canAmend && AMENDABLE.includes(timeline.status);
  const earliest = currentVersion?.validFrom ? dayAfter(currentVersion.validFrom) : undefined;
  const latest = currentVersion?.validTo ?? undefined;

  return (
    <section aria-label="Ciclo del contrato" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Ciclo del contrato</h3>
        <StatusBadge tone={CONTRACT_STATUS[timeline.status]?.tone} label={CONTRACT_STATUS[timeline.status]?.label ?? timeline.status} />
      </div>
      {((canManage && available.length > 0) || amendable) && (
        <div className="flex flex-wrap gap-2">
          {canManage && available.map(([key, meta]) => (
            <button key={key} type="button" onClick={() => { setAction(key); setMessage(''); setAmended(false); }}
              className={`min-h-[36px] rounded-lg border px-3 text-xs font-semibold ${meta.danger ? 'border-status-danger text-status-danger' : 'border-accent-600 text-accent-600'}`}>{actionLabel(key, timeline.status)}</button>
          ))}
          {amendable && <button type="button" onClick={() => { setAmending(true); setMessage(''); setAmended(false); }}
            className="min-h-[36px] rounded-lg border border-accent-600 px-3 text-xs font-semibold text-accent-600">Crear enmienda</button>}
        </div>
      )}
      {message && <p role="status" className="rounded-lg bg-accent-600/10 p-2 text-xs">{message}
        {amended && onOpenDrafts && <button type="button" onClick={onOpenDrafts} className="ml-2 font-semibold text-accent-600 underline">Abrir Borradores</button>}</p>}
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
      <Modal open={Boolean(action)} onClose={() => setAction(null)} title={action === 'Terminate' && timeline.status === 'Draft'
        ? `Descartar el contrato ${timeline.contractCode}` : `${ACTIONS[action]?.label ?? ''} contrato ${timeline.contractCode}`}
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
          {action === 'Terminate' && (timeline.status === 'Draft'
            ? <p className="text-xs text-status-danger">El contrato nunca se activó. Descartarlo es definitivo: se cierra sin firmas, sus versiones abiertas salen de Borradores y de Finanzas, y nada se borra del historial.</p>
            : <p className="text-xs text-status-danger">Terminar es definitivo: el contrato deja de habilitar operaciones.</p>)}
        </div>
      </Modal>
      <Modal open={amending} onClose={() => setAmending(false)} title={`Crear enmienda del contrato ${timeline.contractCode}`}
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setAmending(false)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button type="button" disabled={busy || !amendFrom} onClick={() => void amend()}
            className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Creando…' : 'Crear enmienda'}</button></div>}>
        <div className="space-y-3 text-sm">
          <p className="text-xs">La enmienda cambia precios a mitad de la vigencia. Parte de la última versión aprobada{currentVersion
            ? ` (versión ${currentVersion.versionNumber}, del ${day(currentVersion.validFrom)} ${currentVersion.validTo ? `al ${day(currentVersion.validTo)}` : 'sin vencimiento'})` : ''}, conserva su fin, sus estaciones, cargos y paquetes, y copia las tarifas sin confirmar para que Contratos las revise antes de enviarla a Finanzas.</p>
          <label className="block text-xs font-semibold">Vigente desde
            <input type="date" min={earliest} max={latest} value={amendFrom} onChange={event => setAmendFrom(event.target.value)}
              className="mt-1 block w-full rounded-lg border px-3 py-2 dark:bg-surface-dark" /></label>
          <p className="text-xs text-text-secondary-light">Debe ser posterior al inicio de la versión aprobada vigente y no posterior a su fin. Los precios nuevos rigen desde esa fecha cuando Finanzas apruebe la enmienda.</p>
        </div>
      </Modal>
    </section>
  );
}
