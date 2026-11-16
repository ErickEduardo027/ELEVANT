import { getCombinedConfigExplanation } from '../positionsMapMappers';
import OccGlyph from '../../occ-ui/OccGlyph';
import { LinkIcon } from './icons';
import { useTranslation } from '../../../i18n/LanguageScope';
import { positionsMapMessages } from '../positionsMapMessages';

// A stand disabled by a combined configuration: the attention box with its glyph and its words (design B.4), never the
// colour alone; the text stays in the primary colour.
export default function CombinedPositionBanner({ position }) {
  const { t } = useTranslation(positionsMapMessages);
  const explanation = getCombinedConfigExplanation(position, t);
  if (!explanation) return null;

  return (
    <div
      data-testid="combined-position-banner"
      role="alert"
      className="space-y-1.5 rounded border border-l-[3px] border-occ-line border-l-occ-warn bg-occ-warn-soft p-3 text-sm text-occ-text"
    >
      <p className="flex items-center gap-1.5 font-semibold">
        <OccGlyph name="attention" />
        {t('combined.title')}
      </p>
      <p>{explanation.reason}</p>
      <p className="flex items-start gap-1.5">
        <LinkIcon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-occ-muted" />
        {explanation.relation}
      </p>
    </div>
  );
}
