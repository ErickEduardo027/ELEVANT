import KpiCard from '../../../../components/KpiCard';
import { ShieldCheckIcon, ClockIcon, AlertTriangleIcon } from '../../../shell/components/icons';
import { PERMIT_DOCUMENT_TYPE_META } from '../statusMeta';

// Fila de KPIs superior (skill.md §"RESUMEN"), reutilizando KpiCard tal
// cual — mismo patrón que QualificationSummary. Se agrupa en dos
// subconjuntos (Carnet/Licencia) bajo el mismo estilo de encabezado
// discreto que ya usa AgentQualificationDrawer para "Información del
// agente"/"Resumen", en vez de mezclar los 6 KPI en una sola fila sin
// contexto de a qué documento pertenece cada uno.
function DocumentGroup({ label, icon: IconComponent, activeCount, expiringSoonCount, expiredCount, loading }) {
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
        <IconComponent className="h-3.5 w-3.5" />
        {label}
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Vigentes" value={activeCount} icon={ShieldCheckIcon} loading={loading} />
        <KpiCard
          label="Próximos a vencer"
          value={expiringSoonCount}
          icon={ClockIcon}
          tone={expiringSoonCount > 0 ? 'warning' : 'default'}
          loading={loading}
        />
        <KpiCard
          label="Vencidos"
          value={expiredCount}
          icon={AlertTriangleIcon}
          tone="danger"
          loading={loading}
          emphasize={expiredCount > 0}
        />
      </div>
    </div>
  );
}

export default function PermitSummary({ kpis, loading }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <DocumentGroup
        label={PERMIT_DOCUMENT_TYPE_META.carnet.label}
        icon={PERMIT_DOCUMENT_TYPE_META.carnet.icon}
        activeCount={kpis.carnetActiveCount}
        expiringSoonCount={kpis.carnetExpiringSoonCount}
        expiredCount={kpis.carnetExpiredCount}
        loading={loading}
      />
      <DocumentGroup
        label={PERMIT_DOCUMENT_TYPE_META.licencia.label}
        icon={PERMIT_DOCUMENT_TYPE_META.licencia.icon}
        activeCount={kpis.licenciaActiveCount}
        expiringSoonCount={kpis.licenciaExpiringSoonCount}
        expiredCount={kpis.licenciaExpiredCount}
        loading={loading}
      />
    </div>
  );
}
