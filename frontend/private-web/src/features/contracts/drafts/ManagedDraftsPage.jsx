import { useCallback, useEffect, useState } from 'react';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { useCommercialRevalidation } from '../../../hooks/useCommercialRevalidation';
import ConfirmDialog from '../../../components/ConfirmDialog';
import ContractPackagesPanel from './ContractPackagesPanel';
import { activateManagedDraft, getManagedDrafts, updateManagedDraft } from '../../../services/commercialGovernanceApi';

export default function ManagedDraftsPage({ canEdit = true, canActivate = true }) {
  const [drafts, setDrafts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try { setDrafts(await getManagedDrafts()); setError(''); return true; }
    catch (failure) { setError(failure.message); return false; }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useCommercialRevalidation(reload);
  useEffect(() => {
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('contract_draft_comments')) void reload();
    });
    void observer.start();
    return () => { void observer.stop(); };
  }, [reload]);
  const selected = drafts.find(item => item.id === selectedId) ?? null;
  async function act(action, message) {
    setError(''); setNotice('');
    try { await action(); setNotice(message); await reload(); return true; }
    catch (failure) { setError(failure.message); return false; }
  }
  return <div className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-5"><header className="flex items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-signal-500">Gestión contractual / Versiones</p><h1 className="mt-1 text-2xl font-bold">Borradores</h1><p className="mt-1 text-sm text-text-secondary-light">Revise las observaciones de la aerolínea, configure condiciones y tarifas y envíe el contrato a Finanzas para su aprobación.</p></div><button type="button" onClick={reload} className="rounded-lg border px-4 py-2 text-sm">Actualizar</button></header>
    {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
    {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] xl:grid-cols-[minmax(0,1fr)_500px]"><section className="h-fit rounded-xl border border-black/5 bg-white p-5 dark:bg-surface-dark-card"><h2 className="font-bold">Versiones pendientes</h2>{loading ? <p className="mt-5 text-sm">Cargando…</p> : drafts.length ? <div className="mt-4 divide-y divide-black/5 dark:divide-white/5">{drafts.map(item => <button type="button" key={item.id} onClick={() => setSelectedId(item.id)} className={`w-full py-4 text-left hover:text-accent-600 ${selectedId === item.id ? 'text-accent-600' : ''}`}><strong className="block">{item.airline}</strong><span className="text-xs text-text-secondary-light">{item.contractCode} · {item.rates.length} servicios · {item.comments.length} observaciones</span></button>)}</div> : <p className="mt-5 text-sm text-text-secondary-light">No hay borradores pendientes.</p>}</section>
    <section className="h-fit rounded-xl border border-black/5 bg-white p-5 dark:bg-surface-dark-card">{selected ? <DraftEditor key={selected.id} draft={selected} act={act} canEdit={canEdit} canActivate={canActivate} onPackagesSaved={async () => { if (!await reload()) throw new Error('No se pudo actualizar el borrador.'); }} /> : <p className="py-12 text-center text-sm text-text-secondary-light">Seleccione un borrador para revisarlo.</p>}</section></div>
  </div>;
}

const fieldClass = 'mt-1 block w-full rounded border p-1.5 text-xs dark:bg-surface-dark';

function difference(price, base) {
  if (base === null || base === undefined || Number(base) === 0) return null;
  return Math.round(((Number(price) - Number(base)) / Number(base)) * 1000) / 10;
}

const VERSION_STATUS = {
  Draft: 'Borrador',
  PendingFinanceApproval: 'Pendiente de aprobación de Finanzas',
};

/**
 * Draft editor for Contracts: prices start from the Finance base tariff and may be
 * negotiated; charges can be excluded or negotiated per contract. Submitting sends
 * the draft to Finance, whose approval activates the contract.
 */
function DraftEditor({ draft, act, canEdit, canActivate, onPackagesSaved }) {
  const pending = draft.versionStatus === 'PendingFinanceApproval';
  const editable = canEdit && !pending;
  const [terms, setTerms] = useState(draft.terms ?? '');
  const [validFrom, setValidFrom] = useState(draft.validFrom);
  const [validTo, setValidTo] = useState(draft.validTo ?? '');
  const [currencyCode, setCurrencyCode] = useState(draft.currencyCode);
  const [rates, setRates] = useState(draft.rates.map(rate => ({ ...rate, isConfirmed: rate.isConfirmed === true })));
  const [charges, setCharges] = useState((draft.charges ?? []).map(charge => ({ ...charge,
    mode: charge.isExcluded ? 'excluded' : charge.value !== null && charge.value !== undefined ? 'negotiated' : 'base' })));
  const [busy, setBusy] = useState(false);
  const [packagesBusy, setPackagesBusy] = useState(false);
  const [packagesDirty, setPackagesDirty] = useState(false);
  const [saved, setSaved] = useState(true);
  const [pendingActivation, setPendingActivation] = useState(false);
  async function save(event) {
    event.preventDefault(); setBusy(true);
    const didSave = await act(() => updateManagedDraft(draft.id, {
      terms, validFrom, validTo: validTo || null, currencyCode,
      rates: rates.map(rate => ({ id: rate.id, billingUnit: rate.billingUnit,
        unitPrice: Number(rate.unitPrice), minimumQuantity: Number(rate.minimumQuantity), isConfirmed: rate.isConfirmed })),
      chargeRates: charges.filter(charge => charge.mode !== 'base').map(charge => ({ chargeId: charge.chargeId,
        isExcluded: charge.mode === 'excluded', value: charge.mode === 'negotiated' ? Number(charge.value) : null })),
    }), 'Borrador actualizado. La aerolínea verá los cambios en su portal.');
    setSaved(didSave);
    setBusy(false);
  }
  async function submitToFinance() {
    setPendingActivation(false);
    setBusy(true);
    await act(() => activateManagedDraft(draft.id), 'Contrato enviado a Finanzas. Se activará cuando Finanzas lo apruebe.');
    setBusy(false);
  }
  const updateRate = (index, patch) => setRates(current => current.map((item, position) => (position === index ? { ...item, ...patch } : item)));
  const updateCharge = (id, patch) => setCharges(current => current.map(item => (item.chargeId === id ? { ...item, ...patch } : item)));
  return <div><p className="text-xs font-mono text-signal-500">{draft.contractCode}</p><h2 className="mt-1 text-xl font-bold">{draft.airline}</h2><p className="mt-1 text-xs text-text-secondary-light">Estaciones: {draft.stations.join(' · ')}</p>
    <p className="mt-2 inline-flex rounded-full bg-black/5 px-2.5 py-1 text-xs font-semibold dark:bg-white/10">{VERSION_STATUS[draft.versionStatus] ?? draft.versionStatus ?? 'Borrador'}</p>
    {draft.financeDecision === 'Returned' && !pending && <p role="alert" className="mt-3 rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">Finanzas devolvió el contrato: {draft.financeReason}</p>}
    <section className="mt-5 rounded-lg bg-black/[.03] p-4 dark:bg-white/[.04]"><h3 className="text-sm font-bold">Observaciones de la aerolínea</h3>{draft.comments.length ? <ul className="mt-3 space-y-2">{draft.comments.map(comment => <li key={comment.id} className="border-b border-black/5 pb-2 text-sm"><strong>{comment.author}</strong><p>{comment.body}</p><time className="text-xs text-text-secondary-light">{new Date(comment.at).toLocaleString('es-DO')}</time></li>)}</ul> : <p className="mt-2 text-xs text-text-secondary-light">Aún no hay comentarios.</p>}</section>
    {canEdit && <form onSubmit={save} onChange={() => setSaved(false)} className="mt-5 space-y-4">
      <fieldset disabled={!editable || busy || packagesBusy || packagesDirty} className="space-y-4">
        <label className="block text-xs font-semibold">Condiciones del contrato<textarea required maxLength={10000} rows={4} value={terms} onChange={event => setTerms(event.target.value)} className="mt-1 block w-full rounded-lg border p-2 text-sm dark:bg-surface-dark" /></label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-xs font-semibold">Vigente desde<input type="date" required value={validFrom} onChange={event => setValidFrom(event.target.value)} className="mt-1 block w-full rounded-lg border p-2 text-sm dark:bg-surface-dark" /></label>
          <label className="text-xs font-semibold">Hasta (opcional)<input type="date" value={validTo} onChange={event => setValidTo(event.target.value)} className="mt-1 block w-full rounded-lg border p-2 text-sm dark:bg-surface-dark" /></label>
          <label className="text-xs font-semibold">Moneda<select value={currencyCode} onChange={event => setCurrencyCode(event.target.value)} className="mt-1 block w-full rounded-lg border p-2 text-sm dark:bg-surface-dark"><option>USD</option><option>DOP</option></select></label>
        </div>
        <div><h3 className="text-sm font-bold">Tarifas</h3>
          <p className="text-xs text-text-secondary-light">Parten de la tarifa base de Finanzas en {draft.currencyCode}; Finanzas revisa las diferencias antes de aprobar.</p>
          {rates.map((rate, index) => {
            const diff = difference(rate.unitPrice, rate.basePrice);
            return <div key={rate.id} className="mt-2 rounded-lg border border-black/10 p-3 dark:border-white/10">
              <div className="flex flex-wrap items-baseline justify-between gap-2"><strong className="text-sm">{rate.serviceName}</strong>
                <span className="text-xs text-text-secondary-light">Base {rate.basePrice === null || rate.basePrice === undefined ? 'sin tarifa' : rate.basePrice}{diff !== null && <span className={diff < 0 ? ' text-status-danger' : ' text-status-success'}> · {diff > 0 ? '+' : ''}{diff} %</span>}</span></div>
              <div className="mt-2 grid grid-cols-1 gap-2 min-[400px]:grid-cols-3">{[['billingUnit', 'Unidad'], ['unitPrice', 'Precio'], ['minimumQuantity', 'Mínimo']].map(([key, label]) => <label key={key} className="text-[11px]">{label}<input required type={key === 'billingUnit' ? 'text' : 'number'} min={key === 'billingUnit' ? undefined : 0} step={key === 'billingUnit' ? undefined : '0.01'} value={rate[key]} onChange={event => updateRate(index, { [key]: event.target.value })} className={fieldClass} /></label>)}</div>
              <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={rate.isConfirmed} onChange={event => updateRate(index, { isConfirmed: event.target.checked })} />Confirmar tarifa (0 = cortesía)</label></div>;
          })}</div>
        {charges.length > 0 && <div><h3 className="text-sm font-bold">Cargos y recargos</h3>
          <p className="text-xs text-text-secondary-light">Sin cambios se aplica el tarifario de cargos de Finanzas.</p>
          {charges.map(charge => <div key={charge.chargeId} className="mt-2 grid grid-cols-1 items-end gap-2 rounded-lg border border-black/10 p-3 text-xs dark:border-white/10 min-[400px]:grid-cols-[minmax(0,1fr)_9rem_7rem]">
            <span><strong>{charge.code}</strong> · {charge.name}<span className="block text-text-secondary-light">Base {charge.baseValue ?? 'sin importe'}{charge.method === 'PercentOfService' ? ' %' : ''}</span></span>
            <label>Trato<select aria-label={`Trato de ${charge.code}`} value={charge.mode} onChange={event => updateCharge(charge.chargeId, { mode: event.target.value, value: event.target.value === 'negotiated' ? (charge.value ?? charge.baseValue ?? 0) : charge.value })} className={fieldClass}>
              <option value="base">Tarifa base</option><option value="negotiated">Negociado</option><option value="excluded">Excluido</option></select></label>
            {charge.mode === 'negotiated' ? <label>Importe<input aria-label={`Importe de ${charge.code}`} type="number" min="0" step="0.01" required value={charge.value ?? ''} onChange={event => updateCharge(charge.chargeId, { value: event.target.value })} className={fieldClass} /></label> : <span />}
          </div>)}</div>}
      </fieldset>
      {editable && <button disabled={busy || packagesBusy || packagesDirty} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Guardar borrador</button>}
    </form>}
    {draft.version ? <ContractPackagesPanel draft={draft} canEdit={canEdit} disabled={busy || !saved} onSaved={onPackagesSaved} onBusyChange={setPackagesBusy} onDirtyChange={setPackagesDirty} /> : <p className="mt-5 text-xs text-text-secondary-light">Actualice el borrador para consultar sus paquetes y obtener su versión vigente.</p>}
    {canActivate && !pending && <div className="mt-6 border-t border-black/10 pt-4 dark:border-white/10"><p className="text-xs text-text-secondary-light">Requiere cuenta creada, condiciones, firmantes y servicios confirmados. Finanzas aprobará la versión; los servicios nuevos se habilitan tras ambas firmas verificadas.</p><button type="button" disabled={busy || packagesBusy || packagesDirty || !saved || !draft.terms?.trim() || rates.length === 0 || rates.some(rate => !rate.isConfirmed)} onClick={() => setPendingActivation(true)} className="mt-3 rounded-lg border border-status-success px-4 py-2 text-sm font-semibold text-status-success disabled:opacity-50">Enviar a Finanzas</button></div>}
    {pending && <p className="mt-6 rounded-lg bg-status-warning/10 p-3 text-sm">En revisión por Finanzas. Si lo devuelve, podrá editarlo de nuevo.</p>}
    <ConfirmDialog open={pendingActivation} title="Enviar a Finanzas" description={`¿Enviar ${draft.contractCode} a Finanzas? El contrato se activará cuando Finanzas lo apruebe.`} confirmLabel="Enviar" onClose={() => setPendingActivation(false)} onConfirm={() => void submitToFinance()} busy={busy} />
  </div>;
}
