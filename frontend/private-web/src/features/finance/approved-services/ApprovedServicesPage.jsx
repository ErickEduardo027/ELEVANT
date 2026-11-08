import { billingUnitLabel } from '../../../services/billingUnits';
import { useApprovedServicesData } from './useApprovedServicesData';

/** Who marked the charge OCC approved (ADR-0034). */
const CHARGE_SOURCES = { Agent: 'agente', Automatic: 'automático', Occ: 'OCC' };

const BLOCKING_LABELS = {
  approved_evidence_mismatch: 'Evidencia aprobada ausente o distinta',
  service_not_completed: 'Servicio no completado',
  no_executed_quantity: 'Sin cantidad ejecutada',
  missing_frozen_rate: 'Sin tarifa congelada',
  // 3-N11 and 3-N29: OCC excluded the service in the review, or it carries a charge its contract excludes.
  excluded_in_review: 'Excluido por OCC en la revisión',
  charge_excluded_by_contract: 'Lleva un cargo que el contrato excluye: pida a OCC reabrir la revisión',
  invalid_currency: 'Moneda inválida',
  invalid_billing_unit: 'Unidad de cobro inválida',
  invalid_amount: 'Importe fuera de rango',
};

function money(value, currency) {
  if (value === null || value === undefined || !currency) return '—';
  return new Intl.NumberFormat('es-DO', {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 4,
  }).format(value);
}

function date(value) {
  return new Intl.DateTimeFormat('es-DO', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

export default function ApprovedServicesPage({ initialStationId }) {
  const data = useApprovedServicesData(initialStationId);

  return (
    <div className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Finanzas</p>
          <h1 className="mt-1 text-2xl font-bold">Servicios aprobados</h1>
          <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Evidencia de servicios de operaciones aprobadas por OCC. La estimación individual usa la tarifa congelada; la prefactura aplica paquetes, mínimos, cargos e impuestos configurados.
          </p>
        </div>
        <button type="button" onClick={data.createDraft}
          disabled={!data.selectedCount || data.draftStatus === 'creating' || data.status !== 'success'}
          className="rounded-xl bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50">
          {data.draftStatus === 'creating' ? 'Guardando prefactura…' : 'Crear prefactura'}
        </button>
      </header>

      {data.selectedCount > 0 && <p role="status" className="text-sm text-text-secondary-light">
        {data.selectedCount} servicio{data.selectedCount === 1 ? '' : 's'} seleccionado{data.selectedCount === 1 ? '' : 's'}.
        Solo pueden agruparse líneas de la misma aerolínea y moneda.
      </p>}
      {data.draftStatus === 'conflict' && <p role="alert" className="rounded-xl bg-status-warning/10 p-4 text-sm">
        Uno de estos servicios ya pertenece a una prefactura, o la clave del intento cambió. Actualizamos la lista para que puedas revisar el borrador existente.
      </p>}
      {data.draftStatus === 'error' && <p role="alert" className="rounded-xl bg-status-danger/10 p-4 text-sm">
        No se pudo confirmar la creación. Puedes reintentar con la misma selección; se conservará la clave de este intento.
      </p>}
      {data.draftStatus === 'detail-error' && <div role="alert" className="rounded-xl bg-status-warning/10 p-4 text-sm">
        La prefactura quedó guardada, pero no se pudo cargar el detalle.
        <button type="button" onClick={() => data.openDraft(data.draftId)} className="ml-2 font-semibold underline">Reintentar detalle</button>
      </div>}
      {data.draftStatus === 'loading-detail' && <p role="status">Cargando prefactura guardada…</p>}
      {data.draftDetail && <section aria-label="Prefactura guardada"
        className="rounded-2xl border border-accent-600/20 bg-accent-600/5 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-600">Prefactura guardada</p>
        <h2 className="mt-1 text-lg font-bold">{data.draftDetail.airlineName}</h2>
        <p className="mt-1 text-sm">{data.draftDetail.lines.length} línea{data.draftDetail.lines.length === 1 ? '' : 's'} · {money(data.draftDetail.total, data.draftDetail.currencyCode)} · {data.draftDetail.status}</p>
        <p className="mt-2 text-xs text-text-secondary-light">Borrador interno de prueba. Aún no es factura ni recibo fiscal.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="table-stack w-full min-w-[620px] text-left text-sm">
            <caption className="sr-only">Líneas guardadas con la evidencia y tarifa congeladas</caption>
            <thead className="border-b border-accent-600/20 text-xs uppercase text-text-secondary-light">
              <tr><th className="py-2 pr-3">Operación</th><th className="px-3 py-2">Servicio</th>
                <th className="px-3 py-2 text-right">Ejecutado</th><th className="px-3 py-2 text-right">Tarifa</th>
                <th className="py-2 pl-3 text-right">Importe</th></tr>
            </thead>
            <tbody className="divide-y divide-accent-600/10">
              {data.draftDetail.lines.map(line => <tr key={line.id}>
                <td className="py-2 pr-3"><span className="block font-mono text-xs">{line.operationCode}</span>
                  <span className="block text-xs text-text-secondary-light">{date(line.operationDate)}</span></td>
                <td className="px-3 py-2"><span className="block font-semibold">{line.serviceName}</span>
                  <span className="block font-mono text-xs text-text-secondary-light">{line.serviceCode}</span></td>
                <td className="px-3 py-2 text-right">{line.executedQuantity} {billingUnitLabel(line.billingUnit)}</td>
                <td className="px-3 py-2 text-right">{money(line.unitPrice, line.currencyCode)}</td>
                <td className="py-2 pl-3 text-right font-semibold">{money(line.amount, line.currencyCode)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-text-secondary-light">Estimación individual antes de paquetes, cargos e impuestos. El detalle de prefactura muestra la valoración final y sus fuentes, con cuatro decimales.</p>
      </section>}

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
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2 xl:col-span-5">
            <span className="text-xs font-semibold">Semana de domingo a sábado:</span>
            <button type="button" onClick={() => data.setWeek(-1)}
              className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold dark:border-white/10">Semana pasada</button>
            <button type="button" onClick={() => data.setWeek(0)}
              className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold dark:border-white/10">Esta semana</button>
          </div>
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
              ? <div className="overflow-x-auto"><table className="table-stack w-full text-left text-sm">
                <thead className="bg-black/[0.025] text-xs uppercase text-text-secondary-light dark:bg-white/[0.025]"><tr>
                  <th className="px-3 py-3">Elegir</th>
                  <th className="px-5 py-3">Servicio</th><th className="px-5 py-3">Aerolínea / vuelo</th>
                  <th className="px-5 py-3">Contrato</th><th className="px-5 py-3">Fecha</th>
                  <th className="px-5 py-3">Ejecutado</th><th className="px-5 py-3 text-right">Importe</th>
                  <th className="px-5 py-3">Facturabilidad</th>
                </tr></thead>
                <tbody className="divide-y divide-black/5 dark:divide-white/5">
                  {data.services.map(item => <tr key={item.id}>
                    <td className="px-3 py-4"><input type="checkbox" aria-label={`Seleccionar ${item.serviceName}`}
                      checked={data.selectedIds.includes(item.id)} disabled={!data.canSelect(item)}
                      onChange={() => data.toggleSelection(item.id)} /></td>
                    <td className="px-5 py-4"><span className="block font-semibold">{item.serviceName}</span>
                      <span className="font-mono text-[11px] text-text-secondary-light">{item.serviceCode} · {item.id}</span>
                      {(item.charges ?? []).length > 0 && <span className="mt-1 flex flex-wrap gap-1">
                        {item.charges.map((charge, index) => (
                          <span key={`${charge.code}:${index}`} className="rounded-full bg-status-warning/10 px-2 py-0.5 text-[11px] font-semibold"
                            title={CHARGE_SOURCES[charge.source] ?? charge.source}>{charge.code} · {CHARGE_SOURCES[charge.source] ?? charge.source}</span>
                        ))}
                      </span>}</td>
                    <td className="px-5 py-4">{item.airlineName}<span className="block text-xs text-text-secondary-light">{item.flightNumber || item.operationCode}</span></td>
                    <td className="px-5 py-4 font-mono text-xs">{item.contractCode || 'Sin referencia'}</td>
                    <td className="px-5 py-4">{date(item.operationDate)}</td>
                    <td className="px-5 py-4">{item.executedQuantity} {billingUnitLabel(item.billingUnit)}</td>
                    <td className="px-5 py-4 text-right font-semibold">{money(item.amount, item.frozenCurrency)}</td>
                    <td className="px-5 py-4">{item.preinvoiceId
                      ? <button type="button" onClick={() => data.openDraft(item.preinvoiceId)}
                        className="text-xs font-semibold text-accent-600 underline">Ver prefactura guardada</button>
                      : item.ready
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
