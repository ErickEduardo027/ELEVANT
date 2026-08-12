import KpiCard from '../../../../components/KpiCard';
import HorizontalBarList from '../../../../components/HorizontalBarList';
import { UsersIcon, MailIcon, UserMinusIcon, ShieldCheckIcon } from '../../../shell/components/icons';
import { PORTAL_META } from '../statusMeta';

export default function UserStatsRow({ kpis, loading }) {
  const portalItems = Object.entries(kpis.byPortal ?? {}).map(([portal, value]) => ({
    key: portal,
    label: PORTAL_META[portal]?.label ?? portal,
    value,
  }));

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Usuarios activos" value={kpis.activeCount} icon={UsersIcon} loading={loading} />
      <KpiCard
        label="Cuentas pendientes de activación"
        value={kpis.pendingCount}
        icon={MailIcon}
        tone={kpis.pendingCount > 0 ? 'signal' : 'default'}
        loading={loading}
      />
      <KpiCard
        label="Cuentas deshabilitadas"
        value={kpis.disabledCount}
        icon={UserMinusIcon}
        tone={kpis.disabledCount > 0 ? 'warning' : 'default'}
        loading={loading}
      />
      <KpiCard
        label="Usuarios por portal"
        value={kpis.total}
        icon={ShieldCheckIcon}
        loading={loading}
        visual={portalItems.length > 0 ? <HorizontalBarList items={portalItems} /> : undefined}
      />
    </div>
  );
}
