import { MapPinIcon } from '../../dashboard/components/icons';
import { useTranslation } from '../../../i18n/LanguageScope';
import { positionsMapMessages } from '../positionsMapMessages';

const REASONS = ['no-positions', 'no-results'];

export default function EmptyPositionsState({ reason = 'no-positions' }) {
  const { t } = useTranslation(positionsMapMessages);
  const key = REASONS.includes(reason) ? reason : 'no-positions';

  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-black/5 bg-white/70 p-8 text-center backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <MapPinIcon className="h-8 w-8 text-text-secondary-light dark:text-text-secondary-dark" />
      <p className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{t(`empty.${key}.title`)}</p>
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{t(`empty.${key}.description`)}</p>
    </div>
  );
}
