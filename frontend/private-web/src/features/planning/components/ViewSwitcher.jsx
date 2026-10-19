import { useTranslation } from '../../../i18n/LanguageScope';
import { planningMessages } from '../planningMessages';

const VIEWS = ['timeline', 'table', 'calendar'];

export default function ViewSwitcher({ active, onChange }) {
  const { t } = useTranslation(planningMessages);
  return (
    <div
      role="group"
      aria-label={t('views.label')}
      className="inline-flex rounded-xl border border-black/10 bg-white/70 p-1 dark:border-white/10 dark:bg-surface-dark-card"
    >
      {VIEWS.map(view => (
        <button
          key={view}
          type="button"
          aria-pressed={active === view}
          onClick={() => onChange(view)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-200 ${
            active === view
              ? 'bg-accent-600 text-white'
              : 'text-text-secondary-light hover:text-ink-900 dark:text-text-secondary-dark dark:hover:text-text-primary-dark'
          }`}
        >
          {t(`views.${view}`)}
        </button>
      ))}
    </div>
  );
}
