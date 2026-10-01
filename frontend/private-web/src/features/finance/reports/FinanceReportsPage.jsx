import { useEffect, useMemo, useState } from 'react';
import KpiCard from '../../../components/KpiCard';
import { PreInvoiceIcon, ReconciliationIcon, AlertIcon } from '../components/icons';
import { readSession } from '../../auth/authService';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { getFinanceReport } from '../../../services/financeReportsService';

export default function FinanceReportsPage({ initialStationId }) {
  const session = useMemo(() => readSession(), []);
  const stations = useMemo(() => (session?.stationScopes ?? [])
    .filter(scope => scope?.stationId && scope?.stationCode), [session]);
  const [stationId, setStationId] = useState(
    stations.some(scope => scope.stationId === initialStationId)
      ? initialStationId : stations[0]?.stationId ?? '');
  const [airline, setAirline] = useState('all');
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ status: stationId ? 'loading' : 'forbidden', data: null });
  const rows = state.data?.rows.filter(item => airline === 'all' || item.airlineName === airline) ?? [];
  const airlines = [...new Set(state.data?.rows.map(item => item.airlineName) ?? [])];

  useEffect(() => {
    if (!stationId) {
      setState({ status: 'forbidden', data: null });
      return undefined;
    }
    const controller = new AbortController();
    setState({ status: 'loading', data: null });
    getFinanceReport({ stationId }, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setState({ status: 'success', data });
      })
      .catch(error => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setState({ status: error?.status === 403 || error?.status === 404
          ? 'forbidden' : 'error', data: null });
      });
    return () => controller.abort();
  }, [stationId, revision]);

  useEffect(() => {
    if (!session?.accountId) return undefined;
    const refresh = () => setRevision(value => value + 1);
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('finance_preinvoices')) refresh();
    });
    void observer.start().catch(() => {});
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 25_000);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      void observer.stop();
    };
  }, [session?.accountId]);

  return <div className="mx-auto max-w-[1440px] space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Finanzas</p>
        <h1 className="mt-1 text-2xl font-bold">Reportes financieros</h1>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
          Estado de prefacturas persistidas de la estación autorizada. No incluye conciliación bancaria.
        </p>
      </div>
      {stations.length > 0 && <label className="text-xs font-semibold">Estación
        <select aria-label="Estación del reporte financiero" value={stationId}
          onChange={event => { setStationId(event.target.value); setAirline('all'); }}
          className="mt-1 block rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:bg-surface-dark-card">
          {stations.map(scope => <option key={scope.stationId} value={scope.stationId}>{scope.stationCode}</option>)}
        </select>
      </label>}
    </header>

    {(state.status === 'error' || state.status === 'forbidden') && <div role="alert"
      className="rounded-2xl border border-status-danger/30 bg-white/70 p-5 dark:bg-surface-dark-card">
      <p className="font-semibold text-status-danger">{state.status === 'forbidden'
        ? 'No hay una estación financiera autorizada para este reporte.'
        : 'No se pudo cargar el reporte financiero.'}</p>
      {state.status === 'error' && <button type="button" onClick={() => setRevision(value => value + 1)}
        className="mt-3 rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white">Reintentar</button>}
    </div>}

    {state.status === 'loading' && <p role="status" className="rounded-xl bg-white/70 p-5 text-sm dark:bg-surface-dark-card">Cargando reporte…</p>}

    {state.status === 'success' && <>
      {state.data.hasMore && <p role="status" className="rounded-xl border border-accent-600/20 bg-accent-600/5 px-4 py-3 text-sm">
        Esta vista agrupa hasta 50 prefacturas de la primera página; consulta Pre-facturación para revisar las demás.
      </p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Borradores en consulta" value={state.data.counts.drafts} icon={PreInvoiceIcon} />
        <KpiCard label="Enviadas en consulta" value={state.data.counts.submitted} icon={PreInvoiceIcon} />
        <KpiCard label="Disputadas en consulta" value={state.data.counts.disputed} icon={AlertIcon} tone="signal" />
        <KpiCard label="Facturadas en consulta" value={state.data.counts.invoiced} icon={ReconciliationIcon} />
      </div>
      <section className="overflow-hidden rounded-2xl border border-black/5 bg-white/70 shadow-sm dark:border-white/5 dark:bg-surface-dark-card">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <h2 className="font-semibold">Prefacturas por aerolínea y moneda</h2>
          <select aria-label="Filtrar reporte por aerolínea" value={airline}
            onChange={event => setAirline(event.target.value)}
            className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:bg-surface-dark-card">
            <option value="all">Todas las aerolíneas</option>
            {airlines.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        {rows.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="bg-black/[0.025] text-xs uppercase text-text-secondary-light dark:bg-white/[0.025]">
            <tr><th className="px-5 py-3">Aerolínea</th><th className="px-5 py-3">Moneda</th>
              <th className="px-5 py-3">Borrador</th><th className="px-5 py-3">Enviada</th>
              <th className="px-5 py-3">Disputada</th><th className="px-5 py-3">Aceptada</th>
              <th className="px-5 py-3">Facturada</th><th className="px-5 py-3">Anulada</th></tr>
          </thead><tbody className="divide-y divide-black/5 dark:divide-white/5">
            {rows.map(row => <tr key={`${row.airlineId}-${row.currencyCode}`}>
              <td className="px-5 py-4 font-semibold">{row.airlineName}</td>
              <td className="px-5 py-4">{row.currencyCode}</td>
              <td className="px-5 py-4">{row.drafts}</td>
              <td className="px-5 py-4">{row.submitted}</td>
              <td className="px-5 py-4">{row.disputed}</td>
              <td className="px-5 py-4">{row.accepted}</td>
              <td className="px-5 py-4">{row.invoiced}</td>
              <td className="px-5 py-4">{row.voided}</td>
            </tr>)}
          </tbody>
        </table></div> : <p className="p-5 text-sm text-text-secondary-light">No hay prefacturas en esta consulta.</p>}
      </section>
    </>}
  </div>;
}
