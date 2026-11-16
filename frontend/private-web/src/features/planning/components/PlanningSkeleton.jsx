import { useTranslation } from '../../../i18n/LanguageScope';
import { planningMessages } from '../planningMessages';

export default function PlanningSkeleton() {
  const { t } = useTranslation(planningMessages);
  return (
    <div data-testid="planning-skeleton" role="status" aria-label={t('states.loading')} className="space-y-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          data-testid="planning-skeleton-row"
          className="h-16 animate-pulse rounded-xl border border-black/5 bg-white/60 dark:border-white/5 dark:bg-surface-dark-card"
        />
      ))}
    </div>
  );
}
