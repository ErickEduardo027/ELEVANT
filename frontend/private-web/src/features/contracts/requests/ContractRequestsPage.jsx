import { useState } from 'react';
import { RequestIcon } from '../components/icons';
import RequestDetailModal from './RequestDetailModal';
import { useContractRequestsData } from './useContractRequestsData';

const TYPE_LABELS = { additionalService: 'Servicio adicional', affiliation: 'Afiliación' };
const STATUS_META = {
  pending: { label: 'Pendiente', classes: 'bg-status-warning/15 text-amber-700 dark:text-status-warning' },
  inReview: { label: 'En revisión', classes: 'bg-accent-600/10 text-accent-600' },
  approved: { label: 'Aprobada', classes: 'bg-status-success/10 text-status-success' },
  rejected: { label: 'Rechazada', classes: 'bg-status-danger/10 text-status-danger' },
};

function formatDateTime(value) {
  return new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function ContractRequestsPage() {
  const requestsData = useContractRequestsData();
  const [selectedId, setSelectedId] = useState(null);
  const selectedRequest = requestsData.data.find(request => request.id === selectedId) ?? null;

  if (requestsData.status === 'error') {
    return <div role="alert" className="rounded-2xl border border-status-danger/30 bg-white/70 p-6 dark:bg-surface-dark-card"><p className="font-semibold text-status-danger">No se pudieron cargar las solicitudes.</p><p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">{requestsData.error?.message}</p><button type="button" onClick={requestsData.retry} className="mt-4 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Reintentar</button></div>;
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Gestión contractual</p>
        <h1 className="mt-1 text-2xl font-bold text-ink-900 dark:text-text-primary-dark">Solicitudes</h1>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">Evalúa solicitudes de servicios adicionales y afiliaciones recibidas.</p>
      </header>

      <section className="rounded-2xl border border-black/5 bg-white/70 p-4 shadow-sm backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_210px_190px_auto]">
          <label><span className="sr-only">Buscar solicitud</span><input type="search" value={requestsData.query} onChange={event => requestsData.setQuery(event.target.value)} placeholder="Buscar por solicitud, aerolínea o correo…" className="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm outline-none focus:border-accent-600 dark:border-white/10 dark:bg-surface-dark" /></label>
          <label><span className="sr-only">Filtrar por tipo</span><select aria-label="Filtrar por tipo" value={requestsData.typeFilter} onChange={event => requestsData.setTypeFilter(event.target.value)} className="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm dark:border-white/10 dark:bg-surface-dark"><option value="all">Todos los tipos</option><option value="additionalService">Servicios adicionales</option><option value="affiliation">Afiliaciones</option></select></label>
          <label><span className="sr-only">Filtrar por estado</span><select aria-label="Filtrar por estado" value={requestsData.statusFilter} onChange={event => requestsData.setStatusFilter(event.target.value)} className="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm dark:border-white/10 dark:bg-surface-dark"><option value="all">Todos los estados</option><option value="pending">Pendientes</option><option value="inReview">En revisión</option><option value="approved">Aprobadas</option><option value="rejected">Rechazadas</option></select></label>
          <div className="flex items-center justify-end text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">{requestsData.requests.length} solicitudes</div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-black/5 bg-white/70 shadow-sm dark:border-white/5 dark:bg-surface-dark-card">
        {requestsData.status === 'loading' ? <div data-testid="requests-list-skeleton" className="h-80 animate-pulse bg-black/[0.03] dark:bg-white/[0.03]" /> : requestsData.requests.length ? (
          <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-black/[0.025] text-xs uppercase tracking-wide text-text-secondary-light dark:bg-white/[0.025] dark:text-text-secondary-dark"><tr><th className="px-5 py-3">Solicitud</th><th className="px-5 py-3">Aerolínea</th><th className="px-5 py-3">Tipo</th><th className="px-5 py-3">Recibida</th><th className="px-5 py-3">Estado</th><th className="px-5 py-3 text-right">Acción</th></tr></thead><tbody className="divide-y divide-black/5 dark:divide-white/5">{requestsData.requests.map(request => { const meta = STATUS_META[request.status]; return <tr key={request.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"><td className="px-5 py-4"><span className="flex items-center gap-2 font-mono text-xs font-semibold"><RequestIcon className="h-4 w-4 text-accent-600" />{request.id}</span></td><td className="px-5 py-4"><span className="block font-semibold">{request.airline}</span><span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{request.contactEmail}</span></td><td className="px-5 py-4">{TYPE_LABELS[request.type]}</td><td className="px-5 py-4 text-text-secondary-light dark:text-text-secondary-dark">{formatDateTime(request.receivedAt)}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${meta.classes}`}>{meta.label}</span></td><td className="px-5 py-4 text-right"><button type="button" onClick={() => setSelectedId(request.id)} className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-accent-600 hover:bg-accent-600/5 dark:border-white/10">{['approved', 'rejected'].includes(request.status) ? 'Ver resultado' : 'Revisar'}</button></td></tr>; })}</tbody></table></div>
        ) : <div className="flex flex-col items-center px-6 py-16 text-center"><RequestIcon className="h-10 w-10 text-text-secondary-light/50" /><h2 className="mt-3 font-semibold">No se encontraron solicitudes</h2><p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">Cambia los filtros para consultar otros registros.</p></div>}
      </section>

      <RequestDetailModal request={selectedRequest} onClose={() => setSelectedId(null)} onBeginReview={requestsData.beginReview} onResolve={requestsData.resolveRequest} />
    </div>
  );
}
