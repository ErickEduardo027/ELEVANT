import KpiCard from '../../../components/KpiCard';
import { PlaneIcon, ChecklistIcon, MapPinIcon } from '../../dashboard/components/icons';
import { useTranslation } from '../../../i18n/LanguageScope';
import { planningMessages } from '../planningMessages';

export default function PlanningKPIs({ kpis, loading = false }) {
  const { t } = useTranslation(planningMessages);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label={t('kpis.turnarounds')} value={kpis.turnarounds} icon={PlaneIcon} loading={loading} />
      <KpiCard label={t('kpis.flightLegs')} value={kpis.flightLegs} icon={PlaneIcon} loading={loading} />
      <KpiCard
        label={t('kpis.pendingAssignment')}
        value={kpis.pendingAssignment}
        icon={ChecklistIcon}
        loading={loading}
        tone={kpis.pendingAssignment > 0 ? 'signal' : 'default'}
      />
      <KpiCard label={t('kpis.positionsAssigned')} value={kpis.positionsAssigned} icon={MapPinIcon} loading={loading} />
    </div>
  );
}
