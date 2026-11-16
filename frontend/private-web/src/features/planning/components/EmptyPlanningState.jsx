import OccEmptyState from '../../occ-ui/OccEmptyState';
import { useTranslation } from '../../../i18n/LanguageScope';
import { planningMessages } from '../planningMessages';

const COPY = {
  'no-flights': { title: 'empty.noFlightsTitle', description: 'empty.noFlightsDescription' },
  'no-results': { title: 'empty.noResultsTitle', description: 'empty.noResultsDescription' },
};

// What is absent and what to do (design H.1), on the panel slab.
export default function EmptyPlanningState({ reason }) {
  const { t } = useTranslation(planningMessages);
  const copy = COPY[reason] ?? COPY['no-results'];
  return (
    <OccEmptyState title={t(copy.title)} description={t(copy.description)}
      className="rounded-md border border-occ-line bg-occ-panel px-4 py-10 text-center" />
  );
}
