import { useCallback, useEffect, useState } from 'react';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { useCommercialRevalidation } from '../../../hooks/useCommercialRevalidation';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { activateManagedDraft, getManagedDrafts, updateManagedDraft } from '../../../services/commercialGovernanceApi';

export default function ManagedDraftsPage({ canEdit = true, canActivate = true }) {
  const [drafts, setDrafts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try { setDrafts(await getManagedDrafts()); setError(''); }
    catch (failure) { setError(failure.message); }
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
  return <div className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-5"><header className="flex items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-signal-500">Gestión contractual / Versiones</p><h1 className="mt-1 text-2xl font-bold">Borradores</h1><p className="mt-1 text-sm text-text-secondary-light">Revise las observaciones de la aerolínea, configure condiciones y tarifas y active el contrato cuando esté listo.</p></div><button type="button" onClick={reload} className="rounded-lg border px-4 py-2 text-sm">Actualizar</button></header>
    {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
    {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_500px]"><section className="h-fit rounded-xl border border-black/5 bg-white p-5 dark:bg-surface-dark-card"><h2 className="font-bold">Versiones pendientes</h2>{loading ? <p className="mt-5 text-sm">Cargando…</p> : drafts.length ? <div className="mt-4 divide-y divide-black/5 dark:divide-white/5">{drafts.map(item => <button type="button" key={item.id} onClick={() => setSelectedId(item.id)} className={`w-full py-4 text-left hover:text-accent-600 ${selectedId === item.id ? 'text-accent-600' : ''}`}><strong className="block">{item.airline}</strong><span className="text-xs text-text-secondary-light">{item.contractCode} · {item.rates.length} servicios · {item.comments.length} observaciones</span></button>)}</div> : <p className="mt-5 text-sm text-text-secondary-light">No hay borradores pendientes.</p>}</section>
    <section className="h-fit rounded-xl border border-black/5 bg-white p-5 dark:bg-surface-dark-card">{selected ? <DraftEditor key={selected.id} draft={selected} act={act} canEdit={canEdit} canActivate={canActivate} /> : <p className="py-12 text-center text-sm text-text-secondary-light">Seleccione un borrador para revisarlo.</p>}</section></div>
  </div>;
}

function DraftEditor({ draft, act, canEdit, canActivate }) {
  const [terms, setTerms] = useState(draft.terms ?? '');
  const [validFrom, setValidFrom] = useState(draft.validFrom);
  const [validTo, setValidTo] = useState(draft.validTo ?? '');
  const [currencyCode, setCurrencyCode] = useState(draft.currencyCode);
  const [rates, setRates] = useState(draft.rates.map(rate => ({ ...rate, isConfirmed: rate.isConfirmed === true })));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(true);
  const [pendingActivation, setPendingActivation] = useState(false);
  async function save(event) {
    event.preventDefault(); setBusy(true);
    const didSave = await act(() => updateManagedDraft(draft.id, {
      terms, validFrom, validTo: validTo || null, currencyCode,
      rates: rates.map(rate => ({ id: rate.id, billingUnit: rate.billingUnit,
        unitPrice: Number(rate.unitPrice), minimumQuantity: Number(rate.minimumQuantity), isConfirmed: rate.isConfirmed })),
    }), 'Borrador actualizado. La aerolínea verá los cambios en su portal.');
    setSaved(didSave);
    setBusy(false);
  }
  async function activate() {
    setPendingActivation(false);
    setBusy(true);
    await act(() => activateManagedDraft(draft.id), 'Contrato activado. La aerolínea puede consultar la versión aprobada.');
    setBusy(false);
  }
  return <div><p className="text-xs font-mono text-signal-500">{draft.contractCode}</p><h2 className="mt-1 text-xl font-bold">{draft.airline}</h2><p className="mt-1 text-xs text-text-secondary-light">Estaciones: {draft.stations.join(' · ')}</p>
    <section className="mt-5 rounded-lg bg-black/[.03] p-4 dark:bg-white/[.04]"><h3 className="text-sm font-bold">Observaciones de la aerolínea</h3>{draft.comments.length ? <ul className="mt-3 space-y-2">{draft.comments.map(comment => <li key={comment.id} className="border-b border-black/5 pb-2 text-sm"><strong>{comment.author}</strong><p>{comment.body}</p><time className="text-xs text-text-secondary-light">{new Date(comment.at).toLocaleString('es-DO')}</time></li>)}</ul> : <p className="mt-2 text-xs text-text-secondary-light">Aún no hay comentarios.</p>}</section>
    {canEdit && <form onSubmit={save} onChange={() => setSaved(false)} className="mt-5 space-y-4"><label className="block text-xs font-semibold">Condiciones del contrato<textarea required maxLength={10000} rows={4} value={terms} onChange={event => setTerms(event.target.value)} className="mt-1 block w-full rounded-lg border p-2 text-sm dark:bg-surface-dark" /></label><div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold">Vigente desde<input type="date" required value={validFrom} onChange={event => setValidFrom(event.target.value)} className="mt-1 block w-full rounded-lg border p-2 text-sm dark:bg-surface-dark" /></label><label className="text-xs font-semibold">Hasta (opcional)<input type="date" value={validTo} onChange={event => setValidTo(event.target.value)} className="mt-1 block w-full rounded-lg border p-2 text-sm dark:bg-surface-dark" /></label></div><label className="block text-xs font-semibold">Moneda<input required maxLength={3} value={currencyCode} onChange={event => setCurrencyCode(event.target.value.toUpperCase())} className="mt-1 block w-24 rounded-lg border p-2 text-sm dark:bg-surface-dark" /></label><div><h3 className="text-sm font-bold">Tarifas propuestas</h3>{rates.map((rate, index) => <div key={rate.id} className="mt-2 rounded-lg border border-black/10 p-3 dark:border-white/10"><strong className="text-sm">{rate.serviceName}</strong><div className="mt-2 grid grid-cols-3 gap-2">{[['billingUnit', 'Unidad'], ['unitPrice', 'Precio'], ['minimumQuantity', 'Mínimo']].map(([key, label]) => <label key={key} className="text-[11px]">{label}<input required type={key === 'billingUnit' ? 'text' : 'number'} min={key === 'billingUnit' ? undefined : 0} step={key === 'billingUnit' ? undefined : '0.01'} value={rate[key]} onChange={event => setRates(current => current.map((item, position) => position === index ? { ...item, [key]: event.target.value } : item))} className="mt-1 block w-full rounded border p-1.5 text-xs dark:bg-surface-dark" /></label>)}</div><label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={rate.isConfirmed} onChange={event => setRates(current => current.map((item, position) => position === index ? { ...item, isConfirmed: event.target.checked } : item))} />Confirmar tarifa (0 = cortesía)</label></div>)}</div><button disabled={busy} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Guardar borrador</button></form>}
    {canActivate && <div className="mt-6 border-t border-black/10 pt-4 dark:border-white/10"><p className="text-xs text-text-secondary-light">La activación exige cuenta creada, condiciones y servicios configurados.</p><button type="button" disabled={busy || !saved || !draft.terms?.trim() || rates.length === 0 || rates.some(rate => !rate.isConfirmed)} onClick={() => setPendingActivation(true)} className="mt-3 rounded-lg border border-status-success px-4 py-2 text-sm font-semibold text-status-success disabled:opacity-50">Activar contrato</button></div>}
    <ConfirmDialog open={pendingActivation} title="Activar contrato" description={`¿Activar ${draft.contractCode}? Esto habilita la cobertura operativa según su vigencia.`} confirmLabel="Activar" onClose={() => setPendingActivation(false)} onConfirm={() => void activate()} busy={busy} />
  </div>;
}
