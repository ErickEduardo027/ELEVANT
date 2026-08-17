import KpiCard from '../../../../components/KpiCard';
import { ShieldCheckIcon, ClockIcon, AlertTriangleIcon, UsersIcon } from '../../../shell/components/icons';

// Fila de KPIs superior (skill.md §"RESUMEN SUPERIOR"), reutilizando
// KpiCard tal cual — mismo patrón que UserStatsRow. El KPI de vencidas se
// enfatiza (`emphasize`) cuando hay al menos una, igual que en el Dashboard.
export default function QualificationSummary({ kpis, loading }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Habilitaciones vigentes" value={kpis.activeCount} icon={ShieldCheckIcon} loading={loading} />
      <KpiCard
        label="Próximas a vencer"
        value={kpis.expiringSoonCount}
        icon={ClockIcon}
        tone={kpis.expiringSoonCount > 0 ? 'warning' : 'default'}
        loading={loading}
      />
      <KpiCard
        label="Vencidas"
        value={kpis.expiredCount}
        icon={AlertTriangleIcon}
        tone="danger"
        loading={loading}
        emphasize={kpis.expiredCount > 0}
      />
      <KpiCard
        label="Agentes con alguna habilitación vencida"
        value={kpis.agentsWithExpiredCount}
        icon={UsersIcon}
        tone={kpis.agentsWithExpiredCount > 0 ? 'danger' : 'default'}
        loading={loading}
      />
    </div>
  );
}
