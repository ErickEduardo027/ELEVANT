import KpiCard from '../../dashboard/components/KpiCard';
import { PlaneIcon, ChecklistIcon, MapPinIcon, AlertTriangleIcon } from '../../dashboard/components/icons';

export default function PlanningKPIs({ kpis, loading = false }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Vuelos del día" value={kpis.flightsToday} icon={PlaneIcon} loading={loading} />
      <KpiCard
        label="Pendientes de asignación"
        value={kpis.pendingAssignment}
        icon={ChecklistIcon}
        loading={loading}
        tone={kpis.pendingAssignment > 0 ? 'signal' : 'default'}
      />
      <KpiCard label="Posiciones ocupadas" value={kpis.positionsOccupied} icon={MapPinIcon} loading={loading} />
      <KpiCard
        label="Conflictos detectados"
        value={kpis.conflicts}
        icon={AlertTriangleIcon}
        loading={loading}
        tone={kpis.conflicts > 0 ? 'signal' : 'default'}
      />
    </div>
  );
}
