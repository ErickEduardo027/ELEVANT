import { TERMINAL_FILTERS } from '../positionsMapMappers';
import { useTranslation } from '../../../i18n/LanguageScope';
import { positionsMapMessages } from '../positionsMapMessages';

export default function TerminalSelector({ active, onChange }) {
  const { t } = useTranslation(positionsMapMessages);
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('terminals.filterLabel')}>
      {TERMINAL_FILTERS.map(({ id }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={active === id}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-200 ${
            active === id
              ? 'border-accent-600 bg-accent-600/10 text-accent-600'
              : 'border-black/10 text-text-secondary-light hover:border-accent-600/40 dark:border-white/10 dark:text-text-secondary-dark'
          }`}
        >
          {t(`terminals.filters.${id}`)}
        </button>
      ))}
    </div>
  );
}
