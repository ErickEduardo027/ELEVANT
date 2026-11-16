import { useEffect, useMemo, useState } from 'react';
import { readSession } from '../../auth/authService';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { billingUnitLabel } from '../../../services/billingUnits';
import { getFinanceTariffs } from '../../../services/financeTariffsService';
import { abortForEffectCleanup, isAbortError } from '../../../lib/abort';

function date(value) {
  return value ?? 'Sin vencimiento';
}

export default function TariffsPage({ initialStationId, embedded = false }) {
  const session = useMemo(() => readSession(), []);
  const stations = useMemo(() => (session?.stationScopes ?? [])
    .filter(scope => scope?.stationId && scope?.stationCode), [session]);
  const [stationId, setStationId] = useState(
    stations.some(scope => scope.stationId === initialStationId)
      ? initialStationId : stations[0]?.stationId ?? '');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ status: stationId ? 'loading' : 'forbidden', data: null });

  useEffect(() => {
    if (!stationId) {
      setState({ status: 'forbidden', data: null });
      return undefined;
    }
    const controller = new AbortController();
    setState({ status: 'loading', data: null });
    getFinanceTariffs({ stationId, page, limit: 20 }, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setState({ status: 'success', data });
      })
      .catch(error => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState({ status: error?.status === 401 ? 'unauthorized' :
          error?.status === 403 || error?.status === 404 ? 'forbidden' : 'error', data: null });
      });
    return () => abortForEffectCleanup(controller);
  }, [stationId, page, revision]);

  useEffect(() => {
    if (!session?.accountId || !stationId) return undefined;
    const refresh = () => setRevision(value => value + 1);
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('finance_tariffs')) refresh();
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
  }, [session?.accountId, stationId]);

  return <div className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div hidden={embedded}>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Finanzas</p>
        <h1 className="mt-1 text-2xl font-bold">Tarifas contractuales</h1>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
          Tarifas de versiones publicadas para la estación autorizada. Los importes históricos de operaciones y facturas permanecen congelados.
        </p>
      </div>
      {stations.length > 0 && <label className="text-xs font-semibold">Estación
        <select aria-label="Estación de tarifas" value={stationId}
          onChange={event => { setStationId(event.target.value); setPage(1); }}
          className="mt-1 block rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:bg-surface-dark-card">
          {stations.map(scope => <option key={scope.stationId} value={scope.stationId}>
            {scope.stationCode}</option>)}
        </select>
      </label>}
    </header>

    {['error', 'forbidden', 'unauthorized'].includes(state.status) && <div role="alert"
      className="rounded-2xl border border-status-danger/30 bg-white/70 p-5 dark:bg-surface-dark-card">
      <p className="font-semibold text-status-danger">{state.status === 'forbidden'
        ? 'No hay una estación financiera autorizada para consultar tarifas.'
        : state.status === 'unauthorized' ? 'La sesión expiró. Vuelva a iniciar sesión.'
          : 'No se pudieron cargar las tarifas contractuales.'}</p>
      {state.status === 'error' && <button type="button" onClick={() => setRevision(value => value + 1)}
        className="mt-3 rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white">Reintentar</button>}
    </div>}

    {state.status === 'loading' && <p role="status"
      className="rounded-xl bg-white/70 p-5 text-sm dark:bg-surface-dark-card">Cargando tarifas…</p>}

    {state.status === 'success' && <>
      <p className="text-xs text-text-secondary-light">Página {page} · hasta 20 tarifas por página · solo lectura</p>
      {state.data.tariffs.length ? <section className="overflow-x-auto rounded-2xl border border-black/5 bg-white/70 shadow-sm dark:border-white/5 dark:bg-surface-dark-card">
        <table className="table-stack w-full min-w-[940px] text-left text-sm">
          <thead className="bg-black/[0.025] text-xs uppercase text-text-secondary-light dark:bg-white/[0.025]">
            <tr><th className="px-5 py-3">Aerolínea</th><th className="px-5 py-3">Servicio</th>
              <th className="px-5 py-3">Contrato</th><th className="px-5 py-3">Tarifa publicada</th>
              <th className="px-5 py-3">Versión</th><th className="px-5 py-3">Vigencia</th></tr>
          </thead><tbody className="divide-y divide-black/5 dark:divide-white/5">
            {state.data.tariffs.map(item => <tr key={item.id}>
              <td className="px-5 py-4 font-semibold">{item.airlineName}</td>
              <td className="px-5 py-4">{item.serviceName}<span className="block text-xs text-text-secondary-light">{item.serviceCode}</span></td>
              <td className="px-5 py-4 font-mono text-xs">{item.contractCode}</td>
              <td className="px-5 py-4 font-semibold">{item.currencyCode} <span>{Number(item.unitPrice).toFixed(4)}</span>
                <span className="block text-xs font-normal text-text-secondary-light">Por {billingUnitLabel(item.billingUnit)} · mínimo {item.minimumQuantity}</span></td>
              <td className="px-5 py-4">{item.versionNumber} · {item.versionStatus === 'Superseded' ? 'Histórica' : 'Aprobada'}</td>
              <td className="px-5 py-4">{date(item.validFrom)} — {date(item.validTo)}</td>
            </tr>)}
          </tbody>
        </table>
      </section> : <p className="rounded-xl border p-8 text-center">No hay tarifas publicadas para esta estación en esta página.</p>}
      <nav aria-label="Páginas de tarifas" className="flex items-center justify-between text-sm">
        <button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)}
          className="rounded-lg border px-3 py-2 disabled:opacity-40">Página anterior</button>
        <span>Página {page}</span>
        <button type="button" disabled={!state.data.hasMore} onClick={() => setPage(value => value + 1)}
          className="rounded-lg border px-3 py-2 disabled:opacity-40">Siguiente página</button>
      </nav>
    </>}
  </div>;
}
