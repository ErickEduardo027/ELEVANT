'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { applyPreinvoiceTaxes, createTaxCommand, financeTaxError, getPreinvoiceTaxes, taxMoney, taxTreatmentLabel } from '../../../services/financeTaxService';

export default function PreinvoiceTaxesPanel({ preinvoiceId, status, onChanged }) {
  const { access } = useDepartmentAccess(); const canRead = access?.can('finance.taxes.read') ?? false;
  const canManage = access?.can('finance.taxes.manage') ?? false;
  const [data, setData] = useState(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [run] = useState(createTaxCommand);
  const loadSequence = useRef({ value: 0 });
  const mutationGeneration = useRef(0);
  useEffect(() => () => { mutationGeneration.current++; }, [preinvoiceId]);
  const load = useCallback(async () => {
    if (!canRead) return;
    const sequenceState = loadSequence.current;
    const sequence = ++sequenceState.value;
    try { const next = await getPreinvoiceTaxes(preinvoiceId); if (sequence === sequenceState.value) { setData(next); setError(''); } }
    catch (e) { if (sequence === sequenceState.value) setError(financeTaxError(e)); }
    finally { if (sequence === sequenceState.value) setLoading(false); }
  }, [canRead, preinvoiceId]);
  useEffect(() => {
    const sequenceState = loadSequence.current;
    let active = true;
    queueMicrotask(() => { if (active) void load(); });
    return () => { active = false; sequenceState.value++; };
  }, [load]);
  async function apply() {
    const generation = mutationGeneration.current;
    setBusy(true); setError('');
    try {
      await run(`apply:${preinvoiceId}`, { expectedVersion: data.version }, body => applyPreinvoiceTaxes(preinvoiceId, body));
      if (generation !== mutationGeneration.current) return;
      await load();
      if (generation === mutationGeneration.current) await onChanged?.();
    } catch (e) { if (generation === mutationGeneration.current) setError(financeTaxError(e)); }
    finally { if (generation === mutationGeneration.current) setBusy(false); }
  }
  if (!canRead) return <p role="alert" className="text-sm">No tiene permiso para consultar impuestos.</p>;
  return <section aria-label="Impuestos de la prefactura" className="space-y-3 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-surface-dark-card">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Impuestos de la prefactura</h2><button type="button" disabled={loading || busy} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" onClick={() => { setLoading(true); void load(); }}>Actualizar impuestos</button></div>
    {error && <p role="alert" className="text-sm text-status-danger">{error}</p>}
    {loading || !error && data?.id !== preinvoiceId ? <p role="status">Cargando impuestos…</p> : data?.id === preinvoiceId && <>
      <p className="text-sm">{data.treatmentsConfigured ? 'Tratamientos configurados.' : 'Hay tratamientos sin configurar. La preparación fiscal requiere tratamientos explícitos.'}</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Concepto', 'Tratamiento', 'Neto', 'Descuento', 'Impuesto', 'Bruto'].map(t => <th key={t} className="p-2">{t}</th>)}</tr></thead><tbody>{data.lines.map(line => <tr key={line.id} className="border-t border-black/5 dark:border-white/10"><td className="p-2">{line.description}<span className="block text-xs">{line.conceptCode}{line.excluded ? ' · Excluida' : ''}</span></td><td className="p-2">{taxTreatmentLabel(line.treatment)}{line.rate != null ? ` · ${line.rate}%` : ''}<span className="block max-w-xs break-words text-xs">{line.basis}</span></td>{['net', 'discount', 'tax', 'gross'].map(key => <td key={key} className="whitespace-nowrap p-2 tabular-nums">{taxMoney(line[key], data.currencyCode)}</td>)}</tr>)}</tbody></table></div>
      {data.lines.length === 0 && <p>No hay líneas para mostrar.</p>}
      <dl className="flex flex-wrap gap-6 text-sm">{[['Neto', 'net'], ['Descuento', 'discount'], ['Impuesto', 'tax'], ['Bruto', 'gross']].map(([label, key]) => <div key={key}><dt>{label}</dt><dd className="font-semibold tabular-nums">{taxMoney(data[key], data.currencyCode)}</dd></div>)}</dl>
      {canManage && status === 'Draft' && !data.treatmentsConfigured && <button type="button" disabled={busy} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void apply()}>Aplicar tratamientos pendientes</button>}
    </>}
  </section>;
}
