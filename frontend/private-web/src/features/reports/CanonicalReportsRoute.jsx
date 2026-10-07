import Link from '../../components/AppLink';
import { OccQueueState, OccStationPicker } from '../admin-occ/OccQueueState';
import { useOccReviewQueue } from '../admin-occ/useOccReviewQueue';

function dateTime(value, timeZone) {
  return new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium', timeStyle: 'short', timeZone })
    .format(new Date(value));
}

function csvCell(value) {
  const string = String(value ?? '');
  // Spreadsheet software must never interpret a DB-backed cell as a formula.
  const safe = /^[\s]*[=+\-@\t\r]/.test(string) ? `'${string}` : string;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function approvedRows(queue) {
  return (queue?.operations ?? []).filter(item => item.status === 'Approved');
}

export function exportVisibleApprovedRows(rows) {
  const header = ['Operación', 'Fecha', 'Aerolínea', 'Agente', 'Enviada UTC', 'Servicios', 'Incidencias', 'Revisión'];
  const csv = [header, ...rows.map(item => [
    item.operationCode, item.operationDate, item.airlineName, item.agentName,
    item.submittedAt, item.serviceCount, item.incidentCount, item.revisionNumber,
  ])].map(row => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'elevant-entregas-aprobadas-visibles.csv';
  link.click();
  URL.revokeObjectURL(url);
}

export default function CanonicalReportsRoute() {
  const queue = useOccReviewQueue();
  const rows = approvedRows(queue.data);
  const timeZone = queue.data?.ianaTimeZone ?? 'UTC';
  return <section className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-5 text-ink-900 dark:text-text-primary-dark">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white/80 p-5 dark:border-white/10 dark:bg-surface-dark-card">
      <div><h1 className="text-xl font-semibold">Reportes operativos</h1><p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Entregas aprobadas por OCC, obtenidas de la API.</p></div>
      {queue.stationScopes.length > 0 && <OccStationPicker stationScopes={queue.stationScopes} stationId={queue.stationId} onChange={queue.setStationId} />}
    </header>
    <OccQueueState queue={queue} />
    {queue.status === 'success' && <>
      <div role="status" className="rounded-xl border border-accent-600/25 bg-accent-600/5 p-4 text-sm">
        Esta es una vista de las {queue.data.operations.length} entregas más recientes de la estación, no un histórico financiero ni un cálculo de SLA.
        {queue.data.hasMore && ' Hay más entregas fuera del límite de 100 de esta consulta; los totales y la exportación son parciales.'}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm"><strong className="text-2xl">{rows.length}</strong> entregas aprobadas visibles</p>
        <button type="button" disabled={rows.length === 0} onClick={() => exportVisibleApprovedRows(rows)} className="min-h-11 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Exportar filas visibles (CSV)</button>
      </div>
      {rows.length === 0 ? <p className="rounded-xl bg-white/80 p-5 dark:bg-surface-dark-card">No hay entregas aprobadas entre las operaciones visibles de esta estación.</p> :
        <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white/80 dark:border-white/10 dark:bg-surface-dark-card"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-black/10 dark:border-white/10"><tr><th className="p-3">Operación</th><th className="p-3">Aerolínea</th><th className="p-3">Agente</th><th className="p-3">Entrega</th><th className="p-3">Servicios</th><th className="p-3">Incidencias</th><th className="p-3">Detalle</th></tr></thead><tbody>{rows.map(item => <tr key={item.operationId} className="border-b border-black/5 dark:border-white/5"><td className="p-3"><strong>{item.operationCode}</strong><br />{item.operationDate}</td><td className="p-3">{item.airlineName}</td><td className="p-3">{item.agentName}</td><td className="p-3">{dateTime(item.submittedAt, timeZone)}</td><td className="p-3">{item.serviceCount}</td><td className="p-3">{item.incidentCount}</td><td className="p-3"><Link className="font-semibold text-accent-600 underline" to={`/admin-occ/review?operationId=${item.operationId}`}>Ver evidencia</Link></td></tr>)}</tbody></table></div>}
    </>}
  </section>;
}
