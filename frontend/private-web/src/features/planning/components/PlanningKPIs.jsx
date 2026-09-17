import KpiCard from '../../../components/KpiCard';
import { PlaneIcon, ChecklistIcon, MapPinIcon } from '../../dashboard/components/icons';

export default function PlanningKPIs({ kpis, loading = false }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Escalas operativas" value={kpis.turnarounds} icon={PlaneIcon} loading={loading} />
      <KpiCard label="Tramos de vuelo" value={kpis.flightLegs} icon={PlaneIcon} loading={loading} />
      <KpiCard
        label="Pendientes de recursos"
        value={kpis.pendingAssignment}
        icon={ChecklistIcon}
        loading={loading}
        tone={kpis.pendingAssignment > 0 ? 'signal' : 'default'}
      />
      <KpiCard label="Posiciones asignadas" value={kpis.positionsAssigned} icon={MapPinIcon} loading={loading} />
    </div>
  );
}
