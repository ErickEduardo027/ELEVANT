import KpiCard from '../../../components/KpiCard';
import { AlertTriangleIcon, ChecklistIcon, PlaneIcon, ShieldCheckIcon } from '../../dashboard/components/icons';
import { ClockIcon } from './icons';

// KpiCard's numeric slot runs the value through useCountUp, which only accepts
// numbers — a formatted string like "82 min" would silently render as "0". The
// `visual` escape hatch renders arbitrary content, so units are shown with the
// same typography KpiCard uses for its own numeric span.
function TextValue({ children }) {
  return <span className="font-sans text-3xl font-semibold tabular-nums text-ink-900 dark:text-text-primary-dark">{children}</span>;
}

export default function ReportKpiGrid({ kpis, loading = false }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <KpiCard label="Vuelos atendidos" value={kpis.flightsHandled} icon={PlaneIcon} loading={loading} />
      <KpiCard label="Servicios ejecutados" value={kpis.servicesExecuted} icon={ChecklistIcon} loading={loading} />
      <KpiCard
        label="Operaciones con incidencias"
        value={kpis.incidentOperations}
        icon={AlertTriangleIcon}
        loading={loading}
        tone={kpis.incidentOperations > 0 ? 'signal' : 'default'}
      />
      <KpiCard
        label="Tiempo promedio en tierra"
        icon={ClockIcon}
        loading={loading}
        visual={<TextValue>{kpis.avgGroundTimeMinutes} min</TextValue>}
      />
      <KpiCard
        label="Cumplimiento de SLA"
        icon={ShieldCheckIcon}
        loading={loading}
        visual={<TextValue>{kpis.slaCompliancePct}%</TextValue>}
      />
    </div>
  );
}
