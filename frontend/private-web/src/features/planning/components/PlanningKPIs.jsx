import OccStatTile, { OccStatList } from '../../occ-ui/OccStatTile';
import { useTranslation } from '../../../i18n/LanguageScope';
import { planningMessages } from '../planningMessages';

// The figures of the day (occ-ui/OccStatTile.jsx): only what the planning read model derives truthfully. A turnaround
// still missing its stand or its agent asks to be looked at with the amber triangle.
const TILE = 'rounded-md border border-occ-line bg-occ-panel px-3 py-2';

export default function PlanningKPIs({ kpis, loading = false }) {
  const { t } = useTranslation(planningMessages);
  return (
    <OccStatList label={t('kpis.label')} className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <OccStatTile label={t('kpis.turnarounds')} value={kpis.turnarounds} loading={loading} className={TILE} />
      <OccStatTile label={t('kpis.flightLegs')} value={kpis.flightLegs} loading={loading} className={TILE} />
      <OccStatTile label={t('kpis.pendingAssignment')} value={kpis.pendingAssignment} loading={loading}
        tone="attention" className={TILE} />
      <OccStatTile label={t('kpis.positionsAssigned')} value={kpis.positionsAssigned} loading={loading} className={TILE} />
    </OccStatList>
  );
}
