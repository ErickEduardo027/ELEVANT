'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import PageHeader from '../../../components/PageHeader';
import StatusBadge from '../../../components/StatusBadge';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { createTaxCommand, createTaxPolicy, financeTaxError, getTaxContext, listTaxPolicies, publishTaxPolicy, taxTreatmentLabel } from '../../../services/financeTaxService';

const field = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';
const button = 'rounded-lg border border-black/15 px-4 py-2 text-sm font-semibold disabled:opacity-50 dark:border-white/15';
const kinds = { Service: 'Servicio', Charge: 'Cargo', Package: 'Paquete', Adjustment: 'Ajuste', Excess: 'Excedente', Minimum: 'Mínimo' };
const empty = () => ({ airlineId: '', stationId: '', currencyCode: 'USD', conceptKind: '', conceptCode: '', treatment: '', rate: '', basis: '', validFrom: '', validTo: '', replacesPolicyId: null, expectedVersion: null });

export default function TaxPoliciesPage() {
  const { access } = useDepartmentAccess();
  const canRead = access?.can('finance.taxes.read') ?? false;
  const canManage = access?.can('finance.taxes.manage') ?? false;
  const [state, setState] = useState({ status: 'loading', policies: [], context: { airlines: [], stations: [] } });
  const [form, setForm] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [run] = useState(createTaxCommand);
  const loadSequence = useRef({ value: 0 });
  const load = useCallback(async () => {
    if (!canRead) return;
    const sequenceState = loadSequence.current;
    const sequence = ++sequenceState.value;
    try {
      const [policies, context] = await Promise.all([listTaxPolicies(), canManage ? getTaxContext() : { airlines: [], stations: [] }]);
      if (sequence === sequenceState.value) { setError(''); setState({ status: 'ready', policies, context }); }
    } catch (e) { if (sequence === sequenceState.value) { setError(financeTaxError(e)); setState(s => ({ ...s, status: 'error' })); } }
  }, [canRead, canManage]);
  useEffect(() => {
    const sequenceState = loadSequence.current;
    let active = true;
    queueMicrotask(() => { if (active) void load(); });
    return () => { active = false; sequenceState.value++; };
  }, [load]);
  async function publish(p) {
    setBusy(true); setError(''); setNotice('');
    try { await run(`publish:${p.id}`, { expectedVersion: p.version }, body => publishTaxPolicy(p.id, body)); setNotice('Política publicada.'); await load(); }
    catch (e) { setError(financeTaxError(e)); } finally { setBusy(false); }
  }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const values = { ...form, rate: form.treatment === 'Taxable' ? Number(form.rate) : null, basis: form.basis.trim() || null, validTo: form.validTo || null, conceptCode: form.conceptCode.trim() };
    try { await run('create', values, createTaxPolicy); setForm(null); setNotice('Nueva política guardada como borrador.'); await load(); }
    catch (e) { setError(financeTaxError(e)); } finally { setBusy(false); }
  }
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  if (!canRead) return <p role="alert" className="p-4 text-sm">No tiene permiso para consultar impuestos.</p>;
  return <div className="mx-auto max-w-[1440px] space-y-5">
    <PageHeader eyebrow="Finanzas" title="Políticas de impuestos" description="Configure tratamientos explícitos por concepto, aerolínea, estación, moneda y vigencia. Las publicaciones conservan su historial."
      actions={<><button className={button} type="button" disabled={busy || state.status === 'loading'} onClick={() => { setState(s => ({ ...s, status: 'loading' })); void load(); }}>Actualizar</button>
        {canManage && <button className={`${button} bg-accent-600 text-white`} type="button" disabled={busy || state.status !== 'ready'} onClick={() => { setForm(empty()); setError(''); setNotice(''); }}>Nueva política</button>}</>} />
    {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
    <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Una ausencia se muestra como «Sin configurar». Una tasa de 0% debe guardarse explícitamente. Configurar tratamientos no acredita validez fiscal.</p>
    {state.status === 'loading' ? <p role="status">Cargando políticas…</p> : state.status === 'ready' && <>
      {form && canManage && <form onSubmit={save} className="rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-surface-dark-card">
        <h2 className="mb-4 font-semibold">{form.replacesPolicyId ? 'Nueva política de reemplazo' : 'Nueva política'}</h2>
        {form.replacesPolicyId && <p className="mb-3 text-sm">Reemplaza la anterior solo durante la nueva vigencia. Los documentos capturados conservan su tratamiento.</p>}
        <fieldset disabled={busy} className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm">Aerolínea<select required className={field} value={form.airlineId} disabled={!!form.replacesPolicyId} onChange={e => change('airlineId', e.target.value)}><option value="">Seleccione</option>{state.context.airlines.map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label>
          <label className="text-sm">Estación<select required className={field} value={form.stationId} disabled={!!form.replacesPolicyId} onChange={e => change('stationId', e.target.value)}><option value="">Seleccione</option>{state.context.stations.map(s => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label>
          <label className="text-sm">Moneda<select className={field} value={form.currencyCode} disabled={!!form.replacesPolicyId} onChange={e => change('currencyCode', e.target.value)}><option>USD</option><option>DOP</option></select></label>
          <label className="text-sm">Tipo de concepto<select required className={field} value={form.conceptKind} disabled={!!form.replacesPolicyId} onChange={e => change('conceptKind', e.target.value)}><option value="">Seleccione</option>{Object.entries(kinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="text-sm">Código del concepto<input required maxLength={40} className={field} value={form.conceptCode} disabled={!!form.replacesPolicyId} onChange={e => change('conceptCode', e.target.value)} /></label>
          <label className="text-sm">Tratamiento<select required className={field} value={form.treatment} onChange={e => setForm(f => ({ ...f, treatment: e.target.value, rate: '' }))}><option value="">Seleccione</option>{['Taxable', 'Exempt', 'NotSubject'].map(t => <option key={t} value={t}>{taxTreatmentLabel(t)}</option>)}</select></label>
          {form.treatment === 'Taxable' && <label className="text-sm">Tasa (%)<input className={field} required type="number" min="0" max="100" step="0.0001" value={form.rate} onChange={e => change('rate', e.target.value)} /></label>}
          <label className="text-sm">Desde<input className={field} required type="date" value={form.validFrom} onChange={e => change('validFrom', e.target.value)} /></label>
          <label className="text-sm">Hasta (opcional)<input className={field} type="date" min={form.validFrom || undefined} value={form.validTo} onChange={e => change('validTo', e.target.value)} /></label>
          <label className="text-sm md:col-span-2 lg:col-span-3">Fundamento<textarea className={field} required={['Exempt', 'NotSubject'].includes(form.treatment)} minLength={3} maxLength={500} value={form.basis} onChange={e => change('basis', e.target.value)} /></label>
        </fieldset>
        <div className="mt-4 flex gap-2"><button disabled={busy} className={`${button} bg-accent-600 text-white`}>Guardar nueva política</button><button type="button" disabled={busy} className={button} onClick={() => setForm(null)}>Cancelar</button></div>
      </form>}
      {state.policies.length === 0 ? <p className="rounded-xl bg-white p-5 dark:bg-surface-dark-card">Aún no hay políticas de impuestos.</p>
        : <div className="overflow-x-auto rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-surface-dark-card"><table className="w-full text-left text-sm"><caption className="sr-only">Historial de políticas de impuestos</caption><thead className="border-b border-black/10 dark:border-white/10"><tr>{['Concepto', 'Contexto', 'Tratamiento', 'Vigencia', 'Estado', 'Acciones'].map(t => <th key={t} className="p-3">{t}</th>)}</tr></thead><tbody>
          {state.policies.map(p => <tr key={p.id} className="border-b border-black/5 dark:border-white/5"><td className="p-3"><strong>{p.conceptCode}</strong><span className="block text-xs">{kinds[p.conceptKind]}</span></td><td className="p-3">{p.airlineName}<span className="block text-xs">{p.stationCode} · {p.currencyCode}</span></td><td className="p-3">{taxTreatmentLabel(p.treatment)}{p.treatment === 'Taxable' ? ` · ${p.rate}%` : ''}<span className="block max-w-xs break-words text-xs">{p.basis}</span></td><td className="whitespace-nowrap p-3">{p.validFrom}<span className="block text-xs">{p.validTo ?? 'Sin fecha final'}</span></td><td className="p-3"><StatusBadge label={p.status === 'Published' ? 'Publicada' : 'Borrador'} tone={p.status === 'Published' ? 'success' : 'warning'} /></td><td className="p-3">{canManage && (p.status === 'Draft'
            ? <button type="button" disabled={busy} className={button} aria-label={`Publicar ${p.conceptCode}`} onClick={() => void publish(p)}>Publicar</button>
            : <button type="button" disabled={busy} className={button} aria-label={`Reemplazar ${p.conceptCode}`} onClick={() => { setForm({ ...empty(), airlineId: p.airlineId, stationId: p.stationId, currencyCode: p.currencyCode, conceptKind: p.conceptKind, conceptCode: p.conceptCode, replacesPolicyId: p.id, expectedVersion: p.version }); setNotice(''); setError(''); }}>Nueva política de reemplazo</button>)}</td></tr>)}
        </tbody></table></div>}
    </>}
  </div>;
}
