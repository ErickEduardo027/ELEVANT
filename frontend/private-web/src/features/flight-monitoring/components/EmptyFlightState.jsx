import { RadarIcon } from '../../shell/components/icons';
import { useTranslation } from '../../../i18n/LanguageScope';
import { flightMonitoringMessages } from '../flightMonitoringMessages';

const REASONS = ['no-flights', 'no-results'];

export default function EmptyFlightState({ reason = 'no-flights' }) {
  const { t } = useTranslation(flightMonitoringMessages);
  const key = REASONS.includes(reason) ? reason : 'no-flights';

  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-black/5 bg-white/70 p-8 text-center backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <RadarIcon className="h-8 w-8 text-text-secondary-light dark:text-text-secondary-dark" />
      <p className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{t(`empty.${key}.title`)}</p>
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{t(`empty.${key}.description`)}</p>
    </div>
  );
}
