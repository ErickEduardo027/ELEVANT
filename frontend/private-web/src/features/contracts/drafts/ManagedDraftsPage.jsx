import { useCallback, useEffect, useRef, useState } from 'react';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { useCommercialRevalidation } from '../../../hooks/useCommercialRevalidation';
import ConfirmDialog from '../../../components/ConfirmDialog';
import Modal from '../../../components/Modal';
import ReasonField, { validReason } from '../../../components/ReasonField';
import ContractPackagesPanel from './ContractPackagesPanel';
import ContractPdfButtons from '../agreements/ContractPdfButtons';
import {
  activateManagedDraft, discardContractDraft, getContractDraftReadiness, getContractDraftScope, getManagedDrafts,
  replyContractDraft, setContractDraftScope, updateManagedDraft,
} from '../../../services/commercialGovernanceApi';
import { billingUnitLabel } from '../../../services/billingUnits';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import { listBillingUnits } from '../../../services/financeBookService';
import { isConflict, isForbidden } from '../../../services/problemMessages';
import { DRAFT_PROBLEM_MESSAGES, PORTAL_ACCOUNT_LABELS, READINESS_CHECKS, draftProblemMessage } from './draftProblemMessages';
import { afterFinanceApproval } from '../approvalEffect';

const LOAD_FAILED = 'No se pudieron cargar los borradores. Revise la conexión e intente de nuevo.';
// Comments, scope and discards (contract_drafts) and Finance decisions (contract_approvals) re-read the list.
const RELOAD_ON = ['contract_draft_comments', 'contract_drafts', 'contract_approvals'];
const fieldClass = 'mt-1 block w-full rounded border p-1.5 text-xs dark:bg-surface-dark';
const buttonClass = 'rounded-lg border border-black/15 px-3 py-2 text-xs font-semibold disabled:opacity-50 dark:border-white/15';

const VERSION_STATUS = {
  Draft: 'Borrador',
  PendingFinanceApproval: 'Pendiente de aprobación de Finanzas',
};
/**
 * 409 codes after which the draft on screen is stale: it changed or moved on, so the editor drops its edits
 * and reads it again before a new attempt. Any other 409 is a rule the server refused (package_not_eligible,
 * valid_from_not_after_current, a readiness cause…): the edits stay on screen to be corrected.
 */
const STALE_DRAFT_CODES = new Set(['version_conflict', 'idempotency_conflict', 'draft_closed', 'draft_in_finance_review']);
/** The draft changed, moved on or no longer exists. */
const staleDraft = failure => failure?.status === 404 || (isConflict(failure) && STALE_DRAFT_CODES.has(failure.code));
/** The draft left the list (closed or gone): its editor closes with it, so the page keeps the message. */
const goneDraft = failure => failure?.status === 404 || (isConflict(failure) && failure.code === 'draft_closed');
/** 1-N07: only an exclusion or a plain percentage survives a change of currency; an amount goes back to the base. */
const repricedByCurrency = charge => charge.mode === 'negotiated' && charge.method !== 'PercentOfService';

/**
 * Contract drafts of Contratos (phase 1, block B): the list, and the editor of one draft with its
 * readiness for Finance, its scope of services and stations, packages, terms and prices, the
 * observations with the airline, the submission to Finance and the discard. Every command carries
 * its Idempotency-Key and the draft version on screen; a conflict re-reads the draft.
 */
export default function ManagedDraftsPage({ canEdit = true, canActivate = true, canDiscard = false }) {
  const [view, setView] = useState({ status: 'loading', drafts: [], error: '' });
  const [selectedId, setSelectedId] = useState(null);
  // { text, tone }: a success, or the error of a draft that left the list with its editor.
  const [notice, setNotice] = useState(null);
  const showNotice = useCallback((text, tone = 'success') => setNotice(text ? { text, tone } : null), []);
  // 1-E: rates keep a unit code; the editor offers the active units Finance maintains.
  const [units, setUnits] = useState([]);
  useEffect(() => {
    let active = true;
    // Without the list the editor keeps each rate's current unit; saving still checks it on the server.
    Promise.resolve().then(listBillingUnits).then(list => { if (active) setUnits((list ?? []).filter(unit => unit.isActive)); })
      .catch(() => { if (active) setUnits([]); });
    return () => { active = false; };
  }, []);
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const call = ++latest.current;
    try {
      const drafts = await getManagedDrafts();
      if (call === latest.current) setView({ status: 'ready', drafts, error: '' });
      return true;
    } catch (failure) {
      if (call !== latest.current) return false;
      if (isForbidden(failure)) setView({ status: 'forbidden', drafts: [], error: '' });
      else {
        const error = draftProblemMessage(failure, { fallback: LOAD_FAILED });
        // A failed refresh keeps the list with an alert; a list that never loaded is never shown as empty.
        setView(current => (current.status === 'ready' ? { ...current, error } : { status: 'error', drafts: [], error }));
      }
      return false;
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useCommercialRevalidation(reload);
  useEffect(() => {
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.some(resource => RELOAD_ON.includes(resource))) void reload();
    });
    void observer.start();
    return () => { void observer.stop(); };
  }, [reload]);
  const drafts = view.drafts;
  const selected = drafts.find(item => item.id === selectedId) ?? null;
  const retry = <button type="button" onClick={() => { void reload(); }} className="rounded-lg border border-status-danger px-3 py-1 text-xs font-semibold">Reintentar</button>;
  return <div className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-5"><header className="flex items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-signal-500">Gestión contractual / Versiones</p><h1 className="mt-1 text-2xl font-bold">Borradores</h1><p className="mt-1 text-sm text-text-secondary-light">Revise las observaciones de la aerolínea, configure alcance, condiciones y tarifas y envíe el contrato a Finanzas para su aprobación.</p></div><button type="button" onClick={() => { void reload(); }} className="rounded-lg border px-4 py-2 text-sm">Actualizar</button></header>
    {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg p-3 text-sm ${notice.tone === 'error' ? 'bg-status-danger/10 text-status-danger' : 'bg-status-success/10'}`}>{notice.text}</p>}
    {view.status === 'forbidden' ? <p role="alert" className="rounded-xl border border-status-danger/30 bg-white p-8 text-center text-sm dark:bg-surface-dark-card">No tiene permiso para ver los borradores de contrato. Pida acceso al administrador de Contratos.</p> : <>
      {view.status === 'ready' && view.error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger"><span>{view.error}</span>{retry}</div>}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] xl:grid-cols-[minmax(0,1fr)_500px]"><section className="h-fit rounded-xl border border-black/5 bg-white p-5 dark:bg-surface-dark-card"><h2 className="font-bold">Versiones pendientes</h2>
        {view.status === 'loading' ? <p className="mt-5 text-sm">Cargando…</p>
          : view.status === 'error' ? <div role="alert" className="mt-5 space-y-2 text-sm text-status-danger"><p>{view.error}</p>{retry}</div>
            : drafts.length ? <div className="mt-4 divide-y divide-black/5 dark:divide-white/5">{drafts.map(item => <button type="button" key={item.id} onClick={() => { setSelectedId(item.id); setNotice(null); }} className={`w-full py-4 text-left hover:text-accent-600 ${selectedId === item.id ? 'text-accent-600' : ''}`}><strong className="block">{item.airline}</strong><span className="text-xs text-text-secondary-light">{item.contractCode} · {VERSION_STATUS[item.versionStatus] ?? 'Borrador'} · {item.rates.length} servicios · {item.comments.length} observaciones</span></button>)}</div>
              : <p className="mt-5 text-sm text-text-secondary-light">No hay borradores pendientes.</p>}</section>
        <section className="h-fit rounded-xl border border-black/5 bg-white p-5 dark:bg-surface-dark-card">{selected ? <DraftEditor key={selected.id} draft={selected} units={units} canEdit={canEdit} canActivate={canActivate} canDiscard={canDiscard} onNotice={showNotice} onChanged={reload} /> : <p className="py-12 text-center text-sm text-text-secondary-light">Seleccione un borrador para revisarlo.</p>}</section></div>
    </>}
  </div>;
}

function difference(price, base) {
  if (base === null || base === undefined || Number(base) === 0) return null;
  return Math.round(((Number(price) - Number(base)) / Number(base)) * 1000) / 10;
}

function formOf(draft) {
  return {
    version: draft.version, terms: draft.terms ?? '', validFrom: draft.validFrom, validTo: draft.validTo ?? '',
    currencyCode: draft.currencyCode,
    rates: draft.rates.map(rate => ({ ...rate, isConfirmed: rate.isConfirmed === true })),
    charges: (draft.charges ?? []).map(charge => ({ ...charge,
      mode: charge.isExcluded ? 'excluded' : charge.value !== null && charge.value !== undefined ? 'negotiated' : 'base' })),
  };
}

/** A read of the draft keyed by its version and a refresh counter; loading is derived, not stored. */
function useDraftRead(fetcher, key) {
  const [state, setState] = useState({ key: null, data: null, error: null });
  useEffect(() => {
    let active = true;
    fetcher().then(data => { if (active) setState({ key, data, error: null }); },
      error => { if (active) setState(current => ({ key, data: current.data, error })); });
    return () => { active = false; };
  }, [fetcher, key]);
  return { loading: state.key !== key, data: state.data, error: state.error };
}

/**
 * One draft. The form follows the server version unless the user is editing it; then the save sends
 * the version the form came from and a newer one is refused (version_conflict) and re-read.
 */
function DraftEditor({ draft, units = [], canEdit, canActivate, canDiscard, onNotice, onChanged }) {
  const pending = draft.versionStatus === 'PendingFinanceApproval';
  const editable = canEdit && !pending;
  const [form, setForm] = useState(() => formOf(draft));
  const [dirty, setDirty] = useState(false);
  if (!dirty && form.version !== draft.version) setForm(formOf(draft));
  const [refresh, setRefresh] = useState(0);
  const readKey = `${draft.version}|${refresh}`;
  const fetchReadiness = useCallback(() => getContractDraftReadiness(draft.id), [draft.id]);
  const fetchScope = useCallback(() => getContractDraftScope(draft.id), [draft.id]);
  const readiness = useDraftRead(fetchReadiness, readKey);
  const scope = useDraftRead(fetchScope, readKey);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [packagesBusy, setPackagesBusy] = useState(false);
  const [packagesDirty, setPackagesDirty] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const saveKeys = useRef(createCommandKeyHolder());
  const submitKeys = useRef(createCommandKeyHolder());
  const scopeKeys = useRef(createCommandKeyHolder());
  const discardKeys = useRef(createCommandKeyHolder());
  const replyKeys = useRef(createCommandKeyHolder());
  // 1-F: an amendment or a renewal of a contract in force replaces the version in force; a new contract activates later.
  const afterFinance = afterFinanceApproval(draft.status, draft.validFrom);

  /**
   * Sends one command of the editor. `intent` names it for its Idempotency-Key; with `command` the body is
   * built at the first attempt and a retry resends it as it was. A command answered inside a dialog
   * (`inDialog`) gets its message back to show there, instead of behind the dialog.
   */
  async function run(holder, action, intent, send, success, { command, resetsForm = false, inDialog = false } = {}) {
    setBusy(action); setError('');
    try {
      await holder.current.run(action, intent, send, command);
      if (resetsForm) setDirty(false);
      onNotice(success);
      setRefresh(value => value + 1);
      await onChanged();
      return { ok: true };
    } catch (failure) {
      const message = draftProblemMessage(failure);
      const gone = goneDraft(failure);
      // A draft that left the list takes its editor with it: the page keeps the message.
      if (gone) onNotice(message, 'error');
      else if (!inDialog) setError(message);
      if (staleDraft(failure)) {
        // The draft changed or moved on: the edits are dropped and it is read again before a new attempt.
        setDirty(false); setRefresh(value => value + 1); await onChanged();
      } else if (isConflict(failure)) {
        // A rule refused the command: the edits stay to be corrected; the checks are read again.
        setRefresh(value => value + 1); await onChanged();
      }
      return { ok: false, message, gone };
    } finally {
      setBusy('');
    }
  }

  function save(event) {
    event.preventDefault();
    const command = {
      expectedVersion: form.version, terms: form.terms, validFrom: form.validFrom, validTo: form.validTo || null,
      currencyCode: form.currencyCode,
      rates: form.rates.map(rate => ({ id: rate.id, billingUnit: rate.billingUnit, unitPrice: Number(rate.unitPrice),
        minimumQuantity: Number(rate.minimumQuantity), isConfirmed: rate.isConfirmed })),
      chargeRates: form.charges.filter(charge => charge.mode !== 'base').map(charge => ({ chargeId: charge.chargeId,
        isExcluded: charge.mode === 'excluded', value: charge.mode === 'negotiated' ? Number(charge.value) : null })),
    };
    void run(saveKeys, 'save', { id: draft.id, ...command }, key => updateManagedDraft(draft.id, command, key),
      'Borrador actualizado. La aerolínea verá los cambios en su portal.', { resetsForm: true });
  }
  function submitToFinance() {
    setConfirmSubmit(false);
    const command = { expectedVersion: draft.version };
    void run(submitKeys, 'submit', { id: draft.id, ...command }, key => activateManagedDraft(draft.id, command, key),
      `Contrato enviado a Finanzas para aprobar los precios. ${afterFinance}`);
  }
  const saveScope = command => run(scopeKeys, 'scope', { id: draft.id, ...command },
    key => setContractDraftScope(draft.id, command, key),
    'Alcance actualizado. Los servicios nuevos parten de la tarifa base de Finanzas y deben confirmarse.');
  // The version of the first attempt goes with every retry of the same reason or answer: a retry after an
  // uncertain result is the same command, so the server replays it even if the draft moved on meanwhile.
  const discard = reason => run(discardKeys, 'discard', { id: draft.id, reason },
    (key, command) => discardContractDraft(draft.id, command, key),
    'Borrador descartado. Se conserva en el historial del contrato.',
    { command: () => ({ expectedVersion: draft.version, reason }), inDialog: true });
  const reply = body => run(replyKeys, 'reply', { id: draft.id, body },
    (key, command) => replyContractDraft(draft.id, command, key),
    'Respuesta enviada. La aerolínea la verá en su portal.',
    { command: () => ({ expectedVersion: draft.version, body }) });

  const updateForm = patch => { setForm(current => ({ ...current, ...patch })); setDirty(true); };
  const updateRate = (index, patch) => updateForm({ rates: form.rates.map((item, position) => (position === index ? { ...item, ...patch } : item)) });
  const updateCharge = (id, patch) => updateForm({ charges: form.charges.map(item => (item.chargeId === id ? { ...item, ...patch } : item)) });
  const retiredRates = new Set((scope.data?.services ?? []).filter(service => !service.isActive && service.rateId)
    .map(service => service.rateId));
  const locked = Boolean(busy) || packagesBusy || packagesDirty;
  const ready = readiness.data?.version === draft.version && readiness.data.ready && !readiness.loading;
  const canSubmit = ready && !dirty && !locked;
  const currencyChanged = form.currencyCode !== draft.currencyCode;
  const repriced = currencyChanged ? form.charges.filter(repricedByCurrency).map(charge => charge.code) : [];

  return <div><p className="text-xs font-mono text-signal-500">{draft.contractCode}</p><h2 className="mt-1 text-xl font-bold">{draft.airline}</h2><p className="mt-1 text-xs text-text-secondary-light">Estaciones: {draft.stations.join(' · ') || 'sin estaciones'}</p>
    <ContractPdfButtons versionId={draft.id} fileName={`borrador-${draft.contractCode}.pdf`} draft className="mt-3" />
    <p className="mt-2 inline-flex rounded-full bg-black/5 px-2.5 py-1 text-xs font-semibold dark:bg-white/10">{VERSION_STATUS[draft.versionStatus] ?? draft.versionStatus ?? 'Borrador'}</p>
    {draft.financeDecision === 'Returned' && !pending && <p role="alert" className="mt-3 rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">Finanzas devolvió el contrato: {draft.financeReason}</p>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
    <Observations draft={draft} canReply={canEdit} busy={busy === 'reply'} onReply={reply} />
    <ScopeEditor scope={scope} editable={editable} locked={locked || dirty} busy={busy === 'scope'} onSave={saveScope} onRetry={() => setRefresh(value => value + 1)} />
    {canEdit && <form onSubmit={save} className="mt-5 space-y-4">
      <fieldset disabled={!editable || locked} className="space-y-4">
        <label className="block text-xs font-semibold">Condiciones del contrato<textarea required maxLength={10000} rows={4} value={form.terms} onChange={event => updateForm({ terms: event.target.value })} className="mt-1 block w-full rounded-lg border p-2 text-sm dark:bg-surface-dark" /></label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-xs font-semibold">Vigente desde<input type="date" required value={form.validFrom} onChange={event => updateForm({ validFrom: event.target.value })} className="mt-1 block w-full rounded-lg border p-2 text-sm dark:bg-surface-dark" /></label>
          <label className="text-xs font-semibold">Hasta (opcional)<input type="date" value={form.validTo} onChange={event => updateForm({ validTo: event.target.value })} className="mt-1 block w-full rounded-lg border p-2 text-sm dark:bg-surface-dark" /></label>
          <label className="text-xs font-semibold">Moneda<select value={form.currencyCode} onChange={event => updateForm({ currencyCode: event.target.value })} className="mt-1 block w-full rounded-lg border p-2 text-sm dark:bg-surface-dark"><option>USD</option><option>DOP</option></select></label>
        </div>
        {currencyChanged && <p role="note" className="rounded-lg border border-status-warning/40 bg-status-warning/10 p-3 text-xs">Al cambiar la moneda todas las tarifas quedarán sin confirmar: revíselas y confírmelas de nuevo. {repriced.length > 0 ? `Los cargos con importe negociado (${repriced.join(', ')}) volverán a la tarifa base de Finanzas en ${form.currencyCode}: negócielos de nuevo después de guardar. ` : ''}Las exclusiones y los porcentajes negociados se conservan. Los paquetes vinculados deben existir en la nueva moneda.</p>}
        <div><h3 className="text-sm font-bold">Tarifas</h3>
          <p className="text-xs text-text-secondary-light">Parten de la tarifa base de Finanzas en {draft.currencyCode}; Finanzas revisa las diferencias antes de aprobar.</p>
          {form.rates.map((rate, index) => {
            const diff = difference(rate.unitPrice, rate.basePrice);
            return <div key={rate.id} className="mt-2 rounded-lg border border-black/10 p-3 dark:border-white/10">
              <div className="flex flex-wrap items-baseline justify-between gap-2"><strong className="text-sm">{rate.serviceName}{retiredRates.has(rate.id) && <span className="ml-2 rounded-full bg-status-danger/10 px-2 py-0.5 text-[11px] font-semibold text-status-danger">Retirado</span>}</strong>
                <span className="text-xs text-text-secondary-light">Base {rate.basePrice === null || rate.basePrice === undefined ? 'sin tarifa' : rate.basePrice}{diff !== null && <span className={diff < 0 ? ' text-status-danger' : ' text-status-success'}> · {diff > 0 ? '+' : ''}{diff} %</span>}</span></div>
              {retiredRates.has(rate.id) && <p className="mt-1 text-xs text-status-danger">Servicio dado de baja del catálogo: quítelo del alcance antes de enviar a Finanzas.</p>}
              <div className="mt-2 grid grid-cols-1 gap-2 min-[400px]:grid-cols-3">
                <label className="text-[11px]">Unidad<select required value={rate.billingUnit} onChange={event => updateRate(index, { billingUnit: event.target.value })} className={fieldClass}>
                  {units.map(unit => <option key={unit.code} value={unit.code}>{unit.name}</option>)}
                  {!units.some(unit => unit.code === rate.billingUnit) && <option value={rate.billingUnit}>{billingUnitLabel(rate.billingUnit)}{units.length ? ' (no activa)' : ''}</option>}
                </select></label>
                {[['unitPrice', 'Precio'], ['minimumQuantity', 'Mínimo']].map(([field, label]) => <label key={field} className="text-[11px]">{label}<input required type="number" min={0} step="0.01" value={rate[field]} onChange={event => updateRate(index, { [field]: event.target.value })} className={fieldClass} /></label>)}</div>
              <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={rate.isConfirmed} onChange={event => updateRate(index, { isConfirmed: event.target.checked })} />Confirmar tarifa (0 = cortesía)</label></div>;
          })}</div>
        {form.charges.length > 0 && <div><h3 className="text-sm font-bold">Cargos y recargos</h3>
          <p className="text-xs text-text-secondary-light">Sin cambios se aplica el tarifario de cargos de Finanzas.</p>
          {form.charges.map(charge => <div key={charge.chargeId} className="mt-2 grid grid-cols-1 items-end gap-2 rounded-lg border border-black/10 p-3 text-xs dark:border-white/10 min-[400px]:grid-cols-[minmax(0,1fr)_9rem_7rem]">
            <span><strong>{charge.code}</strong> · {charge.name}<span className="block text-text-secondary-light">Base {charge.baseValue ?? 'sin importe'}{charge.method === 'PercentOfService' ? ' %' : ''}</span>{currencyChanged && repricedByCurrency(charge) && <span className="block text-status-warning">Vuelve a la tarifa base en {form.currencyCode} al guardar.</span>}</span>
            <label>Trato<select aria-label={`Trato de ${charge.code}`} value={charge.mode} onChange={event => updateCharge(charge.chargeId, { mode: event.target.value, value: event.target.value === 'negotiated' ? (charge.value ?? charge.baseValue ?? 0) : charge.value })} className={fieldClass}>
              <option value="base">Tarifa base</option><option value="negotiated">Negociado</option><option value="excluded">Excluido</option></select></label>
            {charge.mode === 'negotiated' ? <label>Importe<input aria-label={`Importe de ${charge.code}`} type="number" min="0" step="0.01" required value={charge.value ?? ''} onChange={event => updateCharge(charge.chargeId, { value: event.target.value })} className={fieldClass} /></label> : <span />}
          </div>)}</div>}
      </fieldset>
      {editable && <button disabled={locked} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Guardar borrador</button>}
    </form>}
    {draft.version ? <ContractPackagesPanel draft={draft} canEdit={canEdit} disabled={Boolean(busy) || dirty} onSaved={async () => { if (!await onChanged()) throw new Error('No se pudo actualizar el borrador.'); }} onBusyChange={setPackagesBusy} onDirtyChange={setPackagesDirty} /> : <p className="mt-5 text-xs text-text-secondary-light">Actualice el borrador para consultar sus paquetes y obtener su versión vigente.</p>}
    {canActivate && !pending && <div className="mt-6 border-t border-black/10 pt-4 dark:border-white/10">
      <Readiness readiness={readiness} onRetry={() => setRefresh(value => value + 1)} />
      {dirty && <p className="mt-2 text-xs text-status-warning">Guarde los cambios del borrador antes de enviarlo a Finanzas.</p>}
      <button type="button" disabled={!canSubmit} onClick={() => setConfirmSubmit(true)} className="mt-3 rounded-lg border border-status-success px-4 py-2 text-sm font-semibold text-status-success disabled:opacity-50">Enviar a Finanzas</button></div>}
    {pending && <p className="mt-6 rounded-lg bg-status-warning/10 p-3 text-sm">En revisión por Finanzas. Si lo devuelve, podrá editarlo de nuevo.</p>}
    {canDiscard && <DiscardSection draft={draft} busy={busy === 'discard'} locked={locked} onDiscard={discard} />}
    <ConfirmDialog open={confirmSubmit} title="Enviar a Finanzas" description={`¿Enviar ${draft.contractCode} a Finanzas para aprobar los precios? ${afterFinance}`} confirmLabel="Enviar" onClose={() => setConfirmSubmit(false)} onConfirm={submitToFinance} busy={busy === 'submit'} />
  </div>;
}

/** «Listo para Finanzas»: the server's causes, the same codes the submission answers (1-D, 1-N14). */
function Readiness({ readiness, onRetry }) {
  if (!readiness.data) {
    if (readiness.error) return <p role="alert" className="text-xs text-status-danger">{draftProblemMessage(readiness.error, { fallback: 'No se pudo comprobar si el borrador está listo. Revise la conexión e intente de nuevo.', forbidden: 'No tiene permiso para comprobar si el borrador está listo.' })} <button type="button" onClick={onRetry} className="font-semibold underline">Reintentar</button></p>;
    return <p role="status" className="text-xs">Comprobando si el borrador está listo para Finanzas…</p>;
  }
  const issues = new Map(readiness.data.issues.map(issue => [issue.code, issue.subjects]));
  return <div><h3 className="text-sm font-bold">Antes de enviar a Finanzas</h3>
    <p className="mt-1 text-xs text-text-secondary-light">{PORTAL_ACCOUNT_LABELS[readiness.data.portalAccount] ?? ''}</p>
    {readiness.error && <p role="alert" className="mt-1 text-xs text-status-danger">{draftProblemMessage(readiness.error)} <button type="button" onClick={onRetry} className="font-semibold underline">Reintentar</button></p>}
    <ul aria-label="Requisitos para enviar a Finanzas" className="mt-2 space-y-1 text-xs">{READINESS_CHECKS.map(([code, label]) => {
      const subjects = issues.get(code);
      return <li key={code} className={subjects ? 'text-status-danger' : ''}>{subjects ? '○' : '✓'} {label}{subjects && <span className="block pl-4 text-text-secondary-light">{DRAFT_PROBLEM_MESSAGES[code]}{subjects.length > 0 && ` (${subjects.join(', ')})`}</span>}</li>;
    })}</ul></div>;
}

function selectionOf(data) {
  return { version: data?.version ?? null, services: (data?.services ?? []).filter(item => item.selected).map(item => item.serviceId),
    stations: (data?.stations ?? []).filter(item => item.selected).map(item => item.stationId) };
}

const sameSet = (left, right) => left.length === right.length && left.every(item => right.includes(item));

/**
 * Services and stations of the draft (1-N04). Only active catalog services can be added; a retired
 * one stays marked until Contratos removes it (1-N10); a service a linked package covers stays.
 */
function ScopeEditor({ scope, editable, locked, busy, onSave, onRetry }) {
  const data = scope.data;
  const [selection, setSelection] = useState(() => selectionOf(data));
  if (data && selection.version !== data.version) setSelection(selectionOf(data));
  const server = selectionOf(data);
  const changed = !sameSet(selection.services, server.services) || !sameSet(selection.stations, server.stations);
  const toggle = (field, id, checked) => setSelection(current => ({ ...current,
    [field]: checked ? [...current[field], id] : current[field].filter(value => value !== id) }));
  const disabled = !editable || locked || busy;
  return <section aria-label="Alcance del contrato" className="mt-5 rounded-lg border border-black/10 p-4 dark:border-white/10"><h3 className="text-sm font-bold">Servicios y estaciones</h3>
    {!data ? scope.error
      ? <p role="alert" className="mt-2 text-xs text-status-danger">{draftProblemMessage(scope.error, { fallback: 'No se pudo cargar el alcance del borrador. Revise la conexión e intente de nuevo.', forbidden: 'No tiene permiso para ver el alcance del borrador.' })} <button type="button" onClick={onRetry} className="font-semibold underline">Reintentar</button></p>
      : <p role="status" className="mt-2 text-xs">Cargando el alcance del borrador…</p>
      : <>
        {editable && <p className="mt-1 text-xs text-text-secondary-light">Agregue servicios activos del catálogo o quítelos, y fije las estaciones. Los servicios nuevos parten de la tarifa base de Finanzas sin confirmar.</p>}
        {scope.error && <p role="alert" className="mt-1 text-xs text-status-danger">{draftProblemMessage(scope.error)} <button type="button" onClick={onRetry} className="font-semibold underline">Reintentar</button></p>}
        <fieldset disabled={disabled} className="mt-3"><legend className="text-xs font-semibold">Servicios</legend>
          {data.services.map(service => <label key={service.serviceId} className="mt-1 flex flex-wrap items-center gap-2 text-xs"><input type="checkbox" checked={selection.services.includes(service.serviceId)} disabled={service.coveredByPackage} onChange={event => toggle('services', service.serviceId, event.target.checked)} />{service.code} · {service.name}{!service.isActive && <span className="rounded-full bg-status-danger/10 px-2 py-0.5 text-[11px] font-semibold text-status-danger">Retirado</span>}{service.coveredByPackage && <span className="text-text-secondary-light">(en un paquete vinculado)</span>}</label>)}
        </fieldset>
        <fieldset disabled={disabled} className="mt-3"><legend className="text-xs font-semibold">Estaciones</legend>
          {data.stations.map(station => <label key={station.stationId} className="mt-1 flex items-center gap-2 text-xs"><input type="checkbox" checked={selection.stations.includes(station.stationId)} onChange={event => toggle('stations', station.stationId, event.target.checked)} />{station.code} · {station.name}{!station.isActive && <span className="text-status-danger"> (inactiva)</span>}</label>)}
        </fieldset>
        {editable && locked && <p className="mt-2 text-xs text-text-secondary-light">Para cambiar el alcance, guarde antes los cambios del borrador y de los paquetes.</p>}
        {editable && <button type="button" disabled={disabled || !changed || selection.services.length === 0 || selection.stations.length === 0} onClick={() => { void onSave({ expectedVersion: data.version, serviceIds: selection.services, stationIds: selection.stations }); }} className={`${buttonClass} mt-3 border-accent-600 text-accent-600`}>{busy ? 'Guardando…' : 'Guardar alcance'}</button>}
      </>}
  </section>;
}

/** The airline's observations and Contratos' answers, also while Finance reviews the draft (1-N15). */
function Observations({ draft, canReply, busy, onReply }) {
  const [body, setBody] = useState('');
  async function submit(event) {
    event.preventDefault();
    if ((await onReply(body.trim())).ok) setBody('');
  }
  return <section aria-label="Observaciones" className="mt-5 rounded-lg bg-black/[.03] p-4 dark:bg-white/[.04]"><h3 className="text-sm font-bold">Observaciones de la aerolínea</h3>
    {draft.comments.length ? <ul className="mt-3 space-y-2">{draft.comments.map(comment => <li key={comment.id} className="border-b border-black/5 pb-2 text-sm"><strong>{comment.author}</strong>{!comment.isAirline && <span className="text-xs text-text-secondary-light"> · Respuesta de Contratos</span>}<p>{comment.body}</p><time className="text-xs text-text-secondary-light">{new Date(comment.at).toLocaleString('es-DO')}</time></li>)}</ul> : <p className="mt-2 text-xs text-text-secondary-light">Aún no hay comentarios.</p>}
    {canReply && <form onSubmit={submit} className="mt-3"><label className="block text-xs font-semibold">Responder a la aerolínea<textarea maxLength={2000} rows={2} value={body} onChange={event => setBody(event.target.value)} className="mt-1 block w-full rounded-lg border p-2 text-sm dark:bg-surface-dark" /></label><button disabled={busy || !body.trim()} className={`${buttonClass} mt-2`}>{busy ? 'Enviando…' : 'Enviar respuesta'}</button></form>}
  </section>;
}

/**
 * Discard with a reason (1-B): the version is kept, closed; a never-active contract closes with it. A refusal
 * shows inside the dialog, where the user is looking; a draft that left the list closes it (the page explains).
 */
function DiscardSection({ draft, busy, locked, onDiscard }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const close = () => { setOpen(false); setError(''); };
  async function confirm() {
    setError('');
    const result = await onDiscard(reason.trim());
    if (result.ok) { close(); setReason(''); }
    else if (result.gone) close();
    else setError(result.message);
  }
  return <div className="mt-6 border-t border-black/10 pt-4 dark:border-white/10">
    <button type="button" disabled={locked} onClick={() => { setError(''); setOpen(true); }} className="rounded-lg border border-status-danger px-4 py-2 text-sm font-semibold text-status-danger disabled:opacity-50">Descartar borrador</button>
    <Modal open={open} onClose={() => { if (!busy) close(); }} tone="danger" title={`Descartar el borrador de ${draft.contractCode}`}
      footer={<><button type="button" disabled={busy} onClick={close} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
        <button type="button" disabled={busy || !validReason(reason)} onClick={() => { void confirm(); }} className="rounded-lg bg-status-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Descartando…' : 'Descartar'}</button></>}>
      <div className="space-y-3 text-sm">
        {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-status-danger">{error}</p>}
        <p>La versión queda descartada: sale de Borradores{draft.versionStatus === 'PendingFinanceApproval' ? ' y de la bandeja de Finanzas' : ''} y la aerolínea deja de verla. Nada se borra: queda en el historial del contrato.</p>
        {draft.status === 'Draft' && <p className="text-status-danger">Si el contrato nunca se activó y no tiene otra versión vigente, también quedará terminado.</p>}
        <ReasonField value={reason} onChange={setReason} />
      </div>
    </Modal>
  </div>;
}
