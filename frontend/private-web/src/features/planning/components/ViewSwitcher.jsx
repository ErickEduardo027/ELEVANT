import OccSegmented from '../../occ-ui/OccSegmented';
import { useTranslation } from '../../../i18n/LanguageScope';
import { planningMessages } from '../planningMessages';

/** The four views of Planificación, in the order of the switch. */
export const PLANNING_VIEWS = Object.freeze(['timeline', 'positions', 'table', 'map']);

// The views as a segmented control (occ-ui/OccSegmented.jsx): toggle buttons with `aria-pressed`, one stop each.
export default function ViewSwitcher({ active, onChange }) {
  const { t } = useTranslation(planningMessages);
  return (
    <OccSegmented label={t('views.label')} value={active} onChange={onChange}
      options={PLANNING_VIEWS.map(view => ({ id: view, label: t(`views.${view}`) }))} />
  );
}
