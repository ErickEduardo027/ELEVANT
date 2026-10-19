import { SearchIcon } from '../../flight-monitoring/components/icons';
import { useTranslation } from '../../../i18n/LanguageScope';
import { positionsMapMessages } from '../positionsMapMessages';

export default function PositionSearchBar({ value, onChange, onSubmit, notFound = false }) {
  const { t } = useTranslation(positionsMapMessages);
  return (
    <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
      {t('search.label')}
      <span className="relative">
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-secondary-light dark:text-text-secondary-dark" />
        <input
          type="text"
          value={value}
          onChange={event => onChange(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') onSubmit?.(value);
          }}
          placeholder={t('search.placeholder')}
          className="w-full rounded-lg border border-black/10 bg-white/80 py-1.5 pl-7 pr-2 text-sm text-ink-900 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
        />
      </span>
      {notFound && <span className="text-status-danger">{t('search.notFound')}</span>}
    </label>
  );
}
