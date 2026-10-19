import { ChecklistIcon } from '../../dashboard/components/icons';
import { useTranslation } from '../../../i18n/LanguageScope';
import { planningMessages } from '../planningMessages';

const COPY = {
  'no-flights': { title: 'empty.noFlightsTitle', description: 'empty.noFlightsDescription' },
  'no-results': { title: 'empty.noResultsTitle', description: 'empty.noResultsDescription' },
};

export default function EmptyPlanningState({ reason }) {
  const { t } = useTranslation(planningMessages);
  const copy = COPY[reason] ?? COPY['no-results'];

  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-black/5 bg-white/70 px-6 py-16 text-center backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <ChecklistIcon className="h-6 w-6 text-text-secondary-light dark:text-text-secondary-dark" />
      <p className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{t(copy.title)}</p>
      <p className="max-w-md text-xs text-text-secondary-light dark:text-text-secondary-dark">{t(copy.description)}</p>
    </div>
  );
}
