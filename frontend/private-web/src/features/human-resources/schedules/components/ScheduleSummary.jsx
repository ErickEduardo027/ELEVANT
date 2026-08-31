import KpiCard from '../../../../components/KpiCard';
import { UsersIcon, ClockIcon, AlertTriangleIcon } from '../../../shell/components/icons';

// Resumen superior del calendario de turnos (skill.md §"CALENDARIO DE
// TURNOS": "agentes programados", "agentes en turno de madrugada", "alertas
// de cobertura"), reutilizando KpiCard tal cual — mismo patrón que
// PermitSummary/QualificationSummary.
export default function ScheduleSummary({ kpis, loading }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <KpiCard
        label="Agentes programados esta semana"
        value={kpis.scheduledAgentsCount}
        icon={UsersIcon}
        loading={loading}
      />
      <KpiCard
        label="Agentes en turno de madrugada"
        value={kpis.nightShiftAgentsCount}
        icon={ClockIcon}
        loading={loading}
      />
      <KpiCard
        label="Alertas de cobertura hoy"
        value={kpis.coverageAlertsCount}
        icon={AlertTriangleIcon}
        tone={kpis.coverageAlertsCount > 0 ? 'danger' : 'default'}
        emphasize={kpis.coverageAlertsCount > 0}
        loading={loading}
      />
    </div>
  );
}
