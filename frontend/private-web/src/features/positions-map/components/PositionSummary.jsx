import { computePositionsSummary } from '../positionsMapMappers';
import { POSITION_STATUS_META, STATUS_COLORS, getStatusLabel } from '../../dashboard/statusMeta';
import { useTranslation } from '../../../i18n/LanguageScope';
import { positionsMapMessages } from '../positionsMapMessages';

const PLANNING_ROWS = ['planned', 'unverified'];
// Live occupancy also has stands planned for a flight that has not arrived and reference positions without a
// registered stand: every status gets its row, so the rows add up to the total (2-N34).
const LIVE_ROWS = ['available', 'occupied', 'releasing', 'planned', 'disabled', 'unverified'];

export default function PositionSummary({ positions, source }) {
  const { t, language } = useTranslation(positionsMapMessages);
  const summary = computePositionsSummary(positions);
  const rows = source === 'planning' ? PLANNING_ROWS : LIVE_ROWS;

  return (
    <div className="absolute bottom-4 right-4 z-10 w-48 rounded-xl border border-black/10 bg-white/90 p-3 text-xs shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card">
      <p className="font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">{t('summary.title')}</p>
      <p className="mt-1 font-mono text-lg font-semibold text-ink-900 dark:text-text-primary-dark">{summary.total}</p>
      <ul className="mt-2 space-y-1">
        {rows.map(row => (
          <li key={row} className="flex items-center justify-between text-text-secondary-light dark:text-text-secondary-dark">
            <span className="flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: STATUS_COLORS[POSITION_STATUS_META[row].color] }}
                aria-hidden="true"
              />
              {getStatusLabel('position', row, language)}
            </span>
            <span className="font-mono font-medium text-ink-900 dark:text-text-primary-dark">{summary[row]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
