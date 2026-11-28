'use client';

import { useTranslation } from '../../../i18n/LanguageScope';
import OccFloatingPanel from '../../occ-ui/OccFloatingPanel';
import { OccRemoteView } from '../../occ-ui/OccPanel';
import OccStatTile, { OccStatList } from '../../occ-ui/OccStatTile';
import { consoleMessages } from './consoleMessages';

// «Cifras de la jornada» (contratos 2.5, design D.1): the six figures of the day (consoleModel.js: buildFigures). Over
// the map (CN-32; floating since M1) they are one strip along its top edge (`strip`), its title at the left and the
// figures in a row, divided by joints; in the fallback grid, a panel of tiles. A figure whose read has not answered
// shows «—», never a zero nobody counted; only «Sin recursos» asks for attention, and only above zero («cabina oscura»:
// normal figures carry no hue). «En operación» keeps counting an operation still open an hour after its aircraft left,
// and says how many are, on a line of their own with the amber triangle (N30, D-N30): «1 abierta tras la salida».

const FIGURES = Object.freeze([
  { id: 'turnarounds', tone: 'neutral', href: '/admin-occ/planning' },
  { id: 'inOperation', tone: 'neutral', detail: 'openAfterDeparture', detailTone: 'attention' },
  { id: 'arriving60', tone: 'neutral' },
  { id: 'needsResources', tone: 'attention', href: '/admin-occ/planning' },
  { id: 'toReview', tone: 'neutral', href: '/admin-occ/review' },
  { id: 'completed', tone: 'neutral' },
]);

/** The line a figure says of its count `figures[figure.detail]`, once it is above zero; `null` otherwise. */
function detailOf(figure, figures, t) {
  const count = figure.detail ? figures?.[figure.detail] : null;
  if (!Number.isFinite(count) || count <= 0) return null;
  return t(count === 1 ? `figures.${figure.detail}One` : `figures.${figure.detail}`, { count });
}

/**
 * The figures panel. `figures` is buildFigures' model and `state` the remote state of the planning snapshot, which most
 * figures come from (`{ status, staleSince, onRetry }`). A day without turnarounds (`empty`) is a day the planning
 * answered: its figures are counted, zeros included, next to «Llegan en 60 min» and «Por revisar», which come from the
 * map flights and the review queue. `strip` draws them as the one line along the top of the map: the header beside
 * the figures (`row`), the tiles a size smaller and «Cifras» on the button below 1400 px; otherwise a panel of tiles,
 * whatever its `layout`.
 */
export default function FiguresPanel({
  figures, state, labels, timeZone, measureRef, layout = 'float', strip = false, defaultFolded = false, className = '',
}) {
  const { t } = useTranslation(consoleMessages);
  const shown = state?.status === 'empty' ? { ...state, status: 'success' } : state;
  return (
    <OccFloatingPanel ref={measureRef} panelId="figures" title={t('panels.figures')} layout={layout}
      shortTitle={strip ? t('panels.figuresShort') : undefined} orientation={strip ? 'row' : 'column'}
      defaultFolded={defaultFolded} className={className}>
      <OccRemoteView {...shown} labels={labels} timeZone={timeZone} className={strip ? 'h-full' : ''}>
        <OccStatList label={t('panels.figures')}
          className={strip
            ? 'flex h-full flex-wrap items-stretch divide-x divide-occ-line'
            : 'grid grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] gap-x-4 gap-y-3 px-3 py-2'}>
          {FIGURES.map(figure => (
            <OccStatTile key={figure.id} label={t(`figures.${figure.id}`)} hint={t(`figures.${figure.id}Hint`)}
              value={figures?.[figure.id] ?? null} tone={figure.tone} href={figure.href}
              isLowerBound={figure.id === 'toReview' && figures?.toReviewIsLowerBound === true}
              detail={detailOf(figure, figures, t)} detailTone={figure.detailTone} compact={strip}
              className={strip ? 'flex-1 basis-auto px-3 py-1 [&_dt]:whitespace-nowrap' : ''} />
          ))}
        </OccStatList>
      </OccRemoteView>
    </OccFloatingPanel>
  );
}
