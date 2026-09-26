import { useApprovedServicesData } from './useApprovedServicesData';

const BLOCKING_LABELS = {
  approved_evidence_mismatch: 'Evidencia aprobada ausente o distinta',
  service_not_completed: 'Servicio no completado',
  no_executed_quantity: 'Sin cantidad ejecutada',
  missing_frozen_rate: 'Sin tarifa congelada',
  invalid_currency: 'Moneda inválida',
  invalid_billing_unit: 'Unidad de cobro inválida',
};

function money(value, currency) {
  if (value === null || value === undefined || !currency) return '—';
  return new Intl.NumberFormat('es-DO', {
    style: 'currency', currency, maximumFractionDigits: currency === 'DOP' ? 0 : 2,
  }).format(value);
}

function date(value) {
  return new Intl.DateTimeFormat('es-DO', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

export default function ApprovedServicesPage() {
  const data = useApprovedServicesData();

  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Finanzas</p>
        <h1 className="mt-1 text-2xl font-bold">Servicios aprobados</h1>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
          Evidencia de servicios de operaciones aprobadas por OCC. Los importes usan la tarifa congelada en la operación.
        </p>
      </header>

      <section className="rounded-2xl border border-black/5 bg-white/70 p-4 shadow-sm dark:border-white/5 dark:bg-surface-dark-card">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <label className="text-xs font-semibold">Estación
            <select aria-label="Estación de servicios" value={data.stationId}
              onChange={event => data.setStationId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark">
              {data.scopes.map(scope => <option key={scope.stationId} value={scope.stationId}>{scope.stationCode}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold">Desde
            <input aria-label="Servicios desde" type="date" value={data.from}
              onChange={event => data.setFrom(event.target.value)}
              className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark" />
          </label>
          <label className="text-xs font-semibold">Hasta
            <input aria-label="Servicios hasta" type="date" value={data.to}
              onChange={event => data.setTo(event.target.value)}
              className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark" />
          </label>
          <label className="text-xs font-semibold">Buscar
            <input aria-label="Buscar servicios" value={data.query}
              onChange={event => data.setQuery(event.target.value)} placeholder="Vuelo, servicio o contrato"
              className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark" />
          </label>
          <label className="text-xs font-semibold">Aerolínea
            <select aria-label="Filtrar por aerolínea" value={data.airline}
              onChange={event => data.setAirline(event.target.value)}
              className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark">
              <option value="all">Todas</option>
              {data.airlines.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
      </section>

      {data.status === 'invalid-range' && <p role="alert" className="rounded-xl bg-status-warning/10 p-4 text-sm">
        Seleccione un intervalo de hasta 31 días, con «Hasta» posterior o igual a «Desde».
      </p>}
      {data.status === 'forbidden' && <p role="alert" className="rounded-xl bg-status-warning/10 p-4 text-sm">
        Esta sesión no tiene acceso vigente a la estación solicitada.
      </p>}
      {data.status === 'error' && <div role="alert" className="rounded-2xl bg-white p-6 dark:bg-surface-dark-card">
        <p className="font-semibold text-status-danger">No se pudieron cargar los servicios aprobados.</p>
        <button type="button" onClick={data.retry}
          className="mt-3 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Reintentar</button>
      </div>}

      {(data.status === 'loading' || data.status === 'success') &&
        <section className="overflow-hidden rounded-2xl border border-black/5 bg-white/70 shadow-sm dark:border-white/5 dark:bg-surface-dark-card">
          {data.status === 'loading'
            ? <div data-testid="approved-services-loading" className="h-64 animate-pulse bg-black/[0.03] dark:bg-white/[0.03]" />
            : data.services.length
              ? <div className="overflow-x-auto"><table className="w-full text-left text-sm">
                <thead className="bg-black/[0.025] text-xs uppercase text-text-secondary-light dark:bg-white/[0.025]"><tr>
                  <th className="px-5 py-3">Servicio</th><th className="px-5 py-3">Aerolínea / vuelo</th>
                  <th className="px-5 py-3">Contrato</th><th className="px-5 py-3">Fecha</th>
                  <th className="px-5 py-3">Ejecutado</th><th className="px-5 py-3 text-right">Importe</th>
                  <th className="px-5 py-3">Facturabilidad</th>
                </tr></thead>
                <tbody className="divide-y divide-black/5 dark:divide-white/5">
                  {data.services.map(item => <tr key={item.id}>
                    <td className="px-5 py-4"><span className="block font-semibold">{item.serviceName}</span>
                      <span className="font-mono text-[11px] text-text-secondary-light">{item.serviceCode} · {item.id}</span></td>
                    <td className="px-5 py-4">{item.airlineName}<span className="block text-xs text-text-secondary-light">{item.flightNumber || item.operationCode}</span></td>
                    <td className="px-5 py-4 font-mono text-xs">{item.contractCode || 'Sin referencia'}</td>
                    <td className="px-5 py-4">{date(item.operationDate)}</td>
                    <td className="px-5 py-4">{item.executedQuantity} {item.billingUnit}</td>
                    <td className="px-5 py-4 text-right font-semibold">{money(item.amount, item.frozenCurrency)}</td>
                    <td className="px-5 py-4">{item.ready
                      ? <span className="rounded-full bg-status-success/10 px-2.5 py-1 text-xs font-semibold text-status-success">Lista para prefactura</span>
                      : <span className="rounded-full bg-status-warning/10 px-2.5 py-1 text-xs font-semibold text-amber-700">{BLOCKING_LABELS[item.blockingReason] || 'Requiere revisión'}</span>}</td>
                  </tr>)}
                </tbody>
              </table></div>
              : <p className="p-6 text-sm text-text-secondary-light">{data.totalServices
                ? 'Ningún servicio coincide con los filtros.'
                : 'No hay servicios aprobados para esta estación y período.'}</p>}
        </section>}
      {data.status === 'success' && data.hasMore && <p role="status" className="text-xs text-text-secondary-light">
        Se muestran los primeros 200 servicios. Acote el intervalo para ver los demás.
      </p>}
    </div>
  );
}
