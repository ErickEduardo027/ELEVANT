'use client';

import { useCallback, useEffect, useState } from 'react';
import PageHeader from '../../../components/PageHeader';
import StackedTable from '../../../components/StackedTable';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { readSession } from '../../auth/authService';
import { formatTreasuryMoney as money, getTreasuryOptions, getTreasuryStatement, treasuryError, treasuryToday } from '../../../services/financeTreasuryService';

const field = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';
const button = 'min-h-[40px] rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
const labels = { Receipt: 'Cobro', Application: 'Aplicación', ApplicationReversal: 'Reverso de aplicación', ReceiptReversal: 'Reverso de cobro', Refund: 'Devolución',
  Invoice: 'Factura', LegacyPayment: 'Pago histórico', LegacyCredit: 'Crédito histórico', Credit: 'Nota de crédito', Debit: 'Nota de débito' };

export default function StatementPage({ initialStationId, initialAirlineId = '', onOpenInvoice, onOpenReceipt }) {
  const { access } = useDepartmentAccess(); const canRead = Boolean(access?.can('finance.receipts.read'));
  const [filters, setFilters] = useState(() => ({ asOf: treasuryToday(), stationId: initialStationId ?? readSession()?.stationScopes?.[0]?.stationId ?? '', airlineId: initialAirlineId }));
  const [query, setQuery] = useState(filters); const [options, setOptions] = useState(null);
  const [data, setData] = useState(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const load = useCallback(signal => {
    if (!canRead) return Promise.resolve();
    return Promise.all([getTreasuryOptions({ signal }), getTreasuryStatement(query, { signal })]).then(
      ([refs, statement]) => { if (!signal?.aborted) { setOptions(refs); setData(statement); setError(''); } },
      failure => { if (!signal?.aborted) { setData(null); setError(treasuryError(failure)); } },
    ).finally(() => { if (!signal?.aborted) setLoading(false); });
  }, [canRead, query]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load, revision]);
  function submit(event) {
    event.preventDefault();
    if (!filters.asOf || filters.asOf > treasuryToday()) { setError('Seleccione una fecha de corte válida.'); return; }
    setLoading(true); setQuery({ ...filters }); setRevision(value => value + 1);
  }
  if (!canRead) return <p role="alert">No tiene permiso para consultar estados de cuenta.</p>;
  return <div className="mx-auto max-w-[1440px] space-y-5">
    <PageHeader eyebrow="Finanzas" title="Estado de cuenta" description="Saldos, movimientos y antigüedad a una fecha de corte, separados por moneda." />
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="text-xs font-semibold">Fecha de corte<input required type="date" value={filters.asOf} max={treasuryToday()} onChange={event => setFilters(current => ({ ...current, asOf: event.target.value }))} className={field} /></label>
      <label className="text-xs font-semibold">Estación<select value={filters.stationId} onChange={event => setFilters(current => ({ ...current, stationId: event.target.value }))} className={field}><option value="">Todas mis estaciones</option>{options?.stations?.map(s => <option key={s.id} value={s.id}>{s.code}</option>)}</select></label>
      <label className="text-xs font-semibold">Aerolínea<select value={filters.airlineId} onChange={event => setFilters(current => ({ ...current, airlineId: event.target.value }))} className={field}><option value="">Todas</option>{options?.airlines?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <button type="submit" className={button} disabled={loading}>Consultar estado</button>
    </form>
    {error && <div role="alert" className="space-y-2 rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger"><p>{error}</p><button type="button" onClick={() => { setLoading(true); setRevision(value => value + 1); }} className="font-semibold">Reintentar consulta</button></div>}
    {loading && <p role="status">Cargando estado de cuenta…</p>}
    {data && !loading && <>
      <p className="text-sm font-semibold">Corte: {data.asOf} · Fechas de registro y movimiento hasta el cierre del día UTC.</p>
      {!data.aging.length ? <p className="rounded-xl border border-black/10 p-6 text-sm dark:border-white/10">No hay documentos ni movimientos para este corte.</p> : data.aging.map(group => <section key={group.currencyCode} className="space-y-2" aria-label={'Antigüedad ' + group.currencyCode}>
        <h2 className="text-base font-semibold">{group.currencyCode}</h2>
        <StackedTable className="rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-surface-dark-card"><table className="table-stack w-full min-w-[760px] text-left text-sm"><thead><tr>{['Saldo', 'Vigente', '1–30 días', '31–60 días', '61–90 días', 'Más de 90 días', 'Remanente sin aplicar', 'Crédito a favor'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead>
          <tbody><tr>{[group.balance, group.current, group.days1To30, group.days31To60, group.days61To90, group.days91Plus, group.unallocated, group.creditBalance].map((value, index) => <td key={index} className="p-3 tabular-nums">{money(value, group.currencyCode)}</td>)}</tr></tbody></table></StackedTable>
      </section>)}
      {data.invoices.length > 0 && <section className="space-y-2"><h2 className="font-semibold">Facturas al corte</h2><StackedTable className="rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-surface-dark-card"><table className="table-stack w-full min-w-[800px] text-left text-sm">
        <thead><tr>{['Factura', 'Vencimiento', 'Facturado', 'Pagos históricos', 'Créditos históricos', 'Aplicado', 'Notas crédito / débito', 'Saldo', 'Antigüedad'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>
          {data.invoices.map(i => <tr key={i.id} className="border-t border-black/5 dark:border-white/5"><td className="p-3">{onOpenInvoice ? <button type="button" className="min-h-[36px] font-semibold text-accent-600" onClick={() => onOpenInvoice(i.id)}>{i.number}</button> : i.number}</td>
            <td className="p-3">{i.dueDate ?? 'Sin fecha'}</td>{[i.total, i.legacyPaid, i.legacyCredited, i.applied].map((value, index) => <td key={index} className="p-3 tabular-nums">{money(value, i.currencyCode)}</td>)}
            <td className="p-3 tabular-nums">{money(i.credited, i.currencyCode)} / {money(i.debited, i.currencyCode)}</td><td className="p-3 font-semibold tabular-nums">{money(i.balance, i.currencyCode)}</td><td className="p-3">{i.agingBucket === 'Current' ? 'Vigente' : i.agingBucket} {i.daysOverdue > 0 && '(' + i.daysOverdue + ' días)'}</td></tr>)}
        </tbody></table></StackedTable></section>}
      {data.receipts.length > 0 && <section className="space-y-2"><h2 className="font-semibold">Cobros y remanentes al corte</h2><ul className="divide-y divide-black/5 rounded-xl border border-black/5 bg-white p-3 text-sm dark:divide-white/5 dark:border-white/5 dark:bg-surface-dark-card">{data.receipts.map(r => <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
        {onOpenReceipt ? <button type="button" className="text-accent-600" onClick={() => onOpenReceipt(r.id)}>{r.reference}</button> : <span>{r.reference}</span>}
        <span>Recibido {money(r.amount, r.currencyCode)} · Disponible {money(r.available, r.currencyCode)}{r.reversed && ' · Revertido'}</span></li>)}</ul></section>}
      {data.movements.length > 0 && <section className="space-y-2"><h2 className="font-semibold">Movimientos al corte</h2><ol className="space-y-2">{data.movements.map(m => <li key={m.id} className="flex flex-wrap justify-between gap-2 rounded-lg border border-black/10 p-3 text-sm dark:border-white/10"><span>{m.effectiveOn} · {labels[m.kind] ?? m.kind} · {m.reference}</span><strong className="tabular-nums">{money(m.amount, m.currencyCode)}</strong></li>)}</ol></section>}
    </>}
  </div>;
}
