'use client';

import { useTranslation } from '../../../i18n/LanguageScope';
import OccFloatingPanel from '../../occ-ui/OccFloatingPanel';
import { OccRemoteView } from '../../occ-ui/OccPanel';
import OccStatTile, { OccStatList } from '../../occ-ui/OccStatTile';
import { consoleMessages } from './consoleMessages';

// «Cifras de la jornada» (contratos 2.5, design D.1): the six figures of the day over the top centre of the map
// (consoleModel.js: buildFigures). A figure whose read has not answered shows «—», never a zero nobody counted; only
// «Sin recursos» asks for attention, and only above zero («cabina oscura»: normal figures carry no hue).

const FIGURES = Object.freeze([
  { id: 'turnarounds', tone: 'neutral', href: '/admin-occ/planning' },
  { id: 'inOperation', tone: 'neutral' },
  { id: 'arriving60', tone: 'neutral' },
  { id: 'needsResources', tone: 'attention', href: '/admin-occ/planning' },
  { id: 'toReview', tone: 'neutral', href: '/admin-occ/review' },
  { id: 'completed', tone: 'neutral' },
]);

/**
 * The figures panel. `figures` is buildFigures' model and `state` the remote state of the planning snapshot, which most
 * figures come from (`{ status, staleSince, onRetry }`).
 */
export default function FiguresPanel({
  figures, state, labels, timeZone, measureRef, layout = 'float', defaultFolded = false, className = '',
}) {
  const { t } = useTranslation(consoleMessages);
  return (
    <OccFloatingPanel ref={measureRef} panelId="figures" title={t('panels.figures')} layout={layout}
      defaultFolded={defaultFolded} className={className}>
      <OccRemoteView {...state} labels={labels} timeZone={timeZone}>
        <OccStatList label={t('panels.figures')}
          className="grid grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] gap-x-4 gap-y-3 px-3 py-2">
          {FIGURES.map(figure => (
            <OccStatTile key={figure.id} label={t(`figures.${figure.id}`)} hint={t(`figures.${figure.id}Hint`)}
              value={figures?.[figure.id] ?? null} tone={figure.tone} href={figure.href}
              isLowerBound={figure.id === 'toReview' && figures?.toReviewIsLowerBound === true} />
          ))}
        </OccStatList>
      </OccRemoteView>
    </OccFloatingPanel>
  );
}
