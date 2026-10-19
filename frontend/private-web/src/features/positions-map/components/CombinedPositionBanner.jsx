import { getCombinedConfigExplanation } from '../positionsMapMappers';
import { AlertTriangleIcon } from '../../dashboard/components/icons';
import { LinkIcon } from './icons';
import { useTranslation } from '../../../i18n/LanguageScope';
import { positionsMapMessages } from '../positionsMapMessages';

export default function CombinedPositionBanner({ position }) {
  const { t } = useTranslation(positionsMapMessages);
  const explanation = getCombinedConfigExplanation(position, t);
  if (!explanation) return null;

  return (
    <div
      data-testid="combined-position-banner"
      role="alert"
      className="space-y-1.5 rounded-xl border border-dashed border-status-danger/60 bg-status-danger/10 p-3 text-xs"
    >
      <p className="flex items-center gap-1.5 font-semibold text-status-danger">
        <AlertTriangleIcon className="h-3.5 w-3.5" />
        {t('combined.title')}
      </p>
      <p className="text-status-danger">{explanation.reason}</p>
      <p className="flex items-start gap-1.5 text-status-danger/90">
        <LinkIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {explanation.relation}
      </p>
    </div>
  );
}
