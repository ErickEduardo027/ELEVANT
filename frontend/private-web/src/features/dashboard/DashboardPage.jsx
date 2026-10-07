import KpiCard from '../../components/KpiCard';
import { getPlanningStatusMeta } from '../planning/planningStatus';
import { ChecklistIcon, PlaneIcon, UsersIcon } from './components/icons';

function Panel({ title, action, children }) {
  return <section className="rounded-2xl border border-black/5 bg-white/70 p-5 shadow-sm dark:border-white/5 dark:bg-surface-dark-card">
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {action}
    </div>
    {children}
  </section>;
}

function Action({ children, onClick }) {
  return <button type="button" onClick={onClick}
    className="text-xs font-semibold text-accent-600 hover:underline">{children}</button>;
}

export default function DashboardPage({
  status, data, stationScopes = [], selectedStationId, onStationChange = () => {},
  onRetry = () => {}, onOpenPlanning = () => {}, onOpenReview = () => {},
  onOpenNotifications = () => {},
}) {
  const statusMessage = {
    forbidden: 'No hay una estación OCC autorizada para consultar este panorama.',
    unauthorized: 'La sesión expiró. Vuelva a iniciar sesión.',
    error: 'No se pudo cargar el panorama operativo de la estación.',
  };

  return <div className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">OCC</p>
        <h1 className="mt-1 text-2xl font-bold">Panorama operativo</h1>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
          Planificación del día local de la estación, entregas en revisión y avisos registrados.
        </p>
      </div>
      {stationScopes.length > 0 && <label className="text-xs font-semibold">Estación
        <select aria-label="Estación OCC" value={selectedStationId ?? ''}
          onChange={event => onStationChange(event.target.value)}
          className="mt-1 block rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:bg-surface-dark-card">
          {stationScopes.map(scope => <option key={scope.stationId} value={scope.stationId}>
            {scope.stationCode}</option>)}
        </select>
      </label>}
    </header>

    {statusMessage[status] && <div role="alert"
      className="rounded-xl border border-status-danger/30 bg-white/70 p-5 dark:bg-surface-dark-card">
      <p className="text-sm font-semibold text-status-danger">{statusMessage[status]}</p>
      {status === 'error' && <button type="button" onClick={onRetry}
        className="mt-3 rounded-lg bg-accent-600 px-3 py-2 text-xs font-semibold text-white">Reintentar</button>}
    </div>}

    {status === 'loading' && <p role="status"
      className="rounded-xl bg-white/70 p-5 text-sm dark:bg-surface-dark-card">Cargando panorama operativo…</p>}

    {status === 'success' && <>
      <p className="text-xs text-text-secondary-light">
        Estación {data.stationCode} · fecha local {data.date} · conteos de las consultas mostradas
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Escalas del día en consulta" value={data.turnarounds.length} icon={PlaneIcon} />
        <KpiCard label="Operaciones con agente" value={data.turnarounds
          .filter(item => item.agents.length > 0).length} icon={UsersIcon} />
        <KpiCard label="Entregas en cola visible"
          value={data.reviewHasMore ? `≥${data.reviews.length}` : data.reviews.length}
          icon={ChecklistIcon} />
        <KpiCard label="Avisos visibles sin leer" value={data.notifications
          .filter(item => item.readAt == null).length} icon={ChecklistIcon} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Panel title="Escalas registradas"
          action={<Action onClick={onOpenPlanning}>Abrir planificación</Action>}>
          {data.turnarounds.length ? <ul className="divide-y divide-black/5 dark:divide-white/5">
            {data.turnarounds.slice(0, 8).map(item => <li key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div><p className="font-semibold">{item.operationCode}</p>
                <p className="text-xs text-text-secondary-light">{item.airline.name} · {item.arrival?.flightNumber ?? 'Sin llegada'} → {item.departure?.flightNumber ?? 'Sin salida'}</p>
              </div>
              <span className="text-xs">{getPlanningStatusMeta(item.status).label}</span>
            </li>)}
          </ul> : <p className="py-6 text-center text-sm text-text-secondary-light">
            No hay escalas registradas para esta estación y fecha local.
          </p>}
          {data.turnarounds.length > 8 && <p className="pt-3 text-xs text-text-secondary-light">
            Se muestran las primeras 8 escalas. Abra Planificación para consultar el resto.
          </p>}
        </Panel>
        <div className="space-y-4">
          <Panel title="Entregas pendientes de revisión"
            action={<Action onClick={onOpenReview}>Abrir revisión</Action>}>
            {data.reviews.length ? <ul className="space-y-3">
              {data.reviews.slice(0, 5).map(item => <li key={item.submissionId ?? item.operationId}
                className="rounded-lg border border-black/5 p-3 text-sm dark:border-white/5">
                <span className="font-semibold">{item.operationCode}</span>
                <span className="ml-2 text-text-secondary-light">{item.agentName}</span>
              </li>)}
            </ul> : <p className="py-4 text-sm text-text-secondary-light">No hay entregas pendientes de revisión.</p>}
            {data.reviewHasMore && <p className="mt-3 text-xs text-text-secondary-light">
              Hay más entregas fuera de esta consulta acotada.
            </p>}
          </Panel>
          <Panel title="Avisos de la estación"
            action={<Action onClick={onOpenNotifications}>Abrir notificaciones</Action>}>
            {data.notifications.length ? <ul className="space-y-3">
              {data.notifications.slice(0, 5).map(item => <li key={item.id}
                className="rounded-lg border border-black/5 p-3 text-sm dark:border-white/5">
                <span className="font-semibold">{item.operationCode}</span>
                <span className="ml-2 text-text-secondary-light">{item.kind}</span>
              </li>)}
            </ul> : <p className="py-4 text-sm text-text-secondary-light">No hay avisos visibles de esta estación.</p>}
            {data.notificationsHasMore && <p className="mt-3 text-xs text-text-secondary-light">
              La cuenta tiene más avisos fuera de esta consulta acotada.
            </p>}
          </Panel>
        </div>
      </div>
    </>}
  </div>;
}
