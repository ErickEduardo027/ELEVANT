import { useCallback, useEffect, useState } from 'react';
import EmptyState from '../../../components/EmptyState';
import Modal from '../../../components/Modal';
import PageHeader from '../../../components/PageHeader';
import StackedTable from '../../../components/StackedTable';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { TariffIcon } from '../components/icons';
import LoadFailure, { loadFailure } from '../components/LoadFailure';
import { correctExchangeRate, listExchangeRates, recordExchangeRate } from '../../../services/financeBookService';
import { financeTariffMessage } from '../../../services/financeErrors';

const fieldClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';
const isoDate = date => date.toISOString().slice(0, 10);

/** Daily USD→DOP rates Finance records by hand. Corrections never overwrite: they supersede. */
export default function ExchangeRatesPage() {
  const { access } = useDepartmentAccess();
  const canCreate = Boolean(access?.can('finance.exchange_rates.create'));
  const canManage = Boolean(access?.can('finance.exchange_rates.update'));
  const today = new Date();
  const [range, setRange] = useState({ from: isoDate(new Date(today.getTime() - 30 * 86400000)), to: isoDate(today) });
  const [history, setHistory] = useState(false);
  const [rates, setRates] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  // A period that failed to load shows a recoverable error, never «Sin tasas en el período».
  const [loadError, setLoadError] = useState(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try { setRates(await listExchangeRates(range.from, range.to, history)); setLoadError(null); }
    catch (failure) {
      setRates(null);
      setLoadError(loadFailure(failure, financeTariffMessage(failure, {
        fallback: 'No se pudieron cargar las tasas. Revise la conexión e intente de nuevo.',
        forbidden: 'No tiene permiso para consultar las tasas de cambio.' })));
    }
  }, [range, history]);
  useEffect(() => { void load(); }, [load]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      if (form.correcting) await correctExchangeRate(form.correcting.id, { rate: Number(form.rate), source: form.source, expectedVersion: form.correcting.version });
      else await recordExchangeRate({ rateDate: form.rateDate, fromCurrency: 'USD', toCurrency: 'DOP', rate: Number(form.rate), source: form.source });
      setNotice(form.correcting ? 'Tasa corregida; la anterior queda en el historial.' : 'Tasa registrada.');
      setForm(null);
      await load();
    } catch (failure) {
      setError(financeTariffMessage(failure, { fallback: 'No se pudo guardar la tasa. Intente de nuevo.' }));
    }
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <PageHeader eyebrow="Finanzas" title="Tasas de cambio"
        description="Tasa diaria USD → DOP registrada por Finanzas. Se usa para consolidar reportes y convertir cargos entre monedas."
        actions={canCreate && <button type="button" onClick={() => setForm({ rateDate: isoDate(today), rate: '', source: 'Banco Central RD' })}
          className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Registrar tasa</button>} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold">Desde<input type="date" value={range.from} onChange={event => setRange(current => ({ ...current, from: event.target.value }))} className={fieldClass} /></label>
        <label className="text-xs font-semibold">Hasta<input type="date" value={range.to} onChange={event => setRange(current => ({ ...current, to: event.target.value }))} className={fieldClass} /></label>
        <label className="flex min-h-[40px] items-center gap-2 text-sm"><input type="checkbox" checked={history} onChange={event => setHistory(event.target.checked)} />Incluir correcciones</label>
      </div>
      {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
      {error && !form && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
      <LoadFailure failure={loadError} onRetry={() => { void load(); }} />
      {!rates ? (loadError ? null : <p role="status" className="text-sm">Cargando tasas…</p>) : rates.length === 0 ? (
        <EmptyState icon={TariffIcon} title="Sin tasas en el período" description="Registre la tasa del día para consolidar reportes en USD." />
      ) : (
        <StackedTable className="rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-surface-dark-card">
          <table className="table-stack w-full min-w-[620px] text-left text-sm">
            <thead className="bg-black/[.03] text-xs uppercase text-text-secondary-light dark:bg-white/[.03]"><tr><th className="p-3">Fecha</th><th className="p-3">Tasa</th><th className="p-3">Fuente</th><th className="p-3">Registrada por</th>{canManage && <th className="p-3">Acción</th>}</tr></thead>
            <tbody>{rates.map(rate => (
              <tr key={rate.id} className={`border-t border-black/5 dark:border-white/5 ${rate.isCurrent ? '' : 'opacity-60'}`}>
                <td className="p-3">{rate.rateDate}{!rate.isCurrent && <span className="block text-xs">Reemplazada</span>}</td>
                <td className="p-3 font-semibold tabular-nums">1 {rate.fromCurrency} = {Number(rate.rate).toLocaleString('es-DO', { maximumFractionDigits: 6 })} {rate.toCurrency}</td>
                <td className="p-3 text-xs">{rate.source}</td>
                <td className="p-3 text-xs">{rate.recordedBy}</td>
                {canManage && <td className="p-3">{rate.isCurrent && <button type="button" onClick={() => setForm({ correcting: rate, rate: rate.rate, source: rate.source })} className="min-h-[32px] text-xs font-semibold text-accent-600">Corregir</button>}</td>}
              </tr>
            ))}</tbody>
          </table>
        </StackedTable>
      )}
      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={form?.correcting ? `Corregir tasa del ${form.correcting.rateDate}` : 'Registrar tasa USD → DOP'}
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setForm(null)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" form="exchange-rate-form" className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Guardar</button></div>}>
        {form && (
          <form id="exchange-rate-form" onSubmit={submit} className="space-y-3">
            {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
            {!form.correcting && <label className="block text-xs font-semibold">Fecha<input required type="date" max={isoDate(today)} value={form.rateDate} onChange={event => setForm(current => ({ ...current, rateDate: event.target.value }))} className={fieldClass} /></label>}
            <label className="block text-xs font-semibold">DOP por 1 USD<input required type="number" min="0.000001" step="0.000001" value={form.rate} onChange={event => setForm(current => ({ ...current, rate: event.target.value }))} className={fieldClass} /></label>
            <label className="block text-xs font-semibold">Fuente<input required maxLength={120} value={form.source} onChange={event => setForm(current => ({ ...current, source: event.target.value }))} className={fieldClass} /></label>
          </form>
        )}
      </Modal>
    </div>
  );
}
