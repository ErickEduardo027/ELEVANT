import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Modal from '../../../components/Modal';
import ReasonField, { validReason } from '../../../components/ReasonField';
import StatusBadge from '../../../components/StatusBadge';
import { applyContractLifecycle, createContractAmendment, getContractTimeline } from '../../../services/commercialGovernanceApi';
import { addDays, businessToday } from '../../../services/businessDay';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import { contractLifecycleMessage } from '../../../services/commercialProblems';
import { isConflict } from '../../../services/problemMessages';
import { amendmentProblemMessage } from '../drafts/draftProblemMessages';
import { CONTRACT_STATUS } from '../contractStatus';

// 2-N26: one Spanish map of contract statuses for every Contratos screen.
export { CONTRACT_STATUS };
const ACTIONS = {
  Suspend: { label: 'Suspender', from: ['Active'], danger: true },
  Reactivate: { label: 'Reactivar', from: ['Suspended'] },
  Renew: { label: 'Renovar', from: ['Active', 'Suspended', 'Expired'], unscheduled: true },
  Terminate: { label: 'Terminar', from: ['Draft', 'Active', 'Suspended', 'Expired'], danger: true },
  // 2-N14: a termination scheduled for a later date can be cancelled until it takes effect.
  CancelTermination: { label: 'Cancelar terminación', from: ['Active', 'Suspended', 'Expired'], scheduled: true },
};
/** Explicit causes that end an active or suspended contract at once, without the signed notice (2-N14). */
const IMMEDIATE_CAUSES = [['Breach', 'Incumplimiento'], ['MutualAgreement', 'Mutuo acuerdo']];
/** A contract that never activated is discarded, not terminated (1-B). */
const actionLabel = (action, status) => (action === 'Terminate' && status === 'Draft' ? 'Descartar contrato' : ACTIONS[action]?.label ?? '');
const KIND_DOT = {
  request: 'bg-sky-500', draft: 'bg-slate-400', finance: 'bg-violet-500', validity: 'bg-blue-600', signature: 'bg-accent-600',
  permit: 'bg-amber-500', status: 'bg-emerald-600', upcoming: 'border-2 border-dashed border-slate-400 bg-transparent',
};
const stamp = value => new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const day = value => new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
/** 1-C: an amendment changes prices mid-term of a contract in force or suspended. */
const AMENDABLE = ['Active', 'Suspended'];
const EMPTY_FORM = { reason: '', validFrom: '', validTo: '', mode: 'notice', effectiveOn: '', cause: '' };
/** Codes after which the timeline is read again: the state or the earliest termination date moved. */
const RELOAD_CODES = ['termination_notice_not_met', 'termination_scheduled', 'termination_not_scheduled'];
/** «Crear enmienda» refusals the user fixes by changing «Vigente desde»: the message stays next to the field. */
const AMENDMENT_DATE_CODES = new Set(['valid_from_not_after_current', 'valid_from_after_current_end', 'invalid_amendment']);
/** No answer or a server failure: the same intent is retried from its dialog, with the same key. */
const uncertain = failure => typeof failure?.status !== 'number' || failure.status >= 500;
/** A panel message: a success is announced as a status, a refused action as an alert. */
const succeeded = text => ({ tone: 'success', text });
const refused = text => ({ tone: 'error', text });

/**
 * Chronological history of a contract (request → verification → approval → draft → Finance →
 * signatures → permits → active → suspensions, renewals and expiry) with the manual lifecycle
 * actions of Contratos (ADR-0024) and «Crear enmienda» (1-C): a new draft from the approved version
 * in force with a later «Vigente desde». `currentVersion` is that approved version when the screen
 * shows it, to bound the date. A termination of an active or suspended contract respects the signed
 * notice or names an immediate cause, and a scheduled one can be cancelled (2-N14).
 */
export default function ContractLifecyclePanel({ versionId, canManage = false, canAmend = false, currentVersion = null,
  onOpenDrafts, onChanged }) {
  const [state, setState] = useState({ status: 'loading', timeline: null });
  const [action, setAction] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  // { tone: 'success' | 'error', text } of the last action, or null.
  const [message, setMessage] = useState(null);
  // Why the action of the open dialog was refused, shown inside it rather than behind it.
  const [dialogError, setDialogError] = useState('');
  const keys = useRef(createCommandKeyHolder());
  const [amending, setAmending] = useState(false);
  const [amendFrom, setAmendFrom] = useState('');
  const [amended, setAmended] = useState(false);
  // { text, onDate }: why «Crear enmienda» failed, inside its dialog (next to «Vigente desde» when the date is wrong).
  const [amendError, setAmendError] = useState(null);
  const amendKeys = useRef(createCommandKeyHolder());
  const amendDateErrorId = useId();

  /**
   * Reads the history again; answers the timeline read, or null when it could not be read (a 403 shows the
   * unauthorized state instead of «Reintentar»).
   */
  const load = useCallback(async () => {
    try {
      const timeline = await getContractTimeline(versionId);
      setState({ status: 'ready', timeline });
      return timeline;
    } catch (failure) {
      setState({ status: failure?.status === 403 ? 'forbidden' : 'error', timeline: null });
      return null;
    }
  }, [versionId]);
  useEffect(() => { void load(); }, [load]);

  const timeline = state.timeline;
  const scheduledOn = timeline?.terminatesOn ?? null;
  // An active or suspended contract ends with the signed notice or an immediate cause; with a termination
  // already scheduled, only an immediate cause brings it forward.
  const withNotice = action === 'Terminate' && ['Active', 'Suspended'].includes(timeline?.status);
  const mode = scheduledOn ? 'immediate' : form.mode;
  const earliest = timeline?.earliestTerminationOn ?? businessToday();

  /** Opens an action's dialog with an empty form; a termination starts on the earliest date the notice allows. */
  function openAction(key) {
    setAction(key); setMessage(null); setAmended(false); setDialogError('');
    setForm({ ...EMPTY_FORM, effectiveOn: key === 'Terminate' ? timeline?.earliestTerminationOn ?? '' : '' });
  }
  function closeAction() { setAction(null); setDialogError(''); }
  function openAmendment() { setAmending(true); setMessage(null); setAmended(false); setAmendError(null); }
  function closeAmendment() { setAmending(false); setAmendError(null); }

  function values() {
    const base = { action, reason: form.reason.trim(), expectedStatus: timeline.status };
    if (action === 'Renew') return { ...base, validFrom: form.validFrom, validTo: form.validTo || null };
    if (!withNotice) return base;
    return mode === 'immediate' ? { ...base, immediateCause: form.cause } : { ...base, effectiveOn: form.effectiveOn };
  }

  function success(result, sent) {
    if (action === 'Renew') return 'Se creó el borrador de renovación; complétalo en Borradores y envíalo a Finanzas.';
    if (action === 'Terminate' && timeline.status === 'Draft')
      return 'Contrato descartado. Sus versiones abiertas quedaron cerradas y se conservan en el historial.';
    if (action === 'CancelTermination') return 'Se canceló la terminación programada; el contrato sigue en su estado actual.';
    if (action === 'Terminate' && sent.effectiveOn && result.status !== 'Terminated')
      return `Se programó la terminación: el contrato cubre operaciones hasta el ${day(addDays(sent.effectiveOn, -1))} y ` +
        `termina el ${day(sent.effectiveOn)}. Sus borradores y versiones sin firmar quedaron cerrados.`;
    return `Contrato ${CONTRACT_STATUS[result.status]?.label.toLowerCase() ?? result.status}.`;
  }

  async function submit() {
    setBusy(true); setMessage(null); setDialogError('');
    const sent = values();
    try {
      // The same key goes with a retry of the same intent after an uncertain result.
      const result = await keys.current.run('lifecycle', { versionId, ...sent },
        key => applyContractLifecycle(versionId, sent, key));
      setMessage(succeeded(success(result, sent)));
      setAction(null); setForm(EMPTY_FORM);
      await load();
      onChanged?.();
    } catch (failure) {
      const text = contractLifecycleMessage(failure);
      const reloaded = isConflict(failure) || RELOAD_CODES.includes(failure?.code) ? await load() : undefined;
      // The contract moved on (or could not be read again): the dialog's intent is stale, so it closes and the
      // panel explains why. Otherwise the cause shows inside the dialog, next to the reason.
      if (reloaded === null || (reloaded && reloaded.status !== sent.expectedStatus)) {
        closeAction(); setMessage(refused(text));
      } else setDialogError(text);
    } finally { setBusy(false); }
  }

  /**
   * Creates the amendment with the status on screen; the same key goes with a retry of the same intent.
   * The approved version and the contract status do not change, so the drawer is not reloaded: the
   * notice and the link to Borradores stay on screen. A wrong «Vigente desde» is explained next to the
   * field and an uncertain result inside the dialog, to correct or retry there; any other refusal (a draft
   * in progress, a contract that changed or is not amendable) closes the dialog and the panel explains it.
   */
  async function amend() {
    setBusy(true); setMessage(null); setAmended(false); setAmendError(null);
    const command = { expectedStatus: timeline.status, validFrom: amendFrom };
    try {
      await amendKeys.current.run('amend', { versionId, ...command }, key => createContractAmendment(versionId, command, key));
      setAmending(false); setAmendFrom(''); setAmended(true);
      setMessage(succeeded('Se creó la enmienda como borrador, con las tarifas sin confirmar. Revísela en Borradores y envíela a Finanzas.'));
      await load();
    } catch (failure) {
      const text = amendmentProblemMessage(failure);
      if (AMENDMENT_DATE_CODES.has(failure?.code)) setAmendError({ text, onDate: true });
      else if (uncertain(failure)) setAmendError({ text, onDate: false });
      else { closeAmendment(); setMessage(refused(text)); }
      if (isConflict(failure)) await load();
    } finally { setBusy(false); }
  }

  if (state.status === 'loading') return <p role="status" className="text-sm">Cargando ciclo del contrato…</p>;
  if (state.status === 'forbidden') return <p role="alert" className="text-sm">Tu acceso no permite consultar el ciclo de este contrato.</p>;
  if (state.status === 'error') return <p role="alert" className="text-sm">No se pudo cargar la línea de tiempo. <button type="button" onClick={() => void load()} className="font-semibold text-accent-600 underline">Reintentar</button></p>;
  const available = Object.entries(ACTIONS).filter(([, meta]) => meta.from.includes(timeline.status) &&
    (!meta.scheduled || scheduledOn) && (!meta.unscheduled || !scheduledOn));
  const amendable = canAmend && AMENDABLE.includes(timeline.status);
  const earliestAmendment = currentVersion?.validFrom ? addDays(currentVersion.validFrom, 1) : undefined;
  const latestAmendment = currentVersion?.validTo ?? undefined;
  // The reason within the bounds the server accepts (5 to 500 characters), plus what the action needs.
  const ready = validReason(form.reason) && (action !== 'Renew' || form.validFrom) &&
    (!withNotice || (mode === 'immediate' ? form.cause : form.effectiveOn));

  return (
    <section aria-label="Ciclo del contrato" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Ciclo del contrato</h3>
        <StatusBadge tone={CONTRACT_STATUS[timeline.status]?.tone} label={CONTRACT_STATUS[timeline.status]?.label ?? timeline.status} />
      </div>
      {scheduledOn && <p role="note" className="rounded-lg border border-status-warning/40 bg-status-warning/10 p-2 text-xs">
        Terminación programada: el contrato cubre operaciones hasta el {day(addDays(scheduledOn, -1))} y termina el {day(scheduledOn)}.
        Puedes cancelarla antes de esa fecha.</p>}
      {((canManage && available.length > 0) || amendable) && (
        <div className="flex flex-wrap gap-2">
          {canManage && available.map(([key, meta]) => (
            <button key={key} type="button" onClick={() => openAction(key)}
              className={`min-h-[36px] rounded-lg border px-3 text-xs font-semibold ${meta.danger ? 'border-status-danger text-status-danger' : 'border-accent-600 text-accent-600'}`}>{actionLabel(key, timeline.status)}</button>
          ))}
          {amendable && <button type="button" onClick={openAmendment}
            className="min-h-[36px] rounded-lg border border-accent-600 px-3 text-xs font-semibold text-accent-600">Crear enmienda</button>}
        </div>
      )}
      {message && (message.tone === 'error'
        ? <p role="alert" className="rounded-lg bg-status-danger/10 p-2 text-xs text-status-danger">{message.text}</p>
        : <p role="status" className="rounded-lg bg-accent-600/10 p-2 text-xs">{message.text}
          {amended && onOpenDrafts && <button type="button" onClick={onOpenDrafts} className="ml-2 font-semibold text-accent-600 underline">Abrir Borradores</button>}</p>)}
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
      <Modal open={Boolean(action)} onClose={closeAction} title={action === 'Terminate' && timeline.status === 'Draft'
        ? `Descartar el contrato ${timeline.contractCode}`
        : action === 'CancelTermination' ? `Cancelar la terminación del contrato ${timeline.contractCode}`
          : `${ACTIONS[action]?.label ?? ''} contrato ${timeline.contractCode}`}
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={closeAction} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button type="button" disabled={busy || !ready} onClick={() => void submit()}
            className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Aplicando…' : 'Confirmar'}</button></div>}>
        <div className="space-y-3 text-sm">
          {dialogError && <p role="alert" className="rounded-lg bg-status-danger/10 p-2 text-xs text-status-danger">{dialogError}</p>}
          {action === 'Renew' && <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-semibold">Nueva vigencia desde<input type="date" value={form.validFrom} onChange={event => setForm(current => ({ ...current, validFrom: event.target.value }))} className="mt-1 block w-full rounded-lg border px-3 py-2 dark:bg-surface-dark" /></label>
            <label className="text-xs font-semibold">Hasta (opcional)<input type="date" value={form.validTo} onChange={event => setForm(current => ({ ...current, validTo: event.target.value }))} className="mt-1 block w-full rounded-lg border px-3 py-2 dark:bg-surface-dark" /></label>
          </div>}
          {withNotice && <fieldset className="space-y-2">
            <legend className="text-xs font-semibold">Cuándo termina</legend>
            {!scheduledOn && <label className="flex items-start gap-2 text-xs"><input type="radio" name="termination-mode" value="notice"
              checked={mode === 'notice'} onChange={() => setForm(current => ({ ...current, mode: 'notice' }))} className="mt-0.5" />
              Con el preaviso firmado: el contrato sigue cubriendo operaciones hasta la víspera de la fecha efectiva.</label>}
            {!scheduledOn && mode === 'notice' && <label className="block text-xs font-semibold">Fecha efectiva (primer día sin cobertura)
              <input type="date" min={earliest} value={form.effectiveOn}
                onChange={event => setForm(current => ({ ...current, effectiveOn: event.target.value }))}
                className="mt-1 block w-full rounded-lg border px-3 py-2 dark:bg-surface-dark" />
              <span className="mt-1 block font-normal text-text-secondary-light">Desde el {day(earliest)}, según el preaviso de la versión vigente.</span></label>}
            <label className="flex items-start gap-2 text-xs"><input type="radio" name="termination-mode" value="immediate"
              checked={mode === 'immediate'} onChange={() => setForm(current => ({ ...current, mode: 'immediate' }))} className="mt-0.5" />
              {scheduledOn ? 'Adelantar la terminación programada por una causa inmediata.' : 'Inmediata, por una causa explícita.'}</label>
            {mode === 'immediate' && <label className="block text-xs font-semibold">Causa inmediata
              <select value={form.cause} onChange={event => setForm(current => ({ ...current, cause: event.target.value }))}
                className="mt-1 block w-full rounded-lg border px-3 py-2 dark:bg-surface-dark">
                <option value="">Elige la causa</option>
                {IMMEDIATE_CAUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>}
          </fieldset>}
          <ReasonField label={withNotice && mode === 'immediate' ? 'Motivo (nota de la causa)' : 'Motivo'} value={form.reason}
            onChange={reason => setForm(current => ({ ...current, reason }))} />
          {action === 'Terminate' && (timeline.status === 'Draft'
            ? <p className="text-xs text-status-danger">El contrato nunca se activó. Descartarlo es definitivo: se cierra sin firmas, sus versiones abiertas salen de Borradores y de Finanzas, y nada se borra del historial.</p>
            : withNotice && mode === 'notice'
              ? <p className="text-xs text-status-danger">La terminación es definitiva en su fecha efectiva. Desde ahora se cierran los borradores y las versiones sin las dos firmas; hasta esa fecha puedes cancelarla.</p>
              : <p className="text-xs text-status-danger">Terminar es definitivo: el contrato deja de habilitar operaciones hoy y se cierran sus borradores y versiones sin las dos firmas.</p>)}
          {action === 'CancelTermination' && <p className="text-xs">El contrato seguirá vigente después de la fecha programada. Los borradores y versiones que se cerraron al programarla no se restauran.</p>}
        </div>
      </Modal>
      <Modal open={amending} onClose={closeAmendment} title={`Crear enmienda del contrato ${timeline.contractCode}`}
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={closeAmendment} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button type="button" disabled={busy || !amendFrom} onClick={() => void amend()}
            className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Creando…' : 'Crear enmienda'}</button></div>}>
        <div className="space-y-3 text-sm">
          {amendError && !amendError.onDate && <p role="alert" className="rounded-lg bg-status-danger/10 p-2 text-xs text-status-danger">{amendError.text}</p>}
          <p className="text-xs">La enmienda cambia precios a mitad de la vigencia. Parte de la última versión aprobada{currentVersion
            ? ` (versión ${currentVersion.versionNumber}, del ${day(currentVersion.validFrom)} ${currentVersion.validTo ? `al ${day(currentVersion.validTo)}` : 'sin vencimiento'})` : ''}, conserva su fin, sus estaciones, cargos y paquetes, y copia las tarifas sin confirmar para que Contratos las revise antes de enviarla a Finanzas.</p>
          <label className="block text-xs font-semibold">Vigente desde
            <input type="date" min={earliestAmendment} max={latestAmendment} value={amendFrom}
              onChange={event => { setAmendFrom(event.target.value); if (amendError?.onDate) setAmendError(null); }}
              aria-invalid={amendError?.onDate ? true : undefined} aria-describedby={amendError?.onDate ? amendDateErrorId : undefined}
              className={`mt-1 block w-full rounded-lg border px-3 py-2 dark:bg-surface-dark ${amendError?.onDate ? 'border-status-danger' : ''}`} /></label>
          {amendError?.onDate && <p id={amendDateErrorId} role="alert" className="text-xs font-semibold text-status-danger">{amendError.text}</p>}
          <p className="text-xs text-text-secondary-light">Debe ser posterior al inicio de la versión aprobada vigente y no posterior a su fin. Los precios nuevos rigen desde esa fecha cuando ambas partes firmen la enmienda; la aprobación de Finanzas sola no cambia lo que se factura.</p>
        </div>
      </Modal>
    </section>
  );
}
