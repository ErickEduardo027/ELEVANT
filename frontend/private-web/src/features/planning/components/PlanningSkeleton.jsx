import OccSkeleton from '../../occ-ui/OccSkeleton';
import { useTranslation } from '../../../i18n/LanguageScope';
import { planningMessages } from '../planningMessages';

// The first load of the day's turnarounds: static rows, no shimmer (occ-ui/OccSkeleton.jsx).
export default function PlanningSkeleton() {
  const { t } = useTranslation(planningMessages);
  return (
    <div data-testid="planning-skeleton" role="status" aria-label={t('states.loading')}
      className="space-y-2 rounded-md border border-occ-line bg-occ-panel p-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} data-testid="planning-skeleton-row" aria-hidden="true">
          <OccSkeleton rows={1} />
        </div>
      ))}
    </div>
  );
}
